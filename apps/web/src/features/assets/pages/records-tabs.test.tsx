import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { AssetDetail, RecordsPage, SourceRecord } from '../api'
import { ClinicalTab, CompanyIrTab, ConferencesTab, DocumentsTab, PatentsTab, PublicationsTab, RegulatoryTab } from './tabs'

vi.mock('@/features/analytics/tab-insights', () => ({ TabInsights: () => null }))

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET = { id: 'trep', name: 'Treprostinil', status: 'ready', company: { name: 'United Therapeutics' }, counts: { trials: 74, regulatory: 2, pressReleases: 2, documents: 1, news: 0, publications: 1, conferences: 1, patents: 1, events: 0 } } as AssetDetail
const EVENT = { id: 'ev:1/a', title: 'TETON readout', date: '2025-03-02', category: 'clinical' as const, significance: 'High' as const }

const page = (items: SourceRecord[], extra: Partial<RecordsPage> = {}): RecordsPage => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  all: items.length,
  facets: [],
  ...extra,
})

const TRIAL: SourceRecord = {
  key: 'ctgov:NCT1',
  nct_id: 'NCT1',
  acronym: 'TETON',
  title: 'Inhaled treprostinil in IPF',
  phases: ['PHASE3'],
  overall_status: 'RECRUITING',
  conditions: ['IPF', 'PH-ILD'],
  lead_sponsor: 'United Therapeutics Corp',
  enrollment: 576,
  start_date: '2021-03-01',
  primary_completion_date: '2026-06-30',
  journey_events: [EVENT],
}
const TRIAL_B: SourceRecord = { ...TRIAL, key: 'ctgov:NCT2', nct_id: 'NCT2', acronym: undefined, title: 'Academic study', lead_sponsor: 'Academic Hospital', journey_events: [] }

const CLINICAL = page([TRIAL, TRIAL_B], {
  all: 74,
  facets: [
    { key: 'phases', label: 'Phase', values: [{ value: 'PHASE3', count: 9 }, { value: 'PHASE2', count: 3 }] },
    { key: 'overall_status', label: 'Status', values: [{ value: 'COMPLETED', count: 5 }, { value: 'RECRUITING', count: 2 }] },
    { key: 'conditions', label: 'Indication', values: [{ value: 'IPF', count: 4 }] },
  ],
})

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
const recordUrls = () => fetchMock.mock.calls.map(([u]) => u).filter((u) => u.includes('/records/'))

