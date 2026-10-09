import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { toQueryString, type RecordTab } from '@/features/assets/api'
import { ApiError, apiFetch } from '@/lib/api'
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

export interface TimelineV3Query {
  /** key = the curated key events (spec §4.1); all (the API default) = everything. */
  scope?: 'key' | 'all'
  limit?: number
}

/**
 * GET /assets/:id/timeline with the v3 fields (branch, via, key, …). The API caches it per asset data version, which
 * the crawler bumps when a job ends: during a crawl it returns what was cached before.
 */
export function useTimelineV3(assetId: string, query: TimelineV3Query = {}) {
  return useQuery({
    queryKey: ['asset', assetId, 'timeline-v3', query],
    queryFn: () =>
      apiFetch<{ events: JourneyEventV3[]; total: number }>(`/assets/${encodeURIComponent(assetId)}/timeline${toQueryString(query)}`),
  })
}

const gone = (r: UseQueryResult<EventDetail>) => r.error instanceof ApiError && r.error.status === 404
const loadedEvents = (results: UseQueryResult<EventDetail>[]) => results.flatMap((r) => (r.data && !gone(r) ? [r.data.event] : []))

/** Several events by id (uncached on the API, sharing useEvent's cache here), in the order given; ids that fail (or 404 after loading) are left out. */
export function useEventsById(assetId: string, ids: string[]): JourneyEventV3[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['asset', assetId, 'event', id],
      queryFn: () => apiFetch<EventDetail>(`/assets/${encodeURIComponent(assetId)}/events/${encodeURIComponent(id)}`),
      staleTime: Infinity,
    })),
    combine: loadedEvents,
  })
}
