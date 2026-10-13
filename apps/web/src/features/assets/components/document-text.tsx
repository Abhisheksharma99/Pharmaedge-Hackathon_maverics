import { Fragment } from 'react'
import { excerpts, namesPattern, segments } from './document-segments'

/**
 * Readable long documents (press releases, filings, articles) in the record panel. Crawled text arrives as one line
 * per element: financial tables become hundreds of one-number lines and legal boilerplate fills the end. This
 * keeps the prose, collapses table runs into a note, stops before standard boilerplate, and pulls the passages that
 * mention the asset to the top.
 */

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
