import type { Document } from 'mongodb';
import { measure, type Bar, type Impact } from '../chat/market.js';

/**
 * Journey story: what changed in an asset's evidence, laid out over time (spec
 * docs/superpowers/specs/2026-10-10-journey-story-design.md). Pure functions over stored data, so the endpoint, the
 * Asset AI tools and the tests compute the same thing. Facts come from the data; the model only names chapters and
 * writes notes that cite these events.
 */

export const LANES = ['regulatory', 'clinical', 'company', 'ip', 'safety'] as const;
export const KEY_SIGNIFICANCE = ['High', 'Medium'];
const MAX_EVENTS = 800;
const CHAPTER_MERGE_DAYS = 3 * 365; // approvals this close start one chapter
const APPROVAL = new Set(['approval']);
const PHASE3 = /PHASE3/i;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface StorySpec {
  from?: string;
  to?: string;
  /** Focus window start: "what changed since". */
  since?: string;
  category?: string[];
  significance?: string[];
  /** Another asset to compare journeys with. */
  compare?: string;
}

export interface Change {
  kind: 'added' | 'changed' | 'removed';
  field?: string;
  before?: unknown;
  after?: unknown;
  at: string;
}

export interface Verification {
  status: 'confirmed' | 'unconfirmed' | 'conflict';
  note: string;
  against: string[];
}

export interface StoryEvent {
  id: string;
  date: string;
  type: string;
  category: string;
  title: string;
  summary?: string;
  significance: string;
  upcoming: boolean;
  origin: string;
  region?: string;
  indication?: string;
  phase?: string;
  /** Sponsor of a regulator record; `ownProduct` false = another company's product of the same molecule. */
  sponsor?: string;
  ownProduct?: boolean;
  source: { collection: string; record_key: string } | null;
  sources: number;
  change?: Change;
  verification?: Verification;
  /** Share-price move after the event (company listing), for events in the focus window. */
  impact?: Impact | null;
}

export interface ApprovalStep {
  id: string;
  date: string;
  region: string;
  product: string;
  /** Approved products so far (US and EU), the height of the staircase. */
  level: number;
}

export interface Chapter {
  id: string;
  name: string;
  from: string;
  to: string;
  focus: boolean;
  events: number;
  byCategory: Record<string, number>;
  highlights: string[];
}

export interface StoryChanges {
  since: string | null;
  /** Key events dated in the focus window: the new findings. */
  developments: StoryEvent[];
  /** What the pipeline saw change: an event first seen late, a date moved, a status changed, an event removed. */
  updates: (Change & { eventId: string; title: string; category: string; eventDate: string })[];
  /** Cross-source checks: an approval no regulator record confirms, sources giving different dates. */
  checks: StoryEvent[];
  /** Investor-slide figures that contradict the slide's own chart. */
  slides: { recordKey: string; title: string; date: string; metric: string; value: string }[];
  /** FDA label changes in the window (efficacy and labeling supplements). */
  labels: StoryEvent[];
  /** Trials that stopped or completed in the window. */
  trials: StoryEvent[];
  /** Evidence first seen by the pipeline in the window (AI screening decisions), by decision. */
  firstSeen: { total: number; kept: number; headline: number; items: { title: string; date: string; source: string; category: string; decision: string; url: string | null }[] };
  upcoming: StoryEvent[];
}

export interface Delta {
  label: string;
  primary: string;
  other: string;
  note?: string;
}

export interface StoryCompare {
  asset: { id: string; name: string };
  events: StoryEvent[];
  deltas: Delta[];
}

export interface StoryMarket {
  ticker: string;
  listedName: string | null;
  viaParent: boolean;
  source: string | null;
  /** Weekly closes in range: a light price strip under the lanes. */
  closes: Bar[];
}

