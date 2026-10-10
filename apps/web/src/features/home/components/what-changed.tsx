import { Sparkle } from 'lucide-react'
import { Link } from 'react-router'
import { CardFilters, useCardFilter } from '@/components/card-filters'
import { InlineError } from '@/components/inline-error'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { CATEGORY_META, CategoryIcon, IndicationBadges, SignificanceBadge } from '@/features/assets/components/badges'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { eventIndications } from '@/features/journey/indications'
import type { JourneyEventV3 } from '@/features/journey/types'
import { formatDay, todayIso } from '@/lib/dates'
import { useEventSheet } from '@/stores/event-sheet-store'
import { usePortfolioTimeline, type PortfolioAsset } from '../api'
import { whatChanged } from '../home-data'
import { ListSkeleton } from './list-skeleton'
import { NoMatches } from './no-matches'

/** Home "What changed" (README §5.2): key High/Medium events of the last 90 days across assets and competitors. */
export function WhatChanged() {
  const portfolio = usePortfolioTimeline()
  const openEvent = useEventSheet((s) => s.openEvent)
  const assets = new Map((portfolio.data?.assets ?? []).map((a) => [a.id, a]))
  const groups = portfolio.data ? whatChanged(portfolio.data.events, todayIso()) : []
  const all = groups.flatMap((g) => g.events)
  const assetName = (e: JourneyEventV3) => assets.get(e.asset)?.name ?? e.asset
  const { filtered, filters } = useCardFilter(all, (e) => `${e.title} ${assetName(e)}`, [
    { label: 'Indication', of: eventIndications },
    { label: 'Asset', of: (e) => [assetName(e)] },
    { label: 'Category', of: (e) => [CATEGORY_META[e.category]?.label ?? e.category] },
  ])
  const keep = new Set(filtered)
  const shownGroups = groups.map((g) => ({ ...g, events: g.events.filter((e) => keep.has(e)) })).filter((g) => g.events.length > 0)

  return (
    <Panel title="What changed" description="High- and medium-significance events across your assets and their competitors" bodyClassName="pt-[4px] pb-[8px]">
      {portfolio.isPending && <ListSkeleton />}
      {portfolio.isError && <InlineError message="Recent events couldn't be loaded." onRetry={() => void portfolio.refetch()} />}
      {portfolio.data && groups.length === 0 && <EmptyState title="Quiet quarter">No new key events in the last 90 days.</EmptyState>}
      {all.length > 0 && <CardFilters {...filters} placeholder="Search title or asset" />}
      {all.length > 0 && shownGroups.length === 0 && <NoMatches />}
      {shownGroups.map((g) => (
        <section key={g.label} aria-label={g.label} className="py-[4px]">
          <p className="mx-[20px] mt-[10px] mb-[4px] text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{g.label}</p>
          <ul>
            {g.events.map((e) => (
              <ChangeRow key={`${e.asset}|${e.id}`} event={e} asset={assets.get(e.asset)} onOpen={() => openEvent(e.asset, e.id)} />
            ))}
          </ul>
        </section>
      ))}
    </Panel>
  )
}

function ChangeRow({ event: e, asset, onOpen }: { event: JourneyEventV3; asset?: PortfolioAsset; onOpen: () => void }) {
  return (
    <li className="flex animate-fade-up items-center gap-[12px] px-[20px] py-[10px] transition-colors hover:bg-background">
      <CategoryIcon category={e.category} className="size-[30px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <button type="button" onClick={onOpen} className="text-left font-medium text-pretty hover:text-primary">
          {e.title}
        </button>
        <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px] text-[12px] text-muted-foreground">
          {asset && (
            <Link to={`/assets/${encodeURIComponent(asset.id)}/overview`} className="inline-flex items-center gap-[5px] rounded-[6px] border border-hair bg-background py-px pr-[6px] pl-[2px] font-medium text-secondary-foreground hover:border-border">
              <AssetTile name={asset.name} kind={asset.kind} size={16} />
              {asset.name}
            </Link>
          )}
          {asset?.kind === 'competitor' && <span className="rounded-[5px] bg-muted px-[6px] py-px text-[11px] text-secondary-foreground">Competitor</span>}
          <IndicationBadges items={eventIndications(e)} />
          <span className="font-mono">{formatDay(e.date)}</span>
          {e.via === 'ai_events' && (
            <span className="inline-flex items-center gap-[4px] text-violet">
              <Sparkle className="size-[11px]" />
              {e.sources.length} source{e.sources.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      <SignificanceBadge value={e.significance} />
    </li>
  )
}
