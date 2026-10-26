import { Check } from 'lucide-react'
import { Link } from 'react-router'
import { useJobs } from '@/features/jobs/api'
import { currentStep, formatSince, heartbeat, jobProgress, jobStepLabel, progressShort } from '@/features/jobs/steps'
import { useNow } from '@/features/jobs/use-now'
import { cn } from '@/lib/utils'

/** Circular progress (0–1), 18px in the crawl chip. */
export function ProgressRing({ value, size = 18, warn = false }: { value: number; size?: number; warn?: boolean }) {
  const r = (size - 4) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#d5ddfa" strokeWidth={2.5} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={2.5}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value)}
        strokeLinecap="round"
        className={cn('transition-[stroke-dashoffset] duration-500', warn ? 'stroke-warning' : 'stroke-primary')}
      />
    </svg>
  )
}

/** Top-bar crawl status: the running crawl (→ its live build) or "All crawls finished"; nothing while unknown. */
export function CrawlChip() {
  const jobs = useJobs({ status: 'running' })
  const now = useNow(!!jobs.data?.length)
  if (!jobs.data) return null
  const job = jobs.data[0]
  if (!job) {
    return (
      <span className="inline-flex items-center gap-[5px] text-[12.5px] whitespace-nowrap text-success max-[899px]:hidden">
        <Check className="size-[13px]" strokeWidth={2.6} />
        All crawls finished
      </span>
    )
  }
  const name = job.assetName ?? job.asset
  const step = jobStepLabel(job)
  const pct = Math.round(jobProgress(job) * 100)
  const more = jobs.data.length - 1
  const live = currentStep(job)?.step
  const count = live?.progress ? progressShort(live.progress) : null
  const beat = live ? heartbeat(live, now) : null
  const stalled = beat?.stalled ? ` · no progress for ${formatSince(beat.seconds)}, may be stalled` : ''
  return (
    <Link
      to={`/assets/${encodeURIComponent(job.asset)}/overview?build=1`}
      title={stalled ? `No progress for ${formatSince(beat!.seconds)}: the crawl may be stalled. Open the live build` : 'Open the live build'}
      aria-label={`${name} crawl: ${step}${count ? `, ${count}` : ''}, ${pct}%${stalled}. Open the live build`}
      className={cn(
        'inline-flex h-[32px] items-center gap-[8px] rounded-full border bg-primary-soft pr-[10px] pl-[7px] text-[12.5px] whitespace-nowrap text-secondary-foreground transition-colors hover:border-primary',
        stalled ? 'border-warning' : 'border-[#d5ddfa]',
      )}
    >
      <ProgressRing value={jobProgress(job)} warn={!!stalled} />
      <span className="max-[899px]:hidden">
        <b className="font-semibold text-foreground">{name}</b> · {step}
        {count && <span className="tabular-nums"> · {count}</span>}
        {more > 0 && ` · +${more} more`}
      </span>
      <span className="font-mono text-[11.5px] font-semibold text-primary">{pct}%</span>
    </Link>
  )
}
