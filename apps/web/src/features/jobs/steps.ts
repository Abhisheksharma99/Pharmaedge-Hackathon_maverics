import { isActive, type Job, type JobStep } from './api'

/**
 * Short label and expected relative duration of each crawl step (design: aj/data.js STEPS; crawler:
 * service/steps.py LABELS). The duration sizes the step's segment in the segmented bar.
 */
export const STEP_META: Record<string, { short: string; dur: number }> = {
  regulatory: { short: 'FDA · EMA', dur: 4 },
  ema_chmp: { short: 'EMA CHMP', dur: 2.5 },
  clinical: { short: 'ClinicalTrials.gov', dur: 4 },
  publications: { short: 'PubMed', dur: 4 },
  conferences: { short: 'ERS · ATS · CHEST', dur: 3 },
  company_site: { short: 'Company website', dur: 3 },
  company_news: { short: 'Newsroom', dur: 3.5 },
  news: { short: 'Newswires · Bing', dur: 4 },
  industry_news: { short: 'Industry news', dur: 3 },
  journey: { short: 'Rules engine', dur: 3.5 },
  ai_triage: { short: 'AI triage', dur: 4 },
  ai_events: { short: 'Event extraction', dur: 5 },
  index: { short: 'Search index', dur: 3 },
  competitors: { short: 'Competitors', dur: 4 },
  fda_calendar: { short: 'FDA calendar', dur: 2.5 },
  patents: { short: 'Patents', dur: 4 },
  finalize: { short: 'Finalize', dur: 3 },
}

const DEFAULT_DURATION = 3

/** "FDA · EMA" for regulatory; an unknown step uses its label without the parenthesised detail. */
export function stepShort(step: Pick<JobStep, 'name' | 'label'>): string {
  return STEP_META[step.name]?.short ?? step.label.replace(/\s*\(.*\)\s*$/, '')
}

export function stepDuration(name: string): number {
  return STEP_META[name]?.dur ?? DEFAULT_DURATION
}

/** Steps no longer pending or running (done, failed or skipped). */
export function stepsFinished(job: Pick<Job, 'steps'>): number {
  return job.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length
}

/** Share of finished steps, 0–1 (0 for a job without steps). */
export function jobProgress(job: Pick<Job, 'steps'>): number {
  return job.steps.length ? stepsFinished(job) / job.steps.length : 0
}

export function currentStep(job: Pick<Job, 'steps'>): { step: JobStep; index: number } | null {
  const index = job.steps.findIndex((s) => s.status === 'running')
  return index < 0 ? null : { step: job.steps[index], index }
}

/** What a crawl is doing now: the running step, "planning" before any step, the next step between two. */
export function jobStepLabel(job: Pick<Job, 'steps'>): string {
  const current = currentStep(job)
  if (current) return stepShort(current.step)
  if (stepsFinished(job) === 0) return 'planning'
  const next = job.steps.find((s) => s.status === 'pending')
  return next ? stepShort(next) : 'finishing'
}

/** The newest queued or running job per asset (`/jobs` lists newest first). */
export function runningByAsset(jobs: Job[] | undefined): Map<string, Job> {
  const byAsset = new Map<string, Job>()
  for (const job of jobs ?? []) if (isActive(job.status) && !byAsset.has(job.asset)) byAsset.set(job.asset, job)
  return byAsset
}

/** "42s", "3m 05s"; "—" before the job starts; a running job counts up to `now`. */
export function jobDuration(job: Pick<Job, 'started_at' | 'finished_at'>, now: number = Date.now()): string {
  if (!job.started_at) return '—'
  const end = job.finished_at ? Date.parse(job.finished_at) : now
  const secs = Math.max(0, Math.round((end - Date.parse(job.started_at)) / 1000))
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
}
