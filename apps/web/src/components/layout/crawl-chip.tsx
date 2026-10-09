import { Check } from 'lucide-react'
import { Link } from 'react-router'
import { useJobs } from '@/features/jobs/api'
import { jobProgress, jobStepLabel } from '@/features/jobs/steps'

/** Circular progress (0–1), 18px in the crawl chip. */
export function ProgressRing({ value, size = 18 }: { value: number; size?: number }) {
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
        className="stroke-primary transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  )
}

/** Top-bar crawl status: the running crawl (→ its live build) or "All crawls finished"; nothing while unknown. */
export function CrawlChip() {
  const jobs = useJobs({ status: 'running' })
  if (!jobs.data) return null
  const job = jobs.data[0]
  if (!job) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-success max-[899px]:hidden">
        <Check className="size-[13px]" strokeWidth={2.6} />
        All crawls finished
      </span>
    )
  }
  const name = job.assetName ?? job.asset
  const step = jobStepLabel(job)
  const pct = Math.round(jobProgress(job) * 100)
  const more = jobs.data.length - 1
  return (
    <Link
      to={`/assets/${encodeURIComponent(job.asset)}/overview?build=1`}
      title="Open the live build"
      aria-label={`${name} crawl: ${step}, ${pct}%. Open the live build`}
      className="inline-flex h-8 items-center gap-2 rounded-full border border-[#d5ddfa] bg-primary-soft pr-2.5 pl-[7px] text-[12.5px] whitespace-nowrap text-secondary-foreground transition-colors hover:border-primary"
    >
      <ProgressRing value={jobProgress(job)} />
      <span className="max-[899px]:hidden">
        <b className="font-semibold text-foreground">{name}</b> · {step}
        {more > 0 && ` · +${more} more`}
      </span>
      <span className="font-mono text-[11.5px] font-semibold text-primary">{pct}%</span>
    </Link>
  )
}
