import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toQueryString } from '@/features/assets/api'
import type { JobProgress } from '@/features/journey/types'

export type JobStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface JobStep {
  name: string
  label: string
  status: StepStatus
  counts: Record<string, number>
  error: string | null
  started_at: string | null
  finished_at: string | null
}

export interface Job {
  id: string
  asset: string
  assetName?: string
  type: 'refresh' | 'onboard' | 'competitor'
  status: JobStatus
  steps: JobStep[]
  cancel_requested: boolean
  requested_by: { id: string; name: string } | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export const isActive = (s: JobStatus) => s === 'queued' || s === 'running'

/** Poll fast while something is running, slowly otherwise. */
const pollInterval = (active: boolean) => (active ? 2000 : 15000)

export function useJobs(filters: { asset?: string; status?: JobStatus; limit?: number } = {}) {
  return useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => apiFetch<Job[]>(`/jobs${toQueryString(filters)}`),
    refetchInterval: (q) => pollInterval(!!q.state.data?.some((j) => isActive(j.status))),
  })
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ['job', id],
    queryFn: () => apiFetch<Job>(`/jobs/${encodeURIComponent(id)}`),
    refetchInterval: (q) => (q.state.data && !isActive(q.state.data.status) ? false : 2000),
  })
}

export function useRefreshAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assetId: string) => apiFetch<Job>(`/assets/${encodeURIComponent(assetId)}/refresh`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export function useCancelJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => apiFetch<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      qc.invalidateQueries({ queryKey: ['job', job.id] })
    },
  })
}

/**
 * A job with its live-build counters (GET /jobs/:id: records per collection, events created, record years).
 * Shares the ['job', id] cache with useJob; polls every 2 s while active. Idle while `id` is null.
 */
export function useJobProgress(id: string | null) {
  return useQuery({
    queryKey: ['job', id],
    queryFn: () => apiFetch<JobProgress>(`/jobs/${encodeURIComponent(id!)}`),
    enabled: id !== null,
    refetchInterval: (q) => (q.state.data && !isActive(q.state.data.status) ? false : 2000),
  })
}
