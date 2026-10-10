import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'
import { safeUrl } from '@/lib/utils'
import type { SourceRecord } from '../api'

/** One investor-presentation slide (crawler step `presentations`, record_type `presentation_slide`). */
interface Claim {
  statement: string
  category?: string | null
  drug?: string | null
  trial?: string | null
}
interface Metric {
  metric: string
  value?: number | null
  value_text?: string | null
  unit?: string | null
  arm?: string | null
  trial?: string | null
  timepoint?: string | null
  comparator?: string | null
  p_value_text?: string | null
  validation?: { status?: string } | null
}

const CATEGORY_LABEL: Record<string, string> = {
  efficacy: 'Efficacy',
  safety: 'Safety',
  regulatory: 'Regulatory',
  commercial: 'Commercial',
  pipeline: 'Pipeline',
  financial: 'Financial',
  other: 'Other',
}
const CATEGORY_ORDER = ['efficacy', 'safety', 'regulatory', 'pipeline', 'commercial', 'financial', 'other']
const UNIT_SUFFIX: Record<string, string> = { percent: '%', '%': '%' }

export const isSlide = (r: SourceRecord) => r.record_type === 'presentation_slide'

const FIGURES_SHOWN = 8
const COUNT = /^(number of (subjects|patients|participants)|n|sample size|enrol+ment)$/i

/** Week 4 < Week 52; Baseline first; unknown last. */
function when(t?: string | null): number {
  if (!t) return Number.MAX_SAFE_INTEGER
  if (/baseline/i.test(t)) return -1
  const n = /(\d+(?:\.\d+)?)/.exec(t)
  return n ? Number(n[1]) : Number.MAX_SAFE_INTEGER - 1
}

/** Outcomes before head-counts; then by measure (slide order), arm and timepoint. */
export function orderFigures<T extends { metric: string; arm?: string | null; timepoint?: string | null }>(ms: T[]): T[] {
  const first = new Map<string, number>()
  ms.forEach((m, i) => first.has(m.metric) || first.set(m.metric, i))
  return [...ms].sort(
    (a, b) =>
      Number(COUNT.test(a.metric)) - Number(COUNT.test(b.metric)) ||
      first.get(a.metric)! - first.get(b.metric)! ||
      (a.arm ?? '').localeCompare(b.arm ?? '') ||
      when(a.timepoint) - when(b.timepoint),
  )
}

/** Title and subtitle for the sheet header. */
export function slideHeading(r: SourceRecord): { title: string; subtitle: string } {
  const deck = (r.deck_title as string) || 'Investor presentation'
  return {
    title: (r.slide_title as string) || `Slide ${r.page}`,
    subtitle: [deck, r.page ? `slide ${r.page}` : '', formatDate(r.date as string)].filter(Boolean).join(' · '),
  }
}

function value(m: Metric): string {
  if (m.value_text) return m.value_text
  if (m.value === null || m.value === undefined) return '—'
  return `${m.value}${m.unit ? (UNIT_SUFFIX[m.unit] ?? ` ${m.unit}`) : ''}`
}

function Check({ status }: { status?: string }) {
  if (status === 'validated')
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400" title="Matches the chart drawn on the slide">
        <CheckCircle2 className="size-3.5" /> Chart-checked
      </span>
    )
  if (status === 'conflict')
    return (
      <span className="inline-flex items-center gap-1 text-destructive" title="Differs from the chart drawn on the slide — check the original">
        <AlertTriangle className="size-3.5" /> Conflicts with chart
      </span>
    )
  return <span className="text-muted-foreground">As printed</span>
}

