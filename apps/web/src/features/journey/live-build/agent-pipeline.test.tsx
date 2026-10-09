import { render, screen } from '@testing-library/react'
import type { JobStep } from '@/features/jobs/api'
import type { JobProgress, JourneyEventV3 } from '../types'
import { AgentPipeline } from './agent-pipeline'

const step = (name: string, status: JobStep['status'], counts: Record<string, number> = {}, error: string | null = null): JobStep => ({
  name,
  label: name,
  status,
  counts,
  error,
  started_at: null,
  finished_at: null,
})

const job = (steps: JobStep[], extra: Partial<JobProgress> = {}): JobProgress => ({
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status: 'running',
  steps,
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: null,
  records: [
    { coll: 'fda_records', count: 44 },
    { coll: 'ema_records', count: 0 },
  ],
  events_created: 0,
  feed_cursor: 0,
  record_years: [],
  ...extra,
})

const event = (id: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date: '2021-04-01',
  type: 'approval',
  category: 'regulatory',
  title: id,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
  ...extra,
})

/** matchMedia that reports `prefers-reduced-motion: reduce` as `reduce`. */
function motion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

const node = (key: string) => document.querySelector<HTMLElement>(`[data-node="${key}"]`)
// edge ids follow the layout order (pipeline-layout.ts): age-0 regulatory → fda_records, age-12 fda_records → rules
// engine, age-30 event extraction → journey
const edge = (id: string) => document.querySelector(`[data-edge="${id}"]`)

afterEach(() => vi.unstubAllGlobals())

describe('AgentPipeline', () => {
  it('shows only the planned steps and the collections holding records, with particles on running edges', () => {
    motion(false)
    render(<AgentPipeline job={job([step('regulatory', 'running'), step('journey', 'pending'), step('finalize', 'pending')])} events={[]} competitors={[]} />)
    expect(node('s:regulatory')).toHaveAttribute('data-status', 'running')
    expect(node('s:regulatory')).toHaveTextContent('FDA · EMA')
    expect(node('s:clinical')).toBeNull()
    expect(node('c:fda_records')).toHaveTextContent('fda_records44')
    expect(node('c:ema_records')).toBeNull()
    expect(node('r:journey')).toHaveAttribute('data-status', 'pending')
    expect(node('r:journey')).toHaveTextContent('Rules engineWaits for structured records')
    expect(node('r:ai_triage')).toBeNull()
    expect(node('o:journey')).toHaveTextContent('Waiting')
    expect(node('o:assetai')).toBeNull()
    expect(node('o:compset')).toBeNull()

    expect(edge('age-0')).toHaveAttribute('data-state', 'active')
    expect(edge('age-0')?.querySelectorAll('[data-particle]')).toHaveLength(3)
    expect(edge('age-12')).toHaveAttribute('data-state', 'pending')
    expect(edge('age-12')?.querySelectorAll('[data-particle]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-edge]')).toHaveLength(3)
  })

  it('draws no particles when the user prefers reduced motion', () => {
    motion(true)
    render(<AgentPipeline job={job([step('regulatory', 'running'), step('journey', 'pending')])} events={[]} competitors={[]} />)
    expect(edge('age-0')).toHaveAttribute('data-state', 'active')
    expect(document.querySelectorAll('[data-particle]')).toHaveLength(0)
  })

  it('fills the outputs as steps finish', () => {
    motion(false)
    const steps = [
      step('regulatory', 'done', { fda_new: 40, fda_updated: 4, ema_new: 12 }),
      step('news', 'failed', {}, 'RuntimeError: feed down'),
      step('journey', 'done', { events: 31 }),
      step('ai_triage', 'done', { articles_ingest: 74, articles_skip: 112 }),
      step('ai_events', 'running'),
      step('index', 'done', { chunks: 1240 }),
      step('competitors', 'done', { competitors: 5 }),
      step('finalize', 'pending'),
    ]
    const events = [event('a'), event('b', { category: 'clinical' }), event('c', { via: 'ai_events', category: 'company' })]
    render(<AgentPipeline job={job(steps)} events={events} competitors={['Yutrepia', 'Uptravi']} />)
    expect(node('s:regulatory')).toHaveTextContent('56')
    expect(node('s:news')?.getAttribute('title')).toBe('news · RuntimeError: feed down')
    expect(node('r:journey')).toHaveTextContent('31 events by rule')
    expect(node('r:ai_triage')).toHaveTextContent('74 kept · 112 dropped')
    expect(node('r:ai_events')).toHaveTextContent('1 events')
    expect(node('r:index')).toHaveTextContent('1,240 passages')
    const journey = node('o:journey')!
    expect(journey).toHaveTextContent('Building')
    expect(journey).toHaveTextContent('3events')
    expect(journey).toHaveTextContent('Regulatory1Clinical1Safety0Company1Patents0')
    expect(journey).toHaveTextContent('rules 2 · ai 1 · rebuild 0')
    expect(node('o:assetai')).toHaveTextContent('1,240 passages · 0 questions')
    expect(node('o:compset')).toHaveTextContent('YutrepiaUptravi')
    expect(edge('age-30')).toHaveAttribute('data-state', 'active')
    expect(screen.getAllByText('AI')).toHaveLength(2)
  })

  it('reads Ready once the job has ended', () => {
    motion(false)
    const steps = [step('regulatory', 'done'), step('journey', 'done'), step('finalize', 'done', { suggested_questions: 4 })]
    render(<AgentPipeline job={job(steps, { status: 'completed' })} events={[event('a')]} competitors={[]} />)
    expect(node('o:journey')).toHaveTextContent('Ready')
    expect(document.querySelectorAll('[data-state="active"]')).toHaveLength(0)
  })
})
