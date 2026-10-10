import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { AssetDetail } from '../api'
import type { CompetitorMilestone, CompetitorsOverview, LandscapeRow } from '../competitors-api'
import { CompetitorsTab } from './competitors-tab'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET = {
  id: 'treprostinil',
  name: 'Treprostinil',
  aliases: [],
  company: { name: 'United Therapeutics' },
  tags: { indications: ['Pulmonary arterial hypertension (PAH)'], investigational_indications: ['PH-ILD'], mechanism: 'Prostacyclin analogue' },
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null,
  kpis: { approvalRegions: ['US'], activeTrials: 0, activePhase3: 0, upcomingMilestones: 0 },
  competitors: [],
  competitorOf: [],
  suggestedQuestions: [],
} as AssetDetail

const INDICATIONS = ['Pulmonary arterial hypertension (PAH)', 'PH-ILD']

function row(overrides: Partial<LandscapeRow> & Pick<LandscapeRow, 'id' | 'name'>): LandscapeRow {
  return {
    company: 'Co',
    mechanism: null,
    modality: null,
    status: 'ready',
    isReference: false,
    coverage: {},
    otherIndications: [],
    overlap: { shared: 0, of: 2 },
    firstApproval: null,
    approvalRegions: [],
    activeTrials: 0,
    activePhase3: 0,
    ...overrides,
  }
}

function milestone(id: string, type: string, category: CompetitorMilestone['category'], title: string): CompetitorMilestone {
  return {
    id,
    assetId: 'sotatercept',
    assetName: 'Sotatercept',
    company: 'Merck & Co.',
    date: '2027-03-31',
    title,
    type,
    category,
    significance: 'High',
    indication: 'PAH',
    phase: null,
    sources: [{ collection: 'trial_records', record_key: id }],
  }
}

const REFERENCE_ROW = row({
  id: 'treprostinil',
  name: 'Treprostinil',
  company: 'United Therapeutics',
  mechanism: 'Prostacyclin analogue',
  isReference: true,
  coverage: { [INDICATIONS[0]]: 'approved', [INDICATIONS[1]]: 'investigational' },
  firstApproval: '2002-05-21',
  approvalRegions: ['US'],
})

const OVERVIEW: CompetitorsOverview = {
  reference: { id: 'treprostinil', name: 'Treprostinil', company: 'United Therapeutics', mechanism: 'Prostacyclin analogue', indications: INDICATIONS },
  kpis: { tracked: 2, candidates: 9, collecting: 1, activePhase3: 4, upcomingMilestones: 4, firstMilestone: '2027-03-31' },
  landscape: [
    REFERENCE_ROW,
    row({
      id: 'sotatercept',
      name: 'Sotatercept',
      company: 'Merck & Co.',
      brand: 'Winrevair',
      stage: 'approved',
      basis: 'both',
      mechanism: 'Activin signaling inhibitor',
      reason: 'Approved for PAH, the same indication.',
      coverage: { [INDICATIONS[0]]: 'approved', [INDICATIONS[1]]: 'none' },
      otherIndications: ['CTEPH'],
      overlap: { shared: 1, of: 2 },
      firstApproval: '2024-03-26',
      approvalRegions: ['US', 'EU'],
    }),
    row({
      id: 'ralinepag',
      name: 'Ralinepag',
      company: 'United Therapeutics',
      mechanism: 'Prostacyclin receptor agonist',
      status: 'onboarding',
      stage: 'phase3',
      basis: 'mechanism',
      reason: 'Prostacyclin receptor agonist in Phase 3 for PAH.',
      coverage: { [INDICATIONS[0]]: 'investigational', [INDICATIONS[1]]: 'none' },
      overlap: { shared: 1, of: 2 },
    }),
  ],
  evidence: [
    { id: 'treprostinil', name: 'Treprostinil', trials: { total: 48, recent: 12 }, publications: { total: 36, recent: 8 }, regulatory: { total: 22, recent: 6 }, news: { total: 12, recent: 3 } },
    { id: 'sotatercept', name: 'Sotatercept', trials: { total: 28, recent: 6 }, publications: { total: 24, recent: 5 }, regulatory: { total: 12, recent: 6 }, news: { total: 8, recent: 3 } },
  ],
  signals: [
    {
      id: 's1',
      assetId: 'sotatercept',
      assetName: 'Sotatercept',
      date: '2024-03-26',
      title: 'FDA approves Winrevair',
      type: 'approval',
      category: 'regulatory',
      significance: 'High',
      sources: [{ collection: 'fda_records', record_key: 'BLA761363' }],
    },
  ],
  milestones: [
    milestone('m1', 'expected_readout', 'clinical', 'Phase 3 primary completion expected: HYPERION'),
    milestone('m2', 'trial_readout', 'clinical', 'ZENITH top-line results'),
    milestone('m3', 'regulatory_decision_expected', 'regulatory', 'EU decision on label expansion'),
    milestone('m4', 'patent_expiry', 'ip', 'Composition-of-matter patent expires'),
  ],
}

const EMPTY: CompetitorsOverview = {
  ...OVERVIEW,
  kpis: { tracked: 0, candidates: 0, collecting: 0, activePhase3: 0, upcomingMilestones: 0, firstMilestone: null },
  landscape: [REFERENCE_ROW],
  evidence: [OVERVIEW.evidence[0]],
  signals: [],
  milestones: [],
}

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>

