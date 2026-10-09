import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { isActive, useJobProgress } from '@/features/jobs/api'
import { StepBar } from '@/features/jobs/components/step-bar'
import { recordsTotal, sourceProgress } from '@/features/jobs/job-counters'
import { JobStatusBadge } from '@/features/jobs/jobs-pages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Card } from '../../api'

type JobCardData = Extract<Card, { type: 'job' }>

/** Progress of the crawl started from the chat (polls while it runs): step bar, counters, link to the live build. */
export function JobCard({ card }: { card: JobCardData }) {
  const job = useJobProgress(card.jobId)
  const j = job.data
  const overview = `/assets/${encodeURIComponent(card.assetId)}/overview`
  const live = !j || isActive(j.status)
  const sources = sourceProgress(j ?? { steps: [] })
  const finished = j ? j.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length : 0
  const total = j?.steps.length ?? 0
  const current = j?.steps.find((s) => s.status === 'running')
  const problems = j?.steps.filter((s) => s.error) ?? []

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">Collecting data for {card.assetName}</p>
          <p className="text-[12.5px] text-text-secondary">
            {!j
              ? 'Checking progress…'
              : current
                ? `Step ${finished + 1} of ${total} · ${current.label}`
                : isActive(j.status)
                  ? 'Waiting to start'
                  : `${finished} of ${total} steps finished`}
          </p>
        </div>
        {j && <JobStatusBadge status={j.status} />}
      </div>
      {job.isPending && <Skeleton className="h-1.5 w-full" />}
      {job.isError && <p className="text-destructive">Progress is unavailable right now.</p>}
      {j && <StepBar steps={j.steps} />}
      {j && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground tabular-nums">{formatNumber(recordsTotal(j))}</b> records
          </span>
          <span>
            <b className="font-semibold text-foreground tabular-nums">{formatNumber(j.events_created)}</b> events
          </span>
          <span>
            <b className="font-semibold text-foreground tabular-nums">
              {sources.done}/{sources.total}
            </b>{' '}
            sources
          </span>
        </p>
      )}
      {problems.length > 0 && (
        <ul aria-label="Step errors" className="space-y-0.5 text-[12.5px]">
          {problems.map((s) => (
            <li key={s.name} className={cn('line-clamp-2', s.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
              <span className="font-medium">{s.label}:</span> {s.error}
            </li>
          ))}
        </ul>
      )}
      <Link
        to={live ? `${overview}?build=1` : overview}
        className="inline-flex w-max items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
      >
        {live ? 'Watch the live build' : 'Open the journey'} <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  )
}
