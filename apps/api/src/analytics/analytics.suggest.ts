import type { Document } from 'mongodb';

/** Suggested-analytics heuristics (ANALYTICS_PIPELINE.md); pure, unit-tested, no I/O. */
export interface Suggestion {
  id: 'tta' | 'label' | 'cal' | 'rev' | 'faers' | 'share';
  title: string;
  why: string;
  src: 'index' | 'web' | 'limited';
  records: number;
  sources?: string[];
}

export interface SuggestInput {
  asset: Document;
  /** Primary asset's branches and journey events (events carry `sources: [{collection, record_key}]`). */
  branches: Document[];
  events: Document[];
  trials: Document[];
  /** Dated competitor milestones from today on. */
  competitorMilestones: Document[];
  /** The company files with the SEC (CIK / ticker on the asset, or an SEC filing in its records). */
  secFiler: boolean;
}

const DECISION = new Set(['approval', 'label_expansion', 'new_formulation']);
export const SUPPLEMENT = new Set(['label_expansion', 'new_formulation']);
export const norm = (s: unknown) => String(s ?? '').toLowerCase();
export const keysOf = (events: Document[]) => [...new Set(events.flatMap((e) => (e.sources ?? []).map((s: Document) => s.record_key as string)).filter(Boolean))];
export const hasKeys = (e: Document) => keysOf([e]).length > 0;

export function pivotalPairs({ asset, branches, events, trials }: SuggestInput) {
  const tags = asset.tags ?? {};
  const programmes: { id: string; label: string; names: string[] }[] = branches.length
    ? branches.map((b) => ({ id: b.id as string, label: String(b.label ?? b.id), names: [b.id, b.label, b.full].filter(Boolean).map(norm) }))
    : [...(tags.indications ?? []), ...(tags.investigational_indications ?? [])].map((i: string) => ({ id: i, label: i, names: [norm(i)] }));
  const trunk = branches.find((b) => b.trunk)?.id;
  const pairs: { programme: { id: string; label: string }; trials: Document[]; decisions: Document[] }[] = [];
  for (const p of programmes) {
    const t = trials.filter(
      (r) => r.start_date && (r.phases ?? []).includes('PHASE3') && r.record_key && (r.conditions ?? []).some((c: string) => norm(c).trim() && p.names.some((n) => norm(c).includes(n) || n.includes(norm(c)))),
    );
    const d = events.filter((e) => DECISION.has(e.type) && !e.is_milestone && ((e.branch ?? trunk) === p.id || (e.indications ?? []).some((i: string) => norm(i) === norm(p.id))) && hasKeys(e));
    if (t.length && d.length) pairs.push({ programme: { id: p.id, label: p.label }, trials: t, decisions: d });
  }
  return pairs;
}

export function suggest(input: SuggestInput): Suggestion[] {
  const { asset, events, competitorMilestones, secFiler } = input;
  const out: Suggestion[] = [];

  const pairs = pivotalPairs(input);
  if (pairs.length >= 2) {
    const sources = [...new Set([...pairs.flatMap((p) => p.trials.map((t) => t.record_key as string)), ...keysOf(pairs.flatMap((p) => p.decisions))])];
    out.push({
      id: 'tta',
      title: 'Time from Phase 3 start to approval',
      why: `${pairs.length} programmes have both a pivotal trial and a decision in the index`,
      src: 'index',
      records: sources.length,
      sources,
    });
  }

  const supplements = events.filter((e) => SUPPLEMENT.has(e.type) && !e.is_milestone && hasKeys(e));
  if (supplements.length >= 3) {
    const products = new Set(supplements.map((e) => norm(e.product ?? e.branch)).filter(Boolean)).size || supplements.length;
    const sources = keysOf(supplements);
    out.push({ id: 'label', title: 'Label evolution by indication', why: products === 1 ? 'Label changes on 1 product are already on the journey' : `Label changes across ${products} products are already on the journey`, src: 'index', records: sources.length, sources });
  }

  const dated = competitorMilestones.filter(hasKeys);
  if (dated.length) {
    const names = [...new Set(dated.map((e) => e.assetName as string).filter(Boolean))];
    const why =
      names.length === 0 ? 'Competitors have upcoming dates'
      : names.length === 1 ? `${names[0]}'s journey has upcoming dates`
      : names.length === 2 ? `${names[0]} and ${names[1]} journeys have upcoming dates`
      : `${names[0]}, ${names[1]} and ${names.length - 2} more journeys have upcoming dates`;
    const sources = keysOf(dated);
    out.push({ id: 'cal', title: 'Competitor milestone calendar', why, src: 'index', records: sources.length, sources });
  }

  const marketed = events.some((e) => e.type === 'approval' && !e.is_milestone) || (asset.tags?.indications ?? []).length > 0;
  if (marketed && secFiler) {
    const co = asset.company?.name ?? 'The company';
    out.push({
      id: 'rev',
      title: 'Net revenue by product',
      why: 'Not crawled; available in public 10-K filings',
      src: 'web',
      records: 0,
      sources: [`sec.gov · ${co} 10-K`, ...(asset.company?.ir_url ? [`${String(asset.company.ir_url).replace(/^https?:\/\//, '')} · quarterly results`] : [])],
    });
  }
  if (marketed) {
    out.push({ id: 'faers', title: 'Adverse event reports over time (FAERS)', why: 'Public FDA adverse-event data, not yet indexed', src: 'web', records: 0, sources: ['open.fda.gov · drug/event API'] });
    const rival = (asset.competitors ?? [])[0];
    if (rival) {
      out.push({ id: 'share', title: `Prescription share vs ${rival.name}`, why: 'Needs licensed prescription data; public sources are partial', src: 'limited', records: 0, sources: ['Company earnings calls (partial)', 'IQVIA (licensed, not connected)'] });
    }
  }
  return out;
}
