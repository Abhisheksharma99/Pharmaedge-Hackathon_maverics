import { yearFraction } from '@/lib/dates'
import { fullDate, hoverDate, neighbours } from './hover-add'

describe('fullDate', () => {
  it('starts partial dates at the beginning of the period', () => {
    expect(fullDate('2021')).toBe('2021-01-01')
    expect(fullDate('2021-03')).toBe('2021-03-01')
    expect(fullDate('2013-02-11')).toBe('2013-02-11')
  })
})

describe('neighbours', () => {
  it('finds the positions just before and after', () => {
    const xs = [236, 414, 592]
    expect(neighbours(xs, 100)).toEqual([-1, 0])
    expect(neighbours(xs, 414)).toEqual([1, 2])
    expect(neighbours(xs, 500)).toEqual([1, 2])
    expect(neighbours(xs, 900)).toEqual([2, 3])
    expect(neighbours([], 5)).toEqual([-1, 0])
  })
})

describe('hoverDate', () => {
  const a = { pos: 100, date: '2012-06-01' }
  const b = { pos: 300, date: '2013-12-20' }

  it('interpolates linearly in year fraction between the neighbours', () => {
    const mid = hoverDate(a, b, 200)
    const expected = (yearFraction(a.date) + yearFraction(b.date)) / 2
    expect(Math.abs(yearFraction(mid) - expected)).toBeLessThan(0.01)
  })

  it('reads the neighbour itself at its position and outside the range', () => {
    expect(hoverDate(a, b, 100)).toBe('2012-06-01')
    expect(hoverDate(a, b, 40)).toBe('2012-06-01')
    expect(hoverDate(null, b, 40)).toBe('2013-12-20')
    expect(hoverDate(a, null, 900)).toBe('2012-06-01')
    expect(hoverDate(null, null, 5, '2026-10-09')).toBe('2026-10-09')
  })

  it('always lies between the neighbouring cards, even at month ends where the 28-day clamp overshoots', () => {
    const pairs = [
      ['2013-03-31', '2013-04-02'],
      ['2013-01-30', '2013-02-02'],
      ['2019-12-31', '2020-01-01'],
      ['2021', '2021-03-15'],
      ['2005-04-27', '2005-04-27'],
      ['2002-05-21', '2028-11-01'],
    ] as const
    for (const [da, db] of pairs) {
      for (let pos = 0; pos <= 100; pos += 2.5) {
        const d = hoverDate({ pos: 0, date: da }, { pos: 100, date: db }, pos)
        expect(d >= fullDate(da) && d <= fullDate(db), `${da}..${db} @${pos} → ${d}`).toBe(true)
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })

  it('is monotonic as the pointer moves right', () => {
    let last = ''
    for (let pos = 0; pos <= 100; pos += 1) {
      const d = hoverDate({ pos: 0, date: '2004-11-23' }, { pos: 100, date: '2006-05-15' }, pos)
      expect(d >= last).toBe(true)
      last = d
    }
  })
})
