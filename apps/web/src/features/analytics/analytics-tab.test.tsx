import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { routes } from '@/routes'
import { ASSET_TABS } from '@/features/assets/pages/asset-layout'
import type { AssetDetail } from '@/features/assets/api'
import type { AssetAnalytics } from './api'
import { AnalyticsTab } from './analytics-tab'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET = { id: 'trep', name: 'Trep', kpis: { approvalRegions: ['US', 'EU'] }, counts: { trials: 21 } } as unknown as AssetDetail

const FULL: AssetAnalytics = {
  pipeline: [
    { id: 'pah', label: 'PAH', full: 'Pulmonary arterial hypertension', color: '#2347d9', ended: null, stage: 4, n: 3, next: null, since: '2017-05-01' },
    { id: 'ipf', label: 'IPF', full: 'Idiopathic pulmonary fibrosis', color: null, ended: null, stage: 2, n: 2, next: { id: 'e1', title: 'Phase 3 readout expected: TETON', date: '2999-01-01' }, since: null },
    { id: 'copd', label: 'COPD', full: 'PH due to COPD', color: '#e0620f', ended: '2018-01-01', stage: 1, n: 1, next: null, since: '2016-01-01' },
  ],
  activityByYear: { cols: [2020, 2021], series: [{ k: 'regulatory', l: 'Regulatory', vals: [1, 2] }, { k: 'ip', l: 'Patents', vals: [0, 1] }] },
  trials: [
    { nct: 'NCT1', name: 'TRIUMPH I', title: 'A study', phase: 'Phase 3', status: 'COMPLETED', start: '2005-01-01', pcd: '2008-06-01', enrollment: 235, indication: 'PAH', company: true, active: false },
    { nct: 'NCT2', name: 'PERFECT', title: 'Another', phase: 'Phase 2', status: 'TERMINATED', start: '2018-01-01', pcd: '', enrollment: 141, indication: 'PH-COPD', company: true, active: false },
  ],
  recordsByYear: [{ coll: 'fda_records', year: 2020, n: 2 }, { coll: 'trial_records', year: 2022, n: 1 }],
  sourceMix: [{ coll: 'fda_records', n: 2 }, { coll: 'trial_records', n: 1 }],
  triageFunnel: { screened: 100, relevant: 50, ingested: 25, candidates: 10, journey: 5 },
  patents: [
    { number: 'US 1', title: 'Old', granted: '2000-01-01', expiry: '2020-01-01', status: 'Expired', invalidated: false, expired: true },
    { number: 'US 2', title: 'Gone', granted: '2010-01-01', expiry: '2030-01-01', status: 'Revoked', invalidated: true, expired: false },
    { number: 'US 3', title: 'Live', granted: '2012-01-01', expiry: '2035-01-01', status: 'Active', invalidated: false, expired: false },
    { number: 'US 4', title: 'Later', granted: '2015-01-01', expiry: '2041-01-01', status: 'Active', invalidated: false, expired: false },
  ],
  landscape: {
    cols: ['Pulmonary arterial hypertension (PAH)', 'IPF'],
    rows: [
      { id: 'trep', name: 'Trep', company: 'UT', me: true, cells: { 'Pulmonary arterial hypertension (PAH)': 'approved', IPF: 'investigational' } },
      { id: 'c1', name: 'Rival', company: 'RivalCo', me: false, cells: { 'Pulmonary arterial hypertension (PAH)': 'none', IPF: 'approved' } },
    ],
  },
  significance: { High: 3, Medium: 2, Low: 1 },
  stats: { approvedIndications: 3, inDevelopment: ['IPF', 'PPF'], activeTrials: 3, phase3: 2, patients: 1335, nextCatalyst: { id: 'e1', title: 'TETON readout', date: '2999-01-01' }, evidenceRecords: 638 },
}
const EMPTY: AssetAnalytics = {
  pipeline: [{ id: 'PAH', label: 'PAH', full: 'PAH', color: null, ended: null, stage: 4, n: 0, next: null, since: null }],
  activityByYear: { cols: [], series: [] },
  trials: [],
  recordsByYear: [],
  sourceMix: [],
  triageFunnel: { screened: 0, relevant: 0, ingested: 0, candidates: 0, journey: 0 },
  patents: [],
  landscape: { cols: ['PAH'], rows: [{ id: 'x', name: 'Self', company: null, me: true, cells: { PAH: 'approved' } }] },
  significance: { High: 0, Medium: 0, Low: 0 },
  stats: { approvedIndications: 1, inDevelopment: [], activeTrials: 0, phase3: 0, patients: 0, nextCatalyst: null, evidenceRecords: 0 },
}

