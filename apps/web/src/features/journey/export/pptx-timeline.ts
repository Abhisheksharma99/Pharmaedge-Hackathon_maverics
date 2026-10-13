import { laneOf, spanOf, type BranchModel } from '../journey-model'
import type { JourneyEventV3 } from '../types'
import { isoDate } from './model'

/** Table lines per timeline slide, year rows included (the rail beside the table needs fixed row heights). */
export const ROWS_PER_SLIDE = 10

/** Timeline table row heights, inches: the header, a year row, an event row (a title wraps to at most two lines). */
export const ROW_H = { head: 0.32, year: 0.3, event: 0.48 } as const

/** A timeline table line: a year row, or one event. */
export type TimelineLine = { year: string; cont: boolean } | { event: JourneyEventV3 }

/**
 * The events split into slide tables, in the journey's order: a year row before each year's events, repeated as
 * "(cont.)" on a slide that carries on a year, and never left as a slide's last line.
 */
export function timelinePages(events: JourneyEventV3[], per = ROWS_PER_SLIDE): TimelineLine[][] {
  const pages: TimelineLine[][] = []
  let page: TimelineLine[] = []
  let year = ''
  for (const event of events) {
    const y = isoDate(event.date).slice(0, 4)
    const starts = y !== year
    if (page.length + (starts ? 2 : 1) > per) {
      pages.push(page)
      page = []
    }
    if (starts || page.length === 0) page.push({ year: y, cont: !starts })
    year = y
    page.push({ event })
  }
  if (page.length) pages.push(page)
  return pages
}

/** A branch lane on the rail left of the timeline tables. */
export interface RailLane {
  id: string
  label: string
  color: string
  trunk: boolean
  ended: boolean
  /** Centre, inches from the slide's left edge. */
  x: number
  /** The lane it forks from: its parent branch when that has a lane running at the fork, else the trunk; null on the trunk. */
  from: string | null
  /** Positions in the deck's event list of the lane's first and last event (the trunk spans the whole list). */
  first: number
  last: number
}

/**
 * The lanes the deck's events sit on (trunk included), left to right by branch offset like the app's tree, at most
 * `maxGap` apart and centred in [left, left + width]. Every timeline slide uses the same lanes, so a branch keeps its
 * place from slide to slide.
 */
export function railLanes(events: JourneyEventV3[], model: BranchModel, newestFirst: boolean, left: number, width: number, maxGap = 0.42): RailLane[] {
  const range = new Map<string, [number, number]>()
  events.forEach((e, i) => {
    const id = laneOf(e, model)
    range.set(id, [range.get(id)?.[0] ?? i, i])
  })
  const trunk = model.trunk.id
  const list = model.list.filter((b) => b.id === trunk || range.has(b.id)).sort((a, b) => a.off - b.off)
  const gap = list.length > 1 ? Math.min(maxGap, width / (list.length - 1)) : 0
  const x0 = left + width / 2 - ((list.length - 1) * gap) / 2
  /** Where a lane starts and stops in time (list positions, negated newest first so later is always greater). */
  const start = (id: string) => (newestFirst ? -range.get(id)![1] : range.get(id)![0])
  const stop = (id: string) => (newestFirst ? -range.get(id)![0] : range.get(id)![1])
  return list.map((b, k) => {
    const isTrunk = b.id === trunk
    const parent = b.from && b.from !== trunk && range.has(b.from) && start(b.from) < start(b.id) && stop(b.from) >= start(b.id) ? b.from : trunk
    const [first, last] = isTrunk ? [0, events.length - 1] : range.get(b.id)!
    return { id: b.id, label: b.label, color: b.color, trunk: isTrunk, ended: !!b.ended, x: x0 + k * gap, from: isTrunk ? null : parent, first, last }
  })
}

/** Where the rail's marks go on one slide, inches. */
export interface PageRail {
  /** One per event line, at the line's vertical centre. */
  dots: { e: JourneyEventV3; lane: RailLane; y: number; span: number[] }[]
  /** The lanes running through this slide. */
  segments: { lane: RailLane; y1: number; y2: number }[]
  /** "New branch" elbows: from the parent lane across to the branch, just before its first event in time. */
  forks: { lane: RailLane; x1: number; y: number }[]
  /** ⊗ caps of ended branches, just after their last event in time. */
  caps: { lane: RailLane; y: number }[]
  years: { year: string; cont: boolean; y: number }[]
  /** The Today line between the past and the expected events, when it falls on this slide. */
  today: number | null
}

