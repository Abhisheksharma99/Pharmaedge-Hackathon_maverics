import type { Significance } from '@/features/journey/types'

export type PortfolioRange = '1y' | '3y' | 'all'

export const RANGE_OPTIONS: { value: PortfolioRange; label: string }[] = [
  { value: '1y', label: '±1 year' },
  { value: '3y', label: '3 years' },
  { value: 'all', label: 'All time' },
]

/** Dot radius by significance (README §5.2). */
export const DOT_RADIUS: Record<Significance, number> = { High: 6.5, Medium: 5, Low: 3.6 }

const QUARTERS = ['Jan', 'Apr', 'Jul', 'Oct']

/**
 * Visible span in year fractions around `today`: ±1 year → [T−1, T+1.15], 3 years → [T−3, T+1.6] (the design's
 * windows); all time → every dated event, starting in 2000 at the latest and ending at least two years ahead.
 */
export function rangeBounds(range: PortfolioRange, today: number, dates: number[]): [number, number] {
  if (range === '1y') return [today - 1, today + 1.15]
  if (range === '3y') return [today - 3, today + 1.6]
  const finite = dates.filter(Number.isFinite)
  const from = Math.min(2000, ...finite.map((d) => Math.floor(d)))
  const to = Math.max(Math.ceil(today + 2), ...finite.map((d) => Math.ceil(d + 0.5)))
  return [from, to]
}

/** Axis ticks: quarters ("Jan ’26") for ±1 year, years for 3 years, every 2 or 4 years for all time. */
export function rangeTicks(range: PortfolioRange, y0: number, y1: number): { v: number; label: string }[] {
  const ticks: { v: number; label: string }[] = []
  if (range === '1y') {
    for (let q = Math.ceil(y0 * 4); q / 4 <= y1; q++) {
      ticks.push({ v: q / 4, label: `${QUARTERS[((q % 4) + 4) % 4]} ’${String(Math.floor(q / 4)).slice(2)}` })
    }
    return ticks
  }
  const step = range === '3y' ? 1 : y1 - y0 > 24 ? 4 : 2
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) ticks.push({ v: y, label: String(y) })
  return ticks
}
