import { InlineError } from '@/components/inline-error'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { CATEGORY_META } from '@/features/journey/constants'
import { daysBetween, relativeFuture, todayIso } from '@/lib/dates'
import { useEventSheet } from '@/stores/event-sheet-store'
import { usePortfolioTimeline } from '../api'
import { proximity, upcomingMilestones } from '../home-data'
import { ListSkeleton } from './list-skeleton'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Home "Next milestones" (README §5.2): date block, title, asset, countdown and a proximity bar. */
export function NextMilestones() {
  const portfolio = usePortfolioTimeline()
  const openEvent = useEventSheet((s) => s.openEvent)
  const today = todayIso()
  const assets = new Map((portfolio.data?.assets ?? []).map((a) => [a.id, a]))
  const items = portfolio.data ? upcomingMilestones(portfolio.data.events, today) : []

  return (
    <Panel title="Next milestones" description="Readouts, regulatory decisions and patent expiries" bodyClassName="pt-[4px] pb-[6px]">
      {portfolio.isPending && <ListSkeleton rows={3} />}
      {portfolio.isError && <InlineError message="Milestones couldn't be loaded." onRetry={() => void portfolio.refetch()} />}
      {portfolio.data && items.length === 0 && (
        <EmptyState title="No upcoming milestones">Expected readouts and decisions appear here once they are in a journey.</EmptyState>
      )}
      <ul>
        {items.map((e) => {
          const asset = assets.get(e.asset)
          return (
            <li key={`${e.asset}|${e.id}`}>
              <button type="button" onClick={() => openEvent(e.asset, e.id)} className="flex w-full items-start gap-[14px] px-[20px] py-[10px] text-left transition-colors hover:bg-background">
                <span className="flex w-[46px] shrink-0 flex-col items-center rounded-[10px] border bg-card py-[4px]">
                  <span className="text-[11px] font-semibold text-primary uppercase">{MONTHS[Number(e.date.slice(5, 7)) - 1] ?? ''}</span>
                  <b className="text-[14px] font-semibold tracking-[-0.02em]">{e.date.slice(0, 4)}</b>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
                  <span className="font-medium text-pretty">{e.title}</span>
                  <span className="flex items-center gap-[6px] text-[12px] text-muted-foreground">
                    {asset && <AssetTile name={asset.name} kind={asset.kind} size={16} />}
                    {asset?.name ?? e.asset}
                    <span className="ml-auto font-semibold text-primary">{relativeFuture(e.date, today)}</span>
                  </span>
                  <span className="h-[3px] overflow-hidden rounded-sm bg-accent">
                    <i
                      className="block h-full rounded-sm opacity-75"
                      style={{ width: `${proximity(daysBetween(today, e.date))}%`, background: CATEGORY_META[e.category]?.color }}
                    />
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
