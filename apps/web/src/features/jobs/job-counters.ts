import type { JobProgress } from '@/features/journey/types'
import type { Job } from './api'

/** Steps that collect from a source (the design's "Sources 9/12"); the journey build, triage, index and finalize are not sources. */
export const SOURCE_STEPS: ReadonlySet<string> = new Set([
  'regulatory',
  'ema_chmp',
  'clinical',
  'publications',
  'conferences',
  'company_site',
  'company_news',
  'news',
  'industry_news',
  'competitors',
  'fda_calendar',
  'patents',
])

/** Source steps done / source steps in the job's plan. A failed or skipped source is not done. */
export function sourceProgress(job: Pick<Job, 'steps'>): { done: number; total: number } {
  const sources = job.steps.filter((s) => SOURCE_STEPS.has(s.name))
  return { done: sources.filter((s) => s.status === 'done').length, total: sources.length }
}

/** Records in the asset's store so far (GET /jobs/:id `records`, measured after every step). */
export function recordsTotal(job: Pick<JobProgress, 'records'>): number {
  return job.records.reduce((sum, r) => sum + r.count, 0)
}