export interface Story {
  asset: { id: string; name: string; company: string | null };
  market: StoryMarket | null;
  spec: StorySpec;
  range: { from: string; to: string; today: string };
  approvals: ApprovalStep[];
  lanes: { category: string; events: StoryEvent[]; total: number }[];
  changes: StoryChanges;
  chapters: Chapter[];
  compare: StoryCompare | null;
  counts: { events: number; shown: number; byCategory: Record<string, number> };
}

export const monthYear = (d: string) => (/^\d{4}-\d{2}/.test(d) ? `${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : d);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const addYears = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;

/** "FDA approves Tyvaso DPI" → "Tyvaso DPI"; "EU marketing authorisation: Trepulmix" → "Trepulmix". */
export function productOf(title: string): string {
  const m = /^(?:FDA approves|EU marketing authorisation:)\s+(.+)$/i.exec(title.trim());
  return (m?.[1] ?? title).trim();
}

export function toStoryEvent(e: Document, change?: Change): StoryEvent {
  const sources = (e.sources ?? []) as { collection: string; record_key: string }[];
  const verification = e.verification as Verification | undefined;
  return {
    id: String(e._id),
    date: String(e.date ?? ''),
    type: String(e.type ?? ''),
    category: String(e.category ?? 'other'),
    title: String(e.title ?? 'Untitled event'),
    ...(e.summary ? { summary: String(e.summary) } : {}),
    significance: String(e.significance ?? 'Low'),
    upcoming: e.is_milestone === true,
    origin: String(e.origin ?? 'rule'),
    ...(e.region ? { region: String(e.region) } : {}),
    ...(e.indication ? { indication: String(e.indication) } : {}),
    ...(e.phase ? { phase: String(e.phase) } : {}),
    ...(e.sponsor ? { sponsor: String(e.sponsor) } : {}),
    ...(typeof e.sponsor_is_company === 'boolean' && e.category === 'regulatory' ? { ownProduct: e.sponsor_is_company } : {}),
    source: sources[0] ? { collection: sources[0].collection, record_key: sources[0].record_key } : null,
    sources: sources.length + ((e.merged_sources as unknown[] | undefined)?.length ?? 0),
    ...(change ? { change } : {}),
    ...(verification?.status ? { verification } : {}),
  };
}

/**
 * The company's product approvals (FDA original approvals, EU authorisations), oldest first, as a cumulative
 * staircase. Another company's product of the same molecule (e.g. a competitor's formulation) is not a step.
 */
export function approvalSteps(events: StoryEvent[]): ApprovalStep[] {
  return events
    .filter((e) => APPROVAL.has(e.type) && e.origin === 'rule' && !e.upcoming && e.date && e.ownProduct !== false)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e, i) => ({ id: e.id, date: e.date, region: e.region ?? '', product: productOf(e.title), level: i + 1 }));
}

/**
 * The journey's chapters: before the first approval, then one per approval wave (approvals within three years
 * start one chapter), the focus window when there is one, and what lies ahead.
 */
export function chapters(all: StoryEvent[], approvals: ApprovalStep[], today: string, since?: string): Chapter[] {
  const past = all.filter((e) => !e.upcoming && e.date && e.date <= today);
  const first = past.reduce((m, e) => (e.date < m ? e.date : m), today);
  const spans: { name: string; from: string; to: string; focus: boolean }[] = [];
  const waves: ApprovalStep[][] = [];
  for (const a of approvals) {
    const wave = waves.at(-1);
    if (wave && days(wave[0]!.date, a.date) <= CHAPTER_MERGE_DAYS) wave.push(a);
    else waves.push([a]);
  }
  if (!waves.length || first < waves[0]![0]!.date) spans.push({ name: waves.length ? 'Before first approval' : 'Development', from: first, to: waves[0]?.[0]!.date ?? today, focus: false });
  waves.forEach((w, i) => {
    const names = [...new Set(w.map((a) => a.product))];
    spans.push({ name: `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''} approved`, from: w[0]!.date, to: waves[i + 1]?.[0]!.date ?? today, focus: false });
  });
  let out = spans;
  if (since && since < today) {
    out = spans.filter((c) => c.from < since).map((c) => (c.to > since ? { ...c, to: since } : c));
    out.push({ name: `Since ${monthYear(since)}`, from: since, to: today, focus: true });
  }
  const ahead = all.filter((e) => e.upcoming && e.date >= today).map((e) => e.date).sort();
  if (ahead.length) out.push({ name: 'Ahead', from: today, to: ahead.at(-1)!, focus: false });

  return out.map((c, i) => {
    const inside = all.filter((e) => e.date >= c.from && (e.date < c.to || (i === out.length - 1 && e.date <= c.to)) && (c.name === 'Ahead' ? e.upcoming : !e.upcoming));
    const byCategory: Record<string, number> = {};
    for (const e of inside) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    const highlights = inside.filter((e) => e.significance === 'High').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map((e) => e.id);
    return { id: `ch-${i + 1}`, name: c.name, from: c.from, to: c.to, focus: c.focus, events: inside.length, byCategory, highlights };
  });
}

/** Range of the plot: the spec's, else the whole journey up to the last upcoming milestone (at most 5 years out). */
export function storyRange(all: StoryEvent[], spec: StorySpec, today: string): { from: string; to: string } {
  const dated = all.map((e) => e.date).filter(Boolean).sort();
  const from = spec.from ?? `${(dated[0] ?? today).slice(0, 4)}-01-01`;
  const lastAhead = dated.at(-1) ?? today;
  const cap = addYears(today, 5);
  const to = spec.to ?? `${(lastAhead > today ? (lastAhead < cap ? lastAhead : cap) : today).slice(0, 4)}-12-31`;
  return { from, to };
}

const indicationsOf = (a: Document | null) => ((a?.tags?.indications ?? []) as string[]).map((s) => s.trim()).filter(Boolean);
const firstApproval = (steps: ApprovalStep[], region: string) => steps.find((s) => s.region === region);
const yearsBetween = (a?: string, b?: string) => (a && b ? Math.abs(days(a, b)) / 365.25 : null);

/** Differences between two journeys that change how either reads: approval timing, breadth, late-stage work. */
export function compareDeltas(primary: { asset: Document; events: StoryEvent[] }, other: { asset: Document; events: StoryEvent[] }, today: string): Delta[] {
  const pa = approvalSteps(primary.events);
  const oa = approvalSteps(other.events);
  const fmt = (s?: ApprovalStep) => (s ? `${monthYear(s.date)} (${s.product})` : 'none recorded');
  const deltas: Delta[] = [];
  for (const region of ['US', 'EU']) {
    const p = firstApproval(pa, region);
    const o = firstApproval(oa, region);
    if (!p && !o) continue;
    const lag = yearsBetween(p?.date, o?.date);
    deltas.push({
      label: `First ${region === 'US' ? 'FDA' : 'EU'} approval`, primary: fmt(p), other: fmt(o),
      ...(lag !== null && p && o ? { note: `${(p.date < o.date ? primary : other).asset.name} first by ${lag.toFixed(1)} years` } : {}),
    });
  }
  deltas.push({ label: 'Approved products (US + EU)', primary: String(pa.length), other: String(oa.length) });
  const p3 = (evs: StoryEvent[]) => evs.filter((e) => e.type === 'trial_start' && PHASE3.test(e.phase ?? '')).length;
  deltas.push({ label: 'Phase 3 trials started', primary: String(p3(primary.events)), other: String(p3(other.events)) });
  const pi = indicationsOf(primary.asset);
  const oi = indicationsOf(other.asset);
  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));
  const onlyP = pi.filter((i) => !lower(oi).has(i.toLowerCase()));
  const onlyO = oi.filter((i) => !lower(pi).has(i.toLowerCase()));
  if (onlyP.length || onlyO.length) deltas.push({ label: 'Approved indications only one has', primary: onlyP.join(', ') || '—', other: onlyO.join(', ') || '—' });
  const next = (evs: StoryEvent[]) => evs.filter((e) => e.upcoming && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const pn = next(primary.events);
  const on = next(other.events);
  if (pn || on) deltas.push({ label: 'Next milestone', primary: pn ? `${monthYear(pn.date)} · ${pn.title}` : '—', other: on ? `${monthYear(on.date)} · ${on.title}` : '—' });
  return deltas;
}

/** Events worth showing for a competitor on the same axis: its approvals, regulatory decisions and late-stage trials. */
const COMPARE_TYPES = new Set(['approval', 'label_expansion', 'complete_response_letter', 'pdufa_date', 'regulatory_decision_expected', 'trial_readout', 'expected_readout', 'trial_completion']);
export const compareWorthy = (e: StoryEvent) =>
  COMPARE_TYPES.has(e.type) || (e.type === 'trial_start' && PHASE3.test(e.phase ?? '')) || (e.category === 'clinical' && e.significance === 'High');

/** One close per ISO week (the last of the week): enough for a price strip, a fifth of the payload. */
export function weekly(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const d = new Date(`${b.date}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (out.length && (out.at(-1) as Bar & { w?: string }).w === monday) out[out.length - 1] = { ...b, w: monday } as Bar;
    else out.push({ ...b, w: monday } as Bar);
  }
  return out.map(({ date, close }) => ({ date, close }));
}

