import { hoverDate } from '../hover-add'
import type { BranchModel } from '../journey-model'
import { noteColor } from '../constants'
import type { JourneyEventV3 } from '../types'
import type { TreeRow } from './tree-rows'

/**
 * Tree constants (README §6.2, aj/story.jsx): lane gap 40px wide / 16px narrow, narrow below a 980px flow, 28px flow
 * padding on top and 40px below, 14px item padding, node 34px below the card top.
 */
export const TREE = { GAP_W: 40, GAP_N: 16, NARROW: 980, PAD_TOP: 28, PAD_BOTTOM: 40, ITEM_PAD: 14, NODE_DY: 34 } as const

/** Gutters around the trunk sized by the branch offsets: left `gl`, right `gr`; `nw` = narrow lane strip. */
export function treeGutters(model: Pick<BranchModel, 'list'>) {
  const offs = model.list.map((b) => b.off)
  const mn = Math.min(0, ...offs)
  const mx = Math.max(0, ...offs)
  return { mn, mx, gl: -mn * TREE.GAP_W + 30, gr: mx * TREE.GAP_W + 30, nw: 14 + (mx - mn) * TREE.GAP_N + 26 }
}

/** Card width for a flow width (same formula as `treeGeometry`, clamped for tiny flows). */
export function treeCardWidth(W: number, model: Pick<BranchModel, 'list'>): number {
  const { gl, gr, nw } = treeGutters(model)
  return Math.max(120, W < TREE.NARROW ? W - nw : (W - (gl + gr)) / 2 - 8)
}

const lines = (text: string | null | undefined, font: number, width: number) =>
  text ? Math.max(1, Math.ceil((text.length * font * 0.54) / Math.max(60, width))) : 0

/**
 * Row height before it is measured (rendered rows replace it with their real height). Event cards are estimated from
 * their text and the card width, so rows below an unmeasured stretch land close to where they will end up.
 */
export function estimateRowHeight(row: TreeRow, cardW = 545): number {
  switch (row.kind) {
    case 'root':
      return 42
    case 'year':
      return 98
    case 'today':
      return 80
    case 'fork':
      return 82
    case 'end':
      return 74
    case 'finish':
      return 72
    case 'event': {
      const e = row.e
      const sig = e.significance
      const low = sig === 'Low'
      const inner = cardW - (sig === 'High' ? 48 : sig === 'Medium' ? 40 : 32)
      const titleFont = sig === 'High' ? 21 : sig === 'Medium' ? 18 : 14.5
      let h = 2 * TREE.ITEM_PAD + (sig === 'High' ? 44 : sig === 'Medium' ? 36 : 24) + 34
      if (e.user) h += 26
      h += (low ? 20 : 12) + lines(e.title, titleFont, inner) * titleFont * 1.25
      if (e.summary) h += 6 + lines(e.summary, 13, inner) * 20
      if ((e.indications?.length ?? 0) > 0 || e.product) h += 36
      const facts = low ? 0 : Object.keys(e.details ?? {}).length
      if (facts) h += 12 + Math.ceil(facts / Math.max(1, Math.floor(inner / 141))) * 46
      if (!low && e.impact) h += 10 + lines(e.impact, 13, inner) * 19.5
      return Math.round(h + 52)
    }
  }
}

/** Row tops from heights (flow padding included) and the flow height. */
export function rowTops(heights: number[]): { tops: number[]; H: number } {
  const tops: number[] = []
  let y = TREE.PAD_TOP
  for (const h of heights) {
    tops.push(y)
    y += h
  }
  return { tops, H: y + TREE.PAD_BOTTOM }
}

/** First and last row intersecting [from, to] (inclusive; [0, −1] when there are no rows). Binary searches, no allocation. */
export function treeWindow(tops: number[], heights: number[], from: number, to: number): [number, number] {
  const n = tops.length
  if (!n) return [0, -1]
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tops[mid]! + heights[mid]! > from) hi = mid
    else lo = mid + 1
  }
  const first = Math.min(n - 1, lo)
  lo = first
  hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tops[mid]! > to) hi = mid
    else lo = mid + 1
  }
  return [first, Math.max(first, lo - 1)]
}

