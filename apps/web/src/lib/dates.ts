export { formatDate, formatMonth } from './format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000
const ISO = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/

/** Today in local time, `YYYY-MM-DD`. */
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "2002-05-21" → 2002.39 (the design's formula: `y + ((m-1)·30.4 + d)/365`). Partial dates start the period; NaN when not a date. */
export function yearFraction(iso: string | null | undefined): number {
  const m = ISO.exec(iso ?? '')
  if (!m) return NaN
  const month = Number(m[2] ?? 1)
  const day = Number(m[3] ?? 1)
  return Number(m[1]) + ((month - 1) * 30.4 + day) / 365
}

export const clampDay = (d: number) => Math.min(28, Math.max(1, d))

/** Inverse of `yearFraction` for hover-to-add: the day is clamped to 1–28 so every month is valid. */
export function fromYearFraction(f: number): string {
  const year = Math.floor(f)
  const mf = (f - year) * 12
  const month = Math.min(12, Math.max(1, Math.floor(mf) + 1))
  const day = clampDay(Math.round((mf - (month - 1)) * 28) + 1)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The date a fraction `t` (0–1) of the way from year fraction `fa` to `fb`. */
export function interpolateDate(fa: number, fb: number, t: number): string {
  const k = Math.min(1, Math.max(0, t))
  return fromYearFraction(fa + k * (fb - fa))
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY_MS)
}

/** Countdown copy: "in 12 days", "in 9 months", "in 1.6 years"; past dates read "… ago". */
export function relativeFuture(iso: string, today: string = todayIso()): string {
  if (!ISO.test(iso)) return ''
  const days = daysBetween(today, iso)
  if (Number.isNaN(days)) return ''
  if (days === 0) return 'today'
  const n = Math.abs(days)
  const months = Math.round(n / 30.4)
  const span = n < 45 ? `${n} day${n === 1 ? '' : 's'}` : months < 18 ? `${months} months` : `${(n / 365).toFixed(1)} years`
  return days > 0 ? `in ${span}` : `${span} ago`
}

/** "2002-05-21" → "May 21, 2002"; "2021-03" → "Mar 2021"; "" → "Undated". Never shifts by timezone. */
export function formatDay(iso: string | null | undefined): string {
  const m = ISO.exec(iso ?? '')
  if (!m) return 'Undated'
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : undefined
  if (!month) return m[1]!
  return m[3] ? `${month} ${Number(m[3])}, ${m[1]}` : `${month} ${m[1]}`
}
