import type { EventCategory } from '@/features/assets/api'
import type { StoryEvent } from './api'

export const CATEGORY_COLOR: Record<EventCategory, string> = {
  regulatory: '#2347D9',
  clinical: '#08916F',
  company: '#E0620F',
  ip: '#7A5AF8',
}
export const CATEGORY_LABEL: Record<EventCategory, string> = {
  regulatory: 'Regulatory',
  clinical: 'Clinical',
  company: 'Company',
  ip: 'Patents',
}

const CLUSTER_PX = 16 // marks closer than this become one count bubble

/** What badge an event carries, if any: the check outranks the change. */
export function eventFlag(e: StoryEvent): { label: string; tone: 'new' | 'moved' | 'updated' | 'check' } | null {
  if (e.verification?.status === 'unconfirmed') return { label: 'Unconfirmed', tone: 'check' }
  if (e.verification?.status === 'conflict') return { label: 'Conflict', tone: 'check' }
  if (!e.change) return null
  if (e.change.kind === 'added') return { label: 'New', tone: 'new' }
  if (e.change.field === 'date' || e.change.field === 'expected_date') return { label: 'Date moved', tone: 'moved' }
  return { label: 'Updated', tone: 'updated' }
}

/** Events whose marks would overlap (closer than CLUSTER_PX) grouped, in date order. */
export function clusterEvents(events: StoryEvent[], x: (d: string) => number): { x: number; events: StoryEvent[] }[] {
  const out: { x: number; events: StoryEvent[] }[] = []
  for (const e of events) {
    const ex = x(e.date)
    const last = out.at(-1)
    if (last && ex - last.x < CLUSTER_PX) last.events.push(e)
    else out.push({ x: ex, events: [e] })
  }
  return out
}
