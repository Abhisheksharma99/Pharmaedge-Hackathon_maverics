/** Pure helpers for AI-built analytics runs (ANALYTICS_PIPELINE.md); no I/O, unit-tested. */
export const SUGGESTION_IDS = ['tta', 'label', 'cal', 'rev', 'faers', 'share'] as const;
export type SuggestionId = (typeof SUGGESTION_IDS)[number];
export const SUGGESTION_TITLES: Record<SuggestionId, string> = {
  tta: 'Time from Phase 3 start to approval',
  label: 'Label evolution by indication',
  cal: 'Competitor milestone calendar',
  rev: 'Net revenue by product',
  faers: 'Adverse event reports over time (FAERS)',
  share: 'Prescription share',
};
/** What the model is told to build for each suggestion. */
export const SUGGESTION_BRIEFS: Record<Exclude<SuggestionId, 'share'>, string> = {
  tta: 'For each programme (indication) with a pivotal Phase 3 trial and an approval, the years from the Phase 3 start date to the approval date. Use chart "hbar", unit "yrs". One row per programme; label names the programme.',
  label: 'The number of approval and labeling supplements per product. Use chart "bars". One row per product; value is the count.',
  cal: 'Upcoming dated competitor milestones (readouts, PDUFA dates), soonest first. Use chart "list". label is the milestone, series is "<competitor>", date is the milestone date.',
  rev: 'Net revenue by product per fiscal year, in $ millions. Use chart "stack", unit "$M". label is the fiscal year, series is the product.',
  faers: 'FDA FAERS adverse-event reports per year for the asset, split into serious and non-serious. Use chart "stack". label is the year, series is "Serious" or "Non-serious".',
};

export const CHARTS = ['bars', 'hbar', 'stack', 'donut', 'list'] as const;
export type BuildChart = (typeof CHARTS)[number];
/** Fewer sourced rows than this means the index does not cover the request: try the public web. */
export const MIN_ROWS = 3;
/** Fewer than this after the web fallback and the answer is "not available". */
export const MIN_RESULT_ROWS = 2;

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface RunStep { label: string; status: StepStatus }

export const SHARE_NOTE =
  'Prescription share needs licensed data (e.g. IQVIA). Connect a data source, or I can track share signals mentioned in earnings calls instead.';

/** Free text that asks for licensed prescription data (prototype `ask()`). */
export const needsLicensedData = (request: string) => /share|prescri|trx|nbrx/i.test(request);

const pending = (labels: string[]): RunStep[] => labels.map((label) => ({ label, status: 'pending' as const }));
const indexLabel = (passages: number) => `Searching the index (${passages.toLocaleString('en-US')} passages)`;
export const WEB_LABEL = 'Not enough indexed data, searching public sources';
export const WEB_EXTRACT_LABEL = 'Extracting values and citing sources';

/** Step labels are the prototype's (overview-analytics.jsx). Index flow: 3 steps; licensed data: its own 3. */
export function buildSteps(passages: number, licensed: boolean): RunStep[] {
  return pending(licensed
    ? [indexLabel(passages), 'Searching public sources', 'Checking data coverage']
    : [indexLabel(passages), 'Extracting values from matched records', 'Building the chart']);
}

/** The prototype's web flow, used when the index is already known to be thin. */
export function webFlowSteps(passages: number): RunStep[] {
  return pending([indexLabel(passages), WEB_LABEL, WEB_EXTRACT_LABEL, 'Building the chart']);
}

/** A passage the model may cite: `key` is the record key (index) or the page URL (web). */
export interface Passage { key: string; text: string; web?: boolean; vector?: boolean }
export interface ExtractedRow {
  label: string; value: number | null; unit?: string | null; date?: string | null; series?: string | null; source_key: string;
  /** The value is derived, not quoted: the server recomputes it from `operands` (each checked against the cited passages) and drops the row on any mismatch. */
  computed?: ComputedSpec | null;
}
export interface ComputedSpec { op: 'count' | 'diff' | 'sum'; operands: (number | string)[]; source_keys: string[] }
export interface Extraction { title: string; chart: string; unit?: string | null; note?: string | null; rows: ExtractedRow[] }

const isWebKey = (k: string) => /^https?:\/\//i.test(k);
const CLIP = 1200;
const BUDGET = 60_000;

/** Passages that fit the prompt: web first, then vector hits (request-ranked), then structured records. */
export function selectPassages(passages: Passage[], budget = BUDGET): Passage[] {
  const rank = (p: Passage) => (p.web ? 0 : p.vector ? 1 : 2);
  const out: Passage[] = [];
  let used = 0;
  for (const p of [...passages].sort((a, b) => rank(a) - rank(b))) {
    const text = p.text.length > CLIP ? `${p.text.slice(0, CLIP)}…` : p.text;
    if (used + text.length > budget) break;
    used += text.length;
    out.push({ ...p, text });
  }
  return out;
}

