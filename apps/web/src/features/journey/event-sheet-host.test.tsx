import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { EventDetail } from './api'
import { EventSheetHost } from './event-sheet-host'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const EVENT_ID = 'ai:trep:https://example.com/a/b:0'
const ENCODED = encodeURIComponent(EVENT_ID)

const DETAIL: EventDetail = {
  event: {
    id: EVENT_ID,
    asset: 'trep',
    date: '2021-03-31',
    type: 'approval',
    category: 'regulatory',
    title: 'Tyvaso approved for PH-ILD',
    summary: 'FDA approved inhaled treprostinil for pulmonary hypertension with interstitial lung disease.',
    significance: 'High',
    is_milestone: false,
    sources: [],
    via: 'ai_events',
    branch: 'PH-ILD',
    impact: 'First approved therapy for PH-ILD.',
  },
  records: [
    { collection: 'company_records', key: 'pr:1', tab: 'company-ir', title: 'UT announces FDA approval', date: '2021-03-31', url: 'https://ut.example/pr', record_type: 'press_release', source: null },
    { collection: 'web_records', key: 'w1', tab: null, title: 'Web page', date: '', url: 'https://example.com/w1', record_type: null, source: null },
  ],
  neighbors: { prev: null, next: null },
  branchStats: { index: 1, total: 1, prevSameBranch: null },
}

function renderHost() {
  const router = createMemoryRouter([{ path: '*', element: <EventSheetHost /> }], { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

function serve(detail: EventDetail | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === `/api/assets/trep/events/${ENCODED}`) return detail ? json(200, detail) : json(404, { code: 'EVENT_NOT_FOUND', message: 'Event not found' })
      if (url === '/api/assets/trep/record/company-ir?key=pr%3A1') return json(200, { key: 'pr:1', title: 'UT announces FDA approval of Tyvaso', date: '2021-03-31' })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
}

beforeEach(() => useEventSheet.setState({ current: null }))
afterEach(() => vi.unstubAllGlobals())

describe('EventSheetHost', () => {
  it('opens from the store with the event, why it matters and its evidence', async () => {
    serve(DETAIL)
    renderHost()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))

    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    expect(within(sheet).getByText('Mar 31, 2021')).toBeInTheDocument()
    expect(within(sheet).getByText('PH-ILD')).toBeInTheDocument()
    expect(within(sheet).getByText('First approved therapy for PH-ILD.')).toBeInTheDocument()
    expect(within(sheet).getByText('Evidence · 2 sources')).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Open Web page' })).toHaveAttribute('href', 'https://example.com/w1')

    await userEvent.click(within(sheet).getByRole('button', { name: 'Open UT announces FDA approval' }))
    expect(await screen.findByText('UT announces FDA approval of Tyvaso')).toBeInTheDocument()
  })

  it('shows the event on the journey timeline with the encoded id and closes', async () => {
    serve(DETAIL)
    const router = renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    await userEvent.click(await screen.findByRole('button', { name: 'Show on the journey timeline' }))
    expect(router.state.location.pathname).toBe('/assets/trep/overview')
    expect(router.state.location.search).toBe(`?focus=${ENCODED}`)
    expect(new URLSearchParams(router.state.location.search).get('focus')).toBe(EVENT_ID)
    expect(useEventSheet.getState().current).toBeNull()
  })

  it('reads "Expected" for a milestone and closes with Escape', async () => {
    serve({ ...DETAIL, event: { ...DETAIL.event, is_milestone: true, date: '2099-01-15' } })
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    expect(within(sheet).getByText(/^Expected Jan 15, 2099 · in /)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useEventSheet.getState().current).toBeNull()
  })

  it('says so when the event cannot be loaded', async () => {
    serve(null)
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    expect(await screen.findByText("This event couldn't be loaded.")).toBeInTheDocument()
  })
})
