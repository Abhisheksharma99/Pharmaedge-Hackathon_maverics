import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useJob, useJobProgress, type Job } from './api'
import { JobPage, JobsPage } from './jobs-pages'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const JOB: Job = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status: 'completed',
  steps: [],
  cancel_requested: false,
  requested_by: null,
  created_at: '2026-10-09T10:00:00Z',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: '2026-10-09T10:05:00Z',
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const calls = (fetchMock: ReturnType<typeof vi.fn>, url: string) => fetchMock.mock.calls.filter(([u]) => u === url).length

function renderRoute(path: string, element: ReactNode, initial: string) {
  const router = createMemoryRouter([{ path, element }, { path: '/jobs', element: <p>Jobs index</p> }], { initialEntries: [initial] })
  render(
    <QueryClientProvider client={newClient()}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('JobsPage', () => {
  it('shows an inline error when the list fails, and "Try again" refetches it', async () => {
    let fail = true
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/jobs') return fail ? json(500, { code: 'INTERNAL', message: 'boom' }) : json(200, [JOB])
      return json(404, { code: 'NOT_FOUND', message: url })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/jobs-list', <JobsPage />, '/jobs-list')

    expect(await screen.findByRole('alert')).toHaveTextContent("Crawl jobs couldn't be loaded.")
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Treprostinil' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls(fetchMock, '/api/jobs')).toBe(2)
  })
})

describe('JobPage', () => {
  it('says "Job not found" without a retry on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { code: 'NOT_FOUND', message: 'No such job' })))
    renderRoute('/jobs/:jobId', <JobPage />, '/jobs/nope')

    expect(await screen.findByRole('heading', { name: 'Job not found' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to crawl jobs' })).toHaveAttribute('href', '/jobs')
  })

  it('offers a retry on a server error, and the retry loads the job', async () => {
    let fail = true
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/jobs/j1') return fail ? json(500, { code: 'INTERNAL', message: 'boom' }) : json(200, JOB)
      return json(404, { code: 'NOT_FOUND', message: url })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderRoute('/jobs/:jobId', <JobPage />, '/jobs/j1')

    expect(await screen.findByRole('heading', { name: "The job couldn't be loaded" })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Check your connection and try again.')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: "The job couldn't be loaded" })).not.toBeInTheDocument())
    expect(calls(fetchMock, '/api/jobs/j1')).toBe(2)
  })
})

describe('job polling', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={newClient()}>{children}</QueryClientProvider>

  it.each([
    ['useJob', () => useJob('j1')],
    ['useJobProgress', () => useJobProgress('j1')],
  ])('%s keeps polling a running job but stops once the first load has failed', async (_name, hook) => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let status = 200
    const fetchMock = vi.fn(async () => (status === 200 ? json(200, { ...JOB, status: 'running' }) : json(500, { code: 'INTERNAL', message: 'boom' })))
    vi.stubGlobal('fetch', fetchMock)
    const ok = renderHook(hook, { wrapper })
    await waitFor(() => expect(ok.result.current.isSuccess).toBe(true))
    await vi.advanceTimersByTimeAsync(4500)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    ok.unmount()

    status = 500
    fetchMock.mockClear()
    const bad = renderHook(hook, { wrapper })
    await waitFor(() => expect(bad.result.current.isError).toBe(true))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
