import { LayoutGrid, List, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { eventsByAsset, usePortfolioTimeline } from '@/features/home/api'
import { useJobs } from '@/features/jobs/api'
import { jobProgress, runningByAsset } from '@/features/jobs/steps'
import { formatDay } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { assetMatches, byKindThenName, useAssetDetails, useAssets, type AssetSummary } from '../api'
import { AssetCard, AssetStatusPill } from '../components/asset-card'
import { AssetTile } from '../components/asset-tile'
import { KindBadge } from '../components/badges'
import { EmptyState } from '../components/panel'
import { Segmented } from '../components/segmented'

type Kind = 'all' | 'primary' | 'competitor'
type View = 'table' | 'grid'

const KINDS: Kind[] = ['all', 'primary', 'competitor']
const VIEWS: { value: View; label: string; icon: typeof List }[] = [
  { value: 'table', label: 'Table view', icon: List },
  { value: 'grid', label: 'Grid view', icon: LayoutGrid },
]

/** "Tyvaso · United Therapeutics · vs Treprostinil" */
function subline(a: AssetSummary): string {
  const brand = a.aliases.find((x) => x.toLowerCase() !== a.name.toLowerCase())
  const vs = a.kind === 'competitor' && a.competitorOf.length ? `vs ${a.competitorOf.map((p) => p.name).join(', ')}` : ''
  return [brand, a.company.name, vs].filter(Boolean).join(' · ')
}

function IndicationTags({ asset }: { asset: AssetSummary }) {
  return (
    <div className="flex flex-wrap gap-1">
      {(asset.tags.indications ?? []).map((x) => (
        <span key={x} className="rounded-[5px] bg-muted px-1.5 py-px text-[11px] whitespace-nowrap text-secondary-foreground">
          {x}
        </span>
      ))}
      {(asset.tags.investigational_indications ?? []).map((x) => (
        <span key={`i-${x}`} className="rounded-[5px] border border-dashed bg-card px-1.5 py-px text-[11px] whitespace-nowrap text-muted-foreground">
          {x}
        </span>
      ))}
    </div>
  )
}

/** Asset Search (README §5.3): every tracked asset, primary or competitor, as a table or cards. */
export function AssetSearchPage() {
  const navigate = useNavigate()
  const assets = useAssets()
  const portfolio = usePortfolioTimeline()
  const running = runningByAsset(useJobs({ status: 'running' }).data)
  const [params, setParams] = useSearchParams()
  // The query is typed into local state (URL updates may render later) and mirrored to ?q= for sharing.
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const kind: Kind = KINDS.find((k) => k === params.get('kind')) ?? 'all'
  const view: View = params.get('view') === 'grid' ? 'grid' : 'table'

  /** Set a URL param; its default removes it, so plain /assets stays clean. */
  const setParam = (key: string, value: string, fallback: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === fallback) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )

  const all = [...(assets.data ?? [])].sort(byKindThenName)
  const primaries = all.filter((a) => a.kind === 'primary').length
  const shown = all.filter((a) => (kind === 'all' || a.kind === kind) && assetMatches(a, q.trim()))
  const details = useAssetDetails(shown.map((a) => a.id))
  const byAsset = eventsByAsset(portfolio.data?.events ?? [])
  const progressOf = (id: string) => {
    const job = running.get(id)
    return job ? jobProgress(job) : null
  }
  const assetPath = (id: string) => `/assets/${encodeURIComponent(id)}/overview`

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
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <label className="flex h-[38px] flex-[1_1_320px] items-center gap-2 rounded-[10px] border bg-card px-3 text-muted-foreground focus-within:border-primary focus-within:shadow-focus">
          <Search className="size-[15px] shrink-0" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setParam('q', e.target.value, '')
            }}
            placeholder="Search by name, brand, company, indication or mechanism"
            aria-label="Search assets"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
          />
        </label>
        <Segmented<Kind>
          label="Kind"
          value={kind}
          onChange={(v) => setParam('kind', v, 'all')}
          options={[
            { value: 'all', label: `All ${all.length}` },
            { value: 'primary', label: `Primary ${primaries}` },
            { value: 'competitor', label: `Competitors ${all.length - primaries}` },
          ]}
        />
        <div role="group" aria-label="View" className="inline-flex rounded-[10px] bg-muted p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={view === v.value}
              aria-label={v.label}
              onClick={() => setParam('view', v.value, 'table')}
              className={cn('flex h-7 w-8 items-center justify-center rounded-lg text-text-secondary', view === v.value && 'bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)]')}
            >
              <v.icon className="size-[13px]" />
            </button>
          ))}
        </div>
      </div>

      {assets.isPending && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}
      {assets.isError && <p className="text-destructive">Assets couldn't be loaded.</p>}
      {assets.data && shown.length === 0 && (
        <section className="rounded-[14px] border bg-card">
          {all.length === 0 ? (
            <EmptyState title="No assets yet">
              <Link to="/chat?intent=add" className="font-medium text-primary hover:underline">
                Add an asset
              </Link>{' '}
              with Asset AI to start building its journey.
            </EmptyState>
          ) : q.trim() ? (
            <EmptyState title={`No assets match “${q.trim()}”`}>
              <Link to="/chat?intent=add" className="font-medium text-primary hover:underline">
                Add it with Asset AI
              </Link>{' '}
              to start building its journey.
            </EmptyState>
          ) : (
            <EmptyState title={`No ${kind === 'primary' ? 'primary' : 'competitor'} assets yet`} />
          )}
        </section>
      )}

      {shown.length > 0 && view === 'table' && (
        <section className="overflow-hidden rounded-[14px] border bg-card shadow-panel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Indications</TableHead>
                <TableHead>Approved in</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Latest update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((a) => (
                <TableRow key={a.id} onClick={() => navigate(assetPath(a.id))} className="cursor-pointer">
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <AssetTile name={a.name} kind={a.kind} size={30} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link to={assetPath(a.id)} onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-primary">
                            {a.name}
                          </Link>
                          <KindBadge kind={a.kind} competitorOf={a.competitorOf.map((p) => p.name)} />
                        </div>
                        <p className="truncate text-[12px] text-muted-foreground">{subline(a)}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <IndicationTags asset={a} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{details[a.id]?.kpis.approvalRegions.join(', ') || '—'}</TableCell>
                  <TableCell>
                    <AssetStatusPill asset={a} progress={progressOf(a.id)} variant="search" />
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">{formatNumber(a.counts.events)}</TableCell>
                  <TableCell className="max-w-[280px]">
                    {a.latestEvent ? (
                      <>
                        <p className="truncate">{a.latestEvent.title}</p>
                        <p className="font-mono text-[11.5px] text-muted-foreground">{formatDay(a.latestEvent.date)}</p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {shown.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
          {shown.map((a, i) => (
            <AssetCard key={a.id} asset={a} variant="search" index={i} events={byAsset.get(a.id) ?? []} progress={progressOf(a.id)} />
          ))}
        </div>
      )}
    </Page>
  )
}
