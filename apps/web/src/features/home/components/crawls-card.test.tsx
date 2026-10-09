import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { Job, JobStep } from '@/features/jobs/api'
import { StepBar } from '@/features/jobs/components/step-bar'
import { CrawlsCard } from './crawls-card'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const job = (id: string, status: Job['status'], extra: Partial<Job> = {}): Job => ({
  id,
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status,
  steps: [],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: '2026-10-09T10:00:42Z',
  ...extra,
})
const RUNNING = job('j1', 'running', {
  type: 'onboard',
  finished_at: null,
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running'), step('finalize', 'pending')],
})
const RECENT = [
  RUNNING,
  job('j2', 'completed', { asset: 'sota', assetName: 'Sotatercept' }),
  job('j3', 'failed', { asset: 'ensi', assetName: 'Ensifentrine' }),
  job('j4', 'completed_with_errors', { asset: 'dupi', assetName: 'Dupilumab', finished_at: '2026-10-09T10:03:05Z' }),
  job('j5', 'completed', { asset: 'old', assetName: 'Oldest' }),
]

function renderCard(running: Job[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/jobs?status=running') return json(200, running)
      if (url === '/api/jobs?limit=10') return json(200, running.length ? RECENT : RECENT.slice(1))
      if (url === '/api/jobs/j1') {
        return json(200, { ...RUNNING, records: [{ coll: 'fda_records', count: 1000 }, { coll: 'trial_records', count: 234 }], events_created: 7, feed_cursor: 0, record_years: [] })
      }
      if (url === '/api/jobs/j2') {
        return json(200, { ...RECENT[1], steps: [step('regulatory', 'done'), step('finalize', 'done')], records: [{ coll: 'fda_records', count: 2000 }, { coll: 'x', count: 345 }], events_created: 12, feed_cursor: 0, record_years: [] })
      }
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const router = createMemoryRouter([{ path: '*', element: <CrawlsCard /> }], { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('CrawlsCard', () => {
  it('shows the running crawl with its step, progress and counters, linking to the live build', async () => {
    renderCard([RUNNING])
    const live = await screen.findByRole('link', { name: /Watch the live build/ })
    expect(live).toHaveAttribute('href', '/assets/trep/overview?build=1')
    expect(live).toHaveTextContent('Treprostinil · onboarding')
    expect(live).toHaveTextContent('Step 3 of 4 · Rules engine')
    expect(live).toHaveTextContent('50%')
    expect(within(live).getByRole('progressbar', { name: 'Crawl steps' })).toHaveAttribute('aria-valuenow', '2')
    expect(await within(live).findByText('1,234')).toBeInTheDocument()
    expect(live).toHaveTextContent('1,234 records')
    expect(live).toHaveTextContent('7 events')
    expect(screen.getByText('Data collection running now')).toBeInTheDocument()
  })

  it('lists the last three finished jobs with their status and duration', async () => {
    renderCard([RUNNING])
    const sota = await screen.findByRole('link', { name: /Sotatercept/ })
    expect(sota).toHaveAttribute('href', '/jobs/j2')
    expect(sota).toHaveTextContent('Completed')
    expect(sota).toHaveTextContent('42s')
    expect(screen.getByRole('link', { name: /Ensifentrine/ })).toHaveTextContent('Failed')
    expect(screen.getByRole('link', { name: /Dupilumab/ })).toHaveTextContent('3m 05s')
    expect(screen.queryByRole('link', { name: /Oldest/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All jobs' })).toHaveAttribute('href', '/jobs')
  })

  it('asks for a small page of jobs, not the full list', async () => {
    renderCard([RUNNING])
    await screen.findByRole('link', { name: /Sotatercept/ })
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => u)
    expect(urls).toContain('/api/jobs?limit=10')
    expect(urls).not.toContain('/api/jobs')
  })

  it('says nothing is running when no crawl is active', async () => {
    renderCard([])
    expect(await screen.findByText('Nothing running right now')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Watch the live build/ })).not.toBeInTheDocument()
  })

  it('when idle, keeps the last finished crawl as a card linking to the journey', async () => {
    renderCard([])
    const card = await screen.findByRole('link', { name: /Explore the journey/ })
    expect(card).toHaveAttribute('href', '/assets/sota/overview')
    expect(card).toHaveTextContent('Sotatercept · refresh')
    expect(await within(card).findByText('Finished · 12 events from 2,345 records')).toBeInTheDocument()
    expect(card).toHaveTextContent('100%')
    expect(within(card).getByRole('progressbar', { name: 'Crawl steps' })).toHaveAttribute('aria-valuenow', '2')
    expect(screen.getByRole('link', { name: /Ensifentrine/ })).toHaveAttribute('href', '/jobs/j3')
  })
})

describe('StepBar', () => {
  it('draws one segment per step, sized by its expected duration', () => {
    render(<StepBar steps={[step('regulatory', 'done'), step('ai_events', 'running'), step('finalize', 'pending')]} />)
    const bar = screen.getByRole('progressbar', { name: 'Crawl steps' })
    const segments = [...bar.querySelectorAll<HTMLElement>('[data-status]')]
    expect(segments.map((s) => s.dataset.status)).toEqual(['done', 'running', 'pending'])
    expect(segments.map((s) => s.style.flexGrow)).toEqual(['4', '5', '3'])
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '3')
  })
})