/** Like `neighbours` over the nodes' y, without building the array: [last node at or above y, first below]. */
function nodeNeighbours(nodes: TreeNode[], y: number): [number, number] {
  let lo = 0
  let hi = nodes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (nodes[mid]!.y > y) hi = mid
    else lo = mid + 1
  }
  return [lo - 1, lo]
}

export interface TreeNode {
  /** Event id. */
  k: string
  /** Index in the view's list. */
  i: number
  y: number
  lane: string
  x: number
  /** Card edge the connector runs to. */
  x2: number
  up: boolean
  hi: boolean
  /** Note tag colour (white node with a tag-colour stroke). */
  note: string | null
  /** x of the other branches a multi-indication event covers. */
  span: number[]
}

export interface TreeLane {
  id: string
  label: string
  color: string
  trunk: boolean
  x: number
  /** Parent lane x (fork curve); null on the trunk. */
  px: number | null
  /** Fork row centre. */
  fy: number
  y1: number
  /** End of the solid/dashed lane (the ⊗ cap of an ended branch). */
  y2: number
  /** End of the "New branch" connector at the fork card. */
  fx2: number
  ended: boolean
  /** Dotted follow-up after the closure, down to the branch's last event. */
  tailY: number | null
}

export interface TreeGeometry {
  W: number
  H: number
  tx: number
  gap: number
  narrow: boolean
  cardW: number
  nodes: TreeNode[]
  lanes: TreeLane[]
  yToday: number | null
  yEnd: number
  xMin: number
  xMax: number
}

export interface TreeGeometryInput {
  /** Flow width. */
  W: number
  rows: TreeRow[]
  tops: number[]
  heights: number[]
  H: number
  model: BranchModel
  /** Other branches covered by an event (journey-model `spanOf`). */
  spanOf: (e: JourneyEventV3) => string[]
}

