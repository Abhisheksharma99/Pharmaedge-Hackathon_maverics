import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import type { AnalyticsPin, AnalyticsSpec } from '@/features/journey/types'

const enc = encodeURIComponent
const base = (assetId: string) => ['asset', assetId, 'analytics'] as const
export const analyticsKey = (assetId: string) => base(assetId)
export const pinsKey = (assetId: string) => [...base(assetId), 'pins'] as const
export const suggestionsKey = (assetId: string) => [...base(assetId), 'suggestions'] as const
export const buildRunKey = (assetId: string, runId: string) => [...base(assetId), 'build', runId] as const

/** GET /assets/:id/analytics blocks (DATA_CONTRACTS §B.4; shapes from apps/api analytics.blocks.ts). */
export interface PipelineRow {
  id: string
  label: string
  full: string
  color: string | null
  ended: string | null
  /** 0 Phase 1 … 4 Approved. */
  stage: number
  n: number
  next: { id: string; title: string; date: string } | null
  since: string | null
}

export interface AnalyticsTrial {
  nct: string
  name: string
  title: string
  phase: string
  status: string
  start: string
  pcd: string
  enrollment: number
  indication: string
  company: boolean
  active: boolean
}

export interface AnalyticsPatent {
  number: string
  title: string
  /** First (current) assignee; shown under the number on the runway chart. */
  assignee?: string
  granted: string
  expiry: string
  status: string
  invalidated: boolean
  expired: boolean
}

export interface AnalyticsLandscapeRow {
  id: string | null
  name: string
  company: string | null
  me: boolean
  cells: Record<string, 'approved' | 'investigational' | 'none'>
}

export interface AssetAnalytics {
  pipeline: PipelineRow[]
  activityByYear: { cols: number[]; series: { k: string; l: string; vals: number[] }[] }
  trials: AnalyticsTrial[]
  recordsByYear: { coll: string; year: number; n: number }[]
  sourceMix: { coll: string; n: number }[]
  triageFunnel: { screened: number; relevant: number; ingested: number; candidates: number; journey: number }
  patents: AnalyticsPatent[]
  landscape: { cols: string[]; rows: AnalyticsLandscapeRow[] }
  significance: { High: number; Medium: number; Low: number }
  stats: {
    approvedIndications: number
    inDevelopment: string[]
    activeTrials: number
    phase3: number
    patients: number
    nextCatalyst: { id: string; title: string; date: string } | null
    patentRunwayYears: number | null
    evidenceRecords: number
  }
}

/** The `/analytics` blocks the Overview cards render from (same shape as the Analytics tab's). */
export type AnalyticsBlocks = AssetAnalytics

export interface AnalyticsSuggestion {
  id: string
  title: string
  why: string
  src: 'index' | 'web' | 'limited'
  records: number
  sources?: string[]
}

export interface BuildRun {
  steps: { label: string; status: string }[]
  /** Optional overall state; 'failed' / 'error' (or 'done' without a result) means the run ended with nothing to show. */
  status?: string
  result?: AnalyticsSpec
}

/** True once a run is over without a result (so polling stops and the UI shows 'Not available'). */
export function runEndedEmpty(run: BuildRun | undefined): boolean {
  if (!run || run.result) return false
  return (
    run.status === 'failed' ||
    run.status === 'error' ||
    run.status === 'done' ||
    run.steps.some((s) => s.status === 'failed' || s.status === 'error')
  )
}

/** Precomputed analytics blocks of an asset (Analytics tab + Overview cards). */
export function useAssetAnalytics(assetId: string) {
  return useQuery({
    queryKey: analyticsKey(assetId),
    queryFn: () => apiFetch<AssetAnalytics>(`/assets/${enc(assetId)}/analytics`),
    staleTime: 60_000,
  })
}

/** Your pinned cards; `items` is null until you first change them (then the defaults apply). */
export function useAnalyticsPins(assetId: string) {
  return useQuery({
    queryKey: pinsKey(assetId),
    queryFn: () => apiFetch<{ items: AnalyticsPin[] | null }>(`/assets/${enc(assetId)}/analytics/pins`),
    staleTime: 60_000,
  })
}

/** Save the whole pin list: the cards change at once and change back with a toast if the save fails. */
export function useSavePins(assetId: string) {
  const qc = useQueryClient()
  const key = pinsKey(assetId)
  return useMutation({
    mutationFn: (items: AnalyticsPin[]) =>
      apiFetch<{ items: AnalyticsPin[] }>(`/assets/${enc(assetId)}/analytics/pins`, { method: 'PUT', body: { items } }),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<{ items: AnalyticsPin[] | null }>(key)
      qc.setQueryData(key, { items })
      return { prev }
    },
    onError: (_err, _items, ctx) => {
      qc.setQueryData(key, ctx?.prev)
      toast.error("The pinned analytics couldn't be saved.")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

export function useAnalyticsSuggestions(assetId: string) {
  return useQuery({
    queryKey: suggestionsKey(assetId),
    queryFn: () => apiFetch<AnalyticsSuggestion[]>(`/assets/${enc(assetId)}/analytics/suggestions`),
    staleTime: 60_000,
  })
}

/** Start a build from a free-text request or a suggestion id; answers `{ runId }`. */
export function useBuildAnalytics(assetId: string) {
  return useMutation({
    mutationFn: (input: { request: string } | { suggestion: string }) =>
      apiFetch<{ runId: string }>(`/assets/${enc(assetId)}/analytics/build`, {
        method: 'POST',
        body: input,
      }),
  })
}

/** Poll a build run every second until its result arrives, it ends empty, or polling fails three times (backing off). */
export function useBuildRun(assetId: string, runId: string | null) {
  return useQuery({
    queryKey: buildRunKey(assetId, runId ?? ''),
    queryFn: () => apiFetch<BuildRun>(`/assets/${enc(assetId)}/analytics/build/${enc(runId ?? '')}`),
    enabled: !!runId,
    staleTime: 0,
    gcTime: 0,
    retry: 2,
    retryDelay: (n) => 1000 * 2 ** n,
    refetchInterval: (q) => (q.state.data?.result || runEndedEmpty(q.state.data) || q.state.status === 'error' ? false : 1000),
  })
}
