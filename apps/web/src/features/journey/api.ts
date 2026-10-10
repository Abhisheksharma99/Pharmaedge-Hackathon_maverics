import { keepPreviousData, useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { toQueryString, type RecordTab } from '@/features/assets/api'
import { ApiError, apiFetch } from '@/lib/api'
import type { Branch, JourneyEventV3 } from './types'

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
  /** The record's own fields, as its tab lists them (trial dates, patent term, application number…). */
  [field: string]: unknown
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
    // Prev/next keep the previous event of the same asset on screen until the next one arrives (the sheet never blanks).
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === assetId ? keepPreviousData(prev) : undefined),
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

/** "Key events" (spec §4.1) or every event. */
export type JourneyScope = 'key' | 'all'

export interface JourneyTimeline {
  events: JourneyEventV3[]
  total: number
}

/** The API caps `limit` at 5000; the largest journey today has ~1,300 events. */
const JOURNEY_LIMIT = 5000

/**
 * A journey scope with the team's notes merged (`include=notes`), newest first as the API sends it. No category,
 * significance or milestone filters are sent: the views filter on the client, so chip counts stay right. (Phase 3's
 * `useTimelineV3` sends neither `include=notes` nor a limit above the API's default 500, so the journey uses this.)
 */
export function useJourneyEvents(assetId: string, scope: JourneyScope, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['asset', assetId, 'timeline-v3', scope],
    queryFn: () =>
      apiFetch<JourneyTimeline>(`/assets/${encodeURIComponent(assetId)}/timeline?scope=${scope}&include=notes&limit=${JOURNEY_LIMIT}`),
    enabled,
    staleTime: 60_000,
    // Switching Key events ↔ All keeps the current journey on screen until the other scope arrives (no skeleton flash).
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === assetId ? keepPreviousData(prev) : undefined),
  })
}

/** Indication branches, trunk first; `[]` means a single trunk (DATA_CONTRACTS §B.1). */
export function useBranches(assetId: string) {
  return useQuery({
    queryKey: ['asset', assetId, 'branches'],
    queryFn: () => apiFetch<Branch[]>(`/assets/${encodeURIComponent(assetId)}/branches`),
    staleTime: 60_000,
  })
}

/**
 * Every event of the ended branches (scope=all), so each closed lane is capped where its programme stopped — the
 * branch docs carry no closure date. Idle when no branch has ended.
 */
export function useEndedBranchEvents(assetId: string, ended: string[]) {
  const ids = [...ended].sort()
  return useQuery({
    queryKey: ['asset', assetId, 'timeline-v3', 'ended', ids],
    queryFn: () =>
      apiFetch<JourneyTimeline>(`/assets/${encodeURIComponent(assetId)}/timeline${toQueryString({ scope: 'all', branch: ids, limit: JOURNEY_LIMIT })}`),
    enabled: ids.length > 0,
    staleTime: 60_000,
  })
}
