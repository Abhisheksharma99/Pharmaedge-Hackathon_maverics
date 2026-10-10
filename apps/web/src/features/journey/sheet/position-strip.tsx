import { useMemo, useRef } from 'react'
import { todayIso, yearFraction } from '@/lib/dates'
import { useElementWidth } from '@/lib/use-element-width'
import { CATEGORY_META } from '../constants'
import { byDate } from '../journey-model'
import type { JourneyEventV3 } from '../types'

const PAD = 10
const H = 46
const MID = 20

/**
 * "Position in the journey" (README §6.4): every event of the pool on one line, the current one r7 with a halo;
 * a dot opens that event. The SVG is decorative for assistive tech: the footer's previous / next buttons do the same.
 */
export function PositionStrip({ event, pool, onPick, today = todayIso() }: { event: JourneyEventV3; pool: JourneyEventV3[]; onPick: (id: string) => void; today?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const W = Math.max(useElementWidth(ref), 260)
  // Undated events can't be placed: they are left out of the strip and of "#k of n", and an undated event shows no strip.
  const all = useMemo(() => (pool.some((e) => e.id === event.id) ? pool : [...pool, event]).filter((e) => Number.isFinite(yearFraction(e.date))).sort(byDate), [pool, event])
  if (all.length < 2 || !Number.isFinite(yearFraction(event.date))) return null
  const fs = all.map((e) => yearFraction(e.date))
  const y0 = Math.min(...fs) - 0.3
  const y1 = Math.max(...fs) + 0.3
  const x = (d: string) => PAD + ((yearFraction(d) - y0) / (y1 - y0)) * (W - PAD * 2)
  const index = all.findIndex((e) => e.id === event.id)
  const colour = (e: JourneyEventV3) => CATEGORY_META[e.category]?.color ?? 'var(--faint)'
  const tf = yearFraction(today)
  return (
    <div ref={ref} className="relative">
      <span className="absolute -top-[20px] right-0 font-mono text-[11px] text-muted-foreground">
        #{index + 1} of {all.length}
      </span>
      <svg width={W} height={H} aria-hidden="true" className="block">
        <line x1={PAD} x2={W - PAD} y1={MID} y2={MID} stroke="#e4e7ec" strokeWidth={2} />
        {tf >= fs[0]! && tf <= y1 && <line x1={x(today)} x2={x(today)} y1={8} y2={32} stroke="#101828" strokeDasharray="2 2" />}
        {all.map((e) => {
          const cur = e.id === event.id
          return (
            <circle
              key={e.id}
              data-event={e.id}
              {...(cur ? { 'data-current': '' } : {})}
              cx={x(e.date)}
              cy={MID}
              r={cur ? 7 : e.significance === 'High' ? 4.5 : 3.2}
              fill={cur || !e.is_milestone ? colour(e) : '#fff'}
              stroke={cur ? '#fff' : colour(e)}
              strokeWidth={cur ? 2.5 : 1.2}
              opacity={cur ? 1 : 0.55}
              className="cursor-pointer"
              onClick={() => onPick(e.id)}
            >
              <title>{e.title}</title>
            </circle>
          )
        })}
        <circle cx={x(event.date)} cy={MID} r={11} fill="none" stroke={colour(event)} strokeOpacity={0.35} strokeWidth={2} />
        <text x={PAD} y={44} className="fill-muted-foreground font-mono text-[10.5px]">
          {all[0]!.date.slice(0, 4)}
        </text>
        <text x={W - PAD} y={44} textAnchor="end" className="fill-muted-foreground font-mono text-[10.5px]">
          {all[all.length - 1]!.date.slice(0, 4)}
        </text>
      </svg>
      {/* One tab stop for assistive tech and keyboards (not one per event): a hidden select jumps to the chosen event. */}
      <select
        className="sr-only focus-visible:not-sr-only focus-visible:mt-[8px] focus-visible:w-full focus-visible:rounded-lg focus-visible:border focus-visible:bg-card focus-visible:px-[8px] focus-visible:py-[4px] focus-visible:text-[12.5px]"
        aria-label="Jump to event"
        value={event.id}
        onChange={(ev) => ev.target.value !== event.id && onPick(ev.target.value)}
      >
        {all.map((e, i) => (
          <option key={e.id} value={e.id}>
            {`#${i + 1} · ${e.title} · ${e.date}`}
          </option>
        ))}
      </select>
    </div>
  )
}
