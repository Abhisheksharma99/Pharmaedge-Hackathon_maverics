import { ChartColumn, Check, CircleDashed, Loader2, Minus, Plus, Sparkle, TriangleAlert, X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { AnalyticsPin, AnalyticsSpec } from '@/features/journey/types'
import { rateLimitMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { type AnalyticsSuggestion, runEndedEmpty, useAnalyticsSuggestions, useAssetAnalytics, useBuildAnalytics, useBuildRun } from './api'
import { SpecChart } from './spec-chart'
import { isRenderable } from './spec-renderable'
import { OV_TEMPLATES } from './templates'

type Tab = 'suggest' | 'lib' | 'ask'
const TABS: { value: Tab; label: string; icon?: boolean }[] = [
  { value: 'suggest', label: 'Suggested by AI', icon: true },
  { value: 'lib', label: 'From your data' },
  { value: 'ask', label: 'Ask for an analysis' },
]
const EXAMPLES = ['Time from Phase 3 start to approval', 'Net revenue by product', 'Adverse event reports over time']
const BADGE = {
  ok: 'bg-success-soft text-success',
  warn: 'bg-warning-soft text-warning',
  bad: 'bg-danger-soft text-danger',
}
const SRC_BADGE = {
  index: ['From indexed data', 'ok'],
  web: ['Needs web search', 'warn'],
  limited: ['Limited public data', 'bad'],
} as const
const METHOD_BADGE = {
  index: ['Indexed data · no new crawl', 'ok'],
  web: ['Public web sources', 'warn'],
  none: ['Not available', 'bad'],
} as const

/** Rows shaped like the suggestion / library list items (title + why, badge, button). */
function ListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-[12px] border-b border-hair py-[12px] last:border-b-0">
          <div className="flex flex-col gap-[6px]">
            <Skeleton className="h-[14px] w-[55%]" />
            <Skeleton className="h-[12px] w-[80%]" />
          </div>
          <Skeleton className="h-[20px] w-[96px] rounded-full" />
          <Skeleton className="h-[32px] w-[64px] rounded-[8px]" />
        </div>
      ))}
    </div>
  )
}

function Badge({ tone, children }: { tone: keyof typeof BADGE; children: string }) {
  return (
    <span className={cn('inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-semibold whitespace-nowrap', BADGE[tone])}>
      {children}
    </span>
  )
}

const stepState = (status: string) =>
  status === 'done' ? 'done' : status === 'running' ? 'run' : status === 'skipped' ? 'skip' : status === 'failed' ? 'fail' : 'wait'

const NONE_NOTE = 'The analysis ended without a result.'
const NO_SOURCES_NOTE = 'No sources were found for this analysis, so no values are shown.'

