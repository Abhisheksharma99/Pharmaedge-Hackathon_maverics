import { cn } from '@/lib/utils'
import type { JobStep } from '../api'
import { stepDuration, stepsFinished } from '../steps'

const TONE: Record<JobStep['status'], string> = {
  pending: 'bg-accent',
  running: 'animate-blink-dot bg-primary/45',
  done: 'bg-primary',
  failed: 'bg-[#dc8a35]',
  skipped: 'bg-[#d0d5dd]',
}

/**
 * The design's segmented crawl bar: one segment per step, as wide as the step's expected duration. Jobs carry no
 * per-step progress, so the running segment blinks instead of filling.
 */
export function StepBar({ steps, className }: { steps: JobStep[]; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Crawl steps"
      aria-valuemin={0}
      aria-valuemax={steps.length}
      aria-valuenow={stepsFinished({ steps })}
      className={cn('flex h-[6px] gap-[2px]', className)}
    >
      {steps.map((s, i) => (
        <i
          key={`${i}-${s.name}`}
          title={`${s.label}: ${s.status}`}
          data-status={s.status}
          className={cn('block min-w-[3px] rounded-[2px]', TONE[s.status])}
          style={{ flexGrow: stepDuration(s.name), flexBasis: 0 }}
        />
      ))}
    </div>
  )
}
