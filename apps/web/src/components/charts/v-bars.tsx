import { useRef, useState } from 'react'
import { useElementWidth } from '@/lib/use-element-width'

export interface BarDatum {
  l: string
  v: number
  c?: string
}

/** Vertical bars with value labels (Trials by phase). */
export function VBars({ data, h = 150, unit = '' }: { data: BarDatum[]; h?: number; unit?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const W = Math.max(useElementWidth(ref), 200)
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.v))
  const slot = (W - 10) / Math.max(1, data.length)
  const bw = Math.max(4, Math.min(46, slot - 8))
  return (
    <div ref={ref} className="relative">
      <svg
        width={W}
        height={h + 34}
        className="block overflow-visible"
        role="img"
        aria-label={data.map((d) => `${d.l}: ${d.v}${unit}`).join(', ')}
      >
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={h - h * f + 8} y2={h - h * f + 8} stroke="#eef0f3" />
        ))}
        {data.map((d, i) => {
          const x = 5 + i * slot + (slot - bw) / 2
          const bh = Math.max(2, (d.v / max) * h)
          return (
            <g key={d.l} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect
                x={x}
                y={h - bh + 8}
                width={bw}
                height={bh}
                rx={4}
                fill={d.c ?? '#2347d9'}
                opacity={hover == null || hover === i ? 1 : 0.45}
                className="origin-bottom animate-grow [transform-box:fill-box]"
                style={{ animationDelay: `${i * 40}ms` }}
              />
              <text x={x + bw / 2} y={h - bh + 2} textAnchor="middle" className="fill-secondary-foreground font-mono text-[11px] font-semibold">
                {d.v}
                {unit}
              </text>
              <text x={x + bw / 2} y={h + 24} textAnchor="middle" className="fill-muted-foreground font-mono text-[10.5px]">
                {d.l}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
