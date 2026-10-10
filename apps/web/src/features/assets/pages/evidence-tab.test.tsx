import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { AssetDetail } from '../api'
import type { EvidenceSummary, LedgerRow } from '../competitors-api'
import { EvidenceTab } from './evidence-tab'

vi.mock('@/features/analytics/tab-insights', () => ({ TabInsights: () => null }))

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET = { id: 'treprostinil', name: 'Treprostinil', company: { name: 'United Therapeutics' } } as AssetDetail

const SUMMARY: EvidenceSummary = {
  sources: [
    { key: 'trials', label: 'Clinical trials', total: 48, recent: 3 },
    { key: 'news', label: 'News', total: 210, recent: 17 },
  ],
  triage: {
    total: 300,
    ingest: 120,
    headline: 60,
    skip: 120,
    byCategory: [
      { category: 'trial_readout', ingest: 40, headline: 5, skip: 0 },
      { category: 'market_report', ingest: 0, headline: 10, skip: 90 },
    ],
  },
}

function ledgerRow(id: string, overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id,
    title: `Item ${id}`,
    url: `https://example.com/${id}`,
    date: '2026-09-01',
    source: 'Reuters',
    collection: 'articles',
    decision: 'ingest',
    category: 'trial_readout',
    reason: 'Reports Phase 3 results.',
    model: 'm',
    decidedAt: '2026-09-02',
    recordKey: `https://example.com/${id}`,
    ...overrides,
  }
}

const LEDGER = {
  items: [ledgerRow('a', { journey_events: [{ id: 'ev:1', title: 'TETON readout', date: '2025-03-02', category: 'clinical' }] }), ledgerRow('b', { decision: 'skip', category: 'market_report', reason: 'Market-research advert.' })],
  total: 60,
  page: 1,
  pageSize: 25,
}

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
const ledgerUrls = () => fetchMock.mock.calls.map(([u]) => u).filter((u) => u.includes('/ledger'))
const lastLedgerUrl = () => ledgerUrls().at(-1)

function renderTab() {
  const router = createMemoryRouter(
    [{ path: '/assets/:assetId', element: <Outlet context={ASSET} />, children: [{ path: 'evidence', element: <EvidenceTab /> }] }],
    { initialEntries: ['/assets/treprostinil/evidence'] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  // jsdom lacks what Radix Select uses on open.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/assets/treprostinil/evidence') return json(200, SUMMARY)
    if (url.startsWith('/api/assets/treprostinil/ledger')) return json(200, LEDGER)
    if (url.startsWith('/api/assets/treprostinil/record/')) return json(200, { key: 'x', title: 'Full article' })
    return json(200, { items: [], total: 0, page: 1, pageSize: 25 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('EvidenceTab', () => {
  it('shows the Evidence panel: decision bar, total, columns, footer', async () => {
    renderTab()
    expect(await screen.findByText('Item a')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Evidence' })).toBeInTheDocument()
    expect(screen.getByText('300 records collected')).toBeInTheDocument()
    // Decision bar sorted by share; legend entries carry the counts.
    expect(screen.getByRole('button', { name: /Ingest\s*120/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Headline\s*60/ })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'Record', 'Decision', 'Reason', 'Journey'])
    expect(screen.getByText('Showing 60 of 300')).toBeInTheDocument()
    // News stays browsable below.
    expect(screen.getByRole('heading', { name: 'News and wire coverage' })).toBeInTheDocument()
  })

  it('shows a journey link for ledger items that feed an event', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Open in the journey: TETON readout' }))
    expect(useEventSheet.getState().current).toEqual({ assetId: 'treprostinil', eventId: 'ev:1' })
  })

  it('builds the ledger query from the decision legend and search, back on page 1 after each change', async () => {
    renderTab()
    await screen.findByText('Item a')
    expect(lastLedgerUrl()).toBe('/api/assets/treprostinil/ledger?page=1&pageSize=25')

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(lastLedgerUrl()).toBe('/api/assets/treprostinil/ledger?page=2&pageSize=25'))

    await userEvent.click(screen.getByRole('button', { name: /Skip\s*120/ }))
    await waitFor(() => expect(lastLedgerUrl()).toBe('/api/assets/treprostinil/ledger?decision=skip&page=1&pageSize=25'))

    await userEvent.type(screen.getByRole('textbox', { name: 'Search evidence' }), 'market report')
    await waitFor(() => expect(lastLedgerUrl()).toBe('/api/assets/treprostinil/ledger?decision=skip&q=market+report&page=1&pageSize=25'))
    // Debounced: no request per keystroke.
    expect(ledgerUrls().filter((u) => u.includes('q='))).toHaveLength(1)
  })

  it('opens kept items as records and skipped ones at their source', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    renderTab()

    await userEvent.click(await screen.findByText('Reports Phase 3 results.'))
    expect(await screen.findByText('Full article')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/assets/treprostinil/record/news?key=${encodeURIComponent('https://example.com/a')}`,
      expect.anything(),
    )
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByText('Market-research advert.'))
    expect(open).toHaveBeenCalledWith('https://example.com/b', '_blank', 'noopener,noreferrer')
  })
})
