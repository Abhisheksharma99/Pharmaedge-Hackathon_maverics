import { ArrowRight, Check, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import type { JobStep } from '@/features/jobs/api'
import { recordsTotal, sourceProgress } from '@/features/jobs/job-counters'
import { currentStep, jobDuration, stepDuration, stepsFinished } from '@/features/jobs/steps'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { JobProgress } from '../types'
import { buildPhase, formatClock, secondsSince, stageRuns } from './build-model'

const SEGMENT: Record<JobStep['status'], string> = {
  pending: 'bg-accent',
  running: 'bg-[#d5ddfa]',
  done: 'bg-primary',
  failed: 'bg-[#dc8a35]',
  skipped: 'bg-[#d0d5dd]',
}
const STRIPES: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.3) 0 4px, transparent 4px 8px)',
  backgroundSize: '11.3px 11.3px',
}

/** Wall-clock time, re-read every second while `ticking` (the elapsed clock). */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

/**
 * Live build header (README §6.1 "Build strip"): what the crawl is doing, its counters, one segment per step (as wide
 * as the step's expected duration) and the stage labels; "Explore the journey" once it has ended.
 */
export function BuildStrip({ job, eventsCount, onExplore }: { job: JobProgress; eventsCount: number; onExplore: () => void }) {
  const phase = buildPhase(job)
  const now = useNow(phase !== 'done')
  const n = job.steps.length
  const finished = stepsFinished(job)
  const sources = sourceProgress(job)
  const records = recordsTotal(job)
  const current = currentStep(job)
  const at = current?.index ?? job.steps.findIndex((s) => s.status === 'pending')
  const ready = job.status === 'completed' || job.status === 'completed_with_errors'
  const end = Date.parse(job.finished_at ?? '')
  const seconds = secondsSince(job.started_at, phase === 'done' && !Number.isNaN(end) ? end : now)

  const title =
    phase === 'planning'
      ? 'Planning the crawl'
      : phase === 'running'
        ? 'Building the journey'
        : ready
          ? 'Journey ready'
          : job.status === 'failed'
            ? 'Crawl failed'
            : 'Crawl cancelled'
  const sub =
    phase === 'planning' ? (
      `Laying out ${n} steps across ${sources.total} sources for ${job.assetName ?? job.asset}`
    ) : phase === 'running' ? (
      <>
        Step {at >= 0 ? at + 1 : n} of {n}
        {at >= 0 && (
          <>
            {' · '}
            <span className="font-medium text-foreground">{job.steps[at]!.label}</span>
          </>
        )}
      </>
    ) : ready ? (
      `${formatNumber(eventsCount)} events from ${formatNumber(records)} records · finished in ${jobDuration(job)}`
    ) : (
      `${finished} of ${n} steps finished`
    )
  const stats: [label: string, value: string][] = [
    ['Records', formatNumber(records)],
    ['Events', formatNumber(eventsCount)],
    ['Sources', `${sources.done}/${sources.total}`],
    [phase === 'done' ? 'Duration' : 'Elapsed', formatClock(seconds)],
  ]

  return (
    <section
      aria-label="Live build"
      className={cn('rounded-[14px] border bg-card px-5 pt-[18px] pb-3.5 shadow-panel transition-colors duration-500', ready && 'border-[#bfe3dd]')}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_380px] items-start gap-3">
          <StatusDot phase={phase} status={job.status} />
          <div aria-live="polite" className="min-w-0">
            <h2 className="text-[17px] leading-6 font-semibold tracking-[-0.01em]">{title}</h2>
            <p className="mt-[3px] text-text-secondary">{sub}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-7">
          <dl className="flex flex-wrap items-center gap-7">
            {stats.map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse">
                <dt className="text-[12px] text-muted-foreground">{label}</dt>
                <dd className="text-[22px] leading-7 font-semibold tracking-[-0.02em] tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {phase === 'done' && (
            <Button size="lg" className="h-10 animate-fade-up rounded-[10px] px-4" onClick={onExplore}>
              Explore the journey <ArrowRight />
            </Button>
          )}
        </div>
      </div>
      <div
        role="progressbar"
        aria-label="Crawl progress"
        aria-valuemin={0}
        aria-valuemax={n}
        aria-valuenow={finished}
        className="mt-4 flex h-2 gap-[3px]"
      >
        {job.steps.map((s, i) => (
          <i
            key={`${i}-${s.name}`}
            data-status={s.status}
            title={`${i + 1}. ${s.label}`}
            className={cn('relative block min-w-1 overflow-hidden rounded-[3px] transition-colors duration-300', SEGMENT[s.status])}
            style={{ flexGrow: stepDuration(s.name), flexBasis: 0 }}
          >
            {s.status === 'running' && <span className="absolute inset-0 animate-stripes bg-primary" style={STRIPES} />}
          </i>
        ))}
      </div>
      <div className="mt-[7px] flex gap-[3px] text-[11.5px] text-muted-foreground">
        {stageRuns(job.steps).map((r) => {
          const on = phase === 'running' && at >= r.first && at <= r.last
          return (
            <span
              key={r.first}
              data-current={on || undefined}
              className={cn('min-w-0 truncate transition-colors duration-300', on && 'font-semibold text-primary')}
              style={{ flexGrow: r.grow, flexBasis: 0 }}
            >
              {r.stage}
            </span>
          )
        })}
      </div>
    </section>
  )
}

function StatusDot({ phase, status }: { phase: ReturnType<typeof buildPhase>; status: JobProgress['status'] }) {
  if (phase === 'done') {
    const ok = status === 'completed' || status === 'completed_with_errors'
    return (
      <span
        className={cn(
          'flex size-6 shrink-0 animate-ag-in items-center justify-center rounded-full text-white',
          ok ? 'bg-success' : status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground',
        )}
      >
        {ok ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
      </span>
    )
  }
  return (
    <span className="relative mt-[-1px] flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft">
      <i className="size-2 rounded-full bg-primary" />
      <span aria-hidden="true" className="absolute inset-0 animate-pulse-ring rounded-full motion-reduce:hidden border-2 border-primary" />
    </span>
  )
}