/** key -> text actually sent, the only thing a row may be grounded in. */
export const groundingOf = (sent: Passage[]) => {
  const m = new Map<string, string>();
  for (const p of sent) m.set(p.key, `${m.get(p.key) ?? ''}\n${p.text}`);
  return m;
};

const SCALES: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mm: 1e6, billion: 1e9, bn: 1e9, b: 1e9 };

/** Does `value` occur in `text` (commas, decimals, and thousand/million/billion words normalised)? */
export function valueInText(value: number, text: string): boolean {
  const re = /(-?\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|mm|bn|k|m|b)?\b/gi;
  for (const m of text.matchAll(re)) {
    // "Phase 3", "Step 2": ordinal labels are not values.
    if (/\b(?:phase|part|step|stage|type|grade)\s*$/i.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
    const n = Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const scale = m[2] ? SCALES[m[2].toLowerCase()]! : 1;
    const cands = scale === 1 ? [n] : [n, n * scale, (n * scale) / 1e3, (n * scale) / 1e6, (n * scale) / 1e9];
    if (cands.some((c) => Math.abs(c - value) <= 1e-9 * Math.max(1, Math.abs(value)))) return true;
  }
  return false;
}

const MONTH_NAMES = ['Jan(?:uary)?', 'Feb(?:ruary)?', 'Mar(?:ch)?', 'Apr(?:il)?', 'May', 'June?', 'July?', 'Aug(?:ust)?', 'Sept?(?:ember)?', 'Oct(?:ober)?', 'Nov(?:ember)?', 'Dec(?:ember)?'];

/** The date (YYYY-MM-DD, or YYYY-MM) occurs in the text, ISO or as "May 23, 2025" / "23 May 2025" / "May 2025". */
export function dateInText(date: string, text: string): boolean {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(date);
  if (!m) return false;
  const [, y, mo, d] = m;
  if (text.includes(date)) return true;
  const mon = MONTH_NAMES[Number(mo) - 1];
  if (!mon) return false;
  const name = `\\b${mon}\\b\\.?`;
  const patterns = d
    ? [`${name}\\s+0?${Number(d)}(?:st|nd|rd|th)?,?\\s+${y}\\b`, `\\b0?${Number(d)}(?:st|nd|rd|th)?\\s+${name},?\\s+${y}\\b`]
    : [`${name},?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?${y}\\b`, `\\b\\d{1,2}\\s+${name},?\\s+${y}\\b`];
  return patterns.some((p) => new RegExp(p, 'i').test(text));
}

const STOP = new Set(['with', 'from', 'that', 'this', 'have', 'will', 'into', 'over', 'under', 'phase', 'trial', 'study', 'date', 'upcoming', 'milestone']);
/** A list row's label is grounded when a distinctive word of it (4+ letters, not a stopword) occurs in the cited text. */
export function labelInText(label: string, text: string): boolean {
  const hay = text.toLowerCase();
  return (label.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) ?? []).some((t) => !STOP.has(t) && hay.includes(t));
}

const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** One operand per distinct cited key, each operand quoted in its key's text. */
function onePerKey(operands: number[], keys: string[], grounding: Map<string, string>, used = new Set<string>()): boolean {
  if (!operands.length) return true;
  const [o, ...rest] = operands;
  return keys.some((k) => !used.has(k) && valueInText(o!, grounding.get(k) ?? '') && onePerKey(rest, keys, grounding, new Set(used).add(k)));
}

/**
 * Recomputes a derived value on the server; null when it is not derivable from the cited passages.
 * - count: the operands are cited keys of ONE collection (same key prefix, indexed records, not web pages); value = distinct keys.
 * - diff: two ISO dates quoted in the cited text (value in years), or two numbers quoted from two DIFFERENT cited keys.
 * - sum: numbers, each quoted from a different cited key. (Same unit context across keys is the model's duty; the note flags computed values.)
 */
function recompute(c: ComputedSpec, grounding: Map<string, string>): { value: number; tol: number } | null {
  if (!c || !Array.isArray(c.operands) || !c.operands.length || !Array.isArray(c.source_keys) || !c.source_keys.length) return null;
  if (!c.source_keys.every((k) => grounding.has(k))) return null;
  const text = c.source_keys.map((k) => grounding.get(k)).join('\n');
  if (c.op === 'count') {
    const keys = [...new Set(c.operands.map(String))];
    const prefixes = new Set(keys.map((k) => k.split(':')[0]));
    return keys.every((k) => c.source_keys.includes(k) && !isWebKey(k)) && prefixes.size === 1 ? { value: keys.length, tol: 1e-6 } : null;
  }
  const nums = c.operands.filter((o): o is number => typeof o === 'number' && Number.isFinite(o));
  if (c.op === 'sum') return nums.length >= 2 && nums.length === c.operands.length && onePerKey(nums, c.source_keys, grounding) ? { value: nums.reduce((a, b) => a + b, 0), tol: 1e-6 } : null;
  if (c.op === 'diff' && c.operands.length === 2) {
    const [a, b] = c.operands as [number | string, number | string];
    if (isIsoDate(a) && isIsoDate(b)) return dateInText(a, text) && dateInText(b, text) ? { value: Math.abs(Date.parse(a) - Date.parse(b)) / (365.25 * 86_400_000), tol: 0.06 } : null;
    if (nums.length === 2 && (onePerKey([a as number, b as number], c.source_keys, grounding))) return { value: Math.abs((a as number) - (b as number)), tol: 1e-6 };
  }
  return null;
}

