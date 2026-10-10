import { CardFilters, useCardFilter } from '@/components/card-filters'
import { InlineError } from '@/components/inline-error'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { IndicationBadges, SignificanceBadge } from '@/features/assets/components/badges'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { eventIndications } from '@/features/journey/indications'
import type { JourneyEventV3 } from '@/features/journey/types'
import { formatDay, formatMonth, todayIso } from '@/lib/dates'
import { useEventSheet } from '@/stores/event-sheet-store'
import { usePortfolioTimeline } from '../api'
import { competitorMoves } from '../home-data'
import { ListSkeleton } from './list-skeleton'
import { NoMatches } from './no-matches'

/** Home "Competitive signals" (README §5.2): competitor events with the primaries they compete with. */
export function CompetitiveSignals() {
  const portfolio = usePortfolioTimeline()
  const openEvent = useEventSheet((s) => s.openEvent)
  const assets = new Map((portfolio.data?.assets ?? []).map((a) => [a.id, a]))
  // Filter every competitor move, then show the first few of what is left.
  const all = portfolio.data ? competitorMoves(portfolio.data.events, (id) => assets.get(id)?.kind === 'competitor', todayIso(), Infinity) : []
  const assetName = (e: JourneyEventV3) => assets.get(e.asset)?.name ?? e.asset
  const { filtered, filters } = useCardFilter(all, (e) => `${e.title} ${assetName(e)}`, [
    { label: 'Indication', of: eventIndications },
    { label: 'Asset', of: (e) => [assetName(e)] },
  ])
  const moves = filtered.slice(0, 8)

  return (
    <Panel title="Competitive signals" description="Moves by competitors of your assets" bodyClassName="pt-[4px] pb-[8px]">
      {portfolio.isPending && <ListSkeleton />}
      {portfolio.isError && <InlineError message="Competitor events couldn't be loaded." onRetry={() => void portfolio.refetch()} />}
      {portfolio.data && moves.length === 0 && (
        <EmptyState title="No competitor moves yet">Competitors are tracked once Asset AI identifies them for one of your assets.</EmptyState>
      )}
      {all.length > 0 && <CardFilters {...filters} collapseKey="home.competitive-signals" placeholder="Search title or competitor" />}
      {all.length > 0 && moves.length === 0 && <NoMatches what="moves" />}
      <ul>
        {moves.map((e) => {
          const asset = assets.get(e.asset)
          const name = assetName(e)
          const vs = (asset?.competitorOf ?? []).map((id) => assets.get(id)?.name ?? id).join(', ')
          return (
            <li key={`${e.asset}|${e.id}`}>
              <button type="button" onClick={() => openEvent(e.asset, e.id)} className="flex w-full items-center gap-[12px] px-[20px] py-[10px] text-left transition-colors hover:bg-background">
                <AssetTile name={name} kind="competitor" size={30} />
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="font-medium text-pretty">{e.title}</span>
                  <span className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px] text-[12px] text-muted-foreground">
                    <b className="font-medium text-secondary-foreground">{name}</b>
                    {vs && <span>vs {vs}</span>}
                    <IndicationBadges items={eventIndications(e)} />
                    <span className="font-mono">{e.is_milestone ? `expected ${formatMonth(e.date)}` : formatDay(e.date)}</span>
                  </span>
                </span>
                <SignificanceBadge value={e.significance} />
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
