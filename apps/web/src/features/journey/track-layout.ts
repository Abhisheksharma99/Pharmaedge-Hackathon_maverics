import { yearFraction } from '@/lib/dates'
import { hoverDate, neighbours } from './hover-add'
import type { Branch, JourneyEventV3 } from './types'

/**
 * Horizontal track geometry (README §6.3, ported from aj/horizontal.jsx): one 178px column per event, 304px cards,
 * 236px left pad, 34px branch rows, 196px card areas above and below the rows, 30px year ruler.
 */
export const HZ = { COL: 178, CW: 304, PADL: 236, ROW: 34, CA: 196, RUL: 30 } as const

export interface TrackLane {
  id: string
  label: string
  color: string
  trunk: boolean
  ended: boolean
  /** Lane start; the trunk starts at PADL − 110, a branch 74px before its first event. */
  x1: number
  /** End of the solid/dashed lane: near the track end, or the ⊗ cap of an ended branch. */
  x2: number
  capX: number | null
  /** An ended branch's events after its closure (late publications) hang on a dotted tail up to here. */
  tailX: number | null
  y: number
  /** Parent row of the fork curve; null on the trunk. */
  py: number | null
  first: JourneyEventV3 | null
}

export interface TrackLayout {
  /** Branch rows, sorted by `off` (negative above the trunk); branches with no event in `list` have no row. */
  rows: Branch[]
  H: number
  top0: number
  bandTop: number
  bandBot: number
  xs: number[]
  TW: number
  maxP: number
  todayX: number
  lanes: TrackLane[]
  years: { y: string; x: number }[]
  /** Parallax numerals (0.55×), at least 520px apart. */
  bgYears: { y: string; bx: number }[]
  /** y of a branch's row; null for a branch without one (no events in the list). */
  rowY: (id: string) => number | null
}

export interface TrackInput {
  /** Chronological, filtered events. */
  list: JourneyEventV3[]
  branches: Branch[]
  laneOf: (e: JourneyEventV3) => string
  /** Pinned viewport width and height. */
  vw: number
  vh: number
  /** Closure of each ended branch (journey-model `branchClosures`). */
  closures: Record<string, { id: string; date: string }>
  today: string
}

/** x of a date between the event columns (interpolated in year fraction); before the first −60px, after the last +70px. */
export function xForDate(date: string, list: Pick<JourneyEventV3, 'date'>[], xs: number[]): number {
  const n = list.length
  if (!n) return HZ.PADL
  const fs = list.map((e) => yearFraction(e.date))
  const f = yearFraction(date)
  const [a, b] = neighbours(fs, f)
  if (a < 0) return xs[0]! - 60
  if (b >= n) return xs[n - 1]! + 70
  const t = fs[b]! > fs[a]! ? (f - fs[a]!) / (fs[b]! - fs[a]!) : 0.5
  return xs[a]! + t * (xs[b]! - xs[a]!)
}

