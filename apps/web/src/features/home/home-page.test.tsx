import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AssetSummary } from '@/features/assets/api'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import type { Job, JobStep } from '@/features/jobs/api'
import type { Prefs, PrefsPatch } from '@/features/me/api'
import type { PortfolioEvent, PortfolioTimeline } from './api'
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
const ev = (id: string, assetId: string, date: string, extra: Partial<PortfolioEvent> = {}): PortfolioEvent => ({
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

/** The previous Home visit the prefs API answers with (Tue Oct 6, 14:05 local), and what Home PATCHes. */
const SINCE = new Date(2026, 9, 6, 14, 5).toISOString()
const BASE_PREFS: Prefs = { journeyView: 'h', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: false }, watchlist: [], homeWatchlistOnly: false, lastSeen: { home: null, homePrev: null } }
let patches: PrefsPatch[] = []

function renderHome({ prefs = BASE_PREFS, homePrev = null as string | null, portfolio = PORTFOLIO } = {}) {
  let stored = prefs
  patches = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/me/prefs') {
        if (init?.method === 'PATCH') {
          const patch = JSON.parse(String(init.body)) as PrefsPatch
          patches.push(patch)
          // Home only PATCHes the watchlist, the chip and its visit.
          stored = {
            ...stored,
            ...(patch.watchlist && { watchlist: patch.watchlist }),
            ...(patch.homeWatchlistOnly !== undefined && { homeWatchlistOnly: patch.homeWatchlistOnly }),
            ...(patch.lastSeen && { lastSeen: { home: patch.lastSeen.home, homePrev } }),
          }
        }
        return json(200, stored)
      }
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/assets') return json(200, ASSETS)
      if (url === '/api/portfolio/timeline?competitors=true') return json(200, portfolio)
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

  it('fills the KPI strip from assets and key events', async () => {
    renderHome()
    const kpis = await screen.findByRole('region', { name: 'Key metrics' })
    await waitFor(() => expect(kpis).toHaveTextContent('Tracked assets21 competitor monitored'))
    await waitFor(() => expect(kpis).toHaveTextContent('New events3Last 90 days, across all assets'))
    expect(kpis).toHaveTextContent('Upcoming milestones2Next 12 months')
    expect(kpis).not.toHaveTextContent('Records collected')
    expect(kpis).not.toHaveTextContent('Crawls running')
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

/** The portfolio with first-seen times: d1, d3 and m1 were stored after the previous visit, the rest before it. */
const SEEN: PortfolioTimeline = {
  ...PORTFOLIO,
  events: PORTFOLIO.events.map((e) => ({ ...e, first_seen: ['d1', 'd3', 'm1'].includes(e.id) ? '2026-10-08T10:00:00.000Z' : '2026-01-01T00:00:00.000Z' })),
}
const NEW = { name: 'New since your last visit' }

describe('Since your last visit', () => {
  it('records the visit and counts what was stored since the previous one', async () => {
    renderHome({ homePrev: SINCE, portfolio: SEEN })
    const banner = await screen.findByRole('status', { name: 'Since your last visit' })
    expect(banner).toHaveTextContent('3 new events since Tue 14:05 across 2 assets')
    expect(patches[0]).toEqual({ lastSeen: { home: new Date('2026-10-09T09:00:00').toISOString() } })
  })

  it('marks new rows in What changed, Next milestones and Competitive signals', async () => {
    renderHome({ homePrev: SINCE, portfolio: SEEN })
    await screen.findByRole('status', { name: 'Since your last visit' })
    const changed = screen.getByRole('heading', { name: 'What changed' }).closest('section')!
    const row = (title: string) => within(changed).getByRole('button', { name: title }).closest('li')!
    expect(within(row('Event d1')).getByRole('img', NEW)).toBeInTheDocument()
    expect(within(row('Event d3')).getByRole('img', NEW)).toBeInTheDocument()
    expect(within(row('Event d2')).queryByRole('img', NEW)).not.toBeInTheDocument()
    const milestones = screen.getByRole('heading', { name: 'Next milestones' }).closest('section')!
    expect(within(within(milestones).getByRole('button', { name: /Event m1/ })).getByRole('img', NEW)).toBeInTheDocument()
    expect(within(within(milestones).getByRole('button', { name: /Event m2/ })).queryByRole('img', NEW)).not.toBeInTheDocument()
    const signals = screen.getByRole('heading', { name: 'Competitive signals' }).closest('section')!
    expect(within(within(signals).getByRole('button', { name: /Event d3/ })).getByRole('img', NEW)).toBeInTheDocument()
  })

  it('Show lists only the new events in What changed; Show all events goes back', async () => {
    renderHome({ homePrev: SINCE, portfolio: SEEN })
    const banner = await screen.findByRole('status', { name: 'Since your last visit' })
    const changed = screen.getByRole('heading', { name: 'What changed' }).closest('section')!
    await userEvent.click(within(banner).getByRole('button', { name: 'Show' }))
    expect(within(changed).getByRole('region', { name: 'New since your last visit' })).toBeInTheDocument()
    const titles = within(changed).getAllByRole('listitem').map((li) => within(li).getAllByRole('button')[0].textContent)
    expect(titles).toEqual(['Event m1', 'Event d1', 'Event d3'])
    await userEvent.click(within(banner).getByRole('button', { name: 'Show all events' }))
    expect(within(changed).getByRole('region', { name: 'Last 7 days' })).toBeInTheDocument()
    expect(within(changed).getByRole('button', { name: 'Event d2' })).toBeInTheDocument()
  })

  it('shows no banner on a first visit or when nothing is new', async () => {
    renderHome({ portfolio: SEEN })
    await screen.findByRole('button', { name: 'Event d1' })
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(screen.queryByRole('status', { name: 'Since your last visit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', NEW)).not.toBeInTheDocument()
  })
})

describe('Watchlist', () => {
  it('is disabled until an asset is starred; a star on a Tracked assets card adds it', async () => {
    renderHome()
    const chip = await screen.findByRole('button', { name: /Watchlist/ })
    await waitFor(() => expect(chip).toBeDisabled())
    await userEvent.click(await screen.findByRole('button', { name: 'Watch Sotatercept' }))
    expect(screen.getByRole('button', { name: 'Watch Sotatercept' })).toHaveAttribute('aria-pressed', 'true')
    expect(chip).toBeEnabled()
    expect(chip).toHaveTextContent('Watchlist1')
    await waitFor(() => expect(patches).toContainEqual({ watchlist: ['sota'] }))
  })

  it('limits every card to watched assets (and their competitors) and remembers the choice', async () => {
    renderHome({ prefs: { ...BASE_PREFS, watchlist: ['sota', 'gone'] } })
    const chip = await screen.findByRole('button', { name: /Watchlist/ })
    await waitFor(() => expect(chip).toHaveTextContent('Watchlist1'))
    await screen.findByRole('button', { name: 'Event d1' })
    await userEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(patches).toContainEqual({ homeWatchlistOnly: true }))

    const changed = screen.getByRole('heading', { name: 'What changed' }).closest('section')!
    expect(within(changed).getByRole('button', { name: 'Event d2' })).toBeInTheDocument()
    expect(within(changed).queryByRole('button', { name: 'Event d1' })).not.toBeInTheDocument()
    const milestones = screen.getByRole('heading', { name: 'Next milestones' }).closest('section')!
    expect(within(milestones).getAllByRole('button', { name: /Event m/ }).map((b) => b.textContent)).toEqual([expect.stringContaining('Event m2')])
    // Nintedanib competes with Treprostinil, which is not watched.
    expect(screen.getByRole('heading', { name: 'Competitive signals' }).closest('section')).toHaveTextContent('No competitor moves yet')
    const tracked = screen.getByRole('region', { name: 'Tracked assets' })
    expect(tracked).toHaveTextContent('1 of 2 primary on your watchlist')
    expect(within(tracked).getByRole('link', { name: /Sotatercept/ })).toBeInTheDocument()
    expect(within(tracked).queryByRole('link', { name: /Treprostinil/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Key metrics' })).toHaveTextContent('Tracked assets1On your watchlist · 0 competitors monitored')
  })

  it('starts on when it was left on', async () => {
    renderHome({ prefs: { ...BASE_PREFS, watchlist: ['trep'], homeWatchlistOnly: true } })
    const chip = await screen.findByRole('button', { name: /Watchlist/ })
    await waitFor(() => expect(chip).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Tracked assets' })).toHaveTextContent('1 of 2 primary on your watchlist'))
    expect(screen.queryByRole('button', { name: 'Event d2' })).not.toBeInTheDocument()
  })
})
