import { Fragment } from 'react'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'

/**
 * Readable long documents (press releases, filings, articles) in the record panel. Crawled text arrives as one line
 * per element: financial tables become hundreds of one-number lines and legal boilerplate fills the end. This
 * keeps the prose, collapses table runs into a note, stops before standard boilerplate, and pulls the passages that
 * mention the asset to the top.
 */

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
const namesPattern = (names: string[]) => {
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

export function Highlight({ text, names }: { text: string; names: string[] }) {
  const rx = namesPattern(names)
  if (!rx) return <>{text}</>
  const parts = text.split(rx)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-primary/10 px-0.5 font-medium text-foreground">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}

export function MentionExcerpts({ text, names, assetName }: { text: string; names: string[]; assetName?: string }) {
  const found = excerpts(text, names)
  if (!found.length) return null
  return (
    <section aria-labelledby="doc-mentions">
      <h3 id="doc-mentions" className="mb-2 font-medium">
        What it says about {assetName ?? names[0]}
      </h3>
      <ul className="space-y-1.5">
        {found.map((t) => (
          <li key={t} className="rounded-lg border-l-2 border-primary/50 bg-background py-1.5 pr-3 pl-3 leading-relaxed">
            <Highlight text={t} names={names} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export interface JourneyEventRef {
  id: string
  title: string
  type?: string
  date?: string
  significance?: string
  is_milestone?: boolean
}

export function JourneyEvents({ events }: { events: JourneyEventRef[] }) {
  if (!events.length) return null
  return (
    <section aria-labelledby="doc-events">
      <h3 id="doc-events" className="mb-2 font-medium">On the journey</h3>
      <ul className="divide-y rounded-lg border bg-background">
        {events.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 px-3 py-2">
            <span className="min-w-0 leading-snug">
              <span className="mr-2 font-mono text-xs whitespace-nowrap text-muted-foreground">{formatDate(e.date)}</span>
              {e.title}
            </span>
            {e.significance && (
              <Badge variant={e.significance === 'High' ? 'default' : 'secondary'} className="shrink-0">
                {e.is_milestone ? 'Milestone' : e.significance}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function DocumentText({ text, names, open }: { text: string; names: string[]; open: boolean }) {
  const { segments: parts, trimmed } = segments(text)
  return (
    <details open={open} className="rounded-lg border bg-background">
      <summary className="cursor-pointer px-3 py-2 font-medium select-none">Full text</summary>
      <div className="space-y-2 border-t px-3 py-3 leading-relaxed">
        {parts.map((s, i) =>
          s.kind === 'table' ? (
            <p key={i} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              Table ({s.cells} values) — open the original to read it in full.
            </p>
          ) : (
            <p key={i}>
              <Highlight text={s.text} names={names} />
            </p>
          ),
        )}
        {trimmed && <p className="text-xs text-muted-foreground">Standard legal and financial-reporting sections are hidden; see the original.</p>}
      </div>
    </details>
  )
}
