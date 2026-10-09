import { Pill, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatNumber } from '@/lib/format'
import { useAssets, type AssetSummary } from '../api'
import { Chip } from '../components/badges'
import { EmptyState, Panel } from '../components/panel'

const STATUS_LABEL: Record<AssetSummary['status'], string> = {
  ready: 'Ready',
  onboarding: 'Collecting data',
  failed: 'Collection failed',
}

function matches(asset: AssetSummary, q: string): boolean {
  const haystack = [asset.name, ...asset.aliases, asset.company.name, ...(asset.tags.indications ?? []), asset.tags.mechanism ?? '']
    .join(' ')
    .toLowerCase()
  return q.toLowerCase().split(/\s+/).every((word) => haystack.includes(word))
}

export function AssetSearchPage() {
  const assets = useAssets()
  const [q, setQ] = useState('')
  const shown = (assets.data ?? []).filter((a) => matches(a, q.trim()))

  return (
    <Page
      title="Asset Search"
      description="Every tracked asset journey."
      actions={
        <Button asChild className="h-9 rounded-[10px] px-3.5">
          <Link to="/chat?intent=add">
            <Plus /> Add asset
          </Link>
        </Button>
      }
    >
      <Panel
        title={assets.data ? `${assets.data.length} asset${assets.data.length === 1 ? '' : 's'}` : 'Assets'}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, brand, company, indication"
              aria-label="Filter assets"
              className="h-8 w-72 pl-8"
            />
          </div>
        }
      >
        {assets.isPending && (
          <div className="space-y-3 p-5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}
        {assets.isError && <p className="p-5 text-destructive">Assets couldn't be loaded.</p>}
        {assets.data && assets.data.length === 0 && (
          <EmptyState title="No assets yet">
            <Link to="/chat?intent=add" className="font-medium text-primary hover:underline">
              Add an asset
            </Link>{' '}
            with Asset AI to start building its journey.
          </EmptyState>
        )}
        {assets.data && assets.data.length > 0 && shown.length === 0 && <EmptyState title={`No assets match “${q}”`} />}
        <ul className="divide-y divide-[#eef0f3]">
          {shown.map((a) => (
            <li key={a.id}>
              <Link to={`/assets/${encodeURIComponent(a.id)}/overview`} className="flex items-start gap-4 px-5 py-4 hover:bg-accent/50">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef2fd] text-primary">
                  <Pill className="size-5" />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="text-[15px] font-semibold">{a.name}</span>
                    <span className="text-text-secondary">{a.company.name}</span>
                    {a.status !== 'ready' && (
                      <span className="rounded-md bg-warning-soft px-1.5 text-xs font-semibold text-warning">{STATUS_LABEL[a.status]}</span>
                    )}
                    {a.kind === 'competitor' && a.competitorOf?.length > 0 && (
                      <span className="rounded-md bg-orange-soft px-1.5 text-xs font-semibold text-orange">
                        Competitor of {a.competitorOf.map((p) => p.name).join(', ')}
                      </span>
                    )}
                  </div>
                  {a.aliases.length > 0 && <p className="text-muted-foreground">{a.aliases.join(' · ')}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {(a.tags.indications ?? []).map((i) => (
                      <Chip key={i}>{i}</Chip>
                    ))}
                  </div>
                </div>
                <dl className="hidden shrink-0 grid-cols-3 gap-x-6 text-right md:grid">
                  <dt className="text-xs text-muted-foreground">Events</dt>
                  <dt className="text-xs text-muted-foreground">Trials</dt>
                  <dt className="text-xs text-muted-foreground">Releases</dt>
                  <dd className="font-semibold tabular-nums">{formatNumber(a.counts.events)}</dd>
                  <dd className="font-semibold tabular-nums">{formatNumber(a.counts.trials)}</dd>
                  <dd className="font-semibold tabular-nums">{formatNumber(a.counts.pressReleases)}</dd>
                </dl>
                {a.latestEvent && (
                  <div className="hidden w-64 shrink-0 lg:block">
                    <p className="text-xs text-muted-foreground">Latest · {formatDate(a.latestEvent.date)}</p>
                    <p className="line-clamp-2">{a.latestEvent.title}</p>
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </Page>
  )
}
