import type { JourneyEventV3 } from '@/features/journey/types'
import { daysBetween } from '@/lib/dates'

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

/** Dated events of competitor assets, newest first. */
export function competitorMoves(events: JourneyEventV3[], isCompetitor: (assetId: string) => boolean, limit = 8): JourneyEventV3[] {
  return events
    .filter((e) => isCompetitor(e.asset) && /^\d{4}/.test(e.date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}

/** Width (%) of a milestone's proximity bar: full today, 4% at 18 months or more. */
export function proximity(days: number): number {
  return Math.min(100, Math.max(4, 100 - (days / 548) * 100))
}
