import type { Job, JobStep } from './api'
import {
  currentStep,
  formatAgo,
  formatSince,
  heartbeat,
  jobDuration,
  jobProgress,
  jobStepLabel,
  progressShort,
  progressText,
  runningByAsset,
  STEP_META,
  stepDuration,
  stepFraction,
  stepShort,
  stepsFinished,
} from './steps'

const step = (name: string, status: JobStep['status']): JobStep => ({
  name,
  label: `${name} (detail)`,
  status,
  counts: {},
  error: null,
  started_at: null,
  finished_at: null,
})

const job = (id: string, asset: string, status: Job['status'], steps: JobStep[] = []): Job => ({
  id,
  asset,
  assetName: asset,
  type: 'onboard',
  status,
  steps,
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: null,
  finished_at: null,
})

// crawler/service/steps.py STEPS
const CRAWLER_STEPS = [
  'regulatory', 'fda_calendar', 'ema_chmp', 'clinical', 'publications', 'conferences', 'patents', 'company_site',
  'company_news', 'news', 'industry_news', 'journey', 'ai_triage', 'ai_events', 'index', 'competitors', 'finalize',
]

describe('step labels', () => {
  it('has a short label and a duration for every crawler step', () => {
    for (const name of CRAWLER_STEPS) expect(STEP_META[name], name).toBeDefined()
    expect(stepShort(step('regulatory', 'running'))).toBe('FDA · EMA')
    expect(stepShort({ name: 'new_source', label: 'New source (beta, AI-screened)' })).toBe('New source')
    expect(stepDuration('ai_events')).toBe(5)
    expect(stepDuration('new_source')).toBe(3)
  })
})

describe('job progress', () => {
  it('counts done, failed and skipped steps as finished', () => {
    const j = job('j1', 'trep', 'running', [
      step('regulatory', 'done'),
      step('clinical', 'failed'),
      step('news', 'skipped'),
      step('journey', 'running'),
      step('finalize', 'pending'),
    ])
    expect(stepsFinished(j)).toBe(3)
    expect(jobProgress(j)).toBeCloseTo(0.6)
    expect(currentStep(j)).toEqual({ step: j.steps[3], index: 3 })
    expect(jobStepLabel(j)).toBe('Rules engine')
  })

  it('reads "planning" before the first step and names the next step between two', () => {
    expect(jobProgress(job('j0', 'x', 'queued'))).toBe(0)
    expect(jobStepLabel(job('j0', 'x', 'queued', [step('regulatory', 'pending')]))).toBe('planning')
    expect(jobStepLabel(job('j2', 'x', 'running', [step('regulatory', 'done'), step('clinical', 'pending')]))).toBe('ClinicalTrials.gov')
    expect(jobStepLabel(job('j3', 'x', 'running', [step('regulatory', 'done')]))).toBe('finishing')
  })

  it('keeps the newest active job per asset', () => {
    const map = runningByAsset([job('new', 'trep', 'running'), job('old', 'trep', 'running'), job('done', 'sota', 'completed'), job('q', 'nint', 'queued')])
    expect([...map.keys()]).toEqual(['trep', 'nint'])
    expect(map.get('trep')?.id).toBe('new')
    expect(runningByAsset(undefined).size).toBe(0)
  })

  it('formats durations like the jobs page', () => {
    expect(jobDuration({ started_at: null, finished_at: null })).toBe('—')
    expect(jobDuration({ started_at: '2026-10-09T10:00:00Z', finished_at: '2026-10-09T10:00:42Z' })).toBe('42s')
    expect(jobDuration({ started_at: '2026-10-09T10:00:00Z', finished_at: null }, Date.parse('2026-10-09T10:03:05Z'))).toBe('3m 05s')
  })
})

describe('live step progress', () => {
  const NOW = Date.parse('2026-10-24T12:00:00Z')
  const live = (done: number, total: number | null, at = '2026-10-24T11:59:52Z', unit = 'pages checked', note: string | null = null) => ({
    ...step('fda_calendar', 'running'),
    progress: { done, total, unit, note, at },
  })

  it("adds the running step's fraction to the job when it reports a total", () => {
    const steps = [step('regulatory', 'done'), live(500, 1000), step('patents', 'pending'), step('finalize', 'pending')]
    expect(jobProgress(job('j', 'trep', 'running', steps))).toBeCloseTo(1.5 / 4)
    expect(jobProgress(job('j', 'trep', 'running', [step('regulatory', 'done'), live(1240, null)]))).toBe(0.5)
    expect(jobProgress(job('j', 'trep', 'running', [step('regulatory', 'done'), live(30, 20)]))).toBe(1) // never past the step
    expect(stepFraction(live(1, 4))).toBe(0.25)
    expect(stepFraction(step('journey', 'running'))).toBeNull()
  })

  it('formats the live count with its unit, total and note', () => {
    expect(progressText(live(1240, null, undefined, 'pages checked', '12 events found').progress)).toBe('1,240 pages checked · 12 events found')
    expect(progressText(live(1093, null, undefined, 'releases collected', 'back to 2018').progress)).toBe('1,093 releases collected · back to 2018')
    expect(progressText(live(512, 1800, undefined, 'records triaged').progress)).toBe('512 of 1,800 records triaged')
    expect(progressShort(live(1240, null).progress)).toBe('1,240 pages')
    expect(progressShort(live(512, 1800).progress)).toBe('512/1,800')
  })

  it('tells a step that is still moving from one that may be stalled', () => {
    expect(heartbeat(live(1, null), NOW)).toEqual({ seconds: 8, stalled: false })
    expect(heartbeat(live(1, null, '2026-10-24T11:54:00Z'), NOW)).toEqual({ seconds: 360, stalled: true })
    expect(heartbeat(step('journey', 'running'), NOW)).toBeNull() // steps without a live count are never "stalled"
    expect(formatAgo(1)).toBe('just now')
    expect(formatAgo(8)).toBe('8 s ago')
    expect(formatSince(360)).toBe('6 min')
    expect(formatSince(3900)).toBe('1 h 05 min')
  })
})
