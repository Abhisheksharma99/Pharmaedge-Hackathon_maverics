import { formatDay } from '@/lib/dates'
import { formatMonth } from '@/lib/format'
import type { JourneyEventV3 } from './types'

/** Card / sheet date: "May 21, 2002"; milestones read "Expected Mar 2027" (`short`: "Exp. Mar 2027"). */
export function eventDate(e: Pick<JourneyEventV3, 'date' | 'is_milestone'>, { short = false, day = false } = {}): string {
  if (!e.is_milestone) return formatDay(e.date)
  return `${short ? 'Exp.' : 'Expected'} ${day ? formatDay(e.date) : formatMonth(e.date)}`
}