function renderTab() {
  const router = createMemoryRouter(
    [{ path: '/assets/:assetId', element: <Outlet context={ASSET} />, children: [{ path: 'analytics', element: <AnalyticsTab /> }] }],
    { initialEntries: ['/assets/trep/analytics'] },
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('AnalyticsTab', () => {
  it('renders every stat and chart title from the API blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, FULL))
    vi.stubGlobal('fetch', fetchMock)
    renderTab()
    expect(await screen.findByText('Approved indications')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/assets/trep/analytics')
    for (const label of ['In development', 'Active trials', 'Next catalyst', 'Evidence records']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('IPF, PPF')).toBeInTheDocument()
    expect(screen.getByText('2 in Phase 3 · 1,335 patients')).toBeInTheDocument()
    expect(screen.queryByText(/Patent runway/)).not.toBeInTheDocument()
    expect(screen.getByText('638')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
    expect(screen.getByText('6 journey events')).toBeInTheDocument()
    for (const t of [
      'Development pipeline', 'Journey activity by year', 'Clinical trial timeline', 'Trials by phase', 'Enrolment by indication',
      'Evidence collected over time', 'Source mix', 'AI triage funnel', 'Competitive landscape', 'Significance mix',
    ]) {
      expect(screen.getByRole('region', { name: t })).toBeInTheDocument()
    }
  })

  it('lists each approved indication with its regions, and prefers the API list when given', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, FULL)))
    const first = renderTab()
    const stat = (await screen.findByText('Approved indications')).parentElement!.parentElement!
    expect(stat).toHaveTextContent('PAH · US, EU')
    first.unmount()
    const approved = ['PAH', 'PH-ILD', 'CTEPH', 'PPF', 'IPF'].map((indication, i) => ({ indication, regions: i ? ['US'] : ['US', 'EU', 'JP'] }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { ...FULL, stats: { ...FULL.stats, approved } })))
    renderTab()
    expect((await screen.findByText('Approved indications')).parentElement!.parentElement!).toHaveTextContent('PAH · US, EU, JP')
    expect(screen.getByText('+1 more')).toHaveAttribute('title', 'IPF · US')
  })

  it('orders the trial timeline by phase under phase headings and filters it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, FULL)))
    renderTab()
    const card = await screen.findByRole('region', { name: 'Clinical trial timeline' })
    // PERFECT (Phase 2, 2018) comes before TRIUMPH I (Phase 3, 2005): phase first, not start date.
    expect(within(card).getByText('PERFECT').compareDocumentPosition(within(card).getByText('TRIUMPH I'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(card).getByText('Phase 2 · 1')).toBeInTheDocument()
    expect(within(card).getByText('Phase 3 · 1')).toBeInTheDocument()
    await userEvent.type(within(card).getByRole('searchbox'), 'triumph')
    expect(within(card).queryByText('PERFECT')).not.toBeInTheDocument()
    expect(within(card).getByText('TRIUMPH I')).toBeInTheDocument()
    expect(within(card).getByText('1 of 2')).toBeInTheDocument()
    await userEvent.type(within(card).getByRole('searchbox'), 'zzz')
    expect(within(card).getByText('Nothing matches these filters.')).toBeInTheDocument()
  })

  it('filters the landscape rows by search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, FULL)))
    renderTab()
    const heat = await screen.findByRole('region', { name: 'Competitive landscape' })
    await userEvent.type(within(heat).getByRole('searchbox'), 'rival')
    expect(within(heat).queryByText('Trep')).not.toBeInTheDocument()
    expect(within(heat).getByText('Rival')).toBeInTheDocument()
  })

  it('shows pipeline stages, terminated hatching copy, next milestone and since', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, FULL)))
    renderTab()
    const pipe = await screen.findByRole('region', { name: 'Development pipeline' })
    expect(within(pipe).getByText('Phase 2 · terminated')).toBeInTheDocument()
    expect(within(pipe).getByText('TETON')).toBeInTheDocument()
    expect(within(pipe).getByText('since 2017')).toBeInTheDocument()
    expect(within(pipe).getAllByText('Approved')).toHaveLength(2)
  })

  it('draws the landscape coverage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, FULL)))
    renderTab()
    const heat = await screen.findByRole('region', { name: 'Competitive landscape' })
    expect(within(heat).getByText('PAH')).toBeInTheDocument()
    expect(within(heat).getByText('In trials')).toBeInTheDocument()
    expect(within(heat).getAllByText('Approved')).toHaveLength(2)
  })

  it('falls back without trials, patents, evidence or triage data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, EMPTY)))
    renderTab()
    expect(await screen.findByText('Approved indications')).toBeInTheDocument()
    expect(screen.getByText('None scheduled')).toBeInTheDocument()
    expect(screen.getByText('ClinicalTrials.gov')).toBeInTheDocument()
    expect(screen.getByText('21')).toBeInTheDocument()
    for (const t of ['Clinical trial timeline', 'Trials by phase', 'Enrolment by indication', 'Evidence collected over time', 'Source mix', 'AI triage funnel', 'Competitive landscape']) {
      expect(screen.queryByRole('region', { name: t })).not.toBeInTheDocument()
    }
    expect(screen.getByText('No dated journey events yet.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Significance mix' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('shows a skeleton while loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    renderTab()
    expect(screen.getByRole('status', { name: 'Loading analytics' })).toBeInTheDocument()
  })

  it('shows an error when the analytics cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(500, { message: 'x' })))
    renderTab()
    expect(await screen.findByText(/Analytics couldn't be loaded/)).toBeInTheDocument()
  })
})

describe('Analytics route', () => {
  it('is registered after overview in the tabs and routes', () => {
    expect(ASSET_TABS.map((t) => t.path).slice(0, 2)).toEqual(['overview', 'analytics'])
    const find = (rs: typeof routes): (typeof routes)[number] | undefined =>
      rs.reduce<(typeof routes)[number] | undefined>((hit, r) => hit ?? (r.path === '/assets/:assetId' ? r : find(r.children ?? [])), undefined)
    const asset = find(routes)
    expect(asset?.children?.map((c) => c.path).slice(1, 3)).toEqual(['overview', 'analytics'])
  })
})
