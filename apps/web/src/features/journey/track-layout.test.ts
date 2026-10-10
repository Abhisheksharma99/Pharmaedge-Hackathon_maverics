import { yearFraction } from '@/lib/dates'
import { HZ, trackActive, trackHoverAt, trackLayout, trackOffsetFor, trackSeen, trackWindow, xForDate } from './track-layout'
import type { Branch, JourneyEventV3 } from './types'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({
  id, label: id, full: id, color: '#2347d9', off, status: 'Approved · US', origin: 'ai', ...extra,
})
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'trial_start', category: 'clinical', title: id, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const BRANCHES = [
  br('PAH', 0, { trunk: true }),
  br('PH-ILD', 2, { from: 'PAH' }),
  br('IPF', 3, { from: 'PH-ILD' }),
  br('CTEPH', -1, { from: 'PAH' }),
  br('PH-COPD', -5, { from: 'PAH', ended: 'Terminated' }),
  br('SSc', 1, { from: 'PAH' }),
]
// Key-scope Treprostinil shape: PH-COPD's key events run to 2025 but the programme closed in Nov 2022.
const LIST = [
  ev('a', '2002-05-21', 'PAH'),
  ev('b', '2017-02-01', 'PH-ILD'),
  ev('c', '2018-05-08', 'PH-COPD'),
  ev('d', '2020-04-03', 'CTEPH'),
  ev('e', '2021-06-01', 'IPF'),
  ev('f', '2022-01-10', 'PAH'),
  ev('g', '2023-05-22', 'PH-ILD'),
  ev('h', '2024-06-06', 'PH-COPD'),
  ev('i', '2025-03-18', 'PH-COPD'),
  ev('j', '2027-04-30', 'IPF', { is_milestone: true }),
]
const laneOf = (e: JourneyEventV3) => e.branch!
const layout = (over: Partial<Parameters<typeof trackLayout>[0]> = {}) =>
  trackLayout({ list: LIST, branches: BRANCHES, laneOf, vw: 1200, vh: 900, closures: { 'PH-COPD': { id: 'stop', date: '2022-11-29' } }, today: '2026-10-09', ...over })

describe('trackLayout', () => {
  it('uses the design constants and centres the band vertically', () => {
    const L = layout()
    expect(L.xs.slice(0, 3)).toEqual([236, 414, 592])
    expect(L.H).toBe(HZ.RUL + HZ.CA + 14 + 5 * HZ.ROW + 14 + HZ.CA)
    expect(L.top0).toBe((900 - L.H) / 2)
    expect(L.bandTop).toBe(L.top0 + 30 + 196 + 14)
    expect(L.TW).toBe(236 + 9 * 178 + 152 + 140)
    expect(L.maxP).toBe(L.TW - 1200)
  })

  it('orders rows by offset (closed and partner branches above the trunk)', () => {
    const L = layout()
    expect(L.rows.map((r) => r.id)).toEqual(['PH-COPD', 'CTEPH', 'PAH', 'PH-ILD', 'IPF'])
    expect(L.rowY('PAH')!).toBe(L.bandTop + 2 * 34 + 17)
  })

  it('hides rows for branches with no event in the list, keeps the trunk, and has no y for them', () => {
    const L = layout()
    expect(L.rows.some((r) => r.id === 'SSc')).toBe(false)
    expect(L.rowY('SSc')).toBeNull()
    const onlyTrunk = layout({ list: LIST.filter((e) => e.branch === 'PAH') })
    expect(onlyTrunk.rows.map((r) => r.id)).toEqual(['PAH'])
    expect(onlyTrunk.H).toBe(HZ.RUL + HZ.CA + 14 + HZ.ROW + 14 + HZ.CA)
    const noEvents = layout({ list: [] })
    expect(noEvents.rows.map((r) => r.id)).toEqual(['PAH'])
  })

  it('starts the trunk at PADL − 110, a branch 74px before its first event, forking from its parent row', () => {
    const L = layout()
    const lane = (id: string) => L.lanes.find((l) => l.id === id)!
    expect(lane('PAH')).toMatchObject({ x1: 126, x2: L.TW - 70, py: null })
    expect(lane('PH-ILD')).toMatchObject({ x1: 414 - 74, py: L.rowY('PAH')! })
    expect(lane('IPF').py).toBe(L.rowY('PH-ILD')!)
    expect(L.lanes.some((l) => l.id === 'SSc')).toBe(false)
  })

  it('caps PH-COPD at its 2022 closure between the 2022 and 2023 columns, with a dotted tail to its later events', () => {
    const L = layout()
    const copd = L.lanes.find((l) => l.id === 'PH-COPD')!
    const x2022 = L.xs[5]!
    const x2023 = L.xs[6]!
    expect(copd.ended).toBe(true)
    expect(copd.capX!).toBeGreaterThan(x2022)
    expect(copd.capX!).toBeLessThan(x2023)
    const t = (yearFraction('2022-11-29') - yearFraction('2022-01-10')) / (yearFraction('2023-05-22') - yearFraction('2022-01-10'))
    expect(copd.capX!).toBeCloseTo(x2022 + t * 178, 6)
    expect(copd.x2).toBe(copd.capX)
    expect(copd.tailX).toBe(L.xs[8])
  })

  it('caps right after the closing event when it is on the track, and after the last event without a closure', () => {
    const withStop = [...LIST.slice(0, 6), ev('stop', '2022-11-29', 'PH-COPD', { type: 'trial_stopped' }), ...LIST.slice(6)]
    const L = layout({ list: withStop })
    expect(L.lanes.find((l) => l.id === 'PH-COPD')!.capX).toBe(L.xs[6]! + 26)
    const M = layout({ closures: {} })
    expect(M.lanes.find((l) => l.id === 'PH-COPD')).toMatchObject({ capX: M.xs[8]! + 26, tailX: null })
  })

  it('puts Today between the last past event and the first future one', () => {
    const L = layout()
    expect(L.todayX).toBe((L.xs[8]! + L.xs[9]!) / 2)
    expect(layout({ today: '1999-01-01' }).todayX).toBe(236 - 60)
    expect(layout({ today: '2030-01-01' }).todayX).toBe(L.xs[9]! + 70)
  })

  it('places one ruler year per year and parallax numerals at least 520px apart', () => {
    const L = layout()
    expect(L.years.map((y) => y.y)).toEqual(['2002', '2017', '2018', '2020', '2021', '2022', '2023', '2024', '2025', '2027'])
    for (let i = 1; i < L.bgYears.length; i++) expect(L.bgYears[i]!.bx - L.bgYears[i - 1]!.bx).toBeGreaterThanOrEqual(520)
  })

  it('draws a single unlabeled trunk for an asset without branches and copes with no events', () => {
    const single = trackLayout({ list: LIST, branches: [br('journey', 0, { trunk: true, label: '' })], laneOf: () => 'journey', vw: 1000, vh: 700, closures: {}, today: '2026-10-09' })
    expect(single.lanes).toHaveLength(1)
    const empty = trackLayout({ list: [], branches: BRANCHES, laneOf, vw: 1000, vh: 700, closures: {}, today: '2026-10-09' })
    expect(empty).toMatchObject({ xs: [], maxP: 0, years: [] })
    expect(xForDate('2020-01-01', [], [])).toBe(236)
  })
})

