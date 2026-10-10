import { useId, useMemo, useRef, useState } from 'react'
import { formatDay, todayIso, yearFraction } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { useElementWidth } from '@/lib/use-element-width'
import { CATEGORIES, CATEGORY_META, collectionMeta } from '../constants'
import type { JobProgress, JourneyEventV3 } from '../types'
import { formingYears, recordTicks, tipVia } from './build-model'

const L = 92
const R = 14
const LANE_H = 30
const TOP = 6
const REC_TOP = TOP + CATEGORIES.length * LANE_H + 12
const REC_H = 30
const AXIS_Y = REC_TOP + REC_H + 16
const H = AXIS_Y + 10

const radius = (e: JourneyEventV3) => (e.significance === 'High' ? 6 : e.significance === 'Medium' ? 4.6 : 3.4)
const laneY = (e: Pick<JourneyEventV3, 'category'>) => TOP + CATEGORIES.indexOf(e.category) * LANE_H + LANE_H / 2

/**
 * "Journey taking shape" (README §6.1; design_files/aj/live.jsx FormingTimeline): four category lanes over a records
 * strip. Records land as ticks at their real years (the job's record-year histogram); events pop on their lane with a
 * ring and a beam. Ticks and dots are keyed by bucket / event id, so only new ones animate.
 */
export function FormingTimeline({
  recordYears,
  recordCount,
  events,
}: {
  recordYears: JobProgress['record_years']
  recordCount: number
  events: JourneyEventV3[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const hatch = `${useId().replace(/[^\w-]/g, '')}-hatch`
  const [hover, setHover] = useState<string | null>(null)
  const ticks = useMemo(() => recordTicks(recordYears), [recordYears])
  const placed = events.filter((e) => CATEGORIES.includes(e.category) && Number.isFinite(yearFraction(e.date)))
  const today = yearFraction(todayIso())
  const { y0, y1 } = formingYears([...recordYears.map((r) => r.year), ...placed.map((e) => yearFraction(e.date))], Math.floor(today))

  const W = Math.max(width, 420)
  const x = (y: number) => L + ((Math.min(y1, Math.max(y0, y)) - y0) / (y1 - y0)) * (W - L - R)
  const tx = x(today)
  const every = W < 720 ? 4 : 2
  const years: number[] = []
  for (let y = y0; y <= y1; y += every) years.push(y)
  const shown = hover ? placed.find((e) => e.id === hover) : undefined

  return (
    <div className="px-[16px] pt-[14px] pb-[4px]">
      <div ref={ref} className="relative">
        <svg aria-hidden="true" width={W} height={H} className="block overflow-visible">
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#eef0f3" strokeWidth="2" />
            </pattern>
          </defs>
          {CATEGORIES.map((c, i) => (
            <g key={c}>
              <rect x={L} y={TOP + i * LANE_H} width={W - L - R} height={LANE_H} fill={i % 2 ? '#fff' : '#fafbfc'} />
              <circle cx={8} cy={laneY({ category: c })} r={3.5} fill={CATEGORY_META[c].color} />
              <text x={18} y={laneY({ category: c }) + 4} className="fill-text-secondary text-[11.5px] font-medium">
                {CATEGORY_META[c].label}
              </text>
            </g>
          ))}
          <rect data-future x={tx} y={TOP} width={Math.max(0, W - R - tx)} height={REC_TOP + REC_H - TOP} fill={`url(#${hatch})`} />
          {years.map((y) => (
            <line key={y} x1={x(y)} x2={x(y)} y1={TOP} y2={REC_TOP + REC_H} stroke="#eef0f3" />
          ))}
          <rect x={L} y={REC_TOP} width={W - L - R} height={REC_H} rx={6} fill="#f9fafb" stroke="#eef0f3" />
          <text x={18} y={REC_TOP + 13} className="fill-text-secondary text-[11.5px] font-medium">
            Records
          </text>
          <text x={18} y={REC_TOP + 26} className="fill-muted-foreground font-mono text-[11px]">
            {formatNumber(recordCount)}
          </text>
          {ticks.map((t) => (
            <rect
              key={t.key}
              data-tick
              className="animate-tick-in"
              x={x(t.at)}
              y={REC_TOP + 4 + t.jitter * (REC_H - 16)}
              width={1.6}
              height={8}
              fill={collectionMeta(t.coll).color}
              opacity={0.55}
            />
          ))}
          {placed.map((e) => {
            const ex = x(yearFraction(e.date))
            const ey = laneY(e)
            const c = CATEGORY_META[e.category].color
            const r = radius(e)
            return (
              <g key={e.id} data-event={e.id} className="cursor-pointer" onMouseEnter={() => setHover(e.id)} onMouseLeave={() => setHover(null)}>
                <line className="animate-beam opacity-0" x1={ex} x2={ex} y1={REC_TOP + 2} y2={ey} stroke={c} strokeWidth={1.5} />
                <circle className="origin-center animate-ring [transform-box:fill-box]" cx={ex} cy={ey} r={r} fill="none" stroke={c} strokeWidth={1.5} />
                <circle
                  className="origin-center animate-dot-in [transform-box:fill-box]"
                  cx={ex}
                  cy={ey}
                  r={r}
                  fill={e.is_milestone ? '#fff' : c}
                  stroke={e.is_milestone ? c : '#fff'}
                  strokeWidth={e.is_milestone ? 1.6 : 1.2}
                  strokeDasharray={e.is_milestone ? '2 1.6' : undefined}
                />
                <circle cx={ex} cy={ey} r={10} fill="transparent" />
              </g>
            )
          })}
          <line x1={tx} x2={tx} y1={TOP - 2} y2={REC_TOP + REC_H + 4} stroke="#101828" strokeWidth={1} strokeDasharray="3 3" />
          <text x={tx} y={AXIS_Y} textAnchor="middle" className="fill-foreground text-[10.5px] font-semibold">
            Today
          </text>
          {years
            .filter((y) => Math.abs(x(y) - tx) > 30)
            .map((y) => (
              <text key={y} x={x(y)} y={AXIS_Y} textAnchor="middle" className="fill-muted-foreground font-mono text-[10.5px]">
                {y}
              </text>
            ))}
        </svg>
        {shown && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-20 flex w-max max-w-[260px] animate-fade flex-col gap-[2px] rounded-lg bg-foreground px-[9px] py-[7px] text-[12px] leading-[1.35] text-white shadow-[0_6px_16px_rgba(16,24,40,0.18)]"
            style={{ left: x(yearFraction(shown.date)), top: laneY(shown) - 6, transform: 'translate(-50%, calc(-100% - 8px))' }}
          >
            <b className="font-medium">{shown.title}</b>
            <span className="text-[11.5px] text-[#c3c9d4]">
              {formatDay(shown.date)} · {tipVia(shown)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
