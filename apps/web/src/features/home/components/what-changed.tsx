import { Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import type { JourneyEventV3 } from '@/features/journey/types'
import { formatDay, todayIso } from '@/lib/dates'
import { useEventSheet } from '@/stores/event-sheet-store'
import { usePortfolioTimeline, type PortfolioAsset } from '../api'
import { whatChanged } from '../home-data'
import { ListSkeleton } from './list-skeleton'

/** Home "What changed" (README §5.2): key High/Medium events of the last 90 days across assets and competitors. */
export function WhatChanged() {
  const portfolio = usePortfolioTimeline()
  const openEvent = useEventSheet((s) => s.openEvent)
  const assets = new Map((portfolio.data?.assets ?? []).map((a) => [a.id, a]))
  const groups = portfolio.data ? whatChanged(portfolio.data.events, todayIso()) : []

  return (
    <Panel title="What changed" description="High- and medium-significance events across your assets and their competitors" bodyClassName="py-1">
      {portfolio.isPending && <ListSkeleton />}
      {portfolio.isError && <p className="p-5 text-destructive">Recent events couldn't be loaded.</p>}
      {portfolio.data && groups.length === 0 && <EmptyState title="Quiet quarter">No new key events in the last 90 days.</EmptyState>}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="py-1">
          <p className="mx-5 mt-2.5 mb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{g.label}</p>
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
    <li className="flex animate-fade-up items-center gap-3 px-5 py-2.5 transition-colors hover:bg-background">
      <CategoryIcon category={e.category} className="size-[30px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <button type="button" onClick={onOpen} className="text-left font-medium text-pretty hover:text-primary">
          {e.title}
        </button>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
          {asset && (
            <Link to={`/assets/${encodeURIComponent(asset.id)}/overview`} className="inline-flex items-center gap-1.5 font-medium text-secondary-foreground hover:text-primary">
              <AssetTile name={asset.name} kind={asset.kind} size={16} />
              {asset.name}
            </Link>
          )}
          {asset?.kind === 'competitor' && <span className="rounded-[5px] bg-muted px-1.5 py-px text-[11px] text-secondary-foreground">Competitor</span>}
          <span className="font-mono">{formatDay(e.date)}</span>
          {e.via === 'ai_events' && (
            <span className="inline-flex items-center gap-1 text-violet">
              <Sparkles className="size-[11px]" />
              AI · {e.sources.length} source{e.sources.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      <SignificanceBadge value={e.significance} />
    </li>
  )
}
