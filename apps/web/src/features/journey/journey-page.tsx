import { ArrowRight } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { CardFilters, useCardFilter, type FilterFacet } from '@/components/card-filters'
import { Page } from '@/components/layout/page'
import { Skeleton } from '@/components/ui/skeleton'
import { byKindThenName, useAssets, type AssetSummary } from '@/features/assets/api'
import { IndicationBadges, KindBadge } from '@/features/assets/components/badges'
import { LoadError } from '@/features/assets/components/competitors/load-error'
import { shortIndication } from '@/features/assets/components/competitors/utils'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { cn } from '@/lib/utils'
import { useShellStore } from '@/stores/shell-store'
import { FOCUS } from './controls'
import { JourneySection } from './journey-section'

const KIND_LABEL = { primary: 'Primary', competitor: 'Competitor' } as const

/** An asset's indications, short form: approved first, then investigational. */
const assetIndications = (a: AssetSummary) =>
  [...new Set([...(a.tags.indications ?? []), ...(a.tags.investigational_indications ?? [])].map(shortIndication))]

const FACETS: FilterFacet<AssetSummary>[] = [
  { label: 'Indication', of: assetIndications },
  { label: 'Kind', of: (a) => [KIND_LABEL[a.kind]] },
]

/** URL params that carry over to another asset's journey (filters belong to the journey they were set on). */
const KEEP = ['view', 'order']

/**
 * Asset Journey (sidebar): every tracked asset, primary first, beside the selected asset's journey. `/journey` opens
 * the last asset viewed (else the first primary); picking another asset moves to `/journey/:assetId`.
 */
export function JourneyPage() {
  const { assetId } = useParams()
  const [params] = useSearchParams()
  const assets = useAssets()
  const lastAssetId = useShellStore((s) => s.lastAssetId)
  const setLastAssetId = useShellStore((s) => s.setLastAssetId)
  const all = useMemo(() => [...(assets.data ?? [])].sort(byKindThenName), [assets.data])
  const { filtered, filters } = useCardFilter(all, (a) => [a.name, ...a.aliases, a.company.name].join(' '), FACETS)
  const selected = all.find((a) => a.id === assetId)
  const navRef = useRef<HTMLElement>(null)
  const nShown = filtered.length

  // Keep the selected asset in view in the list (a scrolling column, or a scrolling row on narrow screens).
  useEffect(() => {
    const nav = navRef.current
    const li = nav?.querySelector('[aria-current="page"]')?.closest('li')
    if (!nav || !li) return
    const { offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h } = li
    if (x < nav.scrollLeft || x + w > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = x - 8
    if (y < nav.scrollTop || y + h > nav.scrollTop + nav.clientHeight) nav.scrollTop = y - 8
  }, [assetId, nShown])

  // The journey shown is the asset last viewed: the sidebar's asset sections follow it.
  useEffect(() => {
    if (selected) setLastAssetId(selected.id)
  }, [selected, setLastAssetId])

  const hrefFor = (id: string) => {
    const keep = new URLSearchParams()
    for (const k of KEEP) {
      const v = params.get(k)
      if (v) keep.set(k, v)
    }
    const qs = keep.toString()
    return `/journey/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`
  }

  if (!assetId && all.length) {
    const start = all.find((a) => a.id === lastAssetId) ?? all.find((a) => a.kind === 'primary') ?? all[0]!
    return <Navigate to={hrefFor(start.id)} replace />
  }

  return (
    <Page title="Asset Journey" description="The dated journey of every tracked asset: approvals, trials, publications, filings and milestones.">
      {assets.isError ? (
        <LoadError message="Assets couldn't be loaded." onRetry={() => void assets.refetch()} />
      ) : assets.isPending ? (
        <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-[24px] max-[900px]:grid-cols-1">
          <Skeleton className="h-[420px] rounded-[14px] max-[900px]:h-[120px]" />
          <Skeleton className="h-[420px] rounded-[14px]" />
        </div>
      ) : all.length === 0 ? (
        <section className="rounded-[14px] border bg-card shadow-panel">
          <EmptyState title="No assets yet">
            <Link to="/chat?intent=add" className="font-medium text-primary hover:underline">
              Add an asset
            </Link>{' '}
            with Asset AI to start building its journey.
          </EmptyState>
        </section>
      ) : (
        <div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-[24px] max-[900px]:grid-cols-1 max-[900px]:gap-[16px]">
          <Panel
            title="Assets"
            description={`${all.length} tracked`}
            className="sticky top-[16px] flex max-h-[calc(100dvh-112px)] flex-col max-[900px]:static max-[900px]:max-h-none"
            bodyClassName="flex min-h-0 flex-col"
          >
            <CardFilters {...filters} placeholder="Search assets" className="px-[14px]" />
            {filtered.length === 0 ? (
              <EmptyState title="No assets match these filters" />
            ) : (
              <nav ref={navRef} aria-label="Tracked assets" className="relative min-h-0 overflow-y-auto p-[8px] max-[900px]:overflow-x-auto max-[900px]:overflow-y-hidden">
                <ul className="flex flex-col gap-[2px] max-[900px]:flex-row max-[900px]:gap-[8px]">
                  {filtered.map((a) => (
                    <li key={a.id} className="max-[900px]:w-[220px] max-[900px]:shrink-0">
                      <AssetItem asset={a} to={hrefFor(a.id)} current={a.id === assetId} />
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </Panel>
          <div className="flex min-w-0 flex-col gap-[16px]">
            {selected ? (
              <>
                <AssetHeading asset={selected} />
                <JourneySection key={selected.id} asset={selected} />
              </>
            ) : (
              <section className="rounded-[14px] border bg-card shadow-panel">
                <EmptyState title="This asset isn’t tracked">Pick an asset from the list to see its journey.</EmptyState>
              </section>
            )}
          </div>
        </div>
      )}
    </Page>
  )
}

function AssetItem({ asset: a, to, current }: { asset: AssetSummary; to: string; current: boolean }) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex h-full flex-col gap-[4px] rounded-[10px] border border-transparent px-[10px] py-[8px] hover:bg-accent',
        FOCUS,
        current && 'border-[#c7d1f4] bg-primary-soft hover:bg-primary-soft',
        'max-[900px]:border-border',
      )}
    >
      <span className="flex min-w-0 items-center gap-[6px]">
        <b className={cn('truncate font-semibold', current && 'text-primary')}>{a.name}</b>
        <span className={cn('ml-auto shrink-0 rounded-full px-[6px] text-[10.5px] leading-[17px] font-semibold', a.kind === 'primary' ? 'bg-primary-soft text-primary' : 'bg-orange-soft text-competitor')}>
          {KIND_LABEL[a.kind]}
        </span>
      </span>
      <span className="truncate text-[12px] text-muted-foreground">{a.company.name}</span>
      <IndicationBadges items={assetIndications(a)} max={2} />
    </Link>
  )
}

function AssetHeading({ asset: a }: { asset: AssetSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
      <h2 className="text-[18px] leading-[24px] font-[650] tracking-[-0.01em]">{a.name}</h2>
      <KindBadge kind={a.kind} competitorOf={a.competitorOf.map((p) => p.name)} />
      <span className="text-text-secondary">{a.company.name}</span>
      <IndicationBadges items={assetIndications(a)} max={4} />
      <Link to={`/assets/${encodeURIComponent(a.id)}/overview`} className={cn('ml-auto inline-flex items-center gap-[4px] rounded-sm text-[12.5px] font-medium text-primary hover:underline', FOCUS)}>
        Open asset <ArrowRight className="size-[12px]" aria-hidden="true" />
      </Link>
    </div>
  )
}
