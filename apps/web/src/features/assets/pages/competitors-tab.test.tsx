import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
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

/** The landscape row (`<tr>`) that links to this asset. */
const landscapeRow = (name: string) => screen.getByRole('link', { name }).closest('tr')!

beforeAll(() => {
  // jsdom has no pointer capture; sonner's toasts call it on pointerdown.
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('CompetitorsTab', () => {
  it('renders the landscape: reference first, coverage per indication, collecting competitors', async () => {
    fetchMock.mockResolvedValue(json(200, OVERVIEW))
    const router = renderTab()

    await screen.findByRole('heading', { name: 'Competitive landscape' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/assets/treprostinil/competitors')

    // Indication columns use the abbreviation, with the full name on hover.
    expect(screen.getByTitle('Pulmonary arterial hypertension (PAH)')).toHaveTextContent('PAH')
    expect(screen.getByTitle('PH-ILD')).toBeInTheDocument()

    const reference = landscapeRow('Treprostinil')
    expect(within(reference).getByText('This asset')).toBeInTheDocument()
    expect(within(reference).getByText('Reference')).toBeInTheDocument()
    expect(within(reference).getByText('Investigational')).toBeInTheDocument()

    const sotatercept = landscapeRow('Sotatercept')
    expect(sotatercept).toHaveAttribute('title', 'Approved for PAH, the same indication.')
    expect(within(sotatercept).getByText('Approved')).toBeInTheDocument()
    expect(within(sotatercept).getByText('Not indicated')).toBeInTheDocument()
    expect(within(sotatercept).getByText('2024')).toBeInTheDocument()
    expect(within(sotatercept).getByText('US, EU')).toBeInTheDocument()
    expect(within(sotatercept).getByText(/\+1 other indication/)).toHaveAttribute('title', 'CTEPH')
    expect(sotatercept).toHaveTextContent('1 / 2')

    const ralinepag = landscapeRow('Ralinepag')
    expect(within(ralinepag).getByText('Collecting data')).toBeInTheDocument()
    expect(within(ralinepag).getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 competitor is still being collected')

    // Head-to-head uses the news row (news + press releases + abstracts).
    expect(screen.getByText('News & abstracts')).toBeInTheDocument()

    // Clicking anywhere on a row opens that asset.
    await userEvent.click(within(sotatercept).getByText('Activin signaling inhibitor'))
    expect(router.state.location.pathname).toBe('/assets/sotatercept/overview')
  })

  it('opens a signal’s source record under the competitor asset', async () => {
    fetchMock.mockImplementation(async (url) =>
      url.includes('/record/') ? json(200, { key: 'BLA761363', title: 'Winrevair BLA' }) : json(200, OVERVIEW),
    )
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /FDA approves Winrevair/ }))
    await screen.findByText('Winrevair BLA')
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/sotatercept/record/regulatory?key=BLA761363', expect.anything())
  })

  it('filters milestones by type and only offers chips that have milestones', async () => {
    fetchMock.mockResolvedValue(json(200, OVERVIEW))
    renderTab()
    const chips = within(await screen.findByRole('group', { name: 'Filter milestones by type' }))
    const table = () => screen.getByRole('columnheader', { name: 'Impact' }).closest('table')!

    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All4',
      'Trial readouts2',
      'Regulatory decisions1',
      'Patent expiries1',
    ])
    expect(within(table()).getAllByRole('row')).toHaveLength(5)

    await userEvent.click(chips.getByRole('button', { name: /Trial readouts/ }))
    expect(chips.getByRole('button', { name: /Trial readouts/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(table()).getByText('HYPERION')).toBeInTheDocument()
    expect(within(table()).getByText('ZENITH top-line results')).toBeInTheDocument()
    expect(within(table()).queryByText('EU decision on label expansion')).not.toBeInTheDocument()

    await userEvent.click(chips.getByRole('button', { name: /Patent expiries/ }))
    expect(within(table()).getAllByRole('row')).toHaveLength(2)
    expect(within(table()).getByText('Composition-of-matter patent expires')).toBeInTheDocument()

    await userEvent.click(chips.getByRole('button', { name: /All/ }))
    expect(within(table()).getAllByRole('row')).toHaveLength(5)
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
    expect(await screen.findByRole('heading', { name: 'Competitive landscape' })).toBeInTheDocument()
  })

  it('points competitor assets to the primaries they compete with', async () => {
    renderTab({ ...ASSET, id: 'ralinepag', name: 'Ralinepag', kind: 'competitor', competitorOf: [{ id: 'treprostinil', name: 'Treprostinil' }] } as AssetDetail)
    expect(await screen.findByText('Competitors are tracked for primary assets')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Treprostinil' })).toHaveAttribute('href', '/assets/treprostinil/competitors')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