export interface StoryInput {
  asset: Document;
  events: Document[];
  changes: Document[];
  slides: Document[];
  /** AI screening decisions in the focus window (crawl_ledger). */
  ledger?: Document[];
  market?: { listing: Document; bars: Bar[]; source: string | null } | null;
  other?: { asset: Document; events: Document[] } | null;
  spec: StorySpec;
  today: string;
}

export function composeStory(input: StoryInput): Story {
  const { spec, today } = input;
  const latest = new Map<string, Change>();
  for (const c of input.changes) {
    const id = String(c.event_id);
    const at = c.at instanceof Date ? c.at.toISOString() : String(c.at);
    if (!latest.has(id) || latest.get(id)!.at < at) {
      latest.set(id, { kind: c.kind, ...(c.field ? { field: c.field } : {}), ...(c.before !== undefined ? { before: c.before } : {}), ...(c.after !== undefined ? { after: c.after } : {}), at });
    }
  }
  const all = input.events.map((e) => toStoryEvent(e, latest.get(String(e._id))));
  const range = storyRange(all, spec, today);
  const significance = new Set(spec.significance?.length ? spec.significance : KEY_SIGNIFICANCE);
  const categories = new Set(spec.category?.length ? spec.category : LANES);
  const inRange = (e: StoryEvent) => e.date >= range.from && e.date <= range.to;
  const shown = all
    .filter((e) => e.date && inRange(e) && categories.has(e.category) && significance.has(e.significance))
    .sort((a, b) => (a.significance === 'High' ? 0 : 1) - (b.significance === 'High' ? 0 : 1) || b.date.localeCompare(a.date))
    .slice(0, MAX_EVENTS)
    .sort((a, b) => a.date.localeCompare(b.date));
  const byCategory: Record<string, number> = {};
  for (const e of all) if (e.date && inRange(e) && significance.has(e.significance)) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;

  const since = spec.since ?? null;
  const key = all.filter((e) => significance.has(e.significance) && categories.has(e.category));
  const developments = since ? key.filter((e) => !e.upcoming && e.date >= since && e.date <= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50) : [];
  const titles = new Map(all.map((e) => [e.id, e]));
  const updates = input.changes
    .filter((c) => !c.baseline && (!since || (c.at instanceof Date ? c.at.toISOString() : String(c.at)) >= since))
    .sort((a, b) => String(b.at instanceof Date ? b.at.toISOString() : b.at).localeCompare(String(a.at instanceof Date ? a.at.toISOString() : a.at)))
    .slice(0, 50)
    .map((c) => ({
      eventId: String(c.event_id), kind: c.kind, ...(c.field ? { field: c.field } : {}), ...(c.before !== undefined ? { before: c.before } : {}),
      ...(c.after !== undefined ? { after: c.after } : {}), at: c.at instanceof Date ? c.at.toISOString() : String(c.at),
      title: String(c.title ?? titles.get(String(c.event_id))?.title ?? ''), category: String(c.category ?? ''), eventDate: String(c.event_date ?? ''),
    }));
  const checks = all.filter((e) => e.verification && e.verification.status !== 'confirmed').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
  const slides = input.slides.flatMap((s) =>
    ((s.metrics ?? []) as Document[]).filter((m) => m?.validation?.status === 'conflict').map((m) => ({
      recordKey: String(s.record_key), title: String(s.slide_title ?? s.title ?? 'Slide'), date: String(s.date ?? ''),
      metric: String(m.metric ?? ''), value: String(m.value_text ?? m.value ?? ''),
    })),
  ).slice(0, 20);
  const upcoming = all.filter((e) => e.upcoming && e.date >= today && categories.has(e.category)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  const inWindow = (e: StoryEvent) => !e.upcoming && (!since || e.date >= since) && e.date <= today;
  const labels = all.filter((e) => inWindow(e) && e.origin === 'rule' && (e.type === 'label_expansion' || e.type === 'label_update')).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  const trials = all.filter((e) => inWindow(e) && (e.type === 'trial_stopped' || e.type === 'trial_completion')).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  const kept = (input.ledger ?? []).filter((l) => l.decision === 'ingest' || l.decision === 'headline');
  const firstSeen = {
    total: kept.length,
    kept: kept.filter((l) => l.decision === 'ingest').length,
    headline: kept.filter((l) => l.decision === 'headline').length,
    items: kept
      .filter((l) => l.decision === 'ingest')
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
      .slice(0, 12)
      .map((l) => ({ title: String(l.title ?? ''), date: String(l.date ?? ''), source: String(l.source ?? ''), category: String(l.category ?? ''), decision: String(l.decision), url: (l.url as string) ?? null })),
  };
  // Share-price reaction after the window's developments (timing only, never causation).
  const bars = input.market?.bars ?? [];
  if (bars.length) for (const e of developments) e.impact = measure(bars, e.date, today).impact;

  const approvals = approvalSteps(all);
  let compare: StoryCompare | null = null;
  if (input.other) {
    const otherEvents = input.other.events.map((e) => toStoryEvent(e));
    compare = {
      asset: { id: String(input.other.asset._id), name: String(input.other.asset.name) },
      events: otherEvents.filter((e) => e.date && inRange(e) && compareWorthy(e)).sort((a, b) => a.date.localeCompare(b.date)),
      deltas: compareDeltas({ asset: input.asset, events: all }, { asset: input.other.asset, events: otherEvents }, today),
    };
  }
  return {
    asset: { id: String(input.asset._id), name: String(input.asset.name), company: (input.asset.company?.name as string | undefined) ?? null },
    market: input.market
      ? {
          ticker: String(input.market.listing.ticker), listedName: (input.market.listing.listed_name as string | null) ?? null,
          viaParent: input.market.listing.via_parent === true, source: input.market.source,
          closes: weekly(bars.filter((b) => b.date >= range.from && b.date <= range.to)),
        }
      : null,
    spec,
    range: { ...range, today },
    approvals,
    lanes: LANES.filter((c) => categories.has(c)).map((c) => ({ category: c, events: shown.filter((e) => e.category === c), total: byCategory[c] ?? 0 })),
    changes: { since, developments, updates, checks, slides, labels, trials, firstSeen, upcoming },
    chapters: chapters(key, approvals, today, since ?? undefined),
    compare,
    counts: { events: all.length, shown: shown.length, byCategory },
  };
}
