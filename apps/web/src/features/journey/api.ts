import { useQuery } from '@tanstack/react-query'
import type { RecordTab } from '@/features/assets/api'
import { apiFetch } from '@/lib/api'
import type { JourneyEventV3 } from './types'

/** A source record of an event, resolved for the evidence list. */
export interface EventRecord {
  collection: string
  key: string
  /** The asset tab the record opens in; null for sources without a tab (web pages). */
  tab: RecordTab | null
  title: string
  date: string
  url: string | null
  record_type: string | null
  source: string | null
}

export interface EventBrief {
  id: string
  title: string
  date: string
}

/** GET /assets/:id/events/:eventId (DATA_CONTRACTS §B.1). */
export interface EventDetail {
  event: JourneyEventV3
  records: EventRecord[]
  neighbors: { prev: EventBrief | null; next: EventBrief | null }
  branchStats: { index: number; total: number; prevSameBranch: EventBrief | null }
}

/** One journey event with its evidence. Event ids contain ':' and '/', so they are URL-encoded. Idle while `eventId` is null. */
export function useEvent(assetId: string, eventId: string | null) {
  return useQuery({
    queryKey: ['asset', assetId, 'event', eventId],
    queryFn: () => apiFetch<EventDetail>(`/assets/${encodeURIComponent(assetId)}/events/${encodeURIComponent(eventId!)}`),
    enabled: eventId !== null,
  })
}