function renderTab(element: React.ReactElement, path: string, asset: AssetDetail = ASSET) {
  const router = createMemoryRouter(
    [{ path: '/assets/:assetId', element: <Outlet context={asset} />, children: [{ path, element }] }],
    { initialEntries: [`/assets/trep/${path}`] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

function respond(routes: Record<string, unknown>) {
  fetchMock = vi.fn(async (url: string) => {
    for (const [prefix, body] of Object.entries(routes)) if (url.startsWith(prefix)) return json(200, body)
    return json(200, page([]))
  })
  vi.stubGlobal('fetch', fetchMock)
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})
beforeEach(() => useEventSheet.setState({ current: null }))
afterEach(() => vi.unstubAllGlobals())

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent)

describe('records tabs: columns per tab (README §5.5)', () => {
  it.each([
    ['clinical', <ClinicalTab key="ClinicalTab" />, ['NCT ID', 'Study', 'Phase', 'Status', 'Indication', 'Sponsor', 'Enrolment', 'Start → primary completion', 'Journey'], { ...TRIAL }],
    ['regulatory', <RegulatoryTab key="RegulatoryTab" />, ['Date', 'Region', 'Record', 'Application', 'Product', 'Indication', 'Class', 'Status', 'Journey'], { key: 'fda:1', record_type: 'fda_submission', date: '2009-07-30', title: 'TYVASO' }],
    ['publications', <PublicationsTab key="PublicationsTab" />, ['PMID', 'Title', 'Journal', 'Year', 'Design', 'Journey'], { key: 'pubmed:1', title: 'A paper' }],
    ['conferences', <ConferencesTab key="ConferencesTab" />, ['Congress', 'Date', 'Abstract', 'Format', 'Journey'], { key: 'c:1', title: 'An abstract', conference: 'ATS' }],
    ['documents', <DocumentsTab key="DocumentsTab" />, ['Document', 'Type', 'Date', 'Pages', 'Journey'], { key: 'd:1', title: 'PI.pdf', record_type: 'prescribing_info' }],
    ['company-ir', <CompanyIrTab key="CompanyIrTab" />, ['Date', 'Title', 'Category', 'Journey'], { key: 'p:1', title: 'A release' }],
    ['patents', <PatentsTab key="PatentsTab" />, ['Patent', 'Title', 'Covers', 'Assignee', 'Granted', 'Expiry', 'Status', 'Journey'], { key: 'pat:1', title: 'A patent', publication_number: 'US1B2' }],
  ] as const)('%s', async (path, element, expected, record) => {
    respond({ '/api/assets/trep/series': [], [`/api/assets/trep/records/${path}`]: page([record as SourceRecord]) })
    renderTab(element, path)
    await screen.findAllByRole('columnheader')
    expect(headers()).toEqual(expected)
  })
})

describe('clinical records panel', () => {
  it('shows the clinical cells, the distribution bar, facet selects, the toggle and the footer', async () => {
    respond({ '/api/assets/trep/records/clinical': CLINICAL })
    renderTab(<ClinicalTab />, 'clinical')

    expect(await screen.findByText('TETON')).toBeInTheDocument()
    expect(screen.getByText('Inhaled treprostinil in IPF')).toBeInTheDocument()
    expect(within(screen.getAllByRole('row')[1]).getByText('Phase 3')).toBeInTheDocument()
    expect(screen.getAllByText('Recruiting').length).toBeGreaterThan(0)
    expect(screen.getAllByText('IPF').length).toBeGreaterThan(0)
    // Every condition is an indication badge in the row.
    expect(screen.getAllByTitle('Indication: PH-ILD').length).toBeGreaterThan(0)
    expect(screen.getAllByText('576').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2021-03 → 2026-06').length).toBeGreaterThan(0)
    expect(screen.getByText('74 records collected')).toBeInTheDocument()
    // Rows shown of those available; the store suffix only when the store holds more.
    expect(screen.getByText('Showing 2 of 74')).toBeInTheDocument()

    // Distribution bar: the first facet, legend with counts; the other facets are selects.
    expect(screen.getByText('Phase', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Phase 3\s*9/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Phase 2\s*3/ })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Indication' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Phase' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Company-sponsored only' })).toBeInTheDocument()
  })

  it('filters by a legend click (facet JSON in the query), a select and the toggle', async () => {
    respond({ '/api/assets/trep/records/clinical': CLINICAL })
    renderTab(<ClinicalTab />, 'clinical')
    await screen.findByText('TETON')

    await userEvent.click(screen.getByRole('button', { name: /Phase 3\s*9/ }))
    await waitFor(() => expect(decodeURIComponent(recordUrls().at(-1)!)).toContain('facets={"phases":"PHASE3"}'))
    expect(screen.getByRole('button', { name: /Phase 3\s*9/ })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Completed' }))
    await waitFor(() => expect(decodeURIComponent(recordUrls().at(-1)!)).toContain('facets={"phases":"PHASE3","overall_status":"COMPLETED"}'))

    await userEvent.click(screen.getByRole('switch', { name: 'Company-sponsored only' }))
    await waitFor(() => expect(recordUrls().at(-1)).toContain('companyOnly=true'))

    // Legend click again clears the phase.
    await userEvent.click(screen.getByRole('button', { name: /Phase 3\s*9/ }))
    await waitFor(() => expect(decodeURIComponent(recordUrls().at(-1)!)).not.toContain('"phases"'))
  })

  it('mutes the sponsor when it is not the asset company', async () => {
    respond({ '/api/assets/trep/records/clinical': CLINICAL })
    renderTab(<ClinicalTab />, 'clinical')
    await screen.findByText('TETON')
    expect(screen.getByText('Academic Hospital')).toHaveClass('text-muted-foreground')
    expect(screen.getByText('United Therapeutics Corp')).not.toHaveClass('text-muted-foreground')
  })
})

describe('Journey column and record sheet', () => {
  it('opens the event through the sheet seam, not the record', async () => {
    respond({ '/api/assets/trep/records/clinical': CLINICAL })
    renderTab(<ClinicalTab />, 'clinical')
    await screen.findByText('TETON')

    await userEvent.click(screen.getByRole('button', { name: 'Open in the journey: TETON readout' }))
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'ev:1/a' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The record without events shows a dash, not a link.
    const rows = screen.getAllByRole('row')
    expect(within(rows[2]).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rows[2]).getByText('—', { selector: 'span' })).toBeInTheDocument()
  })

  it('has no "In the journey" section for a record that feeds no event', async () => {
    respond({
      '/api/assets/trep/records/clinical': CLINICAL,
      '/api/assets/trep/record/clinical': { ...TRIAL_B, date: '2021-03-01' },
    })
    renderTab(<ClinicalTab />, 'clinical')
    await userEvent.click(await screen.findByText('Academic study'))
    // That record has no events: no section.
    await screen.findByRole('dialog')
    expect(screen.queryByText('In the journey')).not.toBeInTheDocument()
  })

  it('shows the section for a record that feeds events', async () => {
    respond({
      '/api/assets/trep/records/clinical': CLINICAL,
      '/api/assets/trep/record/clinical': { ...TRIAL, date: '2021-03-01' },
    })
    renderTab(<ClinicalTab />, 'clinical')
    await userEvent.click(await screen.findByText('TETON'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('In the journey')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /TETON readout/ }))
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'ev:1/a' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('footer and header total', () => {
  it('adds the record-store suffix only when the store holds more than is available', async () => {
    respond({ '/api/assets/trep/records/clinical': { ...CLINICAL, all: 70 } })
    renderTab(<ClinicalTab />, 'clinical')
    expect(await screen.findByText('Showing 2 of 70 · 74 in the record store')).toBeInTheDocument()
  })

  it('shows "N records collected" only on tabs the prototype gives a total', async () => {
    respond({ '/api/assets/trep/records/conferences': page([{ key: 'c:1', title: 'An abstract', conference: 'ATS' }], { all: 38 }) })
    renderTab(<ConferencesTab />, 'conferences')
    await screen.findByText('An abstract')
    expect(screen.queryByText(/records collected/)).not.toBeInTheDocument()
  })

  it('shows the congress with its year in the column', async () => {
    respond({ '/api/assets/trep/records/conferences': page([{ key: 'c:1', title: 'An abstract', conference: 'CHEST', year: 2025 }]) })
    renderTab(<ConferencesTab />, 'conferences')
    expect(await screen.findByText('CHEST 2025')).toBeInTheDocument()
  })
})

describe('records presentation and paging', () => {
  it('shows the short indication badges with the remaining count, and the rest on hover', async () => {
    const record = { ...TRIAL, conditions: ['Pulmonary arterial hypertension (PAH)', 'Interstitial lung disease', 'PH-ILD'] }
    respond({ '/api/assets/trep/records/clinical': page([record]) })
    renderTab(<ClinicalTab />, 'clinical')
    expect(await screen.findByTitle('Indication: PAH')).toHaveTextContent('PAH')
    expect(screen.getByTitle('Indication: Interstitial lung disease')).toBeInTheDocument()
    expect(screen.getByTitle('PH-ILD')).toHaveTextContent('+1')
    expect(screen.queryByText(/Pulmonary arterial/)).not.toBeInTheDocument()
  })

  it('shows an EMA record\'s therapeutic area and an orphan designation\'s intended use as its indication, and nothing for FDA submissions', async () => {
    respond({
      '/api/assets/trep/series': [],
      '/api/assets/trep/records/regulatory': page([
        { key: 'ema:1', record_type: 'ema_epar', date: '2020-01-01', name_of_medicine: 'Orepaxam', therapeutic_area_mesh: 'Hypertension, Pulmonary' },
        { key: 'ema:2', record_type: 'ema_orphan_designation', date: '2020-01-02', title: 'Orphan', intended_use: 'Treatment of idiopathic pulmonary fibrosis' },
        { key: 'fda:1', record_type: 'fda_submission', date: '2009-07-30', title: 'TYVASO' },
      ]),
    })
    renderTab(<RegulatoryTab />, 'regulatory')
    expect(await screen.findByTitle('Indication: Hypertension, Pulmonary')).toBeInTheDocument()
    expect(screen.getByTitle('Indication: idiopathic pulmonary fibrosis')).toBeInTheDocument()
    expect(screen.getAllByTitle(/^Indication:/)).toHaveLength(2)
  })

  it('writes dates the US way (Mon D, YYYY)', async () => {
    respond({ '/api/assets/trep/series': [], '/api/assets/trep/records/regulatory': page([{ key: 'fda:1', record_type: 'fda_submission', date: '2009-07-30', title: 'TYVASO' }]) })
    renderTab(<RegulatoryTab />, 'regulatory')
    expect(await screen.findByText('Jul 30, 2009')).toBeInTheDocument()
    expect(screen.queryByText('2009-07-30')).not.toBeInTheDocument()
  })

  it('pages 25 rows at a time and asks the API for the next page', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ ...TRIAL, key: `ctgov:N${i}`, nct_id: `N${i}`, acronym: `ACR${i}`, journey_events: [] }))
    respond({ '/api/assets/trep/records/clinical': page(items, { total: 60, all: 60 }) })
    renderTab(<ClinicalTab />, 'clinical')
    await screen.findByText('ACR0')
    expect(recordUrls()[0]).toContain('pageSize=25')
    expect(screen.getByText('1–25 of 60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(recordUrls().some((u) => u.includes('page=2') && u.includes('pageSize=25'))).toBe(true))
  })

  it('shows an error with a working retry', async () => {
    let failing = true
    fetchMock = vi.fn(async () => (failing ? json(500, { code: 'ERROR', message: 'boom' }) : json(200, CLINICAL)))
    vi.stubGlobal('fetch', fetchMock)
    renderTab(<ClinicalTab />, 'clinical')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("These records couldn't be loaded.")
    failing = false
    await userEvent.click(within(alert).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByText('TETON')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('onboarding state', () => {
  const onboarding = { ...ASSET, status: 'onboarding' } as AssetDetail
  const job = (status: string) => [{ id: 'j1', steps: [{ name: 'clinical', label: 'ClinicalTrials.gov studies', status }] }]

  it('shows the step pill and the queued empty state', async () => {
    respond({ '/api/jobs': job('pending'), '/api/assets/trep/records/clinical': page([]) })
    renderTab(<ClinicalTab />, 'clinical', onboarding)
    expect(await screen.findByText('ClinicalTrials.gov: queued')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('This tab fills in when “ClinicalTrials.gov studies” runs.')).toBeInTheDocument()
  })

  it('shows running with the rows collected so far, and no store total', async () => {
    respond({ '/api/jobs': job('running'), '/api/assets/trep/records/clinical': { ...CLINICAL, all: 2 } })
    renderTab(<ClinicalTab />, 'clinical', onboarding)
    expect(await screen.findByText('ClinicalTrials.gov: running')).toBeInTheDocument()
    expect(await screen.findByText('TETON')).toBeInTheDocument()
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument()
  })

  it('does not fetch jobs for a ready asset', async () => {
    respond({ '/api/assets/trep/records/clinical': CLINICAL })
    renderTab(<ClinicalTab />, 'clinical')
    await screen.findByText('TETON')
    expect(fetchMock.mock.calls.some(([u]) => u.startsWith('/api/jobs'))).toBe(false)
  })
})
