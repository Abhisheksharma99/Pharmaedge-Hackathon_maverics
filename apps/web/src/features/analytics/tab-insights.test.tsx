import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { TabInsights } from './tab-insights'
import type { InsightsTab, TabInsightsData } from './tab-insights-api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const base = (tab: InsightsTab, extra: Partial<TabInsightsData> = {}): TabInsightsData => ({
  tab,
  total: 5,
  byYear: [{ year: 2020, n: 2 }, { year: 2022, n: 3 }],
  byYearGroup: [],
  facets: {},
  ...extra,
})

const FIXTURES: Record<InsightsTab, { data: TabInsightsData; titles: string[] }> = {
  clinical: {
    data: base('clinical', {
      byYearGroup: [{ year: 2020, group: 'company', n: 2 }, { year: 2022, group: 'other', n: 3 }],
      facets: {
        phases: [{ value: 'PHASE3', n: 3 }, { value: 'PHASE2', n: 2 }],
        overall_status: [{ value: 'COMPLETED', n: 4 }, { value: 'ACTIVE_NOT_RECRUITING', n: 1 }],
      },
    }),
    titles: ['Phase', 'Status', 'Trial starts by year'],
  },
  regulatory: {
    data: base('regulatory', {
      byYearGroup: [{ year: 2020, group: 'US', n: 2 }, { year: 2022, group: 'EU', n: 3 }],
      facets: { submission_status: [{ value: 'Approved', n: 4 }], product: [{ value: 'Tyvaso', n: 4 }] },
    }),
    titles: ['Regulatory activity by year', 'Outcome', 'By product'],
  },
  publications: {
    data: base('publications', { facets: { publication_types: [{ value: 'RCT', n: 3 }], journal: [{ value: 'Chest', n: 2 }] } }),
    titles: ['Publications per year', 'Study design', 'Journals'],
  },
  conferences: {
    data: base('conferences', {
      byYearGroup: [{ year: 2023, group: 'ATS', n: 1 }, { year: 2024, group: 'ERS', n: 2 }],
      facets: { session_type: [{ value: 'Poster', n: 2 }, { value: 'Late-breaking', n: 1 }] },
    }),
    titles: ['Abstracts by congress and year', 'Format'],
  },
  'company-ir': {
    data: base('company-ir', { byYearGroup: [{ year: 2020, group: 'Regulatory', n: 2 }, { year: 2022, group: 'Clinical', n: 3 }] }),
    titles: ['Press releases by year and topic', 'Topics'],
  },
  patents: {
    data: base('patents', {
      facets: { legal_status: [{ value: 'Active', n: 1 }, { value: 'Expired', n: 1 }] },
      terms: [
        { number: 'US1', title: 'T', granted: '2015-01-27', expiry: '2032-04-20', status: 'Active', assignee: 'Acme' },
        { number: 'US2', title: 'T2', granted: '2001-01-01', expiry: '2020-01-01', status: 'Expired', assignee: 'Acme' },
      ],
    }),
    titles: ['Patent terms', 'Status'],
  },
  evidence: {
    data: base('evidence', {
      total: 186,
      byYear: [],
      facets: { decision: [{ value: 'ingest', n: 4 }, { value: 'skip', n: 3 }], source: [{ value: 'a.com', n: 2 }] },
      triage: { screened: 186, relevant: 74, ingested: 41, journey: 13 },
    }),
    titles: ['AI triage', 'Decisions', 'Top sources'],
  },
  documents: {
    data: base('documents', {
      facets: { record_type: [{ value: 'annual_report', n: 2 }, { value: 'prescribing_info', n: 1 }] },
      top: [{ title: 'Annual report 2025', pages: 142 }],
    }),
    titles: ['Document types', 'Pages by document'],
  },
}

function renderInsights(tab: InsightsTab, response: Response | Promise<Response>) {
  const fetchMock = vi.fn(() => Promise.resolve(response))
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <TabInsights assetId="treprostinil" tab={tab} />
    </QueryClientProvider>,
  )
  return { ...view, fetchMock: fetchMock as unknown as Mock }
}

afterEach(() => vi.unstubAllGlobals())

describe('TabInsights', () => {
  it.each(Object.keys(FIXTURES) as InsightsTab[])('%s renders its charts from the insights payload', async (tab) => {
    const { fetchMock } = renderInsights(tab, json(200, FIXTURES[tab].data))
    for (const title of FIXTURES[tab].titles) expect(await screen.findByRole('region', { name: title })).toBeInTheDocument()
    expect(screen.getAllByRole('region')).toHaveLength(FIXTURES[tab].titles.length)
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/assets/treprostinil/records/${tab}/insights`)
  })

  it('shows counts and labels from the data (never samples)', async () => {
    renderInsights('clinical', json(200, FIXTURES.clinical.data))
    const status = await screen.findByRole('region', { name: 'Status' })
    expect(within(status).getByText('Active, not recruiting')).toBeInTheDocument()
    expect(within(status).getAllByText('trials').length).toBeGreaterThan(0)
    const funnelTab = renderInsights('evidence', json(200, FIXTURES.evidence.data))
    const triage = await screen.findByRole('region', { name: 'AI triage' })
    expect(within(triage).getByText('186 unstructured records screened')).toBeInTheDocument()
    expect(within(triage).getByText('Became journey events')).toBeInTheDocument()
    funnelTab.unmount()
  })

  it('falls back to records by year and collections when the tab has no curated data', async () => {
    renderInsights('clinical', json(200, base('clinical')))
    expect(await screen.findByRole('region', { name: 'Records by year' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Collections' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Phase' })).not.toBeInTheDocument()
  })

  it('shows placeholders while loading', () => {
    renderInsights('clinical', new Promise<Response>(() => {}))
    expect(screen.getByLabelText('Loading insights')).toHaveAttribute('aria-busy', 'true')
  })

  it('renders nothing when the tab has no records', async () => {
    const empty = renderInsights('clinical', json(200, base('clinical', { total: 0, byYear: [] })))
    await waitFor(() => expect(screen.queryByLabelText('Loading insights')).not.toBeInTheDocument())
    expect(empty.container).toBeEmptyDOMElement()
  })

  it('shows an error with a working retry when the request fails', async () => {
    const calls: Response[] = [json(500, { message: 'boom' }), json(200, FIXTURES.clinical.data)]
    const fetchMock = vi.fn(() => Promise.resolve(calls.shift()!))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <TabInsights assetId="treprostinil" tab="clinical" />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('The insights couldn’t be loaded.')
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByRole('region', { name: 'Status' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
