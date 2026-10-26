import { cn } from '@/lib/utils'
import type { JobStep } from '../api'
import { stepDuration, stepFraction, stepsFinished } from '../steps'

const TONE: Record<JobStep['status'], string> = {
  pending: 'bg-accent',
  running: 'animate-blink-dot bg-primary/45',
  done: 'bg-primary',
  failed: 'bg-[#dc8a35]',
  skipped: 'bg-[#d0d5dd]',
}

/**
 * The design's segmented crawl bar: one segment per step, as wide as the step's expected duration. The running
 * segment fills when its step reports a total (steps[i].progress), and blinks otherwise.
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
      {steps.map((s, i) => {
        const fraction = s.status === 'running' ? stepFraction(s) : null
        return (
          <i
            key={`${i}-${s.name}`}
            title={`${s.label}: ${s.status}`}
            data-status={s.status}
            className={cn('block min-w-[3px] overflow-hidden rounded-[2px]', fraction === null ? TONE[s.status] : 'bg-[#d5ddfa]')}
            style={{ flexGrow: stepDuration(s.name), flexBasis: 0 }}
          >
            {fraction !== null && <b className="block h-full bg-primary transition-[width] duration-500" style={{ width: `${fraction * 100}%` }} />}
          </i>
        )
      })}
    </div>
  )
}
