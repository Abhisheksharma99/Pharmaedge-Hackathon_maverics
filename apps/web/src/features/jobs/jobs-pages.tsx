import { Activity, ArrowRight, Check, Loader2, SquareDashed, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { InlineError } from '@/components/inline-error'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { isActive, useCancelJob, useJob, useJobs, type JobStatus, type JobStep } from './api'
import { jobDuration, stepsFinished } from './steps'

const STATUS: Record<JobStatus, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-muted text-secondary-foreground' },
  running: { label: 'Running', className: 'bg-primary-soft text-primary' },
  completed: { label: 'Completed', className: 'bg-success-soft text-success' },
  completed_with_errors: { label: 'Completed with errors', className: 'bg-warning-soft text-warning' },
  failed: { label: 'Failed', className: 'bg-danger-soft text-destructive' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-secondary-foreground' },
}

/** Prototype `.jb`: 20px pill-ish badge, 11.5px 600. */
export function JobStatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS[status]
  return <span className={cn('inline-flex h-[20px] items-center rounded-md px-[6px] text-[11.5px] font-semibold whitespace-nowrap', s.className)}>{s.label}</span>
}

/** "Oct 9, 9:02 AM" in the list, "Oct 4, 2026, 9:30 AM" in the detail header. */
const SHORT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
const MEDIUM: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
function when(iso: string | null, options: Intl.DateTimeFormatOptions): string {
  return iso ? new Date(iso).toLocaleString('en-US', options) : '—'
}

/** Prototype `.mini-bar`: 64px by 4px. */
function MiniBar({ value, bad = false, className }: { value: number; bad?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('block h-[4px] w-[64px] overflow-hidden rounded-[2px] bg-accent', className)}>
      <i className={cn('block h-full transition-[width] duration-200', bad ? 'bg-destructive' : 'bg-primary')} style={{ width: `${Math.min(1, value) * 100}%` }} />
    </span>
  )
}

