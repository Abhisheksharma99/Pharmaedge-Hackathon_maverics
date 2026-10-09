import { DOT_RADIUS, rangeBounds, rangeTicks } from './portfolio-scale'

const T = 2026.774

describe('rangeBounds', () => {
  it('spans ±1 year and 3 years around today', () => {
    expect(rangeBounds('1y', T, [])).toEqual([T - 1, T + 1.15])
    expect(rangeBounds('3y', T, [])).toEqual([T - 3, T + 1.6])
  })

  it('covers every dated event for all time, from 2000 at the latest and two years ahead at least', () => {
    expect(rangeBounds('all', T, [])).toEqual([2000, 2029])
    expect(rangeBounds('all', T, [1995.4, 2031.2, Number.NaN])).toEqual([1995, 2032])
  })
})

describe('rangeTicks', () => {
  it('labels quarters for ±1 year', () => {
    expect(rangeTicks('1y', 2025.774, 2027.924).map((t) => t.label)).toEqual([
      'Jan ’26', 'Apr ’26', 'Jul ’26', 'Oct ’26', 'Jan ’27', 'Apr ’27', 'Jul ’27', 'Oct ’27',
    ])
    expect(rangeTicks('1y', 2025.774, 2027.924)[0]).toEqual({ v: 2026, label: 'Jan ’26' })
  })

  it('steps yearly for 3 years, and every 2 or 4 years for all time', () => {
    expect(rangeTicks('3y', 2023.774, 2028.374).map((t) => t.label)).toEqual(['2024', '2025', '2026', '2027', '2028'])
    expect(rangeTicks('all', 1995, 2032).map((t) => t.v)).toEqual([1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024, 2028, 2032])
    expect(rangeTicks('all', 2010, 2029).map((t) => t.v)).toEqual([2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026, 2028])
  })

  it('sizes dots by significance', () => {
    expect(DOT_RADIUS).toEqual({ High: 6.5, Medium: 5, Low: 3.6 })
  })
})
