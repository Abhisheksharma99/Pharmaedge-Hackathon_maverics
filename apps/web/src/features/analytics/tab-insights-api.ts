import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { RecordTab } from '@/features/assets/api'

/** The tabs that have an insights row; Evidence is its own tab over the AI triage ledger. */
export type InsightsTab = Exclude<RecordTab, 'news'> | 'evidence'

export interface Counted {
  value: string
  n: number
}

/** `GET /assets/:id/records/:tab/insights` (DC §B.4). Tab-specific fields are present for their tab only. */
export interface TabInsightsData {
  tab: string
  total: number
  byYear: { year: number; n: number }[]
  byYearGroup: { year: number; group: string; n: number }[]
  facets: Record<string, Counted[]>
  /** Documents: the longest documents. */
  top?: { title: string; pages: number }[]
  /** Patents: grant → expiry per patent. */
  terms?: { number: string; title: string; granted?: string; expiry: string; status?: string; assignee?: string }[]
  /** Evidence: the AI triage funnel. */
  triage?: { screened: number; relevant: number; ingested: number; journey: number }
}

export function useTabInsights(assetId: string, tab: InsightsTab) {
  return useQuery({
    queryKey: ['asset', assetId, 'insights', tab],
    queryFn: () => apiFetch<TabInsightsData>(`/assets/${encodeURIComponent(assetId)}/records/${tab}/insights`),
    staleTime: 60_000,
  })
}
