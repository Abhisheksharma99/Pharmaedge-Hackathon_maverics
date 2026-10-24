import { use, useState } from 'react'
import { ChartExpanded, useCardData } from './card-data'
import { Legend } from './legend'
import { cn } from '@/lib/utils'

export interface Slice {
  l: string
  v: number
  c: string
}

/** Donut with a centre total and a hover readout (source mix, significance, statuses). */
export function Donut({
  data,
  size: base = 140,
  center,
  sub,
}: {
  data: Slice[]
  size?: number
  center?: string | number
  sub?: string
}) {
  const big = use(ChartExpanded)
  const size = big ? base * 2 : base
  const ring = big ? 30 : 18
  useCardData({ columns: ['Label', 'Value'], rows: data.map((d) => [d.l, d.v]), legend: data.map((d) => ({ l: d.l, c: d.c })) })
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.v, 0)
  const r = size / 2 - (big ? 20 : 12)
  const C = 2 * Math.PI * r
  const mid = size / 2
  const lens = data.map((d) => (total ? (d.v / total) * C : 0))
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0))
  const hovered = hover != null ? data[hover] : undefined
  return (
    <div className="flex flex-col items-center gap-[6px]">
      <svg
        width={size}
        height={size}
        className="block"
        role="img"
        aria-label={data.map((d) => `${d.l}: ${d.v}`).join(', ') || 'No data'}
      >
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="#f2f4f7" strokeWidth={ring} />
        {data.map((d, i) => (
          <circle
            key={d.l}
            cx={mid}
            cy={mid}
            r={r}
            fill="none"
            stroke={d.c}
            strokeWidth={hover === i ? ring + 4 : ring}
            strokeDasharray={`${Math.max(0, lens[i]! - 2)} ${C}`}
            strokeDashoffset={-offsets[i]!}
            transform={`rotate(-90 ${mid} ${mid})`}
            className="cursor-pointer transition-[stroke-width] duration-150"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <text x="50%" y="47%" textAnchor="middle" className={cn('fill-foreground font-[650]', big ? 'text-[34px]' : 'text-[22px]')}>
          {hovered ? hovered.v : (center ?? total)}
        </text>
        <text x="50%" y="61%" textAnchor="middle" className={cn('fill-muted-foreground', big ? 'text-[13px]' : 'text-[10.5px]')}>
          {hovered ? hovered.l : (sub ?? 'total')}
        </text>
      </svg>
      <Legend items={data.map((d) => ({ l: d.l, c: d.c, v: d.v }))} className="justify-center" />
    </div>
  )
}
