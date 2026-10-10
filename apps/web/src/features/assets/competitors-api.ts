import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Job } from '@/features/jobs/api'
import { toQueryString, type AssetSummary, type EventCategory, type Page, type RecordEventRef, type Significance } from './api'

export type Coverage = 'approved' | 'investigational' | 'none'

export interface LandscapeRow {
  id: string
  name: string
  company: string
  /** Brand names other than the generic name, joined with " · ". */
  brand?: string | null
  mechanism: string | null
  modality: string | null
  status: AssetSummary['status']
  isReference: boolean
  reason?: string
  basis?: 'indication' | 'mechanism' | 'both'
  stage?: 'approved' | 'phase3' | 'phase2' | 'other'
  coverage: Record<string, Coverage>
  otherIndications: string[]
  overlap: { shared: number; of: number }
  firstApproval: string | null
  approvalRegions: string[]
  activeTrials: number
  activePhase3: number
}

export interface Count {
  total: number
  /** Records dated within the last 365 days. */
  recent: number
}

export interface EvidenceRow {
  id: string
  name: string
  trials: Count
  publications: Count
  regulatory: Count
  /** News articles + press releases + conference abstracts. */
  news: Count
}

export interface EventSource {
  collection: string
  record_key: string
}

export interface CompetitorSignal {
  id: string
  assetId: string
  assetName: string
  date: string
  title: string
  type: string
  category: EventCategory
  significance: Significance
  sources: EventSource[]
}

export interface CompetitorMilestone extends CompetitorSignal {
  company: string
  indication: string | null
  phase: string | null
}

export interface CompetitorsOverview {
  reference: { id: string; name: string; company: string; mechanism: string | null; indications: string[] }
  kpis: {
    tracked: number
    candidates: number
    collecting: number
    activePhase3: number
    upcomingMilestones: number
    firstMilestone: string | null
  }
  landscape: LandscapeRow[]
  evidence: EvidenceRow[]
  signals: CompetitorSignal[]
  milestones: CompetitorMilestone[]
}

export type EvidenceSourceKey =
  | 'trials'
  | 'regulatory'
  | 'publications'
  | 'conferences'
  | 'pressReleases'
  | 'documents'
  | 'news'
  | 'patents'

export type Decision = 'ingest' | 'headline' | 'skip'

export interface EvidenceSummary {
  /** `recent` = dated within the last 90 days. */
  sources: { key: EvidenceSourceKey; label: string; total: number; recent: number }[]
  triage: {
    total: number
    ingest: number
    headline: number
    skip: number
    byCategory: { category: string; ingest: number; headline: number; skip: number }[]
  }
}

export interface LedgerRow {
  id: string
  title: string
  url: string
  date: string | null
  source: string
  collection: string
  decision: Decision
  category: string
  reason: string
  model: string
  decidedAt: string
  recordKey: string
  journey_events?: RecordEventRef[]
}

export interface LedgerQuery {
  decision?: Decision
  collection?: string
  category?: string
  q?: string
  page?: number
  pageSize?: number
}

const path = (id: string, rest: string) => `/assets/${encodeURIComponent(id)}/${rest}`

/** Competitive landscape for a primary asset. Polls while competitors are still being crawled. */
export function useCompetitors(id: string) {
  return useQuery({
    queryKey: ['asset', id, 'competitors'],
    queryFn: () => apiFetch<CompetitorsOverview>(path(id, 'competitors')),
    refetchInterval: (q) => (q.state.data?.landscape.some((r) => !r.isReference && r.status === 'onboarding') ? 15_000 : false),
  })
}

export function useEvidenceSummary(id: string) {
  return useQuery({
    queryKey: ['asset', id, 'evidence'],
    queryFn: () => apiFetch<EvidenceSummary>(path(id, 'evidence')),
  })
}

export function useLedger(id: string, query: LedgerQuery) {
  return useQuery({
    queryKey: ['asset', id, 'ledger', query],
    queryFn: () => apiFetch<Page<LedgerRow>>(path(id, `ledger${toQueryString(query)}`)),
    placeholderData: keepPreviousData,
  })
}

/** Runs only the crawl service's `competitors` step for an asset. */
export function useIdentifyCompetitors() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assetId: string) =>
      apiFetch<Job>(path(assetId, 'refresh'), { method: 'POST', body: { steps: ['competitors'] } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}
