import { isActive, type Job, type JobStep } from '@/features/jobs/api'
import { stepDuration } from '@/features/jobs/steps'
import { CATEGORIES } from '../constants'
import type { EventCategory, EventVia, JobFeedItem, JobProgress, JourneyEventV3 } from '../types'

/** done once the job has ended; planning while queued or before any step starts; running otherwise. */
export type BuildPhase = 'planning' | 'running' | 'done'

export function buildPhase(job: Pick<Job, 'status' | 'steps'>): BuildPhase {
  if (!isActive(job.status)) return 'done'
  return job.steps.some((s) => s.status !== 'pending') ? 'running' : 'planning'
}

export type Stage = 'Collect' | 'Build' | 'Expand' | 'Finalize'

/** Stage of each crawl step (design_files/aj/data.js STAGE); source steps not listed collect. */
const STEP_STAGE: Record<string, Stage> = {
  journey: 'Build',
  ai_triage: 'Build',
  ai_events: 'Build',
  index: 'Build',
  competitors: 'Expand',
  fda_calendar: 'Expand',
  patents: 'Expand',
  finalize: 'Finalize',
}

export const stepStage = (name: string): Stage => STEP_STAGE[name] ?? 'Collect'

export interface StageRun {
  stage: Stage
  /** Sum of the run's expected step durations (its width under the segmented bar). */
  grow: number
  /** Indexes of the run's first and last step. */
  first: number
  last: number
}

/** Stage labels under the segmented bar: one per run of consecutive steps in the same stage, so they line up with it. */
export function stageRuns(steps: Pick<JobStep, 'name'>[]): StageRun[] {
  const runs: StageRun[] = []
  steps.forEach((s, i) => {
    const stage = stepStage(s.name)
    const last = runs.at(-1)
    if (last && last.stage === stage) {
      last.grow += stepDuration(s.name)
      last.last = i
    } else runs.push({ stage, grow: stepDuration(s.name), first: i, last: i })
  })
  return runs
}

/** Records a finished source step stored (`new`, `*_new`, `*_updated` counts); competitors: how many it ranked. null until done. */
export function stepRecordCount(step: Pick<JobStep, 'name' | 'status' | 'counts'>): number | null {
  if (step.status !== 'done') return null
  if (step.name === 'competitors') return Number(step.counts.competitors) || 0
  return Object.entries(step.counts).reduce(
    (sum, [k, v]) => (k === 'new' || k.endsWith('_new') || k.endsWith('_updated') ? sum + (Number(v) || 0) : sum),
    0,
  )
}

/** AI triage outcome from its counts (`<collection>_ingest` kept, `<collection>_skip` dropped). */
export function triageCounts(counts: Record<string, number>): { kept: number; dropped: number } {
  let kept = 0
  let dropped = 0
  for (const [k, v] of Object.entries(counts)) {
    if (k.endsWith('_ingest')) kept += Number(v) || 0
    if (k.endsWith('_skip')) dropped += Number(v) || 0
  }
  return { kept, dropped }
}

/** "10:32" (minutes:seconds; minutes keep counting past an hour). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Seconds from an ISO time to `to` (epoch ms); 0 when the time is missing. */
export function secondsSince(fromIso: string | null | undefined, to: number): number {
  const from = Date.parse(fromIso ?? '')
  return Number.isNaN(from) ? 0 : Math.max(0, (to - from) / 1000)
}

/** Deterministic 0–1 from a string (FNV-1a), so a record tick keeps its place across polls. */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

export interface RecordTick {
  /** `coll:year:i`: stable while the bucket grows, so only new ticks animate in. */
  key: string
  coll: string
  /** Year fraction on the time axis. */
  at: number
  /** 0–1 vertical position in the records strip. */
  jitter: number
}

/**
 * Record ticks for the forming timeline from the per-year histogram (GET /jobs/:id `record_years`). Above `maxTicks`
 * records one tick stands for several, so the strip keeps its shape without drawing thousands of marks.
 */
export function recordTicks(recordYears: JobProgress['record_years'], maxTicks = 1200): RecordTick[] {
  const total = recordYears.reduce((sum, b) => sum + b.n, 0)
  const unit = Math.max(1, Math.ceil(total / maxTicks))
  const ticks: RecordTick[] = []
  for (const { coll, year, n } of recordYears) {
    for (let i = 0; i < Math.ceil(n / unit); i++) {
      const key = `${coll}:${year}:${i}`
      ticks.push({ key, coll, at: year + hash01(`${key}:x`) * 0.999, jitter: hash01(`${key}:y`) })
    }
  }
  return ticks
}

/** Time axis of the forming timeline: from 2000 (earlier when the data is, not before 1985) to 3–6 years past today. */
export function formingYears(years: number[], todayYear: number): { y0: number; y1: number } {
  const known = years.filter(Number.isFinite)
  const min = known.length ? Math.min(...known) : 2000
  const max = known.length ? Math.max(...known) : todayYear
  return {
    y0: Math.max(1985, Math.min(2000, Math.floor(min))),
    y1: Math.max(todayYear + 3, Math.min(todayYear + 6, Math.floor(max) + 1)),
  }
}

const sourceCount = (e: JourneyEventV3) => e.sources.length + (e.merged_sources?.length ?? 0)

/** How an event was built, for "Just added" (design_files/aj/live.jsx viaLabel). */
export function viaLabel(e: JourneyEventV3): string {
  const n = sourceCount(e)
  const coll = e.sources[0]?.collection
  if (e.via === 'user') return e.user?.mode === 'ai' ? `You + AI · ${n} sources` : 'Added by you'
  if (e.via === 'ai_events') return n > 1 ? `AI · merged ${n} records` : 'AI · 1 record'
  if (e.via === 'finalize') return coll ? `Rebuild · ${coll}` : 'Rebuild'
  return coll ? `Rule · ${coll}` : 'Rule'
}

/** The forming timeline's tooltip line under the title. */
export function tipVia(e: JourneyEventV3): string {
  const n = sourceCount(e)
  if (e.via === 'ai_events') return `AI · ${n} record${n === 1 ? '' : 's'}`
  return e.via === 'finalize' ? 'Journey rebuild' : 'Rule'
}

export function categoryCounts(events: Pick<JourneyEventV3, 'category'>[]): Record<EventCategory, number> {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<EventCategory, number>
  for (const e of events) if (e.category in counts) counts[e.category]++
  return counts
}

export function viaCounts(events: Pick<JourneyEventV3, 'via'>[]): Record<EventVia, number> {
  const counts: Record<EventVia, number> = { journey: 0, ai_events: 0, finalize: 0, user: 0 }
  for (const e of events) if (e.via in counts) counts[e.via]++
  return counts
}

/** Event ids announced by `event` lines, oldest first, once each. */
export function liveEventIds(items: JobFeedItem[]): string[] {
  const ids = new Set<string>()
  for (const item of items) if (item.kind === 'event' && item.event_id) ids.add(item.event_id)
  return [...ids]
}

/** Id of the newest `event` line (0 when there is none): the timeline refetches when it grows. */
export function lastEventLine(items: JobFeedItem[]): number {
  return items.reduce((max, item) => (item.kind === 'event' && item.id > max ? item.id : max), 0)
}

/** Events once each by id; the first occurrence wins. */
export function uniqueEvents(...lists: JourneyEventV3[][]): JourneyEventV3[] {
  const byId = new Map<string, JourneyEventV3>()
  for (const list of lists) for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e)
  return [...byId.values()]
}
