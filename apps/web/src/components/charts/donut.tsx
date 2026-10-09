import { useState } from 'react'
import { Legend } from './legend'

export interface Slice {
  l: string
  v: number
  c: string
}

/** Donut with a centre total and a hover readout (source mix, significance, statuses). */
export function Donut({
  data,
  size = 140,
  center,
  sub,
}: {
  data: Slice[]
  size?: number
  center?: string | number
  sub?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.v, 0)
  const r = size / 2 - 12
  const C = 2 * Math.PI * r
  const mid = size / 2
  const lens = data.map((d) => (total ? (d.v / total) * C : 0))
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0))
  const hovered = hover != null ? data[hover] : undefined
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={size}
        height={size}
        className="block"
        role="img"
        aria-label={data.map((d) => `${d.l}: ${d.v}`).join(', ') || 'No data'}
      >
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="#f2f4f7" strokeWidth={18} />
        {data.map((d, i) => (
          <circle
            key={d.l}
            cx={mid}
            cy={mid}
            r={r}
            fill="none"
            stroke={d.c}
            strokeWidth={hover === i ? 22 : 18}
            strokeDasharray={`${Math.max(0, lens[i]! - 2)} ${C}`}
            strokeDashoffset={-offsets[i]!}
            transform={`rotate(-90 ${mid} ${mid})`}
            className="cursor-pointer transition-[stroke-width] duration-150"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <text x="50%" y="47%" textAnchor="middle" className="fill-foreground text-[22px] font-[650]">
          {hovered ? hovered.v : (center ?? total)}
        </text>
        <text x="50%" y="61%" textAnchor="middle" className="fill-muted-foreground text-[10.5px]">
          {hovered ? hovered.l : (sub ?? 'total')}
        </text>
      </svg>
      <Legend items={data.map((d) => ({ l: d.l, c: d.c, v: d.v }))} className="justify-center" />
    </div>
  )
}
