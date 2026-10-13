import type { MarketImpact } from '../api'

export type Range = '1y' | '5y' | 'all'
const YEARS: Record<Range, number | null> = { '1y': 1, '5y': 5, all: null }

export function rangeStart(range: Range, today = new Date()): string | null {
  const years = YEARS[range]
  if (years === null) return null
  const d = new Date(today)
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

/** The move that sums up the reaction: +5 trading days when measured, else day 0. */
export const headline = (i: MarketImpact) => i.day5 ?? i.day0
