import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import type { AssetDetail } from '../api'
import { OverviewTab } from './tabs'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET = {
  id: 'trep', name: 'Treprostinil', aliases: [], company: { name: 'United Therapeutics' }, tags: {}, kind: 'primary', status: 'ready', updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 4, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 105 },
  latestEvent: null, competitorOf: [], kpis: { approvalRegions: ['US', 'EU'], activeTrials: 9, activePhase3: 3, upcomingMilestones: 5 }, competitors: [], suggestedQuestions: [],
} as AssetDetail

afterEach(() => vi.unstubAllGlobals())

describe('OverviewTab', () => {
  it('shows the KPI strip, then the pinned analytics, then the journey section (old list journey gone)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.startsWith('/api/assets/trep/timeline?scope=key')
          ? json(200, { events: [{ id: 'a', asset: 'trep', date: '2002-05-21', type: 'approval', category: 'regulatory', title: 'FDA approves Remodulin', significance: 'High', is_milestone: false, sources: [], via: 'journey' }], total: 1 })
          : json(404, { code: 'NOT_FOUND', message: url }),
      ),
    )
    const router = createMemoryRouter(
      [{ path: '/assets/:assetId', element: <Outlet context={ASSET} />, children: [{ path: 'overview', element: <OverviewTab /> }] }],
      { initialEntries: ['/assets/trep/overview'] },
    )
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    const kpis = screen.getByRole('region', { name: 'Key metrics' })
    expect(kpis).toHaveTextContent('105')
    const journey = await screen.findByRole('region', { name: 'Asset journey' })
    expect(kpis.compareDocumentPosition(journey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(await screen.findByTestId('journey-horizontal')).toBeInTheDocument()
    const analytics = screen.getByRole('region', { name: 'Pinned analytics' })
    expect(analytics.compareDocumentPosition(journey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(kpis.compareDocumentPosition(analytics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Company-sponsored trials only')).not.toBeInTheDocument()
  })
})
