import type { ReactNode } from 'react'
import { todayIso, yearFraction } from '@/lib/dates'
import { cn } from '@/lib/utils'

export interface GanttRow {
  l: string
  sub?: string
  /** Start, as a year fraction. */
  s: number
  /** End, as a year fraction. */
  e: number
  c: string
  tag?: string
  dash?: boolean
  tip?: string
}

/** Start→end bars on a year axis (trial timeline, patent runway) with a Today line. */
export function Gantt({ rows, from, to, today = todayIso() }: { rows: GanttRow[]; from: number; to: number; today?: string }) {
  const span = Math.max(1e-6, to - from)
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - from) / span) * 100))
  const step = span > 36 ? 8 : span > 14 ? 4 : 2
  const ticks: number[] = []
  for (let y = Math.ceil(from / step) * step; y <= to; y += step) ticks.push(y)
  const now = yearFraction(today)
  const showNow = now >= from && now <= to
  return (
    <div className="relative text-[12px] [--gl:150px] @max-[520px]:[--gl:110px]">
      <div className="mb-[4px] grid h-[20px] grid-cols-[var(--gl)_minmax(0,1fr)] items-center">
        <span />
        <div className="relative h-full">
          {ticks.map((y) => (
            <span key={y} className="absolute -translate-x-1/2 font-mono text-[10.5px] text-muted-foreground" style={{ left: `${pct(y)}%` }}>
              {y}
            </span>
          ))}
        </div>
      </div>
      {rows.map((r, i) => {
        const known = Number.isFinite(r.s) && Number.isFinite(r.e)
        const left = pct(Math.min(r.s, r.e))
        const width = Math.max(0.8, pct(Math.max(r.s, r.e)) - left)
        return (
          <div key={`${r.l}-${i}`} className="grid h-[34px] grid-cols-[var(--gl)_minmax(0,1fr)] items-center">
            <span className="flex min-w-0 flex-col pr-[8px] leading-[1.15]">
              <b className="truncate text-[12px] font-medium">{r.l}</b>
              {r.sub && <span className="truncate text-[10.5px] text-muted-foreground">{r.sub}</span>}
            </span>
            <div className="relative h-[34px]">
              {ticks.map((y) => (
                <i key={y} className="absolute inset-y-0 border-l border-[#f2f4f7]" style={{ left: `${pct(y)}%` }} />
              ))}
              {!known && <span className="absolute top-[10px] text-[10.5px] text-muted-foreground">Dates unknown</span>}
              {known && (
                <span
                  title={r.tip}
                  className={cn(
                    'absolute top-[10px] flex h-[14px] min-w-[6px] origin-left animate-grow-x items-center justify-end rounded-[4px] border-[1.5px]',
                    r.dash && 'border-dashed',
                  )}
                  style={{
                    left: `${left}%`,
                    width: `${Math.min(width, 100 - left)}%`,
                    background: r.dash ? 'transparent' : r.c,
                    borderColor: r.c,
                    animationDelay: `${i * 35}ms`,
                  }}
                >
                  {r.tag && (
                    <em className={cn('px-[4px] text-[9.5px] font-bold whitespace-nowrap not-italic', r.dash ? 'text-destructive' : 'text-white')}>
                      {r.tag}
                    </em>
                  )}
                </span>
              )}
            </div>
          </div>
        )
      })}
      {showNow && (
        <div
          className="pointer-events-none absolute top-[18px] bottom-0 border-l-[1.5px] border-dashed border-foreground"
          style={{ left: `calc(var(--gl) + (100% - var(--gl)) * ${pct(now) / 100})` }}
        >
          <em className="absolute -top-[16px] -left-[14px] text-[10px] font-semibold not-italic">Today</em>
        </div>
      )}
    </div>
  )
}

/** A real asset has hundreds of trials or patents: keep the card the prototype's size and scroll the rows. */
export function GanttScroll({ children }: { children: ReactNode }) {
  return <div className="max-h-[560px] overflow-y-auto pt-[16px]">{children}</div>
}
