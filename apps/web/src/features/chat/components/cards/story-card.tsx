import { ArrowUpRight, ChartGantt } from 'lucide-react'
import { Link } from 'react-router'
import type { Card } from '../../api'
import { viewPath } from '../../navigation'

type StoryCardData = Extract<Card, { type: 'story' }>

/** A journey story Asset AI built: what it shows, and the way to it. */
export function StoryCard({ card }: { card: StoryCardData }) {
  const facts = [`${card.events} events`, `${card.changes} changes`, ...(card.checks ? [`${card.checks} to check`] : []), ...(card.compare ? [`vs ${card.compare}`] : [])]
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <p className="flex items-center gap-2 border-b border-[#eef0f3] bg-[#f9fafb] px-3 py-2 text-[12.5px] font-semibold">
        <ChartGantt aria-hidden="true" className="size-3.5 text-primary" />
        <span className="min-w-0 truncate">{card.title}</span>
      </p>
      <ul className="flex flex-wrap gap-1.5 px-3 py-2.5">
        {facts.map((f) => (
          <li key={f} className="inline-flex h-6 items-center rounded-md border px-2 text-[12px] font-medium text-secondary-foreground">{f}</li>
        ))}
      </ul>
      <Link
        to={viewPath({ assetId: card.assetId, tab: 'canvas', storyId: card.storyId })}
        className="flex items-center gap-1 border-t border-[#eef0f3] px-3 py-2 text-[12.5px] font-medium text-primary hover:underline"
      >
        Open the journey story <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  )
}
