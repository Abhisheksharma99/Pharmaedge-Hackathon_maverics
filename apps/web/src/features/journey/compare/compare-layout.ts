import { yearFraction } from '@/lib/dates'
import { eventIndications } from '../indications'
import { chronological } from '../journey-model'
import type { JourneyEventV3 } from '../types'

/** Compare-journeys geometry, in px. */
export const CMP = {
  /** Axis padding before the first year and after the last. */
  PAD: 16,
  /** Narrowest year column (narrower than this the axis scrolls sideways). */
  MIN_YEAR: 24,
  /** Narrowest year column that still labels every year (else every 2nd or 5th). */
  LABEL_EVERY: 40,
  /** Height of one dot row within a lane. */
  ROW: 18,
  /** Dots closer than this go to the next row of their lane. */
  GAP: 11,
  /** Rows per lane; past that, dots share the last row. */
  MAX_ROWS: 3,
}

/** Lane colours of the compared assets, in URL order (a, b, c). */
export const COMPARE_COLORS = ['#2347d9', '#e0620f', '#0b7a6f']

/** Events without an indication sit on this lane. */
export const OTHER_LANE = 'Other'

export interface CompareInput {
  id: string
  name: string
  color: string
  events: JourneyEventV3[]
}

export interface CompareDot {
  e: JourneyEventV3
  x: number
  row: number
}

export interface CompareLane {
  /** The lane's indication (short label), or `OTHER_LANE`. */
  id: string
  /** Another compared asset has this indication too. */
  shared: boolean
  rows: number
  dots: CompareDot[]
}

export interface CompareGroup {
  asset: CompareInput
  lanes: CompareLane[]
  /** Events shown (after the indication filter). */
  n: number
}

export interface CompareLayout {
  /** First year on the axis, and the year after the last. */
  y0: number
  y1: number
  pxPerYear: number
  width: number
  /** Every year's gridline; `label` when the year is printed (every year, or every 2nd / 5th when columns are narrow). */
  years: { y: number; x: number; label: boolean }[]
  todayX: number
  groups: CompareGroup[]
}

const laneOf = (e: JourneyEventV3) => eventIndications(e)[0] ?? OTHER_LANE

/** Indications found in two or more of the journeys: shown first in the filter and highlighted on the lanes. */
export function sharedIndications(assets: Pick<CompareInput, 'events'>[]): Set<string> {
  const seen = new Map<string, number>()
  for (const a of assets) for (const i of new Set(a.events.flatMap(eventIndications))) seen.set(i, (seen.get(i) ?? 0) + 1)
  return new Set([...seen].filter(([, n]) => n > 1).map(([i]) => i))
}

/**
 * Every journey on one time axis: the same year sits at the same x in every group. Each asset's events fall into
 * lanes by indication (oldest lane first); dots that would overlap stack into up to `MAX_ROWS` rows. `fit` is the
 * width available: the axis stretches to it, and scrolls when the years need more room than that.
 */
export function compareLayout(assets: CompareInput[], { fit, ind = null, today }: { fit: number; ind?: string | null; today: string }): CompareLayout {
  const shared = sharedIndications(assets)
  const lists = assets.map((a) => {
    const dated = chronological(a.events)
    return ind ? dated.filter((e) => eventIndications(e).includes(ind)) : dated
  })
  const fracs = lists.flatMap((l) => l.map((e) => yearFraction(e.date)))
  const nowFrac = yearFraction(today)
  const y0 = Math.floor(fracs.length ? Math.min(...fracs) : nowFrac)
  const y1 = Math.floor(Math.max(nowFrac, ...fracs)) + 1
  const pxPerYear = Math.max(CMP.MIN_YEAR, (fit - 2 * CMP.PAD) / (y1 - y0))
  const xOf = (f: number) => CMP.PAD + (f - y0) * pxPerYear
  const every = pxPerYear >= CMP.LABEL_EVERY ? 1 : pxPerYear >= CMP.LABEL_EVERY / 2 ? 2 : 5
  const years = Array.from({ length: y1 - y0 }, (_, k) => ({ y: y0 + k, x: xOf(y0 + k), label: (y0 + k) % every === 0 }))

  const groups = assets.map((asset, ai) => {
    const byLane = new Map<string, CompareDot[]>()
    for (const e of lists[ai]!) {
      const id = laneOf(e)
      if (!byLane.has(id)) byLane.set(id, [])
      byLane.get(id)!.push({ e, x: xOf(yearFraction(e.date)), row: 0 })
    }
    const lanes = [...byLane].map(([id, dots]): CompareLane => {
      const last: number[] = []
      for (const d of dots) {
        let r = last.findIndex((x) => d.x - x >= CMP.GAP)
        if (r < 0) r = last.length < CMP.MAX_ROWS ? last.length : CMP.MAX_ROWS - 1
        last[r] = d.x
        d.row = r
      }
      return { id, shared: shared.has(id), rows: Math.max(1, last.length), dots }
    })
    return { asset, lanes, n: lists[ai]!.length }
  })

  return { y0, y1, pxPerYear, width: xOf(y1) + CMP.PAD, years, todayX: xOf(nowFrac), groups }
}
