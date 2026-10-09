import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Job, JobStep } from '@/features/jobs/api'
import type { AssetSummary } from '../api'
import { AssetSearchPage } from './asset-search-page'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ZERO = { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 }
const TREP: AssetSummary = {
  id: 'trep',
  name: 'Treprostinil',
  aliases: ['Tyvaso', 'Remodulin'],
  company: { name: 'United Therapeutics' },
  tags: { indications: ['PAH'], investigational_indications: ['PH-ILD'] },
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: { ...ZERO, events: 909 },
  latestEvent: { date: '2026-10-05', title: 'Study highlights inhaled treprostinil in IPF', type: 'publication' },
  competitorOf: [],
}
const SOTA: AssetSummary = { ...TREP, id: 'sota', name: 'Sotatercept', aliases: ['Winrevair'], company: { name: 'Merck' }, tags: { indications: ['PAH'] }, counts: { ...ZERO, events: 9 }, latestEvent: null }
const NINT: AssetSummary = {
  ...TREP,
  id: 'nint',
  name: 'Nintedanib',
  aliases: ['Ofev'],
  company: { name: 'Boehringer Ingelheim' },
  tags: { indications: ['IPF', 'PPF'] },
  kind: 'competitor',
  counts: { ...ZERO, events: 1 },
  latestEvent: null,
  competitorOf: [{ id: 'trep', name: 'Treprostinil' }],
}
const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const RUNNING: Job = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: null,
  finished_at: null,
}
const REGIONS: Record<string, string[]> = { trep: ['US', 'EU'], sota: ['US'], nint: ['US', 'EU'] }

function renderSearch(path = '/assets') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/assets') return json(200, [NINT, TREP, SOTA])
      if (url === '/api/portfolio/timeline?competitors=true') return json(200, { assets: [], events: [] })
      if (url === '/api/jobs?status=running') return json(200, [RUNNING])
      const detail = url.match(/^\/api\/assets\/(\w+)$/)?.[1]
      if (detail && REGIONS[detail]) return json(200, { id: detail, kpis: { approvalRegions: REGIONS[detail] } })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const router = createMemoryRouter(
    [
      { path: '/assets', element: <AssetSearchPage /> },
      { path: '/assets/:id/overview', element: <p>Overview</p> },
      { path: '/chat', element: <p>Chat</p> },
    ],
    { initialEntries: [path] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return router
}

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr')!

afterEach(() => vi.unstubAllGlobals())

describe('AssetSearchPage', () => {
  it('table: primary first, kind badges, counts in the kind switch, regions, status and latest update', async () => {
    renderSearch()
    await screen.findByRole('link', { name: 'Treprostinil' })
    expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Primary 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Competitors 1' })).toBeInTheDocument()
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0].textContent)
    expect(names).toEqual(['Sotatercept', 'Treprostinil', 'Nintedanib'])

    const trep = rowOf('Treprostinil')
    expect(within(trep).getByText('Primary')).toBeInTheDocument()
    expect(trep).toHaveTextContent('Tyvaso · United Therapeutics')
    expect(trep).toHaveTextContent('Collecting · 50%')
    expect(trep).toHaveTextContent('909')
    expect(trep).toHaveTextContent('Study highlights inhaled treprostinil in IPF')
    expect(trep).toHaveTextContent('Oct 5, 2026')
    await waitFor(() => expect(trep).toHaveTextContent('US, EU'))

    const nint = rowOf('Nintedanib')
    expect(within(nint).getByText('Competitor')).toBeInTheDocument()
    expect(nint).toHaveTextContent('Ofev · Boehringer Ingelheim · vs Treprostinil')
    expect(nint).toHaveTextContent('Ready')
  })

  it('filters by kind with badges on every view, and keeps the filter in the URL', async () => {
    const router = renderSearch()
    await screen.findByRole('link', { name: 'Treprostinil' })
    await userEvent.click(screen.getByRole('button', { name: 'Primary 2' }))
    expect(router.state.location.search).toBe('?kind=primary')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
    expect(screen.getAllByText('Primary', { selector: 'span' })).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Competitors 1' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(within(rowOf('Nintedanib')).getByText('Competitor')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'All 3' }))
    expect(router.state.location.search).toBe('')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4))
  })

  it('searches by brand and shows an empty state that points to Asset AI', async () => {
    const router = renderSearch()
    const input = await screen.findByRole('textbox', { name: 'Search assets' })
    await userEvent.type(input, 'ofev')
    expect(router.state.location.search).toBe('?q=ofev')
    expect(screen.getAllByRole('row')).toHaveLength(2)
    await userEvent.clear(input)
    await userEvent.type(input, 'zzz')
    expect(screen.getByText('No assets match “zzz”')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add it with Asset AI' })).toHaveAttribute('href', '/chat?intent=add')
  })

  it('shows the grid from the URL with kind badges and rivals, and toggles back to the table', async () => {
    const router = renderSearch('/assets?view=grid')
    const card = await screen.findByRole('link', { name: /Nintedanib/ })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(within(card).getByText('Competitor')).toBeInTheDocument()
    expect(card).toHaveTextContent('vs Treprostinil')
    expect(within(card).getByRole('img', { name: /Key events per year/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('opens an asset from anywhere on its row', async () => {
    const router = renderSearch()
    await userEvent.click(await screen.findByText('Winrevair · Merck'))
    expect(router.state.location.pathname).toBe('/assets/sota/overview')
  })
})
