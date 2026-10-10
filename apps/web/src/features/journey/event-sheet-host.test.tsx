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
  neighbors: { prev: null, next: { id: 'next:1', title: 'TETON-1 started', date: '2021-06-01' } },
  branchStats: { index: 1, total: 1, prevSameBranch: null },
}
const NEXT: EventDetail = {
  ...DETAIL,
  event: { ...DETAIL.event, id: 'next:1', title: 'TETON-1 started', date: '2021-06-01' },
  records: [],
  neighbors: { prev: { id: EVENT_ID, title: DETAIL.event.title, date: DETAIL.event.date }, next: null },
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
      if (url === '/api/assets/trep/events/next%3A1') return json(200, NEXT)
      if (url === '/api/assets/trep/branches') return json(200, [{ id: 'PAH', label: 'PAH', full: 'Pulmonary arterial hypertension', color: '#2347d9', off: 0, trunk: true, status: 'Approved · US', origin: 'ai' }, { id: 'PH-ILD', label: 'PH-ILD', full: 'PH due to ILD', color: '#0b7a6f', off: 1, from: 'PAH', status: 'Approved · US', origin: 'ai' }])
      if (url === '/api/assets/trep/annotations') return json(200, { stars: [], comments: {}, notes: [] })
      if (url === '/api/assets/trep/record/company-ir?key=pr%3A1') return json(200, { key: 'pr:1', title: 'UT announces FDA approval of Tyvaso', date: '2021-03-31' })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
}

beforeEach(() => useEventSheet.setState({ current: null, journeyAsset: null, locate: null }))
afterEach(() => vi.unstubAllGlobals())

describe('EventSheetHost', () => {
  it('opens from the store with the event, why it matters and its evidence', async () => {
    serve(DETAIL)
    renderHost()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))

    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    expect(within(sheet).getByText('Mar 31, 2021')).toBeInTheDocument()
    expect((await within(sheet).findAllByText('PH-ILD')).length).toBeGreaterThan(0)
    expect(within(sheet).getByText('First approved therapy for PH-ILD.')).toBeInTheDocument()
    expect(within(sheet).getByRole('img', { name: '2 records' })).toBeInTheDocument()
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
    expect(within(sheet).getByText('Expected Jan 15, 2099')).toBeInTheDocument()
    expect(within(sheet).getByText(/^in \d+\.\d years$/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useEventSheet.getState().current).toBeNull()
  })

  it('says so when the event cannot be loaded', async () => {
    serve(null)
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    expect(await screen.findByText("This event couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Event unavailable' })).toBeInTheDocument()
  })

  it('moves to the next event with → and back with ←, but not while typing a comment', async () => {
    serve(DETAIL)
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    const box = screen.getByRole('textbox', { name: 'Add a comment' })
    await userEvent.type(box, 'draft{ArrowRight}')
    expect(useEventSheet.getState().current?.eventId).toBe(EVENT_ID)
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })).toBeInTheDocument()
    expect(box).not.toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'next:1' })
    await screen.findByRole('dialog', { name: 'TETON-1 started' })
    await userEvent.keyboard('{ArrowLeft}')
    expect(useEventSheet.getState().current?.eventId).toBe(EVENT_ID)
  })

  it('locates the event in place when its journey is on screen, scrolling the journey on prev/next too', async () => {
    serve(DETAIL)
    renderHost()
    useEventSheet.setState({ journeyAsset: 'trep' })
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    await userEvent.click(within(sheet).getByRole('button', { name: /TETON-1 started/ }))
    expect(useEventSheet.getState().locate).toMatchObject({ assetId: 'trep', eventId: 'next:1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Locate on timeline' }))
    expect(useEventSheet.getState()).toMatchObject({ current: null, locate: { eventId: 'next:1', seq: 2 } })
  })

  it('closes a record opened from one event when another event is shown', async () => {
    serve(DETAIL)
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Open UT announces FDA approval' }))
    expect(await screen.findByText('UT announces FDA approval of Tyvaso')).toBeInTheDocument()
    act(() => useEventSheet.getState().openEvent('trep', 'next:1'))
    await screen.findByRole('dialog', { name: 'TETON-1 started' })
    expect(screen.queryByText('UT announces FDA approval of Tyvaso')).not.toBeInTheDocument()
  })

  it('keeps the previous event on screen (dimmed, no "Loading…") while prev/next loads', async () => {
    serve(DETAIL)
    const base = globalThis.fetch as unknown as (url: string) => Promise<Response>
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/assets/trep/events/next%3A1' ? (await gate, json(200, NEXT)) : base(url))))
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    await userEvent.click(within(sheet).getByRole('button', { name: /TETON-1 started/ }))
    expect(useEventSheet.getState().current?.eventId).toBe('next:1')
    expect(screen.getByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading the event' })).not.toBeInTheDocument()
    expect(sheet.querySelector('.opacity-60')).toBeInTheDocument()
    release()
    await screen.findByRole('dialog', { name: 'TETON-1 started' })
    await waitFor(() => expect(sheet.querySelector('.opacity-60')).not.toBeInTheDocument())
  })

  it('does not bring a record back when the same event is reopened after closing', async () => {
    serve(DETAIL)
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Open UT announces FDA approval' }))
    expect(await screen.findByText('UT announces FDA approval of Tyvaso')).toBeInTheDocument()
    act(() => useEventSheet.getState().closeEvent())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })).not.toBeInTheDocument())
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    expect(screen.queryByText('UT announces FDA approval of Tyvaso')).not.toBeInTheDocument()
  })

  it('shows an error with a working retry', async () => {
    serve(null)
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    await screen.findByRole('alert')
    serve(DETAIL)
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })).toBeInTheDocument()
  })
})
