import type { JobStep } from './api'
import { recordsTotal, SOURCE_STEPS, sourceProgress } from './job-counters'

const step = (name: string, status: JobStep['status']): JobStep => ({
  name,
  label: name,
  status,
  counts: {},
  error: null,
  started_at: null,
  finished_at: null,
})

describe('job counters', () => {
  it('knows the twelve source steps of an onboarding', () => {
    expect(SOURCE_STEPS.size).toBe(12)
    expect(SOURCE_STEPS.has('regulatory')).toBe(true)
    expect(SOURCE_STEPS.has('journey')).toBe(false)
    expect(SOURCE_STEPS.has('finalize')).toBe(false)
  })

  it('counts only finished-and-done source steps against the sources in the plan', () => {
    const steps = [
      step('regulatory', 'done'),
      step('clinical', 'failed'),
      step('news', 'skipped'),
      step('patents', 'running'),
      step('journey', 'done'),
      step('finalize', 'pending'),
    ]
    expect(sourceProgress({ steps })).toEqual({ done: 1, total: 4 })
    expect(sourceProgress({ steps: [] })).toEqual({ done: 0, total: 0 })
  })

  it('adds up the records of every collection', () => {
    expect(recordsTotal({ records: [{ coll: 'fda_records', count: 44 }, { coll: 'trial_records', count: 74 }] })).toBe(118)
    expect(recordsTotal({ records: [] })).toBe(0)
  })
})
