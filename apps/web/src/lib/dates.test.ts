import { clampDay, daysBetween, formatDay, fromYearFraction, interpolateDate, relativeFuture, yearFraction } from './dates'

describe('yearFraction', () => {
  it('maps a full date with the design formula', () => {
    expect(yearFraction('2002-05-21')).toBeCloseTo(2002 + (4 * 30.4 + 21) / 365, 6)
  })
  it('treats partial dates as the start of the period', () => {
    expect(yearFraction('2021')).toBeCloseTo(2021 + 1 / 365, 6)
    expect(yearFraction('2021-03')).toBeCloseTo(2021 + (2 * 30.4 + 1) / 365, 6)
  })
  it('is NaN for missing or invalid dates', () => {
    expect(yearFraction('')).toBeNaN()
    expect(yearFraction(null)).toBeNaN()
    expect(yearFraction('soon')).toBeNaN()
  })
})

describe('fromYearFraction / interpolateDate', () => {
  it('round-trips a mid-month date to the same month', () => {
    expect(fromYearFraction(yearFraction('2005-04-15'))).toMatch(/^2005-04-/)
  })
  it('never produces a day above 28 or below 1', () => {
    for (let f = 2000; f < 2001; f += 0.013) {
      const day = Number(fromYearFraction(f).slice(8))
      expect(day).toBeGreaterThanOrEqual(1)
      expect(day).toBeLessThanOrEqual(28)
    }
  })
  it('interpolates halfway between two dates and clamps t', () => {
    const a = yearFraction('2004-01-01')
    const b = yearFraction('2006-01-01')
    expect(interpolateDate(a, b, 0.5)).toMatch(/^2005-0[01]-/)
    expect(interpolateDate(a, b, -1)).toBe(fromYearFraction(a))
    expect(interpolateDate(a, b, 9)).toBe(fromYearFraction(b))
  })
  it('clampDay keeps days within 1–28', () => {
    expect(clampDay(0)).toBe(1)
    expect(clampDay(31)).toBe(28)
    expect(clampDay(14)).toBe(14)
  })
})

describe('relativeFuture', () => {
  const today = '2026-10-09'
  it('counts days under 45 days', () => {
    expect(relativeFuture('2026-10-21', today)).toBe('in 12 days')
    expect(relativeFuture('2026-10-10', today)).toBe('in 1 day')
  })
  it('counts months under 18 months, then years', () => {
    expect(relativeFuture('2027-07-09', today)).toBe('in 9 months')
    expect(relativeFuture('2028-05-30', today)).toBe('in 1.6 years')
  })
  it('uses the singular for one month', () => {
    expect(relativeFuture('2026-11-23', today)).toBe('in 1 month')
    expect(relativeFuture('2026-08-25', today)).toBe('1 month ago')
  })
  it('handles today and past dates', () => {
    expect(relativeFuture(today, today)).toBe('today')
    expect(relativeFuture('2026-09-29', today)).toBe('10 days ago')
    expect(relativeFuture('2026-07-09', today)).toBe('3 months ago')
    expect(relativeFuture('2023-10-09', today)).toBe('3.0 years ago')
  })
  it('is empty for an invalid date', () => {
    expect(relativeFuture('', today)).toBe('')
  })
})

describe('daysBetween / formatDay', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-10-01', '2026-10-09')).toBe(8)
    expect(daysBetween('2026-10-09', '2026-10-01')).toBe(-8)
  })
  it('formats like the design', () => {
    expect(formatDay('2002-05-21')).toBe('May 21, 2002')
    expect(formatDay('2021-03')).toBe('Mar 2021')
    expect(formatDay('2021')).toBe('2021')
    expect(formatDay('')).toBe('Undated')
  })
})
