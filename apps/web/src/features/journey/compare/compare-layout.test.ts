import type { AssetSummary } from '@/features/assets/api'
import type { JourneyEventV3 } from '../types'
import { CMP, compareLayout, OTHER_LANE, sharedIndications, type CompareInput } from './compare-layout'
import { compareHref, compareIds, defaultCompare } from './compare-url'

const ev = (id: string, date: string, branch: string | undefined, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'x', date, branch, type: 'approval', category: 'regulatory', title: id, significance: 'Low', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const input = (id: string, events: JourneyEventV3[]): CompareInput => ({ id, name: id, color: '#000', events })

const TREP = input('trep', [ev('t1', '2002-05-21', 'PAH'), ev('t2', '2021-03-31', 'PH-ILD'), ev('t3', '2010-01-01', 'PAH')])
const MACI = input('maci', [ev('m1', '2013-10-18', 'PAH'), ev('m2', '2017-06-01', 'CTEPH'), ev('m3', '2015-01-01', undefined)])
const TODAY = '2026-10-24'

describe('compareLayout', () => {
  it('puts every journey on one axis: the same year sits at the same x in every group', () => {
    const L = compareLayout([TREP, MACI], { fit: 2000, today: TODAY })
    expect(L.y0).toBe(2002)
    expect(L.y1).toBe(2027) // through today's year
    expect(L.years.map((y) => y.y)).toEqual(Array.from({ length: 25 }, (_, i) => 2002 + i))
    const x = (g: number, id: string) => L.groups[g]!.lanes.flatMap((l) => l.dots).find((d) => d.e.id === id)!.x
    // 2013 in Treprostinil's group lines up with 2013 in Macitentan's: both are left of / right of the same year lines.
    const y2013 = L.years.find((y) => y.y === 2013)!.x
    const y2014 = L.years.find((y) => y.y === 2014)!.x
    expect(x(1, 'm1')).toBeGreaterThan(y2013)
    expect(x(1, 'm1')).toBeLessThan(y2014)
    expect(x(0, 't3')).toBeCloseTo(L.years.find((y) => y.y === 2010)!.x, 0)
    // The axis stretches to the width given.
    expect(L.width).toBeCloseTo(2000, 0)
    expect(L.todayX).toBeGreaterThan(L.years.at(-1)!.x)
  })

  it('scrolls instead of squeezing: a year never gets narrower than the minimum, and labels thin out', () => {
    const L = compareLayout([TREP, MACI], { fit: 300, today: TODAY })
    expect(L.pxPerYear).toBe(CMP.MIN_YEAR)
    expect(L.width).toBeGreaterThan(300)
    expect(L.years.filter((y) => y.label).every((y) => y.y % 2 === 0)).toBe(true)
    const wide = compareLayout([TREP, MACI], { fit: 2000, today: TODAY })
    expect(wide.years.every((y) => y.label)).toBe(true)
  })

  it('lanes by indication, oldest first; events without one go to Other; shared indications are marked', () => {
    const L = compareLayout([TREP, MACI], { fit: 2000, today: TODAY })
    expect(L.groups[0]!.lanes.map((l) => [l.id, l.shared])).toEqual([['PAH', true], ['PH-ILD', false]])
    expect(L.groups[1]!.lanes.map((l) => [l.id, l.shared])).toEqual([['PAH', true], [OTHER_LANE, false], ['CTEPH', false]])
    expect(sharedIndications([TREP, MACI])).toEqual(new Set(['PAH']))
  })

  it('applies the indication filter to every journey, keeping the shared axis', () => {
    const L = compareLayout([TREP, MACI], { fit: 2000, ind: 'PAH', today: TODAY })
    expect(L.groups.map((g) => g.n)).toEqual([2, 1])
    expect(L.groups.flatMap((g) => g.lanes.map((l) => l.id))).toEqual(['PAH', 'PAH'])
    const only = compareLayout([TREP, MACI], { fit: 2000, ind: 'CTEPH', today: TODAY })
    expect(only.groups[0]!.lanes).toEqual([])
    expect(only.y0).toBe(2017)
  })

  it('stacks dots that would overlap into up to three rows', () => {
    const close = input('c', ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-06-01'].map((d, i) => ev(`e${i}`, d, 'PAH')))
    const lane = compareLayout([close], { fit: 1000, today: TODAY }).groups[0]!.lanes[0]!
    expect(lane.dots.map((d) => d.row)).toEqual([0, 1, 2, 2, 0])
    expect(lane.rows).toBe(3)
  })
})

describe('compare URLs', () => {
  const asset = (id: string, kind: AssetSummary['kind'], competitorOf: string[] = []) =>
    ({ id, name: id, kind, competitorOf: competitorOf.map((p) => ({ id: p, name: p })) }) as AssetSummary

  it('writes and reads up to three slots, without repeats', () => {
    expect(compareHref(['a', 'b', 'c', 'd'], new URLSearchParams('scope=all&view=v'))).toBe('/journey/compare?a=a&b=b&c=c&scope=all')
    expect(compareIds(new URLSearchParams('a=x&b=y&c=x'))).toEqual(['x', 'y'])
  })

  it('defaults to the asset and its first competitor', () => {
    const all = [asset('trep', 'primary'), asset('sota', 'competitor', ['trep']), asset('maci', 'competitor', ['trep']), asset('ocre', 'primary')]
    expect(defaultCompare(all[0]!, all)).toEqual(['trep', 'maci'])
    expect(defaultCompare(all[1]!, all)).toEqual(['sota', 'trep'])
    expect(defaultCompare(all[3]!, all)).toEqual(['ocre'])
  })
})
