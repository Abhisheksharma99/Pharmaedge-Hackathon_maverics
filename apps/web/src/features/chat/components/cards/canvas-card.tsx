import { ArrowUpRight, Network } from 'lucide-react'
import { Link } from 'react-router'
import type { Card } from '../../api'
import { viewPath } from '../../navigation'

type CanvasCardData = Extract<Card, { type: 'canvas' }>

/** A journey canvas Asset AI built: what it holds, and the way to it. */
export function CanvasCard({ card }: { card: CanvasCardData }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <p className="flex items-center gap-2 border-b border-[#eef0f3] bg-[#f9fafb] px-3 py-2 text-[12.5px] font-semibold">
        <Network aria-hidden="true" className="size-3.5 text-primary" />
        <span className="min-w-0 truncate">{card.title}</span>
      </p>
      <ul className="flex flex-wrap gap-1.5 px-3 py-2.5">
        {card.groups.map((g) => (
          <li key={g.label} className="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium text-secondary-foreground">
            {g.label} <span className="text-muted-foreground">{g.events}</span>
          </li>
        ))}
      </ul>
      <Link
        to={viewPath({ assetId: card.assetId, tab: 'canvas', canvasId: card.canvasId })}
        className="flex items-center gap-1 border-t border-[#eef0f3] px-3 py-2 text-[12.5px] font-medium text-primary hover:underline"
      >
        Open the canvas to edit it <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  )
}
