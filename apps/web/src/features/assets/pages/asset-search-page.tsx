import { LayoutGrid, List, Plus, Search } from 'lucide-react'
import { useId, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { FiltersToggle } from '@/components/filters-toggle'
import { InlineError } from '@/components/inline-error'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { eventsByAsset, usePortfolioTimeline } from '@/features/home/api'
import { indicationOptions } from '@/features/journey/indications'
import { useJobs } from '@/features/jobs/api'
import { jobProgress, runningByAsset } from '@/features/jobs/steps'
import { formatDay } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { useCollapsed } from '@/lib/use-collapsed'
import { cn } from '@/lib/utils'
import { assetIndications, assetMatches, byKindThenName, useAssetDetails, useAssets, type AssetSummary } from '../api'
import { AssetCard, AssetStatusPill } from '../components/asset-card'
import { AssetTile } from '../components/asset-tile'
import { KindBadge } from '../components/badges'
import { EmptyState } from '../components/panel'
import { shortIndication } from '../components/competitors/utils'
import { Segmented } from '../components/segmented'

type Kind = 'all' | 'primary' | 'competitor'
type View = 'table' | 'grid'

const KINDS: Kind[] = ['all', 'primary', 'competitor']
const VIEWS: { value: View; label: string; icon: typeof List }[] = [
  { value: 'table', label: 'Table view', icon: List },
  { value: 'grid', label: 'Grid view', icon: LayoutGrid },
]

const ALL_INDICATIONS = '__all__'

/** "Tyvaso · United Therapeutics · vs Treprostinil" */
function subline(a: AssetSummary): string {
  const brand = a.aliases.find((x) => x.toLowerCase() !== a.name.toLowerCase())
  const vs = a.kind === 'competitor' && a.competitorOf.length ? `vs ${a.competitorOf.map((p) => p.name).join(', ')}` : ''
  return [brand, a.company.name, vs].filter(Boolean).join(' · ')
}

function IndicationTags({ asset }: { asset: AssetSummary }) {
  return (
    <div className="flex flex-wrap gap-[4px]">
      {(asset.tags.indications ?? []).map((x) => (
        <span key={x} title={x} className="rounded-[5px] bg-muted px-[6px] py-px text-[11px] whitespace-nowrap text-secondary-foreground">
          {shortIndication(x)}
        </span>
      ))}
      {(asset.tags.investigational_indications ?? []).map((x) => (
        <span key={`i-${x}`} title={x} className="rounded-[5px] border border-dashed bg-card px-[6px] py-px text-[11px] whitespace-nowrap text-muted-foreground">
          {shortIndication(x)}
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
  const indication = params.get('indication') ?? ''
  const [filtersHidden, setFiltersHidden] = useCollapsed('asset-search.filters')
  const filtersId = useId()

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
  const indications = indicationOptions(all, assetIndications)
  const shown = all.filter((a) => (kind === 'all' || a.kind === kind) && (!indication || assetIndications(a).includes(indication)) && assetMatches(a, q.trim()))
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
        <Button asChild>
          <Link to="/chat?intent=add">
            <Plus className="size-[15px]" /> Add asset
          </Link>
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-[10px]">
        <div id={filtersId} hidden={filtersHidden} className="contents">
          <label className="flex h-[38px] flex-[1_1_320px] items-center gap-[8px] rounded-[10px] border bg-card px-[12px] text-muted-foreground focus-within:border-primary focus-within:shadow-focus">
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
          {(indications.length > 1 || indication) && (
            <Select value={indication || ALL_INDICATIONS} onValueChange={(v) => setParam('indication', v, ALL_INDICATIONS)}>
              <SelectTrigger aria-label="Indication" className="h-[38px] max-w-[220px] min-w-[150px] gap-[6px] rounded-[10px] border-border bg-card px-[10px] py-0 text-[13px] text-secondary-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_INDICATIONS}>Indication: all</SelectItem>
                {indications.map((i) => (
                  <SelectItem key={i} value={i}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <FiltersToggle
          collapsed={filtersHidden}
          onCollapsed={setFiltersHidden}
          controls={filtersId}
          active={(q.trim() ? 1 : 0) + (kind !== 'all' ? 1 : 0) + (indication ? 1 : 0)}
          onClear={() => {
            setQ('')
            setParams(
              (prev) => {
                const next = new URLSearchParams(prev)
                for (const k of ['q', 'kind', 'indication']) next.delete(k)
                return next
              },
              { replace: true },
            )
          }}
          className="ml-auto"
        />
        <div role="group" aria-label="View" className="inline-flex gap-[2px] rounded-[8px] bg-muted p-[2px]">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={view === v.value}
              aria-label={v.label}
              onClick={() => setParam('view', v.value, 'table')}
              className={cn('flex h-[28px] w-[32px] items-center justify-center rounded-[6px] text-text-secondary', view === v.value && 'bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.1)]')}
            >
              <v.icon className="size-[13px]" />
            </button>
          ))}
        </div>
      </div>

      {assets.isPending &&
        (view === 'grid' ? (
          <div role="status" aria-label="Loading assets" className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-[16px]">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[230px] rounded-[14px]" />
            ))}
          </div>
        ) : (
          <div role="status" aria-label="Loading assets" className="space-y-[12px] rounded-[14px] border bg-card p-[16px] shadow-panel">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[52px] w-full" />
            ))}
          </div>
        ))}
      {assets.isError && (
        <section className="rounded-[14px] border bg-card shadow-panel">
          <InlineError message="Assets couldn't be loaded." onRetry={() => void assets.refetch()} />
        </section>
      )}
      {assets.data && shown.length === 0 && (
        <section className="rounded-[14px] border bg-card shadow-panel">
          {all.length === 0 ? (
            <EmptyState title="No assets yet">
              <Link to="/chat?intent=add" className="font-medium text-primary hover:underline">
                Add an asset
              </Link>{' '}
              with Asset AI to start building its journey.
            </EmptyState>
          ) : q.trim() || indication ? (
            <EmptyState title={q.trim() ? `No assets match “${q.trim()}”` : `No assets in ${indication}`}>
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
                  <TableCell className="min-w-[260px]">
                    <div className="flex items-center gap-[10px]">
                      <AssetTile name={a.name} kind={a.kind} size={30} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-[7px]">
                          <Link to={assetPath(a.id)} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-primary">
                            {a.name}
                          </Link>
                          <KindBadge kind={a.kind} competitorOf={a.competitorOf.map((p) => p.name)} />
                        </div>
                        <p className="line-clamp-1 max-w-[520px] text-[12px] whitespace-normal text-muted-foreground">{subline(a)}</p>
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
                  <TableCell className="max-w-[300px]">
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-[16px]">
          {shown.map((a, i) => (
            <AssetCard key={a.id} asset={a} variant="search" index={i} events={byAsset.get(a.id) ?? []} progress={progressOf(a.id)} />
          ))}
        </div>
      )}
    </Page>
  )
}
