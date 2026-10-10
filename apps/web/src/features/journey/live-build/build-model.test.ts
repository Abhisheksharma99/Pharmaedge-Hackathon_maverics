import type { JobStep } from '@/features/jobs/api'
import type { JobFeedItem, JourneyEventV3 } from '../types'
import {
  buildPhase,
  categoryCounts,
  formatClock,
  formingYears,
  lastEventLine,
  liveEventIds,
  recordTicks,
  secondsSince,
  stageRuns,
  stepRecordCount,
  stepStage,
  tipVia,
  triageCounts,
  uniqueEvents,
  viaCounts,
  viaLabel,
} from './build-model'

const step = (name: string, status: JobStep['status'], counts: Record<string, number> = {}): JobStep => ({
  name,
  label: name,
  status,
  counts,
  error: null,
  started_at: null,
  finished_at: null,
})

const event = (id: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date: '2021-04-01',
  type: 'approval',
  category: 'regulatory',
  title: `Event ${id}`,
  significance: 'High',
  is_milestone: false,
  sources: [{ collection: 'fda_records', record_key: 'NDA1' }],
  via: 'journey',
  ...extra,
})

const feedLine = (id: number, kind: JobFeedItem['kind'], event_id?: string): JobFeedItem => ({
  id,
  t: '2026-10-09T10:00:00Z',
  step: 'journey',
  kind,
  text: `line ${id}`,
  ...(event_id && { event_id }),
})

describe('build phase and stages', () => {
  it('plans while queued or before any step starts, runs, then is done whatever the outcome', () => {
    expect(buildPhase({ status: 'queued', steps: [step('regulatory', 'pending')] })).toBe('planning')
    expect(buildPhase({ status: 'running', steps: [step('regulatory', 'pending')] })).toBe('planning')
    expect(buildPhase({ status: 'running', steps: [step('regulatory', 'running')] })).toBe('running')
    expect(buildPhase({ status: 'running', steps: [step('regulatory', 'done'), step('journey', 'pending')] })).toBe('running')
    for (const status of ['completed', 'completed_with_errors', 'failed', 'cancelled'] as const) {
      expect(buildPhase({ status, steps: [] })).toBe('done')
    }
  })

  it('groups consecutive steps of a stage, sized by their expected durations', () => {
    expect(stepStage('clinical')).toBe('Collect')
    expect(stepStage('patents')).toBe('Expand')
    expect(stepStage('something_new')).toBe('Collect')
    const runs = stageRuns(['regulatory', 'clinical', 'journey', 'ai_events', 'patents', 'finalize'].map((n) => step(n, 'pending')))
    expect(runs).toEqual([
      { stage: 'Collect', grow: 8, first: 0, last: 1 },
      { stage: 'Build', grow: 8.5, first: 2, last: 3 },
      { stage: 'Expand', grow: 4, first: 4, last: 4 },
      { stage: 'Finalize', grow: 3, first: 5, last: 5 },
    ])
    // the refresh plan interleaves stages: each run gets its own label
    expect(stageRuns(['regulatory', 'fda_calendar', 'ema_chmp'].map((n) => step(n, 'pending'))).map((r) => r.stage)).toEqual([
      'Collect',
      'Expand',
      'Collect',
    ])
  })
})

describe('step counts', () => {
  it('counts the records a finished source step stored', () => {
    expect(stepRecordCount(step('regulatory', 'done', { fda_new: 40, fda_updated: 4, ema_new: 12, ema_updated: 0 }))).toBe(56)
    expect(stepRecordCount(step('clinical', 'done', { trials_new: 3, trials_updated: 71 }))).toBe(74)
    expect(stepRecordCount(step('ema_chmp', 'done', { new: 6, ema_chmp_opinion: 3 }))).toBe(6)
    expect(stepRecordCount(step('competitors', 'done', { competitors: 5, jobs_started: 2 }))).toBe(5)
    expect(stepRecordCount(step('regulatory', 'running', { fda_new: 40 }))).toBeNull()
    expect(stepRecordCount(step('regulatory', 'failed'))).toBeNull()
  })

  it('reads the triage outcome', () => {
    expect(triageCounts({ articles_ingest: 50, publication_records_ingest: 24, articles_skip: 100, conference_records_skip: 12, articles_headline: 9 })).toEqual({
      kept: 74,
      dropped: 112,
    })
  })

  it('formats clocks and elapsed time', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(632.4)).toBe('10:32')
    expect(formatClock(3725)).toBe('62:05')
    expect(formatClock(-5)).toBe('00:00')
    expect(secondsSince('2026-10-09T10:00:00Z', Date.parse('2026-10-09T10:02:05Z'))).toBe(125)
    expect(secondsSince(null, Date.now())).toBe(0)
  })
})

