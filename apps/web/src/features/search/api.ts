import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { toQueryString, type EventCategory } from '@/features/assets/api'
import { apiFetch } from '@/lib/api'
import { useDebouncedValue } from '@/lib/use-debounced-value'

export interface SearchAsset {
  id: string
  name: string
  kind: 'primary' | 'competitor'
  company: string | null
  competitorOf: string[]
}

export interface SearchEvent {
  id: string
  asset: string
  assetName: string
  title: string
  date: string
  category: EventCategory
  nct_id: string | null
}

export interface SearchResult {
  assets: SearchAsset[]
  events: SearchEvent[]
}

/** The API matches events (title or NCT id) from 2 characters; shorter queries aren't sent. */
export const SEARCH_MIN_CHARS = 2
/** The API rejects longer queries. */
const SEARCH_MAX_CHARS = 120

/** ⌘K search (GET /search), debounced 150 ms. */
export function useSearch(q: string) {
  const term = useDebouncedValue(q.trim().slice(0, SEARCH_MAX_CHARS), 150)
  return useQuery({
    queryKey: ['search', term],
    queryFn: () => apiFetch<SearchResult>(`/search${toQueryString({ q: term })}`),
    enabled: term.length >= SEARCH_MIN_CHARS,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}
