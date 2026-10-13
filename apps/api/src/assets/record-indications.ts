/**
 * Which indication(s) a source record belongs to (the Indication column, badge and facet of the record tabs).
 *
 * Labels are the journey's short indication ids (PAH, PH-ILD, IPF: an asset branch's `id`), so a record reads the
 * same as the journey events it feeds. A record takes the indications of the journey events that cite it; one no
 * event cites falls back to its own text, matched conservatively against the asset's known indications.
 */

export interface IndicationMatcher {
  label: string;
  patterns: RegExp[];
}

export interface RecordIndications {
  indications: string[];
  /** `journey`: from the events citing the record; `text`: matched in the record's own text. Absent when none. */
  indicationSource?: 'journey' | 'text';
}

export interface BranchRef {
  id: string;
  full?: string;
  aliases?: string[];
}

/** "Pulmonary arterial hypertension (PAH)" → "PAH"; names without an abbreviation stay as they are (the web's rule). */
export const shortIndication = (name: string) => name.match(/\(([^()]{1,10})\)\s*$/)?.[1] ?? name;

/** The name without its bracketed abbreviation: "Multiple sclerosis (MS)" → "Multiple sclerosis". */
const baseName = (name: string) => name.replace(/\s*\([^()]{1,10}\)\s*$/, '').trim();

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A whole-word phrase ("cli" never matches "clinical"); also right for terms that start or end in punctuation. */
const phrase = (s: string, flags: string) => new RegExp(`(?<!\\w)${escapeRegex(s)}(?!\\w)`, flags);

/** Shorter names are acronyms ("ms", "cd", "iris"): matched only as the branch's own id, case-sensitively. */
const MIN_NAME = 6;
/** Two-letter ids are too ambiguous in free text (MS: mass spectrometry, PA: pulmonary artery): matched by name only. */
const MIN_ID = 3;
const idPattern = (id: string | undefined) => (id && id.length >= MIN_ID ? [phrase(id, '')] : []);

/**
 * Matchers for the asset's known indications: each journey branch (its full name and aliases, case-insensitive; its
 * id, case-sensitive) plus the asset's approved and investigational indications no branch covers.
 */
export function indicationMatchers(branches: BranchRef[], tagNames: string[]): IndicationMatcher[] {
  const known = new Set<string>();
  const matchers: IndicationMatcher[] = [];
  for (const b of branches) {
    if (!b.id) continue;
    const names = [...new Set([b.full ?? '', ...(b.aliases ?? [])].map((n) => baseName(n).toLowerCase()).filter(Boolean))];
    names.forEach((n) => known.add(n));
    known.add(b.id.toLowerCase());
    matchers.push({ label: b.id, patterns: [...idPattern(b.id), ...names.filter((n) => n.length >= MIN_NAME).map((n) => phrase(n, 'i'))] });
  }
  for (const tag of new Set(tagNames)) {
    const base = baseName(tag);
    const abbr = tag.match(/\(([^()]{1,10})\)\s*$/)?.[1];
    if (known.has(base.toLowerCase()) || (abbr && known.has(abbr.toLowerCase()))) continue;
    // Tags are sometimes fragments of a split list ("posterior", "or panuveitis"): keep multi-word names, or one with an abbreviation.
    const words = base.split(/\s+/);
    const usable = base.length >= MIN_NAME && !/^(or|and)$/i.test(words[0]!) && (words.length > 1 || !!abbr);
    const patterns = [...(usable ? [phrase(base, 'i')] : []), ...idPattern(abbr)];
    if (!patterns.length) continue;
    known.add(base.toLowerCase());
    matchers.push({ label: shortIndication(tag), patterns });
  }
  return matchers;
}

const textOf = (v: unknown): string =>
  typeof v === 'string' ? v : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(' · ') : '';

/** The indications named in the first of `texts` (most specific first: title, then abstract) that names any. */
export function textIndications(texts: unknown[], matchers: IndicationMatcher[]): string[] {
  for (const t of texts) {
    const s = textOf(t);
    if (!s) continue;
    const found = matchers.filter((m) => m.patterns.some((p) => p.test(s))).map((m) => m.label);
    if (found.length) return found;
  }
  return [];
}

/** A journey event's indications: its branch (and spanned branches), else its enrichment indications as labels. */
export function eventIndications(e: { branch?: string; span?: string[]; indications?: string[] }, matchers: IndicationMatcher[]): string[] {
  if (e.branch) return [...new Set([e.branch, ...(e.span ?? [])])];
  return [...new Set((e.indications ?? []).map((name) => textIndications([name], matchers)[0] ?? shortIndication(name.trim())).filter(Boolean))];
}

/** A record's indications: the ones of the journey events citing it, else the ones its text names. */
export function recordIndications(cited: string[], texts: unknown[], matchers: IndicationMatcher[]): RecordIndications {
  if (cited.length) return { indications: [...new Set(cited)], indicationSource: 'journey' };
  const found = textIndications(texts, matchers);
  return found.length ? { indications: found, indicationSource: 'text' } : { indications: [] };
}