describe('track windowing and scroll position', () => {
  it('renders only the cards near the viewport, even for 1,270 events', () => {
    const n = 1270
    const [first, last] = trackWindow(100_000, 1200, n)
    expect(last - first).toBeLessThan(20)
    expect(HZ.PADL + first * HZ.COL + HZ.CW / 2).toBeLessThan(100_000)
    expect(HZ.PADL + last * HZ.COL - HZ.CW / 2).toBeGreaterThan(101_200)
    expect(trackWindow(0, 1200, 5)).toEqual([0, 4])
    expect(trackWindow(0, 1200, 0)).toEqual([0, -1])
  })

  it('finds the active card at the middle, the revealed ones, and the offset that centres a card', () => {
    expect(trackActive(0, 1200, 10)).toBe(Math.round((600 - 236) / 178))
    expect(trackActive(99_999, 1200, 10)).toBe(9)
    expect(trackSeen(0, 1200, 10)).toBe(Math.floor((1160 - 236) / 178))
    const L = layout()
    expect(trackOffsetFor(L, 0, 1200)).toBe(0)
    expect(trackOffsetFor(L, 9, 1200)).toBe(L.maxP)
    expect(trackOffsetFor(L, 5, 1200)).toBe(L.xs[5]! - 600)
  })
})

describe('trackHoverAt', () => {
  it('reads the row under the pointer and a date between the neighbouring cards', () => {
    const L = layout()
    const x = (L.xs[3]! + L.xs[4]!) / 2
    const h = trackHoverAt(L, LIST, x, L.rowY('CTEPH')!, '2026-10-09')!
    expect(h.lane).toBe('CTEPH')
    expect(h.ly).toBe(L.rowY('CTEPH')!)
    expect(h.prev?.id).toBe('d')
    expect(h.next?.id).toBe('e')
    expect(h.date > '2020-04-03' && h.date < '2021-06-01').toBe(true)
  })

  it('is null outside the band and clamps to the first and last events at the ends', () => {
    const L = layout()
    expect(trackHoverAt(L, LIST, 500, L.bandTop - 20)).toBeNull()
    expect(trackHoverAt(L, LIST, 140, L.rowY('PAH')!)!.date).toBe('2002-05-21')
    expect(trackHoverAt(L, LIST, L.TW - 80, L.rowY('PAH')!)!.date).toBe('2027-04-30')
  })

  it('reads a row only where its lane exists: not before it starts, not past the trunk end', () => {
    const L = layout()
    const y = L.rowY('PH-ILD')!
    const start = L.lanes.find((l) => l.id === 'PH-ILD')!.x1
    expect(trackHoverAt(L, LIST, start - 10, y)).toBeNull()
    expect(trackHoverAt(L, LIST, start + 10, y)?.lane).toBe('PH-ILD')
    expect(trackHoverAt(L, LIST, 100, L.rowY('PAH')!)).toBeNull()
    expect(trackHoverAt(L, LIST, L.TW, L.rowY('PAH')!)).toBeNull()
  })

  it('stops an ended branch at its cap, or at the dotted tail when later events follow it', () => {
    const L = layout()
    const copd = L.lanes.find((l) => l.id === 'PH-COPD')!
    const y = L.rowY('PH-COPD')!
    expect(trackHoverAt(L, LIST, copd.capX! + 20, y)?.lane).toBe('PH-COPD')
    expect(trackHoverAt(L, LIST, copd.tailX! + 40, y)).toBeNull()
    const M = layout({ closures: {} })
    const m = M.lanes.find((l) => l.id === 'PH-COPD')!
    expect(trackHoverAt(M, LIST, m.capX! + 40, M.rowY('PH-COPD')!)).toBeNull()
  })
})
