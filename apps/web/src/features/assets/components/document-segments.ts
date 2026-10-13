/** The text side of `DocumentText`: prose segments, collapsed table runs, trimmed boilerplate, the asset's mentions. */

export type Segment = { kind: 'p'; text: string } | { kind: 'table'; cells: number }

// Standard closing sections of releases and filings: nothing asset-specific after them.
const BOILERPLATE =
  /^(use of non-gaap|non-gaap financial|cautionary statement|forward-looking statements?|safe harbor|website information|conference call information|investor (and media )?contacts?|media contacts?)\b/i
const TABLE_RUN = 6 // short lines in a row, mostly numbers: a flattened table
const TABLE_NUMERIC_SHARE = 0.4

const numeric = (line: string) => /^[\d$€£¥(),.%*+\-—–/\s]+$/.test(line) || /^(n\/a|nm|\*)$/i.test(line)
// Row/column labels ("Earnings per share - GAAP*", "Total Revenues"): short, no sentence ending.
const cellLike = (line: string) => numeric(line) || (line.length <= 45 && !/[.!?:;]$/.test(line) && line.split(/\s+/).length <= 7)

/** Lines a crawler wrapped mid-sentence ("…decreased by $0.03 per share" / "in the third quarter…") joined back. */
function unwrap(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const prev = out[out.length - 1]
    if (prev && prev.length > 45 && !/[.!?:;"”)]$/.test(prev) && /^[a-z(]/.test(line)) out[out.length - 1] = `${prev} ${line}`
    else out.push(line)
  }
  return out
}

export function segments(text: string): { segments: Segment[]; trimmed: boolean } {
  const lines = unwrap(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
  const out: Segment[] = []
  let trimmed = false
  for (let i = 0; i < lines.length; ) {
    if (BOILERPLATE.test(lines[i]!) && i > 3) {
      trimmed = true
      break
    }
    let j = i
    while (j < lines.length && cellLike(lines[j]!)) j++
    const numbers = lines.slice(i, j).filter(numeric).length
    if (j - i >= TABLE_RUN && numbers >= TABLE_NUMERIC_SHARE * (j - i)) {
      out.push({ kind: 'table', cells: j - i })
      i = j
    } else {
      out.push({ kind: 'p', text: lines[i]! })
      i++
    }
  }
  return { segments: out, trimmed }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const namesPattern = (names: string[]) => {
  const parts = names.filter((n) => n.trim().length >= 3).map((n) => escape(n.trim()))
  return parts.length ? new RegExp(`(?<![\\w-])(${parts.join('|')})(?![\\w-])`, 'gi') : null
}

/** The document's sentences/lines that name the asset, in order, without repeats. */
export function excerpts(text: string, names: string[], max = 5): string[] {
  const rx = namesPattern(names)
  if (!rx) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    rx.lastIndex = 0
    if (t.length < 40 || !rx.test(t) || seen.has(t)) continue // labels and table cells are not passages
    seen.add(t)
    out.push(t.length > 700 ? `${t.slice(0, 700)}…` : t)
    if (out.length >= max) break
  }
  return out
}
