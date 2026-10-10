import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AssetDetail } from '@/features/assets/api'
import type { JobProgress } from '../types'
import { LiveBuild } from './live-build'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET = { id: 'trep', name: 'Treprostinil', status: 'ready', competitors: [] } as unknown as AssetDetail
const JOB: JobProgress = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status: 'completed',
  steps: [{ name: 'regulatory', label: 'Regulatory', status: 'done', counts: {}, error: null, started_at: null, finished_at: null }],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: '2026-10-09T10:05:00Z',
  records: [],
  events_created: 0,
  feed_cursor: 0,
  record_years: [],
}

let jobsFail: boolean
let jobsList: JobProgress[]

function renderBuild(props: Partial<React.ComponentProps<typeof LiveBuild>> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/jobs?asset=trep') return jobsFail ? json(500, { code: 'INTERNAL', message: 'boom' }) : json(200, jobsList)
      if (url === '/api/jobs/j1') return json(200, JOB)
      if (/^\/api\/jobs\/j1\/feed/.test(url)) return json(200, { items: [], cursor: 0 })
      if (url.startsWith('/api/assets/trep/timeline')) return json(200, { events: [], total: 0 })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const onExplore = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LiveBuild asset={ASSET} onExplore={onExplore} {...props} />
    </QueryClientProvider>,
  )
  return { onExplore }
}

beforeEach(() => {
  jobsFail = false
  jobsList = [JOB]
})
afterEach(() => vi.unstubAllGlobals())

describe('LiveBuild error and empty states', () => {
  it('shows an inline error with "Try again" when the jobs fail to load, and recovers on retry', async () => {
    jobsFail = true
    const { onExplore } = renderBuild()
    expect(await screen.findByRole('alert')).toHaveTextContent("The live build couldn't be loaded.")
    // The way back to the journey stays available while the build is unavailable.
    await userEvent.click(screen.getByRole('button', { name: /Explore the journey/ }))
    expect(onExplore).toHaveBeenCalledTimes(1)

    jobsFail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Agent pipeline' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says there is no crawl yet when the asset has no jobs', async () => {
    jobsList = []
    renderBuild()
    expect(await screen.findByText('No crawl yet')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the fallback (the journey) instead of the error or empty state', async () => {
    jobsFail = true
    renderBuild({ fallback: <p>Journey view</p> })
    expect(screen.getByText('Journey view')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Journey view')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