/** Gap between an event's dot and its lane's fork elbow or end cap. */
const END_DY = 0.2

/**
 * The rail beside one timeline table: a dot per event line on its lane, level with the line's row (the table starts at
 * `top`, header included); lanes from their fork (or the slide's top) to their end (or the slide's bottom); fork
 * elbows, end caps, year labels and the Today line. `index` gives an event's position in the deck's list.
 */
export function pageRail(
  lines: TimelineLine[],
  index: (e: JourneyEventV3) => number,
  lanes: RailLane[],
  model: BranchModel,
  newestFirst: boolean,
  top: number,
  today: string,
): PageRail {
  const byId = new Map(lanes.map((l) => [l.id, l]))
  const rowsTop = top + ROW_H.head
  const ys: number[] = []
  let y = rowsTop
  for (const l of lines) {
    const h = 'year' in l ? ROW_H.year : ROW_H.event
    ys.push(y + h / 2)
    y += h
  }
  const rowsBottom = y
  const yAt = new Map<number, number>()
  const dots: PageRail['dots'] = []
  const years: PageRail['years'] = []
  lines.forEach((l, k) => {
    if ('year' in l) {
      years.push({ year: l.year, cont: l.cont, y: ys[k]! })
      return
    }
    const lane = byId.get(laneOf(l.event, model)) ?? lanes.find((x) => x.trunk)!
    yAt.set(index(l.event), ys[k]!)
    dots.push({ e: l.event, lane, y: ys[k]!, span: spanOf(l.event, model).flatMap((id) => (byId.has(id) ? [byId.get(id)!.x] : [])) })
  })
  const idx = [...yAt.keys()]
  const [a, b] = [Math.min(...idx), Math.max(...idx)]

  const segments: PageRail['segments'] = []
  const forks: PageRail['forks'] = []
  const caps: PageRail['caps'] = []
  for (const lane of lanes) {
    if (lane.first > b || lane.last < a) continue
    // Oldest first a branch forks above its first event and an ended one is capped below its last; newest first time
    // runs up, so the fork is below and the cap above. Either way the lane reaches a little past the event's dot.
    const forkAt = lane.trunk ? null : newestFirst ? lane.last : lane.first
    const capAt = lane.trunk || !lane.ended ? null : newestFirst ? lane.first : lane.last
    const marked = (i: number) => (i === forkAt || i === capAt ? END_DY : 0)
    const y1 = lane.first < a ? rowsTop : yAt.get(lane.first)! - marked(lane.first)
    const y2 = lane.last > b ? rowsBottom : yAt.get(lane.last)! + marked(lane.last)
    segments.push({ lane, y1, y2 })
    if (forkAt !== null && yAt.has(forkAt)) forks.push({ lane, x1: byId.get(lane.from!)!.x, y: newestFirst ? y2 : y1 })
    if (capAt !== null && yAt.has(capAt)) caps.push({ lane, y: newestFirst ? y1 : y2 })
  }
  // A parent lane reaches every elbow forking off it (the trunk's first event may come after a branch's fork).
  for (const f of forks) {
    const parent = segments.find((s) => s.lane.id === f.lane.from)
    if (parent) Object.assign(parent, { y1: Math.min(parent.y1, f.y), y2: Math.max(parent.y2, f.y) })
  }

  // Today sits between the last past and the first event ahead: at the bottom of the earlier row of the pair in the
  // slide's order (oldest first above the first event ahead and its year row; newest first below the last one ahead).
  const ahead = (e: JourneyEventV3) => isoDate(e.date) > today.slice(0, isoDate(e.date).length)
  let todayY: number | null = null
  for (let k = 1; k < dots.length && todayY === null; k++) {
    if (ahead(dots[k - 1]!.e) !== ahead(dots[k]!.e)) todayY = dots[k - 1]!.y + ROW_H.event / 2
  }
  return { dots, segments, forks, caps, years, today: todayY }
}
