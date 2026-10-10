import { Check, GitMerge, TriangleAlert } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import type { JobStep } from '@/features/jobs/api'
import { stepShort } from '@/features/jobs/steps'
import { cn } from '@/lib/utils'
import type { JobFeedItem } from '../types'
import { formatClock, secondsSince } from './build-model'

/** Lines kept on screen (design_files/aj/live.jsx). */
const LOG_LINES = 140

const VERDICT: Record<NonNullable<JobFeedItem['verdict']>, string> = {
  Ingest: 'bg-success-soft text-success',
  Headline: 'bg-warning-soft text-warning',
  Skip: 'bg-muted text-muted-foreground',
}

/**
 * The crawl worker's live log (README §6.1 "Activity log"): clock since the job started, step tag, and the line by kind
 * (info, done ✓, warn ⚠, AI verdict pill, event + merged-records chip), with a typing caret on the newest line while
 * the job runs. It follows new lines unless the user has scrolled up more than 40px.
 */
export function ActivityLog({ items, steps, startedAt, running }: { items: JobFeedItem[]; steps: JobStep[]; startedAt: string | null; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lines = items.slice(-LOG_LINES)
  const last = lines.at(-1)?.id
  const byName = new Map(steps.map((s) => [s.name, s]))
  const start = startedAt ?? items[0]?.t ?? null

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [last])

  return (
    <div
      ref={ref}
      role="log"
      aria-live="off"
      aria-label="Crawl activity"
      className="absolute inset-0 overflow-auto pt-[8px] pb-[12px]"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {lines.map((l) => {
        const caret = running && l.id === last
        return (
          <div key={l.id} data-kind={l.kind} className="grid animate-log-in grid-cols-[40px_minmax(0,1fr)] gap-[8px] px-[16px] py-[4px] text-[12.5px] leading-[1.45]">
            <span className="pt-px font-mono text-[11px] text-faint">{formatClock(secondsSince(start, Date.parse(l.t)))}</span>
            <div className="min-w-0 break-words">
              <span className="mr-[6px] inline-block rounded-[4px] bg-muted px-[5px] text-[11px] leading-[17px] font-semibold text-text-secondary">
                {l.step === 'plan' ? 'Plan' : stepShort(byName.get(l.step) ?? { name: l.step, label: l.step })}
              </span>
              <span
                data-caret={caret || undefined}
                className={cn(
                  'text-secondary-foreground',
                  l.kind === 'warn' && 'text-warning',
                  l.kind === 'done' && 'font-medium text-foreground',
                  caret && "after:ml-[4px] after:inline-block after:h-[13px] after:w-[6px] after:animate-caret after:bg-primary after:align-[-2px] after:content-['']",
                )}
              >
                {l.kind === 'event' && (
                  <>
                    <span className="mr-[4px] font-bold text-success">+</span>
                    <b className="font-medium text-foreground">{l.text}</b>
                    {(l.merged ?? 0) > 1 && (
                      <span className="ml-[6px] inline-flex items-center gap-[2px] rounded bg-violet-soft px-[5px] align-[1px] text-[11px] text-violet">
                        <GitMerge aria-hidden="true" className="size-[11px]" />
                        {l.merged}
                      </span>
                    )}
                  </>
                )}
                {l.kind === 'ai' && (
                  <>
                    {l.verdict && (
                      <span className={cn('mr-[6px] inline-block rounded px-[5px] text-[10.5px] leading-[16px] font-semibold', VERDICT[l.verdict])}>{l.verdict}</span>
                    )}
                    {l.text}
                  </>
                )}
                {l.kind === 'warn' && (
                  <>
                    <TriangleAlert aria-hidden="true" className="mr-[4px] inline-block size-[12px] align-[-2px]" />
                    {l.text}
                  </>
                )}
                {l.kind === 'done' && (
                  <>
                    <Check aria-hidden="true" className="mr-[4px] inline-block size-[12px] align-[-2px] text-success" strokeWidth={2.6} />
                    {l.text}
                  </>
                )}
                {l.kind === 'info' && l.text}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