export function JobsPage() {
  const jobs = useJobs()
  const navigate = useNavigate()
  return (
    <Page title="Crawl jobs" description="Data collection runs for your assets, newest first.">
      <section className="overflow-hidden rounded-[14px] border bg-card shadow-panel">
        {jobs.isPending && (
          <div role="status" aria-label="Loading crawl jobs" className="space-y-[10px] p-[20px]">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[36px] w-full" />
            ))}
          </div>
        )}
        {jobs.isError && <InlineError message="Crawl jobs couldn't be loaded." onRetry={() => void jobs.refetch()} />}
        {jobs.data?.length === 0 && <EmptyState title="No crawl jobs yet">Use “Refresh data” on an asset to start one.</EmptyState>}
        {!!jobs.data?.length && (
          <Table>
            <TableHeader>
              <TableRow>
                {['Asset', 'Type', 'Status', 'Steps', 'Requested by', 'Started', 'Duration'].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.data.map((j) => {
                const done = stepsFinished(j)
                return (
                  <TableRow key={j.id} onClick={() => navigate(`/jobs/${encodeURIComponent(j.id)}`)} className="cursor-pointer">
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-[10px]">
                        <AssetTile name={j.assetName ?? j.asset} kind={j.type === 'competitor' ? 'competitor' : 'primary'} size={24} />
                        <Link to={`/jobs/${encodeURIComponent(j.id)}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-primary hover:underline">
                          {j.assetName ?? j.asset}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize">{j.type}</TableCell>
                    <TableCell><JobStatusBadge status={j.status} /></TableCell>
                    <TableCell>
                      <span className="flex items-center gap-[8px]">
                        <span className="font-mono">{done}/{j.steps.length}</span>
                        <MiniBar value={j.steps.length ? done / j.steps.length : 0} bad={j.status === 'failed'} />
                      </span>
                    </TableCell>
                    <TableCell>{j.requested_by?.name ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{when(j.started_at ?? j.created_at, SHORT)}</TableCell>
                    <TableCell className="font-mono">{jobDuration(j)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </Page>
  )
}

/** Step glyph (prototype `.step-ic`): pending dashed, running spinner, done success disc, failed x, warning triangle. */
function StepGlyph({ step }: { step: JobStep }) {
  const base = 'mt-[1px] flex size-[20px] shrink-0 items-center justify-center'
  if (step.status === 'failed') return <span className={cn(base, 'text-destructive')}><X aria-label="Failed" className="size-[15px]" /></span>
  if (step.status === 'running') return <span className={cn(base, 'text-primary')}><Loader2 aria-label="Running" className="size-[15px] animate-spin" /></span>
  if (step.status === 'done' && step.error) return <span className={cn(base, 'text-[#c4690f]')}><TriangleAlert aria-label="Finished with a warning" className="size-[15px]" /></span>
  if (step.status === 'done') {
    return (
      <span className="mt-[1px] flex size-[18px] shrink-0 items-center justify-center rounded-full bg-success text-white">
        <Check aria-label="Done" strokeWidth={3} className="size-[11px]" />
      </span>
    )
  }
  return <span className={cn(base, 'text-[#c0c6d0]')}><SquareDashed aria-label={step.status === 'skipped' ? 'Skipped' : 'Pending'} className="size-[15px]" /></span>
}

const humanize = (key: string) => key.replace(/_/g, ' ')

export function JobPage() {
  const { jobId = '' } = useParams()
  const job = useJob(jobId)
  const cancel = useCancelJob()

  if (job.isError && !job.data) {
    const missing = job.error instanceof ApiError && job.error.status === 404
    return (
      <Page title={missing ? 'Job not found' : "The job couldn't be loaded"}>
        {!missing && <InlineError message="Check your connection and try again." onRetry={() => void job.refetch()} className="px-0 pt-0" />}
        <Link to="/jobs" className="font-medium text-primary hover:underline">Back to crawl jobs</Link>
      </Page>
    )
  }
  const j = job.data
  const running = !!j && isActive(j.status)
  const done = j ? stepsFinished(j) : 0
  const crumb: ReactNode = (
    <nav aria-label="Breadcrumb" className="flex flex-wrap gap-[6px] text-text-secondary">
      <Link to="/jobs" className="hover:text-foreground hover:underline">Crawl jobs</Link>
      <span aria-hidden="true" className="text-faint">/</span>
      <span aria-current="page" className="font-medium text-foreground">{jobId}</span>
    </nav>
  )
  return (
    <Page
      crumb={crumb}
      title={j ? `${j.assetName ?? j.asset} · ${j.type}` : 'Crawl job'}
      description={j ? `Requested by ${j.requested_by?.name ?? 'system'} · ${when(j.created_at, MEDIUM)}` : undefined}
      actions={
        j && (
          <div className="flex flex-wrap items-center gap-[8px]">
            <JobStatusBadge status={j.status} />
            {running && (
              <Button variant="outline" size="sm" disabled={j.cancel_requested || cancel.isPending} onClick={() => cancel.mutate(j.id, { onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not cancel') })}>
                {j.cancel_requested ? 'Cancelling…' : 'Cancel job'}
              </Button>
            )}
            {running && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/assets/${encodeURIComponent(j.asset)}/overview?build=1`}>
                  <Activity /> Live build view
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to={`/assets/${encodeURIComponent(j.asset)}/overview`}>
                Open asset <ArrowRight className="size-[13px]" />
              </Link>
            </Button>
          </div>
        )
      }
    >
      {!j ? (
        <div role="status" aria-label="Loading the job" className="space-y-[12px] rounded-[14px] border bg-card p-[20px]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[34px] w-full" />
          ))}
        </div>
      ) : (
        <Panel title="Steps" description={`${jobDuration(j)}${running ? ' so far' : ''} · ${done} of ${j.steps.length} finished`}>
          <ol>
            {j.steps.map((s) => {
              const counts = Object.entries(s.counts).filter(([, v]) => v > 0)
              return (
                <li key={s.name} className={cn('flex items-start gap-[12px] border-b border-hair px-[20px] py-[12px] transition-colors last:border-b-0', s.status === 'running' && 'bg-[#f8f9fe]')}>
                  <StepGlyph step={s} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('font-medium', s.status === 'pending' && 'font-normal text-text-secondary')}>{s.label}</p>
                    {counts.length > 0 && (
                      <p className="mt-[2px] font-mono text-[11.5px] text-text-secondary">{counts.map(([k, v]) => `${humanize(k)}: ${formatNumber(v)}`).join(' · ')}</p>
                    )}
                    {s.error && <p className={cn('mt-[2px] text-[12.5px]', s.status === 'failed' ? 'text-destructive' : 'text-warning')}>{s.error}</p>}
                  </div>
                  <span className="text-[12px] text-muted-foreground capitalize">{s.status}</span>
                </li>
              )
            })}
          </ol>
        </Panel>
      )}
    </Page>
  )
}
