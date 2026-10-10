import { interpolateDate, todayIso, yearFraction } from '@/lib/dates'

/** An event on a view's axis: its position (x in the horizontal track, y in the tree) and date. */
export interface DatedPoint {
  pos: number
  date: string
}

/** "2021" → "2021-01-01", "2021-03" → "2021-03-01"; a full date is unchanged. */
export function fullDate(iso: string): string {
  const [y, m = '01', d = '01'] = iso.slice(0, 10).split('-')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** Indices of the events just before and just after `pos` in ascending `positions` (-1 / length when none). */
export function neighbours(positions: number[], pos: number): [before: number, after: number] {
  let lo = 0
  let hi = positions.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (positions[mid]! > pos) hi = mid
    else lo = mid + 1
  }
  return [lo - 1, lo]
}

/**
 * Hover-to-add date (README §6.2 / §6.3): linear in year fraction between the events before (`a`) and after (`b`)
 * the pointer, then clamped to [a.date, b.date] so it always matches the neighbouring cards (the 28-day clamp of
 * `fromYearFraction` can otherwise step past them). Before the first event → its date; after the last → its date.
 */
export function hoverDate(a: DatedPoint | null, b: DatedPoint | null, pos: number, today: string = todayIso()): string {
  if (!a && !b) return today
  if (!a) return fullDate(b!.date)
  if (!b || b.pos <= a.pos || pos <= a.pos) return fullDate(a.date)
  const lo = fullDate(a.date)
  const hi = fullDate(b.date)
  const d = interpolateDate(yearFraction(a.date), yearFraction(b.date), (pos - a.pos) / (b.pos - a.pos))
  return d < lo ? lo : d > hi ? hi : d
}
