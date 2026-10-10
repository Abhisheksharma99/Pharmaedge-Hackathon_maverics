import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface LegendItem {
  l: string
  c: string
  v?: number
}

export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn('mt-[6px] flex flex-wrap gap-x-[12px] gap-y-[4px] text-[11.5px] text-text-secondary', className)}>
      {items.map((i) => (
        <li key={i.l} className="inline-flex items-center gap-[5px]">
          <i aria-hidden="true" className="size-[8px] rounded-[2px]" style={{ background: i.c }} />
          {i.l}
          {i.v != null && <span className="font-mono text-[10.5px] text-muted-foreground">{formatNumber(i.v)}</span>}
        </li>
      ))}
    </ul>
  )
}