function renderTab(asset: AssetDetail = ASSET) {
  const router = createMemoryRouter(
    [
      {
        path: '/assets/:assetId',
        element: <Outlet context={asset} />,
        children: [
          { path: 'competitors', element: <CompetitorsTab /> },
          { path: 'overview', element: <p>Overview page</p> },
        ],
      },
      { path: '/jobs/:jobId', element: <p>Job page</p> },
    ],
    { initialEntries: [`/assets/${asset.id}/competitors`] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )
  return router
}

beforeAll(() => {
  // jsdom has no pointer capture; sonner's toasts call it on pointerdown.
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  useEventSheet.setState({ current: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('CompetitorsTab', () => {
  it('lists the tracked competitors as cards (reference left out) with stage, brand, mechanism and basis', async () => {
    fetchMock.mockResolvedValue(json(200, OVERVIEW))
    const router = renderTab()

    expect(await screen.findAllByRole('link', { name: /Open journey/ })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Competitors' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/assets/treprostinil/competitors')

    const card = screen.getByText('Sotatercept').closest('div.rounded-\\[12px\\]') as HTMLElement
    expect(card).toHaveTextContent('Winrevair · Merck & Co.')
    expect(within(card).getByText('Approved', { selector: 'span.rounded-\\[5px\\]' })).toBeInTheDocument()
    expect(within(card).getByText('Activin signaling inhibitor')).toBeInTheDocument()
    expect(within(card).getByText('Shared indication and mechanism')).toBeInTheDocument()

    const ralinepag = screen.getByText('Ralinepag').closest('div.rounded-\\[12px\\]') as HTMLElement
    expect(within(ralinepag).getByText('Phase 3')).toBeInTheDocument()
    expect(within(ralinepag).getByText('Shared mechanism')).toBeInTheDocument()
    expect(screen.queryByText('This asset')).not.toBeInTheDocument()

    await userEvent.click(within(card).getByRole('link', { name: /Open journey/ }))
    expect(router.state.location.pathname).toBe('/assets/sotatercept/overview')
  })

  it('shows a coverage chip per indication of the primary: approved, investigational or not indicated', async () => {
    fetchMock.mockResolvedValue(json(200, OVERVIEW))
    renderTab()
    await screen.findByText('Sotatercept')
    const sotatercept = screen.getByText('Sotatercept').closest('div.rounded-\\[12px\\]') as HTMLElement
    // Indication names use their abbreviation, with the full name and the coverage on hover.
    const pah = within(sotatercept).getByTitle('Pulmonary arterial hypertension (PAH): Approved')
    expect(pah).toHaveTextContent('PAH')
    expect(within(sotatercept).getByTitle('PH-ILD: Not indicated')).toHaveTextContent('PH-ILD')

    const ralinepag = screen.getByText('Ralinepag').closest('div.rounded-\\[12px\\]') as HTMLElement
    expect(within(ralinepag).getByTitle('Pulmonary arterial hypertension (PAH): Investigational')).toHaveTextContent('PAH')
    expect(within(ralinepag).getByTitle('PH-ILD: Not indicated')).toBeInTheDocument()
  })

  it('offers to identify competitors when none are tracked, and starts only the competitors step', async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? json(201, { id: 'job-1', asset: 'treprostinil', status: 'queued' }) : json(200, EMPTY),
    )
    const router = renderTab()

    await userEvent.click(await screen.findByRole('button', { name: 'Identify competitors' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(url).toBe('/api/assets/treprostinil/refresh')
    expect(JSON.parse(init!.body as string)).toEqual({ steps: ['competitors'] })

    await userEvent.click(await screen.findByRole('button', { name: 'View progress' }))
    expect(router.state.location.pathname).toBe('/jobs/job-1')
  })

  it('says so when a refresh is already running', async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? json(409, { code: 'JOB_ALREADY_RUNNING', message: 'busy' }) : json(200, EMPTY),
    )
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Identify competitors' }))
    expect(await screen.findByText('A data refresh is already running for this asset')).toBeInTheDocument()
  })

  it('shows an error with a working retry', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { code: 'ERROR', message: 'boom' })).mockResolvedValue(json(200, OVERVIEW))
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /Try again/ }))
    expect(await screen.findByRole('heading', { name: 'Competitors' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('points competitor assets to the primaries they compete with', async () => {
    fetchMock.mockImplementation(async (url) =>
      url === '/api/assets/treprostinil' ? json(200, { ...ASSET, aliases: ['Tyvaso'] }) : json(404, { code: 'NOT_FOUND', message: url }),
    )
    renderTab({ ...ASSET, id: 'ralinepag', name: 'Ralinepag', kind: 'competitor', competitorOf: [{ id: 'treprostinil', name: 'Treprostinil' }] } as AssetDetail)
    expect(await screen.findByRole('heading', { name: 'Competes with' })).toBeInTheDocument()
    expect(await screen.findByText('Tyvaso · United Therapeutics')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open journey/ })).toHaveAttribute('href', '/assets/treprostinil/overview')
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/competitors'))).toBe(false)
  })

  it('explains that competitors are tracked for primary assets when a competitor has none', async () => {
    renderTab({ ...ASSET, id: 'ralinepag', name: 'Ralinepag', kind: 'competitor', competitorOf: [] } as AssetDetail)
    expect(await screen.findByText('Competitors are tracked for primary assets')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