function RunView({
  assetId,
  title,
  runId,
  failed,
  onBack,
  onAdd,
}: {
  assetId: string
  title: string
  runId: string | null
  failed: boolean
  onBack: () => void
  onAdd: (spec: AnalyticsSpec) => void
}) {
  const run = useBuildRun(assetId, runId)
  const steps = run.data?.steps ?? []
  const ended = failed || run.isError || runEndedEmpty(run.data)
  const raw = run.data?.result
  // Values never show without sources: such a result is treated as 'Not available'.
  const res =
    raw && raw.sources.length === 0 && raw.method !== 'none'
      ? {
          ...raw,
          chart: 'none' as const,
          method: 'none' as const,
          note: NO_SOURCES_NOTE,
        }
      : raw
  const [label, tone] = METHOD_BADGE[res?.method ?? 'none']
  const canPin = !!res && res.method !== 'none' && res.sources.length > 0 && isRenderable(res)
  const footer = (
    <div className="mt-[4px] flex items-center gap-[8px]">
      <Button variant="outline" size="sm" className="h-[32px] gap-[8px] rounded-[8px] px-[12px] text-[13px]" onClick={onBack}>
        Back
      </Button>
      <span className="flex-1" />
      {canPin && (
        <Button size="sm" className="h-[32px] gap-[8px] rounded-[8px] px-[12px] text-[13px]" onClick={() => onAdd(res!)}>
          <Plus size={14} aria-hidden="true" />
          Add to Overview
        </Button>
      )}
    </div>
  )
  return (
    <div className="flex flex-col gap-[9px]">
      <p className="m-0 mb-1 flex items-center gap-[7px] font-semibold text-violet">
        <Sparkle size={14} aria-hidden="true" />
        {title}
      </p>
      <div aria-live="polite" className="flex flex-col gap-[9px]">
        {steps.length === 0 && !ended && (
          <div className="flex items-center gap-[8px] text-[13px] font-medium text-primary">
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            Starting the analysis
          </div>
        )}
        {steps.map((s) => {
          const st = stepState(s.status)
          return (
            <div
              key={s.label}
              className={cn(
                'flex items-center gap-[8px] text-[13px]',
                st === 'wait' || st === 'skip'
                  ? 'text-muted-foreground'
                  : st === 'run'
                    ? 'font-medium text-primary'
                    : st === 'fail'
                      ? 'text-warning'
                      : 'text-secondary-foreground',
              )}
            >
              {st === 'done' ? (
                <Check size={13} strokeWidth={2.6} className="text-success" aria-hidden="true" />
              ) : st === 'run' ? (
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              ) : st === 'skip' ? (
                <Minus size={13} data-testid="step-skipped" aria-hidden="true" />
              ) : st === 'fail' ? (
                <TriangleAlert size={13} data-testid="step-failed" aria-hidden="true" />
              ) : (
                <CircleDashed size={13} aria-hidden="true" />
              )}
              {s.label}
              {st === 'skip' && <span className="sr-only"> (skipped)</span>}
              {st === 'fail' && <span className="sr-only"> (failed)</span>}
            </div>
          )
        })}
      </div>
      {failed && (
        <>
          <p role="alert" className="m-0 flex items-start gap-[6px] text-[12px] text-warning">
            <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            The analysis couldn’t be built. Try again.
          </p>
          {footer}
        </>
      )}
      {!failed && (res || ended) && (
        <div className="mt-[8px] flex animate-fade-up flex-col gap-[10px] rounded-[12px] border p-[14px]">
          <div className="flex items-center justify-between gap-[10px]">
            <b>{res?.title ?? 'Not available'}</b>
            <Badge tone={tone}>{label}</Badge>
          </div>
          {res && res.chart !== 'none' && <SpecChart spec={res} />}
          {(!res || res.chart === 'none') && (
            <p className="m-0 flex items-start gap-[6px] text-[12.5px] text-warning">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {res?.note ?? NONE_NOTE}
            </p>
          )}
          {res && res.chart !== 'none' && res.note && (
            <p className="m-0 flex items-start gap-[6px] text-[12px] text-warning">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              {res.note}
            </p>
          )}
          {res && res.sources.length > 0 && (
            <div className="flex flex-col gap-[3px] rounded-[8px] bg-background px-[12px] py-[10px] text-[11.5px] text-text-secondary">
              <span className="mb-0.5 text-[10.5px] font-semibold tracking-[.05em] text-muted-foreground uppercase">Sources</span>
              {res.sources.map((s) => (
                <span key={s} className="font-mono break-words">
                  {s}
                </span>
              ))}
            </div>
          )}
          {footer}
        </div>
      )}
    </div>
  )
}

