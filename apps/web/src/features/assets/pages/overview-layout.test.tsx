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

describe('Overview layout (KPI strip → pinned analytics → journey)', () => {
  it('puts the KPI strip before the journey and drops the old right column', () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(404, { code: 'NOT_FOUND', message: url })))
    const router = createMemoryRouter([{ path: '/assets/:assetId', element: <Outlet context={ASSET} />, children: [{ path: 'overview', element: <OverviewTab /> }] }], {
      initialEntries: ['/assets/trep/overview'],
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    const kpis = screen.getByRole('region', { name: 'Key metrics' })
    expect(kpis).toHaveTextContent('Approved inUS, EU')
    const journey = screen.getByRole('heading', { name: 'Journey' })
    expect(kpis.compareDocumentPosition(journey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const analytics = screen.getByRole('region', { name: 'Pinned analytics' })
    expect(analytics.compareDocumentPosition(journey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(kpis.compareDocumentPosition(analytics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Upcoming milestones', { selector: 'h3' })).not.toBeInTheDocument()
  })
})
