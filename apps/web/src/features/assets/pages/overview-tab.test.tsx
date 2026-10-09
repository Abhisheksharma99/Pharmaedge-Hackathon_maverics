import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { AssetDetail } from '@/features/assets/api'
import type { JobStep } from '@/features/jobs/api'
import type { JobProgress } from '@/features/journey/types'
import { useShellStore } from '@/stores/shell-store'
import { AssetLayout } from './asset-layout'
import { OverviewTab } from './tabs'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET: AssetDetail = {
  id: 'trep',
  name: 'Treprostinil',
  aliases: [],
  company: { name: 'United Therapeutics' },
  tags: { indications: ['PAH'] },
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null,
  competitorOf: [],
  kpis: { approvalRegions: ['US'], activeTrials: 0, activePhase3: 0, upcomingMilestones: 0 },
  competitors: [],
  suggestedQuestions: [],
}
const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const JOB: JobProgress = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status: 'running',
  steps: [step('regulatory', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: null,
  records: [{ coll: 'fda_records', count: 44 }],
  events_created: 0,
  feed_cursor: 1,
  record_years: [{ coll: 'fda_records', year: 2021, n: 44 }],
}
const DONE: JobProgress = { ...JOB, status: 'completed', steps: JOB.steps.map((s) => ({ ...s, status: 'done' })), finished_at: '2026-10-09T10:03:05Z' }

function fakeApi(asset: AssetDetail, job: JobProgress) {
  const api = { asset, job, jobs: 'list' as 'list' | 'none' | 'error' }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/assets/trep') return json(200, api.asset)
      if (url === '/api/jobs?asset=trep') return api.jobs === 'error' ? json(500, { code: 'X', message: 'boom' }) : json(200, api.jobs === 'none' ? [] : [api.job])
      if (url === '/api/jobs/j1') return json(200, api.job)
      if (url.startsWith('/api/jobs/j1/feed')) return json(200, { items: [], cursor: 0 })
      if (url === '/api/assets/trep/timeline?scope=key') return json(200, { events: [], total: 0 })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  return api
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: '/assets/:assetId', element: <AssetLayout />, children: [{ path: 'overview', element: <OverviewTab /> }] }],
    { initialEntries: [path] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, client }
}

const breadcrumb = () => within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText((_, el) => el?.getAttribute('aria-current') === 'page')

beforeEach(() => useShellStore.setState({ assetAiOpen: false }))
afterEach(() => vi.unstubAllGlobals())

describe('Overview live build', () => {
  it('shows the live build while the asset is onboarding, with a live dot on the Overview tab', async () => {
    fakeApi({ ...ASSET, status: 'onboarding' }, JOB)
    renderAt('/assets/trep/overview')
    expect(await screen.findByRole('heading', { name: 'Building the journey' })).toBeInTheDocument()
    expect(breadcrumb()).toHaveTextContent('Building journey')
    expect(screen.getByRole('link', { name: 'Overview' }).querySelector('[data-live-dot]')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Agent pipeline' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Journey taking shape' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Key metrics' })).not.toBeInTheDocument()
  })

  it('switches to the journey on its own when onboarding finishes', async () => {
    const api = fakeApi({ ...ASSET, status: 'onboarding' }, JOB)
    const { client } = renderAt('/assets/trep/overview')
    expect(await screen.findByRole('heading', { name: 'Building the journey' })).toBeInTheDocument()

    api.job = DONE
    api.asset = { ...ASSET, status: 'ready' }
    await act(() => client.refetchQueries({ queryKey: ['job', 'j1'], exact: true }))

    expect(await screen.findByRole('region', { name: 'Key metrics' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Live build' })).not.toBeInTheDocument()
    expect(breadcrumb()).toHaveTextContent('Overview')
    expect(screen.getByRole('link', { name: 'Overview' }).querySelector('[data-live-dot]')).toBeNull()
  })

  it('shows the build of a ready asset with ?build=1 until "Explore the journey" clears it', async () => {
    fakeApi(ASSET, DONE)
    const { router } = renderAt('/assets/trep/overview?build=1')
    expect(await screen.findByRole('heading', { name: 'Journey ready' })).toBeInTheDocument()
    expect(breadcrumb()).toHaveTextContent('Overview')

    await userEvent.click(screen.getByRole('button', { name: /Explore the journey/ }))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByRole('region', { name: 'Key metrics' })).toBeInTheDocument()
  })

  it('shows the journey without ?build=1 once the asset is ready', async () => {
    fakeApi(ASSET, JOB)
    renderAt('/assets/trep/overview')
    expect(await screen.findByRole('region', { name: 'Key metrics' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Live build' })).not.toBeInTheDocument()
  })

  it('keeps the live build of a job that ends cancelled, when the asset flips to failed', async () => {
    const api = fakeApi({ ...ASSET, status: 'onboarding' }, JOB)
    const { client } = renderAt('/assets/trep/overview')
    expect(await screen.findByRole('heading', { name: 'Building the journey' })).toBeInTheDocument()

    api.job = { ...DONE, status: 'cancelled', steps: JOB.steps.map((s, i) => ({ ...s, status: i === 0 ? 'done' : 'skipped' })) }
    api.asset = { ...ASSET, status: 'failed' }
    await act(() => client.refetchQueries({ queryKey: ['job', 'j1'], exact: true }))
    await act(() => client.refetchQueries({ queryKey: ['asset', 'trep'], exact: true }))

    expect(await screen.findByRole('heading', { name: 'Crawl cancelled' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Key metrics' })).not.toBeInTheDocument()
  })

  it('replaces the history entry on "Explore the journey" and keeps the other params', async () => {
    fakeApi(ASSET, DONE)
    const { router } = renderAt('/assets/trep/overview?build=1&x=1')
    await userEvent.click(await screen.findByRole('button', { name: /Explore the journey/ }))
    expect(router.state.location.search).toBe('?x=1')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('moves focus into the Overview once the build is left', async () => {
    fakeApi(ASSET, DONE)
    renderAt('/assets/trep/overview?build=1')
    await userEvent.click(await screen.findByRole('button', { name: /Explore the journey/ }))
    const metrics = await screen.findByRole('region', { name: 'Key metrics' })
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.contains(metrics)).toBe(true)
  })

  it('shows the journey for a failed asset that was never crawled', async () => {
    fakeApi({ ...ASSET, status: 'failed' }, JOB).jobs = 'none'
    renderAt('/assets/trep/overview')
    expect(await screen.findByRole('region', { name: 'Key metrics' })).toBeInTheDocument()
    expect(screen.queryByText('No crawl yet')).not.toBeInTheDocument()
  })

  it('shows "Crawl cancelled" with Explore for a failed asset whose job was cancelled', async () => {
    fakeApi({ ...ASSET, status: 'failed' }, { ...DONE, status: 'cancelled' })
    renderAt('/assets/trep/overview')
    expect(await screen.findByRole('heading', { name: 'Crawl cancelled' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Explore the journey/ })).toBeInTheDocument()
  })

  it('lets an onboarding asset leave a build that could not be loaded', async () => {
    fakeApi({ ...ASSET, status: 'onboarding' }, JOB).jobs = 'error'
    renderAt('/assets/trep/overview')
    expect(await screen.findByText("The live build couldn't be loaded.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Explore the journey/ }))
    expect(await screen.findByRole('region', { name: 'Key metrics' })).toBeInTheDocument()
  })
})