/** "Add analytics to the Overview": AI suggestions, the template library, and free-text requests (README §7.3). */
export function AddAnalyticsDialog({
  assetId,
  pinned,
  onAdd,
  onClose,
}: {
  assetId: string
  pinned: string[]
  onAdd: (pin: AnalyticsPin) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('suggest')
  const [q, setQ] = useState('')
  const [run, setRun] = useState<{
    title: string
    runId: string | null
    failed: boolean
  } | null>(null)
  const blocks = useAssetAnalytics(assetId)
  const suggestions = useAnalyticsSuggestions(assetId)
  const build = useBuildAnalytics(assetId)

  const start = (title: string, input: { request: string } | { suggestion: string }) => {
    setRun({ title, runId: null, failed: false })
    build.mutate(input, {
      onSuccess: ({ runId }) => setRun((r) => r && { ...r, runId }),
      onError: (err) => {
        toast.error(rateLimitMessage(err) ?? "The analysis couldn't be built.")
        setRun((r) => r && { ...r, failed: true })
      },
    })
  }
  const rival = blocks.data?.landscape?.rows.find((r) => !r.me)?.name
  const examples = rival ? [...EXAMPLES, `Prescription share vs ${rival}`] : EXAMPLES
  const avail = Object.entries(OV_TEMPLATES).filter(([, t]) => !!blocks.data && t.requires(blocks.data))

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(16,24,40,0.32)] data-[state=open]:animate-fade" />
        <DialogPrimitive.Content className="fixed top-[10vh] left-1/2 z-50 flex max-h-[84vh] w-[min(720px,calc(100%-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-[16px] bg-card text-[13px] shadow-[0_24px_60px_rgba(16,24,40,.25)] outline-none data-[state=open]:animate-fade-up">
          <div className="flex items-center gap-[12px] border-b border-hair px-[16px] py-[14px]">
            <span className="flex size-[28px] shrink-0 items-center justify-center rounded-[8px] bg-violet-soft text-violet">
              <ChartColumn size={14} aria-hidden="true" />
            </span>
            <div className="flex flex-1 flex-col">
              <DialogPrimitive.Title className="text-[13px] leading-snug font-semibold">
                Add analytics to the Overview
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-[12.5px] text-text-secondary">
                Built from data we’ve already indexed. Public web sources are used only when the index is missing something.
              </DialogPrimitive.Description>
            </div>
            <Button variant="ghost" size="icon" className="size-[32px] rounded-[8px] text-text-secondary" onClick={onClose} aria-label="Close">
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
          {!run && (
            <div
              role="tablist"
              aria-label="Mode"
              className="mx-[16px] mt-[12px] flex w-fit gap-[2px] rounded-[8px] bg-muted p-[2px]"
              onKeyDown={(e) => {
                const i = TABS.findIndex((t) => t.value === tab)
                const n =
                  e.key === 'ArrowRight'
                    ? (i + 1) % TABS.length
                    : e.key === 'ArrowLeft'
                      ? (i + TABS.length - 1) % TABS.length
                      : e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? TABS.length - 1
                          : -1
                if (n < 0) return
                e.preventDefault()
                setTab(TABS[n]!.value)
                document.getElementById(`aa-tab-${TABS[n]!.value}`)?.focus()
              }}
            >
              {TABS.map((t) => (
                <button
                  key={t.value}
                  id={`aa-tab-${t.value}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.value}
                  aria-controls="aa-panel"
                  tabIndex={tab === t.value ? 0 : -1}
                  onClick={() => setTab(t.value)}
                  className={cn(
                    'inline-flex h-[28px] items-center gap-[5px] rounded-[6px] px-[10px] font-medium text-text-secondary transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    tab === t.value && 'bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.1)]',
                  )}
                >
                  {t.icon && <Sparkle size={14} aria-hidden="true" />}
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div
            id="aa-panel"
            role={run ? undefined : 'tabpanel'}
            aria-labelledby={run ? undefined : `aa-tab-${tab}`}
            className="overflow-auto px-[16px] pt-[12px] pb-[16px]"
          >
            {run ? (
              <RunView
                assetId={assetId}
                title={run.title}
                runId={run.runId}
                failed={run.failed}
                onBack={() => setRun(null)}
                onAdd={(spec) => {
                  onAdd({ custom: spec })
                  onClose()
                }}
              />
            ) : tab === 'suggest' ? (
              suggestions.isPending ? (
                <ListSkeleton label="Loading suggestions" />
              ) : suggestions.isError ? (
                <p role="alert" className="m-0 flex flex-wrap items-center gap-[8px] py-3 text-text-secondary">
                  Suggestions couldn’t be loaded.
                  <Button variant="outline" size="sm" className="h-[32px] gap-[8px] rounded-[8px] px-[12px] text-[13px]" onClick={() => void suggestions.refetch()}>
                    Try again
                  </Button>
                </p>
              ) : !suggestions.data.length ? (
                <p className="m-0 py-3 text-text-secondary">No suggestions yet. Ask for an analysis instead.</p>
              ) : (
                <ul>
                  {suggestions.data.map((s: AnalyticsSuggestion) => (
                    <li
                      key={s.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-[12px] border-b border-hair py-[12px] last:border-b-0"
                    >
                      <div className="flex min-w-0 flex-col gap-[2px]">
                        <b className="font-semibold">{s.title}</b>
                        <span className="text-[12.5px] text-text-secondary">{s.why}</span>
                        {/* Indexed suggestions cite record keys (shown once built); the prototype lists only public source names. */}
                        {s.src !== 'index' && s.sources && s.sources.length > 0 && (
                          <span className="line-clamp-2 font-mono text-[11px] break-words text-muted-foreground">{s.sources.join(' · ')}</span>
                        )}
                      </div>
                      <Badge tone={SRC_BADGE[s.src][1]}>{`${SRC_BADGE[s.src][0]}${s.records ? ` · ${s.records} records` : ''}`}</Badge>
                      <Button variant="outline" size="sm" className="h-[32px] gap-[8px] rounded-[8px] px-[12px] text-[13px]" onClick={() => start(s.title, { suggestion: s.id })}>
                        {s.src === 'index' ? 'Build' : 'Search & build'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            ) : tab === 'lib' ? (
              blocks.isPending ? (
                <ListSkeleton label="Loading the library" />
              ) : blocks.isError || !avail.length ? (
                <p role={blocks.isError ? 'alert' : undefined} className="m-0 py-3 text-text-secondary">
                  {blocks.isError ? 'The analytics library couldn’t be loaded.' : 'Nothing in the library fits this asset’s data yet. Ask for an analysis instead.'}
                </p>
              ) : (
                <ul>
                  {avail.map(([k, t]) => {
                    const on = pinned.includes(k)
                    return (
                      <li
                        key={k}
                        className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-[12px] border-b border-hair py-[12px] last:border-b-0"
                      >
                        <div className="flex min-w-0 flex-col gap-[2px]">
                          <b className="font-semibold">{t.title}</b>
                          <span className="text-[12.5px] text-text-secondary">{t.description ?? `From ${t.basis}`}</span>
                        </div>
                        <Badge tone="ok">{`Indexed · ${t.basis}`}</Badge>
                        <Button variant="outline" size="sm" className="h-[32px] gap-[8px] rounded-[8px] px-[12px] text-[13px]" disabled={on} onClick={() => onAdd({ key: k })}>
                          {on ? 'Added' : 'Add'}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )
            ) : (
              <div className="flex flex-col gap-[10px]">
                <textarea
                  rows={3}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="Describe the analysis"
                  placeholder="e.g. Time from Phase 3 start to approval for each indication · Net revenue by product · Adverse event reports over time"
                  className="resize-y rounded-[10px] border px-[12px] py-[10px] outline-0 focus:border-primary focus:ring-[3px] focus:ring-primary/12"
                />
                <div className="flex flex-wrap gap-[6px]">
                  {examples.map((x) => (
                    <button
                      key={x}
                      type="button"
                      onClick={() => setQ(x)}
                      className="rounded-full border bg-card px-[11px] py-[5px] text-[12.5px] text-secondary-foreground hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {x}
                    </button>
                  ))}
                </div>
                <div className="rounded-[10px] bg-violet-soft px-[14px] py-[10px] text-[12.5px] text-secondary-foreground">
                  <b className="text-violet">How this works</b>
                  <ol className="mt-[6px] flex list-decimal flex-col gap-[3px] pl-[18px]">
                    <li>Asset AI searches the passages already indexed for this asset. Nothing is re-crawled.</li>
                    <li>
                      If the index can’t answer, it runs a public web search (FDA, EMA, ClinicalTrials.gov, SEC filings, company IR) and
                      cites every source.
                    </li>
                    <li>You review the chart and its sources before it’s pinned.</li>
                  </ol>
                </div>
                <div className="flex items-center gap-[8px]">
                  <span className="flex-1" />
                  <Button size="sm" className="h-[32px] gap-[8px] rounded-[8px] px-[12px] text-[13px]" disabled={!q.trim()} onClick={() => start(q.trim(), { request: q.trim() })}>
                    <Sparkle size={14} aria-hidden="true" />
                    Build analysis
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
