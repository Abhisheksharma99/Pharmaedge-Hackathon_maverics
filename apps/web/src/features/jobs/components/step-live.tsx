import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JobStep } from '../api'
import { formatAgo, formatSince, heartbeat, progressText, stepFraction, stepShort } from '../steps'

/**
 * Live count of the running step (crawler: steps[i].progress): "FDA calendar · 1,240 pages checked · 12 events
 * found", a determinate bar when the step knows its total, and when it last moved, or a stalled warning after
 * STALL_MINUTES without movement. Always three rows (placeholders before the first count, for steps that report
 * none, and between two steps: `step` null), so the surrounding layout never jumps.
 */
export function StepLive({ step, now, named = true, className }: { step: JobStep | null; now: number; named?: boolean; className?: string }) {
  const p = step?.progress
  const beat = step && heartbeat(step, now)
  const fraction = step && stepFraction(step)
  const started = Date.parse(step?.started_at ?? '')
  const text = !step ? 'Starting the next step…' : p ? progressText(p) : 'Working…'
  return (
    <div data-testid="step-live" className={cn('flex min-w-0 flex-col gap-[4px] text-[12px] leading-[16px]', className)}>
      <p className="truncate text-text-secondary" title={named && step ? `${step.label}: ${text}` : text}>
        {named && step && <span className="font-medium text-foreground">{stepShort(step)} · </span>}
        <span className="tabular-nums">{text}</span>
      </p>
      <span aria-hidden="true" className={cn('block h-[3px] overflow-hidden rounded-[2px]', fraction != null && 'bg-accent')}>
        {fraction != null && <i className="block h-full rounded-[2px] bg-primary transition-[width] duration-500" style={{ width: `${fraction * 100}%` }} />}
      </span>
      {beat?.stalled ? (
        <p className="flex min-w-0 items-center gap-[4px] text-warning">
          <TriangleAlert aria-hidden="true" className="size-[12px] shrink-0" />
          <span className="truncate">No progress for {formatSince(beat.seconds)} — may be stalled</span>
        </p>
      ) : (
        <p className="truncate text-muted-foreground">
          {beat
            ? `Last update ${formatAgo(beat.seconds)}`
            : Number.isNaN(started)
              ? '\u00a0'
              : `Running for ${formatSince(Math.max(0, Math.round((now - started) / 1000)))}`}
        </p>
      )}
    </div>
  )
}

/** One-line form for tables: "FDA calendar · 1,240 pages checked · 8 s ago", amber when it looks stalled. */
export function StepLiveInline({ step, now, className }: { step: JobStep; now: number; className?: string }) {
  const beat = heartbeat(step, now)
  const text = [
    stepShort(step),
    step.progress && progressText(step.progress),
    beat && (beat.stalled ? `no progress for ${formatSince(beat.seconds)} — may be stalled` : formatAgo(beat.seconds)),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <span title={text} className={cn('block min-w-0 truncate text-[11.5px] leading-[16px]', beat?.stalled ? 'text-warning' : 'text-muted-foreground', className)}>
      {text}
    </span>
  )
}
