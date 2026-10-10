/**
 * Answer verification, deterministic, after the model has written its answer and before it is stored and sent as
 * the final `answer` (the version the UI keeps). It checks what can be checked mechanically:
 *
 *  - every number, percentage and date in a sentence that cites [n] must appear in the evidence the model was shown
 *    under those refs this turn (CitationRegistry.evidence); otherwise the sentence is marked "(unverified)";
 *  - a sentence stating numbers or dates with no citation at all is marked "(no source)";
 *  - refs the model was never given this turn are dropped later by CitationRegistry.finalize;
 *  - leaks: API keys, connection strings, private keys, filesystem paths and the system prompt's canary are
 *    redacted, whole sentence, and reported. (The live token stream applies the same check word by word:
 *    chat.service.ts.)
 *
 * Semantic support beyond numbers/dates (does passage n really say X?) is not decided here.
 */

export interface VerifyIssue {
  kind: 'unsupported_value' | 'uncited_value' | 'leak';
  detail: string;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};
const MONTH_NAMES = Object.keys(MONTHS).join('|');

const LEAKS: [string, RegExp][] = [
  ['api key', /\bsk-[A-Za-z0-9_-]{16,}/],
  ['connection string', /\b(?:mongodb(?:\+srv)?|redis|rediss|postgres(?:ql)?):\/\/\S+/i],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['filesystem path', /(?:^|[\s(`'"])(?:\/(?:Users|home|private|etc|var|root|opt|tmp|app)\/|[A-Z]:\\)[^\s`'")]*/],
  ['environment secret', /\b(?:OPENAI_API_KEY|JWT_SECRET|MONGODB_URI|CRAWLER_SERVICE_KEY|ADMIN_PASSWORD)\s*[=:]/],
];

/** What kind of secret the text contains (api key, connection string, ..., the system prompt's canary), or null. */
export function leakIn(text: string, canary: string): string | null {
  for (const [what, re] of LEAKS) if (re.test(text)) return what;
  return canary && text.includes(canary) ? 'system prompt' : null;
}

/** Values a sentence states that a source must back: dates (normalised to ISO forms), percentages, numbers. */
export function valuesIn(sentence: string): string[] {
  const text = sentence.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, ' ');
  const out: string[] = [];
  const consumed: [number, number][] = [];
  const overlaps = (a: number, b: number) => consumed.some(([x, y]) => a < y && b > x);
  const take = (re: RegExp, map: (m: RegExpMatchArray) => string) => {
    for (const m of text.matchAll(re)) {
      if (overlaps(m.index!, m.index! + m[0].length)) continue; // "Mar 2024" inside "22 Mar 2024"
      out.push(map(m));
      consumed.push([m.index!, m.index! + m[0].length]);
    }
  };
  // 12 Mar 2024 / 12 March 2024
  take(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES})[a-z]*\\.?\\s+(\\d{4})\\b`, 'gi'), (m) => `${m[3]}-${MONTHS[m[2]!.slice(0, 3).toLowerCase()]}-${m[1]!.padStart(2, '0')}`);
  // March 2024
  take(new RegExp(`\\b(${MONTH_NAMES})[a-z]*\\.?\\s+(\\d{4})\\b`, 'gi'), (m) => `${m[2]}-${MONTHS[m[1]!.slice(0, 3).toLowerCase()]}`);
  take(/\b(\d{4}-\d{2}-\d{2})\b/g, (m) => m[1]!);
  const free = (i: number) => !consumed.some(([a, b]) => i >= a && i < b);
  // not the digits of a code name ("TDE-PH-304", "BI-1015550"): identifiers are matched by retrieval, not here
  for (const m of text.matchAll(/(?<![\w.])(?<![A-Za-z]-)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?%)?(?![\w])/g)) {
    if (!free(m.index!)) continue;
    const n = m[1]!.replace(/,/g, '');
    if (!m[2] && /^\d$/.test(n)) continue; // single digits ("2 trials", "Phase 3"): too common to check meaningfully
    out.push(m[2] ? `${n}%` : n);
  }
  return out;
}

/** Evidence text normalised so values match however the source wrote them. */
function normaliseEvidence(evidence: string): string {
  let e = evidence.replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/(\d)\s+%/g, '$1%');
  // also index "12 Mar 2024"-style dates in their ISO form
  e += ' ' + valuesIn(evidence).join(' ');
  return e;
}

function supported(value: string, evidence: string): boolean {
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(value)) return evidence.includes(value);
  if (value.endsWith('%')) return evidence.includes(value) || new RegExp(`(?<![\\d.])${value.slice(0, -1).replace('.', '\\.')}(?![\\d])`).test(evidence);
  return new RegExp(`(?<![\\d.])${value.replace('.', '\\.')}(?![\\d])`).test(evidence);
}

/**
 * Sentences, list items and table rows, with the separators kept as their own pieces so the text rebuilds exactly.
 * A boundary is a line break, or [.!?] + whitespace not after an abbreviation ("U.S.", "vs.", "Inc.") - so a date
 * and the citation at the end of its sentence stay together. Models also write the citation after the full stop
 * ("... in 2024. [2] Next ..."): that citation belongs to the sentence before it, so the boundary is after it.
 */
const REFS = '(?:\\[\\d+(?:\\s*,\\s*\\d+)*\\])';
const BOUNDARY = new RegExp(
  `(\\n+|(?<=[.!?][*_]{0,2})(?<!\\b[A-Z]\\.)(?<!\\b(?:vs|Dr|Inc|Ltd|Co|No|Fig|approx|al|e\\.g|i\\.e)\\.)\\s+(?!${REFS})|(?<=[.!?][*_]{0,2}\\s*${REFS}+)\\s+)`,
);

export function pieces(text: string): string[] {
  return text.split(BOUNDARY).filter((p) => p !== '');
}

export function verifyAnswer(
  text: string,
  evidenceFor: (n: number) => string,
  canary: string,
): { text: string; issues: VerifyIssue[] } {
  const issues: VerifyIssue[] = [];
  const refsOf = (piece: string) => [...piece.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((m) => m[1]!.split(',').map((n) => Number(n.trim())));
  const all = pieces(text);
  const out = all.map((piece, i) => {
    if (!piece.trim()) return piece; // separator
    const leak = leakIn(piece, canary);
    if (leak) {
      issues.push({ kind: 'leak', detail: leak });
      return '[removed] ';
    }
    const values = valuesIn(piece);
    if (!values.length || /^\s*\|?\s*[-:| ]+\|?\s*$/.test(piece)) return piece;
    // "A. B. [1]": a citation closing a paragraph covers the uncited sentences before it in that paragraph
    let refs = refsOf(piece);
    for (let j = i + 1; !refs.length && j < all.length && !all[j]!.includes('\n'); j++) refs = refsOf(all[j]!);
    const mark = (note: string) => piece.replace(/(\s*)$/, ` ${note}$1`);
    if (!refs.length) {
      issues.push({ kind: 'uncited_value', detail: values.join(', ') });
      return mark('(no source)');
    }
    const evidence = normaliseEvidence(refs.map(evidenceFor).join('\n'));
    const missing = values.filter((v) => !supported(v, evidence));
    if (missing.length) {
      issues.push({ kind: 'unsupported_value', detail: missing.join(', ') });
      return mark('(unverified)');
    }
    return piece;
  });
  return { text: out.join(''), issues };
}