export function trackLayout({ list, branches, laneOf, vw, vh, closures, today }: TrackInput): TrackLayout {
  // A branch with no event in the current list (filtered out, or none yet) has no lane to draw: no row (its card stays in the header).
  const used = new Set(list.map(laneOf))
  const rows = branches.filter((b) => b.trunk || used.has(b.id)).sort((a, b) => a.off - b.off)
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]))
  const trunkId = (rows.find((r) => r.trunk) ?? rows[0])?.id
  const nR = rows.length
  const H = HZ.RUL + HZ.CA + 14 + nR * HZ.ROW + 14 + HZ.CA
  const top0 = Math.max(0, (vh - H) / 2)
  const bandTop = top0 + HZ.RUL + HZ.CA + 14
  const bandBot = bandTop + nR * HZ.ROW
  const rowY = (id: string): number | null => {
    const r = rowIndex.get(id)
    return r === undefined ? null : bandTop + r * HZ.ROW + HZ.ROW / 2
  }

  const n = list.length
  const xs = list.map((_, i) => HZ.PADL + i * HZ.COL)
  const TW = (n ? xs[n - 1]! : HZ.PADL) + HZ.CW / 2 + 140
  const maxP = Math.max(0, TW - vw)
  const fs = list.map((e) => yearFraction(e.date))
  const [ta, tb] = neighbours(fs, yearFraction(today))
  const todayX = !n ? HZ.PADL : ta < 0 ? xs[0]! - 60 : tb >= n ? xs[n - 1]! + 70 : (xs[ta]! + xs[tb]!) / 2

  const lanesOf = rows.map((l) => list.flatMap((e, i) => (laneOf(e) === l.id ? [i] : [])))
  const lanes = rows.flatMap((l, r): TrackLane[] => {
    const idx = lanesOf[r]!
    if (!idx.length && !l.trunk) return []
    const x1 = l.trunk ? HZ.PADL - 110 : xs[idx[0]!]! - 74
    const parent = l.trunk ? null : l.from && rowIndex.has(l.from) ? l.from : trunkId
    const ended = !!l.ended && idx.length > 0
    let x2 = TW - 70
    let capX: number | null = null
    let tailX: number | null = null
    if (ended) {
      const lastX = xs[idx[idx.length - 1]!]!
      const closure = closures[l.id]
      const at = closure ? list.findIndex((e) => e.id === closure.id) : -1
      capX = Math.max(x1 + 20, at >= 0 ? xs[at]! + 26 : closure ? xForDate(closure.date, list, xs) : lastX + 26)
      tailX = lastX > capX ? lastX : null
      x2 = capX
    }
    return [
      {
        id: l.id, label: l.label, color: l.color, trunk: !!l.trunk, ended, x1, x2, capX, tailX,
        y: rowY(l.id)!, py: parent ? rowY(parent) : null, first: idx.length ? list[idx[0]!]! : null,
      },
    ]
  })

  const years: { y: string; x: number }[] = []
  list.forEach((e, i) => {
    const y = e.date.slice(0, 4)
    if (years[years.length - 1]?.y !== y) years.push({ y, x: xs[i]! })
  })
  const bgYears: { y: string; bx: number }[] = []
  for (const y of years) {
    const bx = y.x * 0.55
    if (!bgYears.length || bx - bgYears[bgYears.length - 1]!.bx >= 520) bgYears.push({ y: y.y, bx })
  }
  return { rows, H, top0, bandTop, bandBot, xs, TW, maxP, todayX, lanes, years, bgYears, rowY }
}

/** Which cards to render at scroll offset `p` (windowing for 1,000+ event journeys): [first, last], inclusive. */
export function trackWindow(p: number, vw: number, n: number, overscan = 3): [number, number] {
  if (!n) return [0, -1]
  const first = Math.ceil((p - HZ.CW / 2 - HZ.PADL) / HZ.COL) - overscan
  const last = Math.floor((p + vw + HZ.CW / 2 - HZ.PADL) / HZ.COL) + overscan
  return [Math.min(n - 1, Math.max(0, first)), Math.min(n - 1, Math.max(0, last))]
}

/** The event nearest the middle of the viewport (HUD, active card). */
export const trackActive = (p: number, vw: number, n: number) => (n ? Math.min(n - 1, Math.max(0, Math.round((p + vw / 2 - HZ.PADL) / HZ.COL))) : 0)

/** The last card revealed: cards reveal once `x − p < vw − 40` (strictly), and stay revealed. */
export const trackSeen = (p: number, vw: number, n: number) => Math.min(n - 1, Math.ceil((p + vw - 40 - HZ.PADL) / HZ.COL) - 1)

/** Scroll offset that centres event `i`. */
export const trackOffsetFor = (layout: Pick<TrackLayout, 'xs' | 'maxP'>, i: number, vw: number) =>
  Math.min(layout.maxP, Math.max(0, (layout.xs[i] ?? 0) - vw / 2))

export interface TrackHover {
  x: number
  ly: number
  lane: string
  date: string
  prev: JourneyEventV3 | null
  next: JourneyEventV3 | null
}

/**
 * Hover band → row and date. `x`/`y` are relative to the track's SVG, which lives inside the translated track: they
 * are already track coordinates (never add the scroll offset, README §6.3).
 */
export function trackHoverAt(layout: TrackLayout, list: JourneyEventV3[], x: number, y: number, today?: string): TrackHover | null {
  const { rows, bandTop, bandBot, xs, rowY } = layout
  if (!rows.length || y < bandTop - 6 || y > bandBot + 6) return null
  const row = rows[Math.min(rows.length - 1, Math.max(0, Math.floor((y - bandTop) / HZ.ROW)))]!
  // Only a lane that exists at this x: from its start (the trunk's, or 74px before a branch's first event), and, on an
  // ended branch, up to the cap — or the dotted tail when later events follow it.
  const lane = layout.lanes.find((l) => l.id === row.id)
  if (!lane || x < lane.x1 || x > (lane.tailX ?? lane.x2) + 8) return null
  const [a, b] = neighbours(xs, x)
  const prev = a >= 0 ? list[a]! : null
  const next = b < list.length ? list[b]! : null
  const date = hoverDate(prev && { pos: xs[a]!, date: prev.date }, next && { pos: xs[b]!, date: next.date }, x, today)
  return { x, ly: rowY(row.id)!, lane: row.id, date, prev, next }
}
