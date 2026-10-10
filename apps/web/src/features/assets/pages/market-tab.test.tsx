import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import type { AssetDetail, AssetMarket, MarketEvent } from '../api'
import type { MeasuredEvent } from './market-chart'
import { MarketTab, rangeStart } from './market-tab'

// jsdom has no canvas: a stand-in that exposes the chart's hover and click callbacks as buttons.
vi.mock('./market-chart', () => ({
  default: ({ events, onSelect, onHover }: { events: MeasuredEvent[]; onSelect: (e: MeasuredEvent) => void; onHover: (e: MeasuredEvent[] | null) => void }) => (
    <div>
      {events.map((e) => (
        <button key={e.id} type="button" aria-label={`marker ${e.id}`} onMouseEnter={() => onHover([e])} onClick={() => onSelect(e)} />
      ))}
    </div>
  ),
}))

const json = (status: number, body?: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET = { id: 'selexipag', name: 'Selexipag', company: { name: 'Actelion (Janssen)' } } as AssetDetail
const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)

const event = (id: string, date: string, day5: number | null, over: Partial<MarketEvent> = {}): MarketEvent => ({
  id, date, title: `Event ${id}`, type: 'approval', category: 'regulatory', significance: 'High',
  drug: { id: 'selexipag', name: 'Selexipag' }, source: { collection: 'fda_records', record_key: `fda:${id}` },
  impact: { trading_day: date, base_close: 100, days_measured: 20, day0: 1, day5, day20: null, dip: -4, dip_day: 3, dip_close: 96, peak: 3, peak_day: 1, peak_close: 103 },
  note: null, ...over,
})

const LISTED: AssetMarket = {
  listed: true, ticker: 'JNJ', company: 'Actelion (Janssen)', listed_name: 'Johnson & Johnson', exchange: 'NYSE', via_parent: true,
  other_listings: [], source: 'test prices', currency: 'USD', as_of: recent(1), note: 'Moves show timing, not causation.',
  drugs: [{ id: 'macitentan', name: 'Macitentan', selected: false }, { id: 'selexipag', name: 'Selexipag', selected: true }],
  category_counts: { regulatory: 3, ip: 2 },
  bars: [{ date: recent(300), close: 100 }, { date: recent(200), close: 120 }, { date: recent(100), close: 90 }],
  events: [event('small', recent(300), 2.04), event('big', recent(200), -12.5), event('old', '2001-01-02', null, { impact: null, note: 'before price history' })],
}

let fetchMock: Mock<(url: string) => Promise<Response>>

function renderTab(body: AssetMarket) {
  fetchMock = vi.fn(async () => json(200, body))
  vi.stubGlobal('fetch', fetchMock)
  const router = createMemoryRouter(
    [{ path: '/assets/:assetId', element: <Outlet context={ASSET} />, children: [{ path: 'market', element: <MarketTab /> }] }],
    { initialEntries: ['/assets/selexipag/market'] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}
const lastUrl = () => decodeURIComponent(fetchMock.mock.calls.at(-1)![0])
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => vi.unstubAllGlobals())

describe('MarketTab', () => {
  it('says when the company has no listed share price', async () => {
    renderTab({ listed: false, company: 'Boehringer Ingelheim', note: 'x' })
    expect(await screen.findByText('No listed share price for Boehringer Ingelheim')).toBeInTheDocument()
  })

  it("shows the listed parent's price and the signed move after each event in range", async () => {
    renderTab(LISTED)
    expect(await screen.findByText('Johnson & Johnson · JNJ')).toBeInTheDocument()
    expect(screen.getByText(/Listed parent of Actelion \(Janssen\)/)).toBeInTheDocument()
    const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows().map((r) => within(r).getAllByText(/^Event /)[0]!.textContent)).toEqual(['Event big', 'Event small']) // 5Y: 2001 out
    expect(within(rows()[0]!).getByText('-12.5%')).toHaveClass('text-destructive')
    expect(within(rows()[1]!).getByText('+2.0%')).toHaveClass('text-success')
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('before price history')).toBeInTheDocument()
  })

  it("filters by the company's other drugs and by event category, with counts", async () => {
    renderTab(LISTED)
    const drugs = await screen.findByRole('group', { name: 'Drugs' })
    expect(within(drugs).getByRole('button', { name: 'Selexipag' })).toBeDisabled() // this asset is always shown
    await userEvent.click(within(drugs).getByRole('button', { name: 'Macitentan' }))
    expect(lastUrl()).toBe('/api/assets/selexipag/market?drugs=macitentan&significance=High,Medium')
    await userEvent.click(screen.getByRole('button', { name: /^Patents\s*2$/ }))
    expect(lastUrl()).toBe('/api/assets/selexipag/market?drugs=macitentan&category=ip&significance=High,Medium')
  })

  it('names the event under the cursor and details the one clicked: dip and peak with their day', async () => {
    renderTab(LISTED)
    await userEvent.hover(await screen.findByRole('button', { name: 'marker big' }))
    expect(screen.getByText(/after 5 days · Event big/).closest('p')).toHaveTextContent('-12.5% after 5 days · Event big')
    await userEvent.click(screen.getByRole('button', { name: 'marker big' }))
    expect(screen.getByText('Deepest dip').parentElement).toHaveTextContent('-4.0%day 3')
    expect(screen.getByText('Highest peak').parentElement).toHaveTextContent('+3.0%day 1')
    expect(screen.getByRole('button', { name: 'Open evidence' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show full history' }))
    expect(screen.queryByText('Deepest dip')).not.toBeInTheDocument()
  })

  it('computes the range start from today', () => {
    expect(rangeStart('1y', new Date('2026-10-10T12:00:00Z'))).toBe('2025-10-10')
    expect(rangeStart('all')).toBeNull()
  })
})
