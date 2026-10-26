import type { JourneyEventV3 } from '@/features/journey/types'
import { daysBetween } from '@/lib/dates'
import type { PortfolioEvent, PortfolioTimeline } from './api'

export interface EventGroup {
  label: string
  events: JourneyEventV3[]
}

export interface HomeCounts {
  /** Events dated in the last 30 days, and how many of them are High. */
  new30: number
  high30: number
  new90: number
  /** Expected milestones in the next 6 and 12 months. */
  next6m: number
  next12m: number
}

const BANDS: [label: string, from: number, to: number][] = [
  ['Last 7 days', 0, 7],
  ['Last 30 days', 8, 30],
  ['Last 90 days', 31, 90],
]

/** Days from `today` to the event (negative = past); NaN when undated, so every comparison is false. */
const offset = (e: { date: string }, today: string) => daysBetween(today, e.date)

/** "What changed": past High and Medium events of the last 90 days, newest first, grouped Last 7 / 30 / 90 days. */
export function whatChanged(events: JourneyEventV3[], today: string): EventGroup[] {
  const recent = events
    .map((e) => ({ e, ago: -offset(e, today) }))
    .filter(({ e, ago }) => ago >= 0 && ago <= 90 && !e.is_milestone && e.significance !== 'Low')
    .sort((a, b) => a.ago - b.ago)
  return BANDS.map(([label, from, to]) => ({ label, events: recent.filter((r) => r.ago >= from && r.ago <= to).map((r) => r.e) })).filter(
    (g) => g.events.length > 0,
  )
}

/** Expected milestones from today on, soonest first. */
export function upcomingMilestones(events: JourneyEventV3[], today: string, limit = 6): JourneyEventV3[] {
  return events
    .filter((e) => e.is_milestone && offset(e, today) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
}

/** The hero sentence and KPI strip numbers, over the same events the Home timeline shows. */
export function homeCounts(events: JourneyEventV3[], today: string): HomeCounts {
  const counts: HomeCounts = { new30: 0, high30: 0, new90: 0, next6m: 0, next12m: 0 }
  for (const e of events) {
    const d = offset(e, today)
    if (!Number.isFinite(d)) continue
    if (e.is_milestone) {
      if (d >= 0 && d <= 183) counts.next6m++
      if (d >= 0 && d <= 365) counts.next12m++
    } else if (d <= 0) {
      if (d >= -30) {
        counts.new30++
        if (e.significance === 'High') counts.high30++
      }
      if (d >= -90) counts.new90++
    }
  }
  return counts
}

/** Competitor moves: key events of the last 12 months (newest first), then milestones due in the next 12 months (soonest first). */
export function competitorMoves(events: JourneyEventV3[], isCompetitor: (assetId: string) => boolean, today: string, limit = 8): JourneyEventV3[] {
  const mine = events.filter((e) => isCompetitor(e.asset)).map((e) => ({ e, d: offset(e, today) }))
  const recent = mine.filter(({ e, d }) => !e.is_milestone && d <= 0 && d >= -365).sort((a, b) => b.d - a.d)
  const upcoming = mine.filter(({ e, d }) => e.is_milestone && d >= 0 && d <= 365).sort((a, b) => a.d - b.d)
  return [...recent, ...upcoming].slice(0, limit).map((r) => r.e)
}

/** Width (%) of a milestone's proximity bar: full today, 4% at 18 months or more. */
export function proximity(days: number): number {
  return Math.min(100, Math.max(4, 100 - (days / 548) * 100))
}

/**
 * The portfolio limited to a watchlist: watched primaries, and the competitors that are watched or compete with a
 * watched primary (their moves are what a watcher wants to see), with those assets' events. `null` keeps everything.
 */
export function scopePortfolio(data: PortfolioTimeline, watched: ReadonlySet<string> | null): PortfolioTimeline {
  if (!watched) return data
  const assets = data.assets.filter((a) => watched.has(a.id) || (a.kind === 'competitor' && a.competitorOf.some((p) => watched.has(p))))
  const keep = new Set(assets.map((a) => a.id))
  return { assets, events: data.events.filter((e) => keep.has(e.asset)) }
}

/** Stored after the previous Home visit `since` (ISO); false without either time. */
export function isNewSince(e: PortfolioEvent, since: string | null): boolean {
  return !!since && !!e.first_seen && Date.parse(e.first_seen) > Date.parse(since)
}

/** Events stored since the previous visit, newest-dated first, and how many assets they touch. */
export function newSince(events: PortfolioEvent[], since: string | null): { events: PortfolioEvent[]; assets: number } {
  const fresh = events.filter((e) => isNewSince(e, since)).sort((a, b) => b.date.localeCompare(a.date))
  return { events: fresh, assets: new Set(fresh.map((e) => e.asset)).size }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A past visit in local time: "14:05 today", "Tue 14:05" within the week, else "Oct 2, 14:05". */
export function formatVisit(iso: string, now: Date): string {
  const d = new Date(iso)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === now.toDateString()) return `${time} today`
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (d.getTime() >= midnight - 6 * 86_400_000) return `${WEEKDAYS[d.getDay()]} ${time}`
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${time}`
}
