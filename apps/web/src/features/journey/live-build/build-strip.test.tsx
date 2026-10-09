import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JobStep } from '@/features/jobs/api'
import type { JobProgress } from '../types'
import { BuildStrip } from './build-strip'

const step = (name: string, status: JobStep['status'], label = name): JobStep => ({
  name,
  label,
  status,
  counts: {},
  error: null,
  started_at: null,
  finished_at: null,
})

const job = (extra: Partial<JobProgress> = {}): JobProgress => ({
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'onboard',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running', 'Journey events (rules)'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '2026-10-09T09:59:58Z',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: null,
  records: [
    { coll: 'fda_records', count: 1000 },
    { coll: 'trial_records', count: 234 },
  ],
  events_created: 99,
  feed_cursor: 12,
  record_years: [],
  ...extra,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T10:02:05Z'))
})
afterEach(() => vi.useRealTimers())

describe('BuildStrip', () => {
  it('shows the running step, the counters and one segment per step', () => {
    render(<BuildStrip job={job()} eventsCount={7} onExplore={() => {}} />)
    const strip = screen.getByRole('region', { name: 'Live build' })
    expect(within(strip).getByRole('heading', { name: 'Building the journey' })).toBeInTheDocument()
    expect(strip).toHaveTextContent('Step 3 of 4 · Journey events (rules)')
    expect(within(strip).getByText('Records').nextElementSibling).toHaveTextContent('1,234')
    expect(within(strip).getByText('Events').nextElementSibling).toHaveTextContent('7')
    expect(within(strip).getByText('Sources').nextElementSibling).toHaveTextContent('2/2')
    expect(within(strip).getByText('Elapsed').nextElementSibling).toHaveTextContent('02:05')
    const bar = within(strip).getByRole('progressbar', { name: 'Crawl progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    const segments = [...bar.querySelectorAll<HTMLElement>('[data-status]')]
    expect(segments.map((s) => s.dataset.status)).toEqual(['done', 'done', 'running', 'pending'])
    expect(segments.map((s) => s.style.flexGrow)).toEqual(['4', '4', '3.5', '3'])
    expect(within(strip).getByText('Build')).toHaveAttribute('data-current', 'true')
    expect(within(strip).getByText('Collect')).not.toHaveAttribute('data-current')
    expect(within(strip).queryByRole('button', { name: /Explore the journey/ })).not.toBeInTheDocument()
  })

  it('plans before the first step starts', () => {
    render(
      <BuildStrip
        job={job({ status: 'queued', started_at: null, steps: [step('regulatory', 'pending'), step('clinical', 'pending'), step('journey', 'pending'), step('finalize', 'pending')] })}
        eventsCount={0}
        onExplore={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Planning the crawl' })).toBeInTheDocument()
    expect(screen.getByText('Laying out 4 steps across 2 sources for Treprostinil')).toBeInTheDocument()
    expect(screen.getByText('Elapsed').nextElementSibling).toHaveTextContent('00:00')
  })

  it('turns green with the totals and "Explore the journey" when the job completes', async () => {
    const onExplore = vi.fn()
    const steps = ['regulatory', 'clinical', 'journey', 'finalize'].map((n) => step(n, 'done'))
    render(<BuildStrip job={job({ status: 'completed', steps, finished_at: '2026-10-09T10:03:05Z' })} eventsCount={7} onExplore={onExplore} />)
    expect(screen.getByRole('heading', { name: 'Journey ready' })).toBeInTheDocument()
    expect(screen.getByText('7 events from 1,234 records · finished in 3m 05s')).toBeInTheDocument()
    expect(screen.getByText('Duration').nextElementSibling).toHaveTextContent('03:05')
    await userEvent.click(screen.getByRole('button', { name: /Explore the journey/ }))
    expect(onExplore).toHaveBeenCalledOnce()
  })

  it('says when the crawl failed, and still lets you explore', () => {
    const steps = [step('regulatory', 'done'), step('clinical', 'failed'), step('journey', 'skipped'), step('finalize', 'pending')]
    render(<BuildStrip job={job({ status: 'failed', steps, finished_at: '2026-10-09T10:01:00Z' })} eventsCount={0} onExplore={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Crawl failed' })).toBeInTheDocument()
    expect(screen.getByText('3 of 4 steps finished')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Explore the journey/ })).toBeInTheDocument()
  })
})
