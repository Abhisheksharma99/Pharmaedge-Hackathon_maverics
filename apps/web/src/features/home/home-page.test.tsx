import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AssetSummary } from '@/features/assets/api'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import type { Job, JobStep } from '@/features/jobs/api'
import type { JourneyEventV3 } from '@/features/journey/types'
import type { PortfolioTimeline } from './api'
import { HomePage } from './home-page'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
const ZERO = { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 }
const asset = (id: string, name: string, kind: AssetSummary['kind'], extra: Partial<AssetSummary> = {}): AssetSummary => ({
  id,
  name,
  aliases: [],
  company: { name: 'Co' },
  tags: {},
  kind,
  status: 'ready',
  updatedAt: null,
  counts: ZERO,
  latestEvent: null,
  competitorOf: [],
  ...extra,
})
const ASSETS = [
  asset('trep', 'Treprostinil', 'primary', {
    counts: { trials: 74, regulatory: 56, pressReleases: 112, documents: 26, news: 95, publications: 210, conferences: 38, patents: 18, events: 909 },
  }),
  asset('sota', 'Sotatercept', 'primary', { counts: { ...ZERO, trials: 10, events: 9 } }),
  asset('nint', 'Nintedanib', 'competitor', { competitorOf: [{ id: 'trep', name: 'Treprostinil' }] }),
]
const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const RUNNING: Job = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'onboard',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: null,
  finished_at: null,
}
const ev = (id: string, assetId: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset: assetId,
  date,
  type: 'approval',
  category: 'regulatory',
  title: `Event ${id}`,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
  key: true,
  ...extra,
})
const PORTFOLIO: PortfolioTimeline = {
  assets: [
    { id: 'trep', name: 'Treprostinil', kind: 'primary', company: 'Co', status: 'onboarding', progress: 0.5, competitorOf: [] },
    { id: 'sota', name: 'Sotatercept', kind: 'primary', company: 'Co', status: 'ready', progress: null, competitorOf: [] },
    { id: 'nint', name: 'Nintedanib', kind: 'competitor', company: 'Co', status: 'ready', progress: null, competitorOf: ['trep'] },
  ],
  events: [
    ev('d1', 'trep', '2026-10-05'),
    ev('d2', 'sota', '2026-09-20', { significance: 'Medium' }),
    ev('d3', 'nint', '2026-08-01', { significance: 'Medium' }),
    ev('m1', 'trep', '2026-12-01', { is_milestone: true }),
    ev('m2', 'sota', '2027-03-31', { is_milestone: true }),
    ev('m3', 'nint', '2028-01-01', { is_milestone: true }),
  ],
}

function renderHome() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/assets') return json(200, ASSETS)
      if (url === '/api/portfolio/timeline?competitors=true') return json(200, PORTFOLIO)
      if (url === '/api/jobs?status=running') return json(200, [RUNNING])
      if (url === '/api/jobs?limit=10') return json(200, [RUNNING])
      if (url === '/api/jobs/j1') return json(200, { ...RUNNING, records: [], events_created: 0, feed_cursor: 0, record_years: [] })
      if (url === '/api/assets/trep' || url === '/api/assets/sota') return json(200, { kpis: { approvalRegions: ['US'] } })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const router = createMemoryRouter(
    [
      { path: '/', element: <HomePage /> },
      { path: '/chat', element: <p>Chat</p> },
      { path: '/assets/:id/overview', element: <p>Overview</p> },
    ],
    { initialEntries: ['/'] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T09:00:00'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HomePage', () => {
  it('greets the user with the date and a summary that matches the data', async () => {
    renderHome()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Good morning, Ana' })
    const hero = heading.parentElement!
    expect(hero).toHaveTextContent('Friday, October 9, 2026')
    await waitFor(() =>
      expect(hero).toHaveTextContent('2 new events in the last 30 days (1 high-significance) · 2 milestones in the next 6 months · Treprostinil journey 50% built'),
    )
  })

  it('fills the KPI strip from assets, key events and running crawls', async () => {
    renderHome()
    const kpis = await screen.findByRole('region', { name: 'Key metrics' })
    await waitFor(() => expect(kpis).toHaveTextContent('Tracked assets21 competitor monitored'))
    await waitFor(() => expect(kpis).toHaveTextContent('New events3Last 90 days, across all assets'))
    expect(kpis).toHaveTextContent('Upcoming milestones2Next 12 months')
    expect(kpis).toHaveTextContent('Records collected639FDA, EMA, trials, PubMed, news')
    await waitFor(() => expect(kpis).toHaveTextContent('Crawls running1Treprostinil · 50%'))
  })

  it('lays out every Home block', async () => {
    renderHome()
    for (const name of ['Portfolio timeline', 'What changed', 'Next milestones', 'Crawls', 'Tracked assets', 'Competitive signals', 'Asset AI']) {
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument()
    }
  })

  it('asks Asset AI from the hero', async () => {
    const router = renderHome()
    await userEvent.type(await screen.findByRole('textbox', { name: 'Ask Asset AI about your assets' }), 'What changed for Yutrepia?{Enter}')
    expect(router.state.location.pathname).toBe('/chat')
    expect(new URLSearchParams(router.state.location.search).get('ask')).toBe('What changed for Yutrepia?')
  })

  it('offers starter questions, including a comparison with a tracked competitor', async () => {
    renderHome()
    const compare = await screen.findByRole('link', { name: /Compare Treprostinil with Nintedanib/ })
    expect(compare).toHaveAttribute('href', `/chat?ask=${encodeURIComponent('Compare Treprostinil with Nintedanib')}`)
    expect(screen.getByRole('link', { name: /Add an asset by chatting/ })).toHaveAttribute('href', '/chat?intent=add')
  })
})
