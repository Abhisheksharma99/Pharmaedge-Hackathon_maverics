import { useRef, useState } from 'react'
import { useElementWidth } from '@/lib/use-element-width'
import { Legend } from './legend'

export interface Series {
  k: string
  l: string
  c: string
  vals: number[]
}

/** 2024 → ’24; anything else unchanged. */
const colLabel = (c: string | number) => (/^\d{4}$/.test(String(c)) ? `’${String(c).slice(2)}` : String(c))

/** Stacked columns with a hover breakdown (activity by year, records by collection). */
export function StackBars({
  cols,
  series,
  h = 160,
  every = 1,
}: {
  cols: (string | number)[]
  series: Series[]
  h?: number
  every?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const W = Math.max(useElementWidth(ref), 260)
  const [hover, setHover] = useState<number | null>(null)
  const totals = cols.map((_, i) => series.reduce((s, x) => s + (x.vals[i] ?? 0), 0))
  const top = Math.max(0, ...totals)
  // Whole, evenly spaced ticks: the axis tops out at the next multiple of 4.
  const max = top === 0 ? 4 : Math.ceil(top / 4) * 4
  const cw = (W - 30) / Math.max(1, cols.length)
  const bw = Math.max(3, Math.min(26, cw - 3))
  return (
    <div ref={ref} className="relative">
      <svg
        width={W}
        height={h + 26}
        className="block overflow-visible"
        role="img"
        aria-label={cols.map((c, i) => `${c}: ${totals[i]}`).join(', ')}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={26} x2={W} y1={h - h * f + 4} y2={h - h * f + 4} stroke="#eef0f3" />
            {top > 0 && (
              <text x={22} y={h - h * f + 8} textAnchor="end" className="fill-muted-foreground font-mono text-[10.5px]">
                {max * f}
              </text>
            )}
          </g>
        ))}
        {cols.map((c, i) => {
          let acc = 0
          const x = 28 + i * cw + (cw - bw) / 2
          return (
            <g key={String(c)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={28 + i * cw} y={0} width={cw} height={h + 4} fill={hover === i ? '#f2f4f7' : 'transparent'} />
              {series.map((s) => {
                const v = s.vals[i] ?? 0
                if (!v) return null
                const bh = (v / max) * h
                acc += bh
                return (
                  <rect
                    key={s.k}
                    x={x}
                    y={h - acc + 4}
                    width={bw}
                    height={Math.max(0, bh - 1)}
                    rx={2}
                    fill={s.c}
                    className="origin-bottom animate-grow [transform-box:fill-box]"
                    style={{ animationDelay: `${i * 18}ms` }}
                  />
                )
              })}
              {i % every === 0 && (
                <text x={x + bw / 2} y={h + 20} textAnchor="middle" className="fill-muted-foreground font-mono text-[10.5px]">
                  {colLabel(c)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover != null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-[calc(100%+8px)] flex-col rounded-[8px] bg-foreground px-[9px] py-[7px] text-[12px] leading-[1.35] gap-[2px] shadow-[0_6px_16px_rgba(16,24,40,.18)] w-max max-w-[260px] text-background"
          style={{ left: 28 + hover * cw + cw / 2, top: h - (totals[hover]! / max) * h }}
        >
          <b className="font-medium">
            {cols[hover]} · {totals[hover]}
          </b>
          <span className="text-[11.5px] text-[#c3c9d4]">
            {series
              .filter((s) => s.vals[hover])
              .map((s) => `${s.l} ${s.vals[hover]}`)
              .join(' · ')}
          </span>
        </div>
      )}
      <Legend items={series.map((s) => ({ l: s.l, c: s.c, v: s.vals.reduce((a, b) => a + b, 0) }))} />
    </div>
  )
}
