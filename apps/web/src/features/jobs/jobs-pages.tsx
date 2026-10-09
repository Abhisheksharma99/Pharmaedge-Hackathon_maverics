import { CheckCircle2, CircleDashed, CircleSlash, Loader2, XCircle } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { isActive, useCancelJob, useJob, useJobs, type Job, type JobStatus, type StepStatus } from './api'

const STATUS: Record<JobStatus, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-muted text-secondary-foreground' },
  running: { label: 'Running', className: 'bg-[#eef2fd] text-primary' },
  completed: { label: 'Completed', className: 'bg-success-soft text-success' },
  completed_with_errors: { label: 'Completed with errors', className: 'bg-warning-soft text-warning' },
  failed: { label: 'Failed', className: 'bg-danger-soft text-destructive' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS[status]
  return <span className={cn('inline-flex h-5 items-center rounded-md px-1.5 text-xs font-semibold whitespace-nowrap', s.className)}>{s.label}</span>
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

function duration(job: Job): string {
  if (!job.started_at) return '—'
  const secs = Math.round(((job.finished_at ? Date.parse(job.finished_at) : Date.now()) - Date.parse(job.started_at)) / 1000)
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
}

const stepsDone = (job: Job) => job.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length

export function JobsPage() {
  const jobs = useJobs()
  return (
    <Page title="Crawl jobs" description="Data collection runs for your assets, newest first.">
      <Panel title="Recent jobs">
        {jobs.isPending && <Skeleton className="m-5 h-24" />}
        {jobs.data?.length === 0 && <EmptyState title="No crawl jobs yet">Use “Refresh data” on an asset to start one.</EmptyState>}
        {!!jobs.data?.length && (
          <Table>
            <TableHeader>
              <TableRow className="bg-background hover:bg-background">
                {['Asset', 'Type', 'Status', 'Steps', 'Requested by', 'Started', 'Duration'].map((h) => (
                  <TableHead key={h} className="h-9 text-xs font-semibold text-text-secondary first:pl-5">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.data.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="pl-5 font-medium">
                    <Link to={`/jobs/${j.id}`} className="hover:text-primary hover:underline">{j.assetName ?? j.asset}</Link>
                  </TableCell>
                  <TableCell className="capitalize">{j.type}</TableCell>
                  <TableCell><JobStatusBadge status={j.status} /></TableCell>
                  <TableCell className="tabular-nums">{stepsDone(j)}/{j.steps.length}</TableCell>
                  <TableCell>{j.requested_by?.name ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-text-secondary">{when(j.started_at ?? j.created_at)}</TableCell>
                  <TableCell className="tabular-nums">{duration(j)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </Page>
  )
}

const STEP_ICON: Record<StepStatus, React.ReactNode> = {
  pending: <CircleDashed className="size-4 text-muted-foreground" />,
  running: <Loader2 className="size-4 animate-spin text-primary" />,
  done: <CheckCircle2 className="size-4 text-success" />,
  failed: <XCircle className="size-4 text-destructive" />,
  skipped: <CircleSlash className="size-4 text-muted-foreground" />,
}

const humanize = (key: string) => key.replace(/_/g, ' ')

export function JobPage() {
  const { jobId = '' } = useParams()
  const job = useJob(jobId)
  const cancel = useCancelJob()

  if (job.isError) {
    return (
      <Page title="Job not found">
        <Link to="/jobs" className="font-medium text-primary hover:underline">Back to crawl jobs</Link>
      </Page>
    )
  }
  const j = job.data
  return (
    <Page
      title={j ? `${j.assetName ?? j.asset} · ${j.type}` : 'Crawl job'}
      description={j ? `Requested by ${j.requested_by?.name ?? 'system'} · ${when(j.created_at)}` : undefined}
      actions={
        j &&
        isActive(j.status) && (
          <Button
            variant="outline"
            disabled={j.cancel_requested || cancel.isPending}
            onClick={() =>
              cancel.mutate(j.id, { onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not cancel') })
            }
          >
            {j.cancel_requested ? 'Cancelling…' : 'Cancel job'}
          </Button>
        )
      }
    >
      {!j ? (
        <Skeleton className="h-64" />
      ) : (
        <Panel
          title="Steps"
          description={`${duration(j)} so far`}
          actions={
            <div className="flex items-center gap-3">
              <JobStatusBadge status={j.status} />
              <Link to={`/assets/${encodeURIComponent(j.asset)}/overview`} className="font-medium text-primary hover:underline">Open asset</Link>
            </div>
          }
        >
          <ol className="divide-y divide-[#eef0f3]">
            {j.steps.map((s) => (
              <li key={s.name} className="flex items-start gap-3 px-5 py-3.5">
                <span className="mt-0.5">{STEP_ICON[s.status]}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.label}</p>
                  {Object.keys(s.counts).length > 0 && (
                    <p className="mt-0.5 text-text-secondary">
                      {Object.entries(s.counts).map(([k, v]) => `${humanize(k)}: ${v}`).join(' · ')}
                    </p>
                  )}
                  {s.error && (
                    <p className={cn('mt-0.5', s.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{s.error}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground capitalize">{s.status}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </Page>
  )
}
