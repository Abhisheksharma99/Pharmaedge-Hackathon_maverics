import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { JobStep } from '@/features/jobs/api'
import type { JobProgress } from '@/features/journey/types'
import { JobCard } from './job-card'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const step = (name: string, status: JobStep['status'], label = name, error: string | null = null): JobStep => ({
  name,
  label,
  status,
  counts: {},
  error,
  started_at: null,
  finished_at: null,
})

const job = (extra: Partial<JobProgress>): JobProgress => ({
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'onboard',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'pending'), step('journey', 'running', 'Journey events (rules)'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: null,
  records: [
    { coll: 'fda_records', count: 1000 },
    { coll: 'trial_records', count: 234 },
  ],
  events_created: 7,
  feed_cursor: 9,
  record_years: [],
  ...extra,
})

function renderCard(data: JobProgress) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url === '/api/jobs/j1' ? json(200, data) : json(404, { code: 'NOT_FOUND', message: url }))),
  )
  const card = { type: 'job' as const, jobId: 'j1', assetId: 'trep', assetName: 'Treprostinil' }
  const router = createMemoryRouter([{ path: '*', element: <JobCard card={card} /> }])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('chat JobCard', () => {
  it('shows the segmented step bar, the counters and a link to the live build while the crawl runs', async () => {
    renderCard(job({}))
    expect(await screen.findByText('Step 2 of 4 · Journey events (rules)')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Crawl steps' })
    expect([...bar.querySelectorAll<HTMLElement>('[data-status]')].map((s) => s.dataset.status)).toEqual(['done', 'pending', 'running', 'pending'])
    expect(screen.getByText(/records$/)).toHaveTextContent('1,234 records')
    expect(screen.getByText(/events$/)).toHaveTextContent('7 events')
    expect(screen.getByText(/sources$/)).toHaveTextContent('1/2 sources')
    expect(screen.getByRole('link', { name: /Watch the live build/ })).toHaveAttribute('href', '/assets/trep/overview?build=1')
  })

  it('opens the journey once the crawl has ended, and keeps listing step errors', async () => {
    const steps = [step('regulatory', 'done'), step('clinical', 'failed', 'Clinical trials', 'HTTP 503'), step('journey', 'done'), step('finalize', 'done')]
    renderCard(job({ status: 'completed_with_errors', steps, finished_at: '2026-10-09T10:05:00Z' }))
    expect(await screen.findByText('4 of 4 steps finished')).toBeInTheDocument()
    expect(screen.getByText('Completed with errors')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open the journey/ })).toHaveAttribute('href', '/assets/trep/overview')
    expect(screen.getByRole('list', { name: 'Step errors' })).toHaveTextContent('Clinical trials: HTTP 503')
  })
})
