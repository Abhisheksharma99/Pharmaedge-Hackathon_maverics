import { createContext, use, useEffect } from 'react'

/** The series a chart draws, as a table: what its card's "Download data" writes, and the PNG's colour key. */
export interface CardData {
  columns: string[]
  rows: (string | number)[][]
  /** Drawn under the chart in the PNG (the HTML legend isn't part of the chart's SVG). */
  legend?: { l: string; c: string }[]
}

/** Set by a ChartCard with a menu: its charts report what they draw. */
export const CardDataContext = createContext<((data: CardData | null) => void) | null>(null)

/** True inside a card's Expand dialog: charts draw larger. */
export const ChartExpanded = createContext(false)

/** Reports the chart's current (filtered) series to its card; a no-op outside a ChartCard with a menu. */
export function useCardData(data: CardData) {
  const report = use(CardDataContext)
  useEffect(() => {
    if (!report) return
    report(data)
    return () => report(null)
  })
}

/** A Gantt year fraction (`lib/dates` yearFraction) back to `YYYY-MM`; '' when unknown. */
export function fractionMonth(v: number): string {
  if (!Number.isFinite(v)) return ''
  const year = Math.floor(v)
  const days = (v - year) * 365
  // Late December runs past the year boundary (12 months of 30.4 days + the day): under 0.7 days in (Dec 31 lands at 0.4, Jan 1 at 1) is last December.
  if (days < 0.7) return `${year - 1}-12`
  const month = Math.min(12, Math.max(1, Math.floor((days - 0.999) / 30.4) + 1))
  return `${year}-${String(month).padStart(2, '0')}`
}