describe('forming timeline data', () => {
  it('draws one tick per record, keyed by bucket so a growing bucket keeps its ticks', () => {
    const before = recordTicks([{ coll: 'fda_records', year: 2021, n: 2 }])
    const after = recordTicks([
      { coll: 'fda_records', year: 2021, n: 3 },
      { coll: 'trial_records', year: 2019, n: 1 },
    ])
    expect(before.map((t) => t.key)).toEqual(['fda_records:2021:0', 'fda_records:2021:1'])
    expect(after.slice(0, 2)).toEqual(before)
    expect(after).toHaveLength(4)
    for (const t of after) {
      expect(t.at).toBeGreaterThanOrEqual(Math.floor(t.at))
      expect(t.at - Math.floor(t.at)).toBeLessThan(1)
      expect(t.jitter).toBeGreaterThanOrEqual(0)
      expect(t.jitter).toBeLessThan(1)
    }
    expect(Math.floor(after[3]!.at)).toBe(2019)
  })

  it('lets one tick stand for several records past the cap', () => {
    const ticks = recordTicks([
      { coll: 'publication_records', year: 2020, n: 3000 },
      { coll: 'articles', year: 2024, n: 1 },
    ])
    expect(ticks).toHaveLength(1001) // 3001 records, 3 per tick: 1000 + 1
  })

  it('spans 2000 to three years ahead, stretching for older or later data within limits', () => {
    expect(formingYears([], 2026)).toEqual({ y0: 2000, y1: 2029 })
    expect(formingYears([2004, 2027], 2026)).toEqual({ y0: 2000, y1: 2029 })
    expect(formingYears([1993.4, 2031], 2026)).toEqual({ y0: 1993, y1: 2032 })
    expect(formingYears([1950, 2090, NaN], 2026)).toEqual({ y0: 1985, y1: 2032 })
  })
})

describe('events', () => {
  it('says how each event was built', () => {
    expect(viaLabel(event('a'))).toBe('Rule · fda_records')
    expect(viaLabel(event('b', { via: 'finalize', sources: [{ collection: 'patent_records', record_key: 'US1' }] }))).toBe('Rebuild · patent_records')
    expect(viaLabel(event('c', { via: 'ai_events', sources: [{ collection: 'articles', record_key: 'x' }] }))).toBe('AI · 1 record')
    expect(
      viaLabel(
        event('d', {
          via: 'ai_events',
          sources: [{ collection: 'articles', record_key: 'x' }],
          merged_sources: [{ collection: 'company_records', record_key: 'y' }],
        }),
      ),
    ).toBe('AI · merged 2 records')
    expect(viaLabel(event('e', { sources: [] }))).toBe('Rule')
    expect(tipVia(event('f', { via: 'ai_events' }))).toBe('AI · 1 record')
    expect(tipVia(event('g', { via: 'finalize' }))).toBe('Journey rebuild')
    expect(tipVia(event('h'))).toBe('Rule')
  })

  it('counts events by category and by how they were built', () => {
    const events = [event('a'), event('b', { category: 'clinical', via: 'ai_events' }), event('c', { via: 'finalize' })]
    expect(categoryCounts(events)).toEqual({ regulatory: 2, clinical: 1, company: 0, ip: 0 })
    expect(viaCounts(events)).toEqual({ journey: 1, ai_events: 1, finalize: 1, user: 0 })
  })

  it('reads announced events from the feed', () => {
    const items = [feedLine(1, 'info'), feedLine(2, 'event', 'e1'), feedLine(3, 'event'), feedLine(4, 'event', 'e2'), feedLine(5, 'event', 'e1'), feedLine(6, 'done')]
    expect(liveEventIds(items)).toEqual(['e1', 'e2'])
    expect(lastEventLine(items)).toBe(5)
    expect(lastEventLine([feedLine(1, 'info')])).toBe(0)
  })

  it('keeps each event once, the first copy winning', () => {
    const merged = uniqueEvents([event('a', { title: 'first' }), event('b')], [event('a', { title: 'second' }), event('c')])
    expect(merged.map((e) => [e.id, e.title])).toEqual([
      ['a', 'first'],
      ['b', 'Event b'],
      ['c', 'Event c'],
    ])
  })
})
