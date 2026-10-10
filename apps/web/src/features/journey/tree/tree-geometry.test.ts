import { yearFraction } from '@/lib/dates'
import { branchModel, spanOf } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'
import { estimateRowHeight, rowTops, TREE, treeActiveAt, treeGeometry, treeGutters, treeHoverAt, treeWindow } from './tree-geometry'
import { treeRows, type TreeRow } from './tree-rows'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({
  id, label: id, full: `${id} full`, color: '#0b7a6f', off, status: 'Approved · US', origin: 'ai', ...extra,
})
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'trial_start', category: 'clinical', title: `T ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const MODEL = branchModel([
  br('PAH', 0, { trunk: true, color: '#2347d9' }),
  br('PH-ILD', 2, { from: 'PAH' }),
  br('IPF', 3, { from: 'PH-ILD' }),
  br('CTEPH', -1, { from: 'PAH' }),
  br('PH-COPD', -5, { from: 'PAH', ended: 'Terminated' }),
])
const LIST = [
  ev('a', '2002-05-21', 'PAH'),
  ev('b', '2004-11-23', 'PAH'),
  ev('c', '2017-02-01', 'PH-ILD'),
  ev('d', '2018-05-08', 'PH-COPD'),
  ev('e', '2021-06-01', 'IPF', { span: ['PH-ILD'] }),
  ev('f', '2022-01-10', 'PAH'),
  ev('g', '2023-05-22', 'PH-ILD'),
  ev('h', '2024-06-06', 'PH-COPD', { significance: 'Medium' }),
  ev('i', '2027-04-30', 'IPF', { is_milestone: true }),
]
const CLOSURES = { 'PH-COPD': { id: 'stop', date: '2022-11-29', title: 'Phase 3 trial terminated: PERFECT OLE' } }
const keys = (rows: TreeRow[]) => rows.map((r) => r.key)

function geometry(W: number, rows = treeRows(LIST, MODEL, CLOSURES, '2026-10-09')) {
  const heights = rows.map(estimateRowHeight)
  const { tops, H } = rowTops(heights)
  return { rows, tops, heights, geo: treeGeometry({ W, rows, tops, heights, H, model: MODEL, spanOf: (e) => spanOf(e, MODEL) }) }
}

describe('treeRows', () => {
  it('orders root, years, forks before a branch’s first event, the closure, Today and the end', () => {
    const rows = treeRows(LIST, MODEL, CLOSURES, '2026-10-09')
    expect(keys(rows)).toEqual([
      'root', 'y2002', 'a', 'y2004', 'b', 'y2017', 'fPH-ILD', 'c', 'y2018', 'fPH-COPD', 'd', 'y2021', 'fIPF', 'e', 'y2022', 'f',
      'xPH-COPD', 'y2023', 'g', 'y2024', 'h', 'today', 'y2027', 'i', 'finish',
    ])
    expect(rows.find((r) => r.key === 'xPH-COPD')).toMatchObject({ closure: { date: '2022-11-29', title: 'Phase 3 trial terminated: PERFECT OLE' }, side: 'l' })
    expect(rows.find((r) => r.key === 'fPH-ILD')).toMatchObject({ n: 2, side: 'r' })
    expect(rows.at(-1)).toMatchObject({ kind: 'finish', milestones: true })
  })

  it('alternates trunk events right / left and keeps branch events on their side', () => {
    const sides = treeRows(LIST, MODEL, CLOSURES, '2026-10-09').flatMap((r) => (r.kind === 'event' ? [`${r.key}:${r.side}`] : []))
    expect(sides).toEqual(['a:r', 'b:l', 'c:r', 'd:l', 'e:r', 'f:r', 'g:r', 'h:l', 'i:r'])
  })

  it('closes after the branch’s last event when the closure is unknown, and has no forks on a single trunk', () => {
    expect(keys(treeRows(LIST, MODEL, {}, '2026-10-09'))).toContain('xPH-COPD')
    const k = keys(treeRows(LIST, MODEL, {}, '2026-10-09'))
    expect(k.indexOf('xPH-COPD')).toBe(k.indexOf('h') + 1)
    const single = treeRows(LIST, branchModel([]), {}, '2030-01-01')
    expect(single.some((r) => r.kind === 'fork' || r.kind === 'end' || r.kind === 'today')).toBe(false)
  })
})

describe('treeGeometry', () => {
  it('sizes the gutters from the branch offsets and centres the trunk between them', () => {
    expect(treeGutters(MODEL)).toEqual({ mn: -5, mx: 3, gl: 230, gr: 150, nw: 14 + 8 * 16 + 26 })
    const { geo } = geometry(1300)
    expect(geo.narrow).toBe(false)
    expect(geo.gap).toBe(40)
    expect(geo.tx).toBe(Math.round((1300 + 230 - 150) / 2))
    expect(geo.cardW).toBe((1300 - 380) / 2 - 8)
    const x = (id: string) => geo.lanes.find((l) => l.id === id)!.x
    expect(x('IPF')).toBe(geo.tx + 120)
    expect(x('PH-COPD')).toBe(geo.tx - 200)
    expect(geo.xMin).toBe(geo.tx - 200)
    expect(geo.xMax).toBe(geo.tx + 120)
  })

  it('switches to the narrow layout below a 980px flow: trunk near the left edge, every card on the right', () => {
    const { geo } = geometry(979)
    expect(geo.narrow).toBe(true)
    expect(geo.gap).toBe(16)
    expect(geo.tx).toBe(14 + 5 * 16)
    expect(geo.cardW).toBe(979 - (14 + 8 * 16 + 26))
    expect(new Set(geo.nodes.map((n) => n.x2))).toEqual(new Set([979 - geo.cardW]))
    expect(geometry(980).geo.narrow).toBe(false)
  })

  it('puts nodes 48px below the card row top and connects them to the facing card edge', () => {
    const { rows, tops, geo } = geometry(1300)
    const i = rows.findIndex((r) => r.key === 'b')
    const node = geo.nodes.find((n) => n.k === 'b')!
    expect(node.y).toBe(tops[i]! + TREE.ITEM_PAD + TREE.NODE_DY)
    expect(node.x2).toBe(geo.cardW)
    expect(geo.nodes.find((n) => n.k === 'a')!.x2).toBe(1300 - geo.cardW)
    expect(geo.nodes.find((n) => n.k === 'e')!.span).toEqual([geo.tx + 80])
    expect(geo.nodes.find((n) => n.k === 'i')!.up).toBe(true)
  })

  it('forks a branch at its fork row from its parent lane, falling back to the trunk', () => {
    const { rows, tops, heights, geo } = geometry(1300)
    const f = rows.findIndex((r) => r.key === 'fIPF')
    const ipf = geo.lanes.find((l) => l.id === 'IPF')!
    expect(ipf.fy).toBe(tops[f]! + heights[f]! / 2)
    expect(ipf.px).toBe(geo.lanes.find((l) => l.id === 'PH-ILD')!.x)
    expect(ipf.fx2).toBe(1300 - geo.cardW)
    const orphan = branchModel([br('PAH', 0, { trunk: true }), br('X', 1, { from: 'Nope' })])
    const rows2 = treeRows([ev('a', '2002-01-01', 'PAH'), ev('x', '2010-01-01', 'X')], orphan, {}, '2026-10-09')
    const h2 = rows2.map(estimateRowHeight)
    const { tops: t2, H } = rowTops(h2)
    const g2 = treeGeometry({ W: 1300, rows: rows2, tops: t2, heights: h2, H, model: orphan, spanOf: () => [] })
    expect(g2.lanes.find((l) => l.id === 'X')!.px).toBe(g2.tx)
  })

  it('caps an ended branch at its closure row with a dotted tail to later events; active branches reach Today', () => {
    const { rows, tops, heights, geo } = geometry(1300)
    const end = rows.findIndex((r) => r.key === 'xPH-COPD')
    const copd = geo.lanes.find((l) => l.id === 'PH-COPD')!
    expect(copd).toMatchObject({ ended: true, y2: tops[end]! + heights[end]! / 2 })
    expect(copd.tailY).toBe(geo.nodes.find((n) => n.k === 'h')!.y)
    const ild = geo.lanes.find((l) => l.id === 'PH-ILD')!
    expect(ild.y2).toBe(geo.yToday)
    expect(geo.lanes.find((l) => l.id === 'IPF')!.y2).toBe(geo.nodes.find((n) => n.k === 'i')!.y)
    expect(geo.lanes.find((l) => l.trunk)!.y2).toBe(geo.yEnd)
  })
})

describe('tree windowing, active row and hover', () => {
  it('renders only rows near the viewport', () => {
    const heights = Array.from({ length: 2000 }, () => 100)
    const { tops } = rowTops(heights)
    expect(treeWindow(tops, heights, 50_000, 51_000)).toEqual([499, 509])
    expect(treeWindow(tops, heights, -500, 10)).toEqual([0, 0])
    expect(treeWindow([], [], 0, 10)).toEqual([0, -1])
  })

  it('finds the event nearest the probe', () => {
    const { geo } = geometry(1300)
    const b = geo.nodes.find((n) => n.k === 'b')!
    expect(treeActiveAt(geo.nodes, b.y + 3)).toBe(1)
    expect(treeActiveAt(geo.nodes, -100)).toBe(0)
    expect(treeActiveAt(geo.nodes, 1e9)).toBe(8)
  })

  it('hovers the nearest started lane with a date between the nodes above and below', () => {
    const { geo } = geometry(1300)
    const byId = new Map(LIST.map((e) => [e.id, e]))
    const a = geo.nodes.find((n) => n.k === 'a')!
    const b = geo.nodes.find((n) => n.k === 'b')!
    const h = treeHoverAt(geo, byId, geo.tx + 3, (a.y + b.y) / 2, '2026-10-09')!
    expect(h).toMatchObject({ lane: 'PAH', lx: geo.tx, prev: LIST[0], next: LIST[1] })
    const mid = (yearFraction('2002-05-21') + yearFraction('2004-11-23')) / 2
    expect(Math.abs(yearFraction(h.date) - mid)).toBeLessThan(0.05)
    // PH-COPD has not forked yet in 2004: the pointer over its lane x snaps to the trunk.
    expect(treeHoverAt(geo, byId, geo.tx - 200, (a.y + b.y) / 2)!.lane).toBe('PAH')
    const d = geo.nodes.find((n) => n.k === 'd')!
    expect(treeHoverAt(geo, byId, geo.tx - 199, d.y + 10)!.lane).toBe('PH-COPD')
  })
})
