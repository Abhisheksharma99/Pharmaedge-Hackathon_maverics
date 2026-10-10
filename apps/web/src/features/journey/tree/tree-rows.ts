import { laneOf, type BranchModel, type Closure } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'

export type Side = 'l' | 'r'

/** The tree's rows in date order (README §6.2 "Rows"). */
export type TreeRow =
  | { kind: 'root'; key: 'root' }
  | { kind: 'year'; key: string; year: string; n: number }
  | { kind: 'today'; key: 'today' }
  | { kind: 'fork'; key: string; branch: Branch; side: Side; n: number }
  | { kind: 'event'; key: string; e: JourneyEventV3; i: number; side: Side; lane: string }
  | { kind: 'end'; key: string; branch: Branch; side: Side; closure: Closure }
  | { kind: 'finish'; key: 'finish'; milestones: boolean }

/** Left of the trunk for negative offsets, right otherwise. */
export const branchSide = (b: Pick<Branch, 'off'>): Side => (b.off < 0 ? 'l' : 'r')

/**
 * Root, then per event: Today (before the first event after today), a year marker, a "New branch" fork row before a
 * branch's first event, the event; a "Branch closed" row once an ended branch's closure date has passed (or after
 * its last event when the closure is unknown); then the end marker. Trunk events alternate sides.
 *
 * `newestFirst` (`list` newest first): the same rows bottom-up — the end marker on top, then each year's marker above
 * its events, forks below a branch's first event, the root at the bottom. Event rows keep their index into `list`.
 */
export function treeRows(list: JourneyEventV3[], model: BranchModel, closures: Record<string, Closure>, today: string, newestFirst = false): TreeRow[] {
  if (!newestFirst) return chronologicalRows(list, model, closures, today)
  const n = list.length
  const rows = chronologicalRows([...list].reverse(), model, closures, today)
  const years = new Map(rows.flatMap((r) => (r.kind === 'year' ? [[r.year, r] as const] : [])))
  const out: TreeRow[] = []
  let year: string | null = null
  for (const r of rows.reverse()) {
    if (r.kind === 'year') continue
    if (r.kind === 'event') {
      const y = r.e.date.slice(0, 4)
      if (y !== year) out.push(years.get(y)!)
      year = y
      out.push({ ...r, i: n - 1 - r.i })
    } else out.push(r)
  }
  return out
}

function chronologicalRows(list: JourneyEventV3[], model: BranchModel, closures: Record<string, Closure>, today: string): TreeRow[] {
  const out: TreeRow[] = [{ kind: 'root', key: 'root' }]
  const lanes = list.map((e) => laneOf(e, model))
  const count = new Map<string, number>()
  const last = new Map<string, JourneyEventV3>()
  const perYear = new Map<string, number>()
  list.forEach((e, i) => {
    count.set(lanes[i]!, (count.get(lanes[i]!) ?? 0) + 1)
    last.set(lanes[i]!, e)
    perYear.set(e.date.slice(0, 4), (perYear.get(e.date.slice(0, 4)) ?? 0) + 1)
  })
  const ends = new Map<string, Closure>()
  if (model.multi) {
    for (const b of model.list) {
      const fallback = last.get(b.id)
      if (b.ended && fallback) ends.set(b.id, closures[b.id] ?? { id: fallback.id, date: fallback.date, title: fallback.title })
    }
  }
  const forked = new Set<string>()
  const closed = new Set<string>()
  const flushEnds = (before: string | null) => {
    for (const [id, c] of ends) {
      if (closed.has(id) || !forked.has(id) || (before !== null && c.date >= before)) continue
      closed.add(id)
      const branch = model.byId.get(id)!
      out.push({ kind: 'end', key: `x${id}`, branch, side: branchSide(branch), closure: c })
    }
  }

  let year: string | null = null
  let todayShown = false
  let trunkTurn = 0
  list.forEach((e, i) => {
    const lane = lanes[i]!
    const b = model.byId.get(lane)!
    flushEnds(e.date)
    if (!todayShown && e.date > today) {
      out.push({ kind: 'today', key: 'today' })
      todayShown = true
    }
    const y = e.date.slice(0, 4)
    if (y !== year) {
      out.push({ kind: 'year', key: `y${y}`, year: y, n: perYear.get(y)! })
      year = y
    }
    if (model.multi && !b.trunk && !forked.has(lane)) {
      forked.add(lane)
      out.push({ kind: 'fork', key: `f${lane}`, branch: b, side: branchSide(b), n: count.get(lane)! })
    }
    const side: Side = b.off < 0 ? 'l' : b.off > 0 ? 'r' : trunkTurn++ % 2 ? 'l' : 'r'
    out.push({ kind: 'event', key: e.id, e, i, side, lane })
  })
  flushEnds(null)
  out.push({ kind: 'finish', key: 'finish', milestones: list.some((e) => e.is_milestone) })
  return out
}
