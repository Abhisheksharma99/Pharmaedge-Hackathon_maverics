import { Pill, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/auth-context'
import { useAssets, type RecordTab } from '@/features/assets/api'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { TAB_FOR_COLLECTION } from '@/features/assets/components/journey-timeline'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { RecordSheet } from '@/features/assets/components/record-sheet'
import { isActive, useJobs } from '@/features/jobs/api'
import { formatDate, formatNumber } from '@/lib/format'
import { useSignals, type Signal } from './api'

function Rows({ count }: { count: number }) {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

function TrackedAssets() {
  const assets = useAssets()
  const primary = (assets.data ?? []).filter((a) => a.kind === 'primary')
  const competitors = (assets.data ?? []).length - primary.length
  return (
    <Panel
      title="Tracked assets"
      description={assets.data ? `${primary.length} primary · ${competitors} competitor${competitors === 1 ? '' : 's'}` : undefined}
      actions={
        <Button asChild size="sm">
          <Link to="/chat?intent=add">
            <Plus /> Add asset
          </Link>
        </Button>
      }
    >
      {assets.isPending && <Rows count={2} />}
      {assets.data && primary.length === 0 && <EmptyState title="No assets yet">Add a drug by name with Asset AI.</EmptyState>}
      <ul className="divide-y divide-[#eef0f3]">
        {primary.map((a) => (
          <li key={a.id}>
            <Link to={`/assets/${encodeURIComponent(a.id)}/overview`} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/50">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef2fd] text-primary">
                <Pill className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {a.name} <span className="font-normal text-text-secondary">· {a.company.name}</span>
                  {a.status === 'onboarding' && (
                    <span className="ml-2 rounded-md bg-warning-soft px-1.5 text-xs font-semibold text-warning">Collecting data</span>
                  )}
                </p>
                {a.latestEvent && (
                  <p className="truncate text-muted-foreground">
                    {formatDate(a.latestEvent.date)} · {a.latestEvent.title}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                <span className="block text-sm font-semibold text-foreground tabular-nums">{formatNumber(a.counts.events)}</span>
                events
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function CrawlsInProgress() {
  const jobs = useJobs()
  const active = (jobs.data ?? []).filter((j) => isActive(j.status))
  return (
    <Panel title="Crawls in progress" description="Data collection running now">
      {jobs.isPending && <Rows count={1} />}
      {jobs.data && active.length === 0 && <EmptyState title="Nothing running">Refresh an asset or add one to start a crawl.</EmptyState>}
      <ul className="divide-y divide-[#eef0f3]">
        {active.map((j) => {
          const done = j.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length
          const current = j.steps.find((s) => s.status === 'running')
          return (
            <li key={j.id}>
              <Link to={`/jobs/${j.id}`} className="block px-5 py-3 hover:bg-accent/50">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{j.assetName ?? j.asset}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {done}/{j.steps.length} steps
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / Math.max(j.steps.length, 1)) * 100}%` }} />
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{current ? current.label : 'Queued'}</p>
              </Link>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function SignalList({ title, description, items, loading, empty }: { title: string; description: string; items: Signal[]; loading: boolean; empty: string }) {
  const [open, setOpen] = useState<{ assetId: string; tab: RecordTab; key: string } | null>(null)
  return (
    <Panel title={title} description={description}>
      {loading && <Rows count={4} />}
      {!loading && items.length === 0 && <EmptyState title={empty} />}
      <ul className="divide-y divide-[#eef0f3]">
        {items.map((s) => {
          const source = s.sources[0]
          const tab = source && TAB_FOR_COLLECTION[source.collection]
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!tab}
                onClick={() => source && tab && setOpen({ assetId: s.assetId, tab, key: source.record_key })}
                className="flex w-full items-start gap-3 px-5 py-3 text-left enabled:hover:bg-accent/50"
              >
                <CategoryIcon category={s.category} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-medium">{s.title}</p>
                  <p className="text-muted-foreground">
                    {s.assetName}
                    {s.kind === 'competitor' && ' (competitor)'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono text-xs text-muted-foreground">{formatDate(s.date)}</span>
                  <SignificanceBadge value={s.significance} />
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      <RecordSheet assetId={open?.assetId ?? ''} tab={open?.tab ?? 'clinical'} recordKey={open?.key ?? null} onClose={() => setOpen(null)} />
    </Panel>
  )
}

export function HomePage() {
  const { user } = useAuth()
  const firstName = user?.name.split(' ')[0] ?? ''
  const signals = useSignals()

  return (
    <Page title={`Welcome${firstName ? `, ${firstName}` : ''}`} description="Your tracked assets and what changed recently.">
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <TrackedAssets />
          <CrawlsInProgress />
        </div>
        <div className="flex flex-col gap-5">
          <SignalList
            title="Latest signals"
            description="High-significance events across your assets and their competitors"
            items={signals.data?.recent ?? []}
            loading={signals.isPending}
            empty="No signals yet"
          />
          <SignalList
            title="Coming up"
            description="The next readouts, decisions and patent expiries"
            items={signals.data?.upcoming ?? []}
            loading={signals.isPending}
            empty="No upcoming milestones"
          />
        </div>
      </div>
    </Page>
  )
}