export function SlideBody({ record }: { record: SourceRecord }) {
  const claims = (Array.isArray(record.claims) ? (record.claims as Claim[]) : []).filter((c) => c?.statement)
  const metrics = orderFigures((Array.isArray(record.metrics) ? (record.metrics as Metric[]) : []).filter((m) => m?.metric))
  const trials = [...new Set(metrics.map((m) => m.trial).filter(Boolean))]
  const sharedTrial = metrics.length > 1 && trials.length === 1 && metrics.every((m) => m.trial) ? trials[0]! : null
  const [allFigures, setAllFigures] = useState(false)
  const shown = allFigures ? metrics : metrics.slice(0, FIGURES_SHOWN)
  const pdf = safeUrl(record.url)
  // Browsers' PDF viewers open the right page from #page=N.
  const slideLink = pdf && record.page ? `${pdf}#page=${record.page}` : pdf
  const byCategory = CATEGORY_ORDER.map((c) => [c, claims.filter((x) => (x.category ?? 'other') === c)] as const).filter(([, xs]) => xs.length)
  const text = ((record.slide_text as string) || '').trim()

  return (
    <div className="space-y-6 px-4 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        {slideLink && (
          <a href={slideLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
            Open slide {record.page ? String(record.page) : ''} in the deck <ExternalLink className="size-3.5" />
          </a>
        )}
        {typeof record.slide_type === 'string' && record.slide_type !== 'other' && (
          <Badge variant="secondary" className="capitalize">{record.slide_type.replace(/_/g, ' ')}</Badge>
        )}
        {typeof record.company === 'string' && <Badge variant="outline">{record.company}</Badge>}
      </div>

      {byCategory.length > 0 && (
        <section aria-labelledby="slide-claims">
          <h3 id="slide-claims" className="mb-2 font-medium">Key statements</h3>
          <div className="space-y-3">
            {byCategory.map(([cat, xs]) => (
              <div key={cat}>
                <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{CATEGORY_LABEL[cat] ?? cat}</p>
                <ul className="space-y-1.5">
                  {xs.map((c, i) => (
                    <li key={i} className="rounded-lg border bg-background px-3 py-2 leading-snug">
                      {c.statement}
                      {(c.drug || c.trial) && (
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {c.drug && <Badge variant="outline">{c.drug}</Badge>}
                          {c.trial && <Badge variant="outline">{c.trial}</Badge>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {metrics.length > 0 && (
        <section aria-labelledby="slide-figures">
          <h3 id="slide-figures" className="font-medium">Reported figures</h3>
          {sharedTrial && <p className="text-xs text-muted-foreground">{sharedTrial}</p>}
          <ul className="mt-2 divide-y rounded-lg border bg-background">
            {shown.map((m, i) => {
              const v = value(m)
              const has = (part?: string | null) => !!part && [m.arm, v].some((x) => x?.toLowerCase().includes(part.toLowerCase()))
              const context = [
                [m.arm, m.comparator && !has(m.comparator) && `vs ${m.comparator}`].filter(Boolean).join(' '),
                m.timepoint,
                sharedTrial ? null : m.trial,
                has(m.p_value_text) ? null : m.p_value_text,
              ].filter(Boolean)
              const long = v.length > 14 // e.g. "111.8 mL (95% CI, 79.7–144.0)": own line, never over the name
              return (
                <li key={i} className="px-3 py-2">
                  <div className={long ? '' : 'flex items-baseline justify-between gap-3'}>
                    <span className="min-w-0 leading-snug">{m.metric}</span>
                    <span className={long ? 'mt-0.5 block font-semibold tabular-nums' : 'shrink-0 font-semibold whitespace-nowrap tabular-nums'}>
                      {v}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {context.map((c, j) => (
                      <span key={j}>{c}</span>
                    ))}
                    <Check status={m.validation?.status} />
                  </div>
                </li>
              )
            })}
          </ul>
          {metrics.length > FIGURES_SHOWN && (
            <button type="button" className="mt-1.5 text-sm font-medium text-primary hover:underline" onClick={() => setAllFigures((v) => !v)}>
              {allFigures ? 'Show fewer' : `Show all ${metrics.length} figures`}
            </button>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">Read from the slide by AI; check the original slide before relying on a figure.</p>
        </section>
      )}

      {!claims.length && !metrics.length && !text && <p className="text-muted-foreground">No statements or figures were extracted from this slide.</p>}

      {text && (
        <details className="group rounded-lg border bg-background">
          <summary className="cursor-pointer px-3 py-2 font-medium select-none">Slide text</summary>
          <div className="border-t px-3 py-2 text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{text}</div>
        </details>
      )}
    </div>
  )
}
