import type { Document } from 'mongodb';
import { MIN_RESULT_ROWS, PALETTE, noneSpec, type BuiltSpec, type SuggestionId } from './analytics.build.js';
import { SUPPLEMENT, hasKeys, keysOf, pivotalPairs, type SuggestInput } from './analytics.suggest.js';

/**
 * Index-sourced suggestions (tta, label, cal) computed straight from the stored records the suggestion
 * heuristics already use (ANALYTICS_PIPELINE.md): no LLM, no text grounding. Every value is a stored field
 * and `sources` are the exact record keys behind the rows shown. Pure, no I/O.
 */
export const STRUCTURED_SUGGESTIONS: readonly SuggestionId[] = ['tta', 'label', 'cal'];
export const isStructured = (s: SuggestionId | undefined): s is 'tta' | 'label' | 'cal' => !!s && STRUCTURED_SUGGESTIONS.includes(s);

const YEAR_MS = 365.25 * 86_400_000;
const CAL_MAX = 12;
const LABEL_SERIES = 5;

/** Stored dates are YYYY-MM-DD or YYYY-MM; null when unparseable. */
const ms = (d: unknown) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}(-\d{2})?$/.test(d)) return null;
  const t = Date.parse(d.length === 7 ? `${d}-01` : d);
  return Number.isNaN(t) ? null : t;
};

/** "in 3 months" style countdown from `today` (YYYY-MM-DD). */
function relFuture(date: string, today: string) {
  const days = Math.round(((ms(date) ?? 0) - (ms(today) ?? 0)) / 86_400_000);
  if (days <= 0) return 'now';
  if (days < 60) return `in ${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `in ${Math.round(days / 30.44)} months`;
  return `in ${Math.round(days / 365.25)} years`;
}

function ttaSpec(input: SuggestInput, id: string, at: string): BuiltSpec {
  const title = 'Time from Phase 3 start to approval';
  const rows: { l: string; v: number; sources: string[]; fallback: boolean }[] = [];
  for (const p of pivotalPairs(input)) {
    const trial = p.trials
      .map((t) => ({ t, s: ms(t.start_date) }))
      .filter((x): x is { t: Document; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s)[0];
    if (!trial) continue;
    // The first decision after the Phase 3 start; an approval wins over a later-listed supplement.
    const after = p.decisions
      .map((e) => ({ e, d: ms(e.date) }))
      .filter((x): x is { e: Document; d: number } => x.d !== null && x.d > trial.s)
      .sort((a, b) => a.d - b.d);
    const decision = after.find((x) => x.e.type === 'approval') ?? after[0];
    if (!decision) continue;
    const nct = trial.t.nct_id ? ` (${trial.t.nct_id})` : '';
    rows.push({
      l: `${p.programme.label}${nct}${decision.e.type === 'approval' ? '' : ` · ${String(decision.e.type).replace(/_/g, ' ')}`}`,
      v: Math.round(((decision.d - trial.s) / YEAR_MS) * 10) / 10,
      sources: [trial.t.record_key as string, ...keysOf([decision.e])],
      fallback: decision.e.type !== 'approval',
    });
  }
  if (rows.length < MIN_RESULT_ROWS) return noneSpec(id, title, 'Fewer than two programmes have both a Phase 3 start date and a later approval or label decision in the indexed records, so there is nothing to compare yet.', at);
  rows.sort((a, b) => b.v - a.v);
  const note = ['Years from the earliest Phase 3 trial start to the first approval for the programme.', rows.some((r) => r.fallback) ? 'Programmes without an approval record use their first label change or new formulation.' : ''].filter(Boolean).join(' ');
  return {
    id, title, chart: 'hbar', unit: ' yrs', method: 'index', refreshed_at: at, note,
    data: rows.map((r, i) => ({ l: r.l, v: r.v, c: PALETTE[i % PALETTE.length] })),
    sources: [...new Set(rows.flatMap((r) => r.sources))],
  };
}

function labelSpec(input: SuggestInput, id: string, at: string): BuiltSpec {
  const title = 'Label evolution by indication';
  const branchLabel = new Map(input.branches.map((b) => [b.id as string, String(b.label ?? b.id)]));
  const rows = input.events
    .filter((e) => SUPPLEMENT.has(e.type) && !e.is_milestone && hasKeys(e) && /^\d{4}/.test(String(e.date ?? '')))
    .map((e) => ({
      year: Number(String(e.date).slice(0, 4)),
      series: String(e.indications?.[0] ?? branchLabel.get(e.branch) ?? e.product ?? 'Unspecified'),
      keys: keysOf([e]),
    }));
  if (rows.length < MIN_RESULT_ROWS) return noneSpec(id, title, 'Fewer than two dated label changes (new indications or formulations) are on the journey, so there is no evolution to show yet.', at);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.series, (counts.get(r.series) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  const shown = ranked.length > LABEL_SERIES + 1 ? ranked.slice(0, LABEL_SERIES) : ranked;
  const names = shown.length < ranked.length ? [...shown, 'Other'] : shown;
  const cols = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const years = Array.from({ length: cols[cols.length - 1]! - cols[0]! + 1 }, (_, i) => cols[0]! + i);
  const seriesOf = (r: { series: string }) => (shown.includes(r.series) ? r.series : 'Other');
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 's';
  return {
    id, title, chart: 'stack', method: 'index', refreshed_at: at, cols: years,
    series: names.map((l, i) => ({ k: slug(l), l, c: PALETTE[i % PALETTE.length]!, vals: years.map((y) => rows.filter((r) => r.year === y && seriesOf(r) === l).length) })),
    note: `${rows.length} label change${rows.length === 1 ? '' : 's'} (new indications and formulations) per year; each is counted under its first listed indication.`,
    sources: [...new Set(rows.flatMap((r) => r.keys))],
  };
}

function calSpec(input: SuggestInput, id: string, at: string, today: string): BuiltSpec {
  const title = 'Competitor milestone calendar';
  const dated = input.competitorMilestones.filter((m) => hasKeys(m) && ms(m.date) !== null && String(m.date) >= today && m.title);
  if (dated.length < MIN_RESULT_ROWS) return noneSpec(id, title, 'Fewer than two dated upcoming competitor milestones are on the competitors’ journeys.', at);
  const next = dated.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, CAL_MAX);
  return {
    id, title, chart: 'list', method: 'index', refreshed_at: at,
    data: next.map((m) => ({ l: String(m.title), sub: `${m.assetName ?? m.asset} · ${relFuture(String(m.date), today)}`, d: String(m.date) })),
    note: `Soonest ${next.length} dated milestones across the competitors’ journeys.`,
    sources: keysOf(next),
  };
}

export function structuredSpec(suggestion: 'tta' | 'label' | 'cal', input: SuggestInput, id: string, today: string, at: string): BuiltSpec {
  return suggestion === 'tta' ? ttaSpec(input, id, at) : suggestion === 'label' ? labelSpec(input, id, at) : calSpec(input, id, at, today);
}