/** Lanes, nodes and connectors computed from the row layout (no DOM reads), so off-screen rows have geometry too. */
export function treeGeometry({ W, rows, tops, heights, H, model, spanOf }: TreeGeometryInput): TreeGeometry {
  const narrow = W < TREE.NARROW
  const gap = narrow ? TREE.GAP_N : TREE.GAP_W
  const { mn, gl, gr, nw } = treeGutters(model)
  const tx = narrow ? 14 + -mn * TREE.GAP_N : Math.round((W + gl - gr) / 2)
  const cardW = Math.max(120, narrow ? W - nw : (W - (gl + gr)) / 2 - 8)
  const laneX = (id: string) => tx + (model.byId.get(id)?.off ?? 0) * gap
  /** The card edge facing the lanes: a right-hand card's left edge, a left-hand card's right edge. */
  const edge = (side: 'l' | 'r') => (narrow || side === 'r' ? W - cardW : cardW)
  const mid = (i: number) => tops[i]! + heights[i]! / 2

  const nodes: TreeNode[] = []
  const forkAt = new Map<string, number>()
  const endAt = new Map<string, number>()
  let yToday: number | null = null
  let yRoot = TREE.PAD_TOP + 15
  let yEnd = H - TREE.PAD_BOTTOM
  rows.forEach((r, i) => {
    if (r.kind === 'event') {
      nodes.push({
        k: r.e.id,
        i: r.i,
        y: tops[i]! + TREE.ITEM_PAD + TREE.NODE_DY,
        lane: r.lane,
        x: laneX(r.lane),
        x2: edge(r.side),
        up: r.e.is_milestone,
        hi: r.e.significance === 'High',
        note: r.e.user ? noteColor(r.e.user.tag) : null,
        span: spanOf(r.e).map(laneX),
      })
    } else if (r.kind === 'fork') forkAt.set(r.branch.id, i)
    else if (r.kind === 'end') endAt.set(r.branch.id, i)
    else if (r.kind === 'today') yToday = mid(i)
    else if (r.kind === 'root') yRoot = tops[i]! + 15
    else if (r.kind === 'finish') yEnd = tops[i]! + 14
  })

  const lanes: TreeLane[] = []
  const started = new Map<string, number>()
  const trunk = model.trunk
  lanes.push({ id: trunk.id, label: trunk.label, color: trunk.color, trunk: true, x: laneX(trunk.id), px: null, fy: yRoot, y1: yRoot, y2: yEnd, fx2: laneX(trunk.id), ended: false, tailY: null })
  started.set(trunk.id, yRoot)
  for (const b of model.list) {
    const f = forkAt.get(b.id)
    if (b.id === trunk.id || f === undefined) continue
    const fy = mid(f)
    const parent = b.from && (started.get(b.from) ?? Infinity) < fy ? b.from : trunk.id
    const mine = nodes.filter((n) => n.lane === b.id)
    const last = mine[mine.length - 1]
    const end = endAt.get(b.id)
    let y2: number
    let tailY: number | null = null
    if (end !== undefined) {
      y2 = mid(end)
      tailY = last && last.y > y2 ? last.y : null
    } else {
      const lastY = last ? last.y : fy
      y2 = Math.max(lastY, yToday !== null && !last?.up ? Math.min(yToday, yEnd) : lastY)
    }
    const fork = rows[f] as Extract<TreeRow, { kind: 'fork' }>
    lanes.push({
      id: b.id, label: b.label, color: b.color, trunk: false, x: laneX(b.id), px: laneX(parent), fy, y1: fy, y2,
      fx2: edge(fork.side), ended: end !== undefined, tailY,
    })
    started.set(b.id, fy)
  }
  const xs = lanes.map((l) => l.x)
  return { W, H, tx, gap, narrow, cardW, nodes, lanes, yToday, yEnd, xMin: Math.min(...xs), xMax: Math.max(...xs) }
}

/** The event row nearest the scroll probe (HUD, active card): index into the view's list. */
export function treeActiveAt(nodes: TreeNode[], probeY: number): number {
  if (!nodes.length) return 0
  const [a, b] = nodeNeighbours(nodes, probeY)
  const pick = a < 0 ? b : b >= nodes.length ? a : probeY - nodes[a]!.y <= nodes[b]!.y - probeY ? a : b
  return nodes[pick]!.i
}

export interface TreeHover {
  y: number
  lx: number
  lane: string
  color: string
  label: string
  date: string
  prev: JourneyEventV3 | null
  next: JourneyEventV3 | null
}

/**
 * Gutter hover-to-add (README §6.2): the nearest started lane at this height, and a date interpolated between the
 * event nodes above and below (`x`, `y` relative to the flow).
 */
export function treeHoverAt(geo: TreeGeometry, byId: Map<string, JourneyEventV3>, x: number, y: number, today?: string): TreeHover | null {
  const live = geo.lanes.filter((l) => y >= (l.px !== null ? l.fy : l.y1) && y <= (l.tailY ?? l.y2) + 20)
  const pool = live.length ? live : geo.lanes.filter((l) => l.trunk)
  const lane = pool.reduce<(typeof pool)[number] | null>((best, l) => (!best || Math.abs(l.x - x) < Math.abs(best.x - x) ? l : best), null)
  if (!lane) return null
  const [a, b] = nodeNeighbours(geo.nodes, y)
  const A = a >= 0 ? (byId.get(geo.nodes[a]!.k) ?? null) : null
  const B = b < geo.nodes.length ? (byId.get(geo.nodes[b]!.k) ?? null) : null
  const date = hoverDate(A && { pos: geo.nodes[a]!.y, date: A.date }, B && { pos: geo.nodes[b]!.y, date: B.date }, y, today)
  return { y, lx: lane.x, lane: lane.id, color: lane.color, label: lane.label, date, prev: A, next: B }
}
