import { AssetTile } from '@/features/assets/components/asset-tile'
import { SignificanceBadge } from '@/features/assets/components/badges'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { formatDay, formatMonth } from '@/lib/dates'
import { useEventSheet } from '@/stores/event-sheet-store'
import { usePortfolioTimeline } from '../api'
import { competitorMoves } from '../home-data'
import { ListSkeleton } from './list-skeleton'

/** Home "Competitive signals" (README §5.2): competitor events with the primaries they compete with. */
export function CompetitiveSignals() {
  const portfolio = usePortfolioTimeline()
  const openEvent = useEventSheet((s) => s.openEvent)
  const assets = new Map((portfolio.data?.assets ?? []).map((a) => [a.id, a]))
  const moves = portfolio.data ? competitorMoves(portfolio.data.events, (id) => assets.get(id)?.kind === 'competitor') : []

  return (
    <Panel title="Competitive signals" description="Moves by competitors of your assets" bodyClassName="py-1">
      {portfolio.isPending && <ListSkeleton />}
      {portfolio.isError && <p className="p-5 text-destructive">Competitor events couldn't be loaded.</p>}
      {portfolio.data && moves.length === 0 && (
        <EmptyState title="No competitor moves yet">Competitors are tracked once Asset AI identifies them for one of your assets.</EmptyState>
      )}
      <ul>
        {moves.map((e) => {
          const asset = assets.get(e.asset)
          const name = asset?.name ?? e.asset
          const vs = (asset?.competitorOf ?? []).map((id) => assets.get(id)?.name ?? id).join(', ')
          return (
            <li key={`${e.asset}|${e.id}`}>
              <button type="button" onClick={() => openEvent(e.asset, e.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-background">
                <AssetTile name={name} kind="competitor" size={30} />
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="font-medium text-pretty">{e.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
                    <b className="font-medium text-secondary-foreground">{name}</b>
                    {vs && <span>vs {vs}</span>}
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