/** Keeps rows whose source was sent to the model AND whose value (or list date) is found in that source's text, or recomputes from grounded operands. */
export function validateRows(rows: ExtractedRow[], grounding: Map<string, string>, chart: BuildChart) {
  const kept: ExtractedRow[] = [];
  for (const r of rows ?? []) {
    if (typeof r?.label !== 'string' || !r.label.trim() || typeof r.source_key !== 'string') continue;
    const text = grounding.get(r.source_key);
    if (text === undefined) continue;
    let ok: boolean;
    if (chart === 'list') ok = typeof r.date === 'string' && dateInText(r.date, text) && labelInText(r.label, text);
    else if (typeof r.value !== 'number' || !Number.isFinite(r.value)) ok = false;
    else if (r.computed) {
      const v = recompute(r.computed, grounding);
      ok = v !== null && near(v.value, r.value, v.tol) && r.computed.source_keys.includes(r.source_key);
    } else ok = valueInText(r.value, text);
    if (ok) kept.push(r);
  }
  return { kept, dropped: (rows?.length ?? 0) - kept.length };
}

export const PALETTE = ['#2347d9', '#0b7a6f', '#e0620f', '#6941c6', '#b42318', '#98a2b3'];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 's';

export interface BuiltSpec {
  id: string; title: string; chart: BuildChart | 'none'; data?: unknown; cols?: (string | number)[];
  series?: { k: string; l: string; c: string; vals: number[] }[]; unit?: string; note?: string;
  method: 'index' | 'web' | 'none'; sources: string[]; refreshed_at: string;
}

export function noneSpec(id: string, title: string, note: string, refreshed_at: string): BuiltSpec {
  return { id, title, chart: 'none', method: 'none', sources: [], note, refreshed_at };
}

/** Spec from validated rows; `sources` are exactly the keys the kept rows cite. */
export function assembleSpec(o: { id: string; fallbackTitle: string; extraction: Extraction; kept: ExtractedRow[]; dropped: number; refreshed_at: string }): BuiltSpec {
  const { extraction, kept } = o;
  const chart = (CHARTS as readonly string[]).includes(extraction.chart) ? (extraction.chart as BuildChart) : 'bars';
  const sources = [...new Set(kept.flatMap((r) => [r.source_key, ...(r.computed?.source_keys ?? [])]))];
  const spec: BuiltSpec = {
    id: o.id, title: extraction.title?.trim() || o.fallbackTitle, chart,
    method: sources.some(isWebKey) ? 'web' : 'index', sources, refreshed_at: o.refreshed_at,
  };
  if (extraction.unit) spec.unit = extraction.unit;
  if (chart === 'stack') {
    const numeric = kept.every((r) => /^\d+$/.test(r.label.trim()));
    const cols = [...new Set(kept.map((r) => r.label.trim()))].sort((a, b) => (numeric ? Number(a) - Number(b) : a.localeCompare(b)));
    const names = [...new Set(kept.map((r) => r.series?.trim() || 'Total'))];
    spec.cols = numeric ? cols.map(Number) : cols;
    spec.series = names.map((l, i) => ({
      k: slug(l), l, c: PALETTE[i % PALETTE.length]!,
      // The same (label, series) from two sources is one figure reported twice: keep the first, never sum.
      vals: cols.map((c) => (kept.find((r) => r.label.trim() === c && (r.series?.trim() || 'Total') === l)?.value as number | undefined) ?? 0),
    }));
  } else if (chart === 'list') {
    spec.data = [...kept].sort((a, b) => a.date!.localeCompare(b.date!)).map((r) => ({ l: r.label, sub: r.series ?? '', d: r.date }));
  } else {
    spec.data = kept.map((r, i) => ({ l: r.label, v: r.value, c: PALETTE[i % PALETTE.length] }));
  }
  const computed = kept.some((r) => r.computed && typeof r.value === 'number');
  const notes = [extraction.note?.trim(), computed ? 'Some values are computed from the cited records.' : '', o.dropped > 0 ? `${o.dropped} row${o.dropped > 1 ? 's' : ''} without a verifiable source or value ${o.dropped > 1 ? 'were' : 'was'} left out.` : ''].filter(Boolean);
  if (notes.length) spec.note = notes.join(' ');
  return spec;
}
