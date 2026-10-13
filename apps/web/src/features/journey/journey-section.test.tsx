import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { Mock } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { useEventSheet } from '@/stores/event-sheet-store'
import { JourneyExportButton } from './export/export-menu'
import { JourneySection } from './journey-section'
import type { Branch, JourneyEventV3 } from './types'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: `${id} full`, color: '#0b7a6f', off, status: 'Approved · US', origin: 'ai', ...extra })
const BRANCHES = [br('PAH', 0, { trunk: true, color: '#2347d9' }), br('PH-ILD', 1, { from: 'PAH' }), br('PH-COPD', -1, { from: 'PAH', ended: 'Terminated' })]
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'Low', is_milestone: false, sources: [], via: 'journey', key: true, ...extra,
})
const DEEP = 'ai:trep:https://example.com/a/b:0'
const KEY = [ev('a', '2002-05-21', 'PAH'), ev('b', '2017-02-01', 'PH-ILD', { category: 'clinical' }), ev('c', '2018-05-08', 'PH-COPD')]
const ALL = [...KEY, ev(DEEP, '2019-03-01', 'PAH', { key: false }), ev('stop', '2022-11-29', 'PH-COPD', { type: 'trial_stopped', key: false })]

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>

/** The journey on the Overview; `withExport` adds the page header's Export button (the journey header has none). */
function renderAt(path: string, { withExport = false } = {}) {
  const asset = { id: 'trep', name: 'Treprostinil' }
  const element = (
    <>
      {withExport && <JourneyExportButton asset={asset} />}
      <JourneySection asset={asset} />
    </>
  )
  const router = createMemoryRouter([{ path: '/assets/:assetId/overview', element }], { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  localStorage.clear()
  useEventSheet.setState({ current: null, journeyAsset: null, locate: null })
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/assets/trep/branches') return json(200, BRANCHES)
    if (url === '/api/assets/trep/timeline?scope=key&include=notes&limit=5000') return json(200, { events: [...KEY].reverse(), total: KEY.length })
    if (url === '/api/assets/trep/timeline?scope=all&include=notes&limit=5000') return json(200, { events: [...ALL].reverse(), total: ALL.length })
    if (url === '/api/assets/trep/timeline?scope=all&branch=PH-COPD&limit=5000') return json(200, { events: ALL.filter((e) => e.branch === 'PH-COPD'), total: 2 })
    if (url === '/api/assets/trep/annotations') return json(200, { stars: ['a'], comments: {}, notes: [] })
    return json(404, { code: 'NOT_FOUND', message: url })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('JourneySection', () => {
  it('shows the horizontal journey by default with the HUD, and the vertical tree when chosen (never saved)', async () => {
    localStorage.setItem('aj.orient', 'v')
    const router = renderAt('/assets/trep/overview')
    expect(await screen.findByTestId('journey-horizontal')).toBeInTheDocument()
    expect(screen.getByText(/^3 events, 2002–2018 · 3 indication branches\./)).toBeInTheDocument()
    expect(screen.getByTestId('journey-hud')).toHaveTextContent('2002PAH01/03')
    expect(useEventSheet.getState().journeyAsset).toBe('trep')
    await userEvent.click(screen.getByRole('button', { name: 'Vertical' }))
    expect(await screen.findByTestId('journey-tree')).toBeInTheDocument()
    expect(screen.queryByTestId('journey-hud')).not.toBeInTheDocument() // the tree renders its own HUD
    expect(new URLSearchParams(router.state.location.search).get('view')).toBe('v')
    expect(await screen.findByText('Terminated Nov 2022 · Event stop')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/me/prefs', expect.anything())
  })

  it('reverses the horizontal track: the newest event first, on the left, the HUD counting from it', async () => {
    const router = renderAt('/assets/trep/overview')
    await screen.findByTestId('journey-horizontal')
    await userEvent.click(screen.getByRole('button', { name: 'Newest first' }))
    await waitFor(() => expect(screen.getByTestId('journey-hud')).toHaveTextContent('2018PH-COPD01/03'))
    expect(new URLSearchParams(router.state.location.search).get('order')).toBe('newest')
    const left = (id: string) => parseFloat((document.querySelector(`[data-card="${id}"]`) as HTMLElement).style.left)
    expect(left('c')).toBeLessThan(left('b'))
    expect(left('b')).toBeLessThan(left('a'))
    // The header still reads in time.
    expect(screen.getByText(/^3 events, 2002–2018/)).toBeInTheDocument()
    // Locate still finds an event in the reversed track.
    act(() => useEventSheet.getState().requestLocate('trep', 'a'))
    expect(document.querySelector('[data-card="a"]')).toHaveClass('animate-journey-flash')
  })

  it('reverses the tree: newest at the top under its year, the journey start at the bottom', async () => {
    renderAt('/assets/trep/overview?view=v&order=newest')
    await screen.findByTestId('journey-tree')
    const keys = [...document.querySelectorAll<HTMLElement>('[data-row]')].map((el) => el.dataset.row!)
    expect(keys[0]).toBe('finish')
    expect(keys.filter((k) => ['a', 'b', 'c'].includes(k))).toEqual(['c', 'b', 'a'])
    expect(keys.at(-1)).toBe('root')
    expect(keys.indexOf('y2018')).toBeLessThan(keys.indexOf('c'))
    expect(screen.getByText(/Journey begins/)).toHaveTextContent('May 2002')
  })

  it('filters by indication and title through the URL', async () => {
    renderAt('/assets/trep/overview?ind=PH-ILD')
    expect(await screen.findByText(/^1 event, 2017–2017/)).toBeInTheDocument()
    expect(screen.getByTestId('journey-hud')).toHaveTextContent('2017PH-ILD01/01')
    expect(document.querySelector('[data-card="b"]')).toHaveTextContent('PH-ILD')
    cleanup()
    renderAt('/assets/trep/overview?q=EVENT%20A')
    expect(await screen.findByText(/^1 event, 2002–2002/)).toBeInTheDocument()
    cleanup()
    renderAt('/assets/trep/overview?q=nothing')
    expect(await screen.findByText('No events match these filters')).toBeInTheDocument()
  })

  it('has no Export menu of its own: the page header exports the journey', async () => {
    renderAt('/assets/trep/overview')
    await screen.findByTestId('journey-horizontal')
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument()
  })

  it('filters to a selected branch (its events and those spanning it) through the URL, counted as a filter and cleared by Clear', async () => {
    const SPAN = ev('span', '2019-06-01', 'PAH', { span: ['PH-COPD'] })
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) =>
      url === '/api/assets/trep/timeline?scope=key&include=notes&limit=5000' ? json(200, { events: [SPAN, ...KEY].reverse(), total: 4 }) : base(url, init),
    )
    const router = renderAt('/assets/trep/overview')
    expect(await screen.findByText(/^4 events, 2002–2019/)).toBeInTheDocument()
    const copd = screen.getByRole('button', { name: /^PH-COPD/ })
    // The card counts what selecting it shows: its own event and the one spanning it.
    expect(copd).toHaveTextContent(/from PAH2/)
    await userEvent.click(copd)
    expect(new URLSearchParams(router.state.location.search).get('branch')).toBe('PH-COPD')
    expect(await screen.findByText(/^2 events, 2018–2019/)).toBeInTheDocument()
    expect(document.querySelector('[data-card="c"]')).toBeInTheDocument()
    expect(document.querySelector('[data-card="span"]')).not.toHaveClass('opacity-30')
    expect(document.querySelector('[data-card="a"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-lane="PAH"]')).toHaveClass('opacity-[0.18]')
    expect(screen.getByRole('button', { name: /^PH-COPD/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Hide filters' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show filters (1 active)' }))

    // The vertical tree shows the same events.
    await userEvent.click(screen.getByRole('button', { name: 'Vertical' }))
    await screen.findByTestId('journey-tree')
    expect(screen.getByRole('article', { name: 'Event c' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Event a' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(new URLSearchParams(router.state.location.search).get('branch')).toBeNull()
    expect(await screen.findByText(/^4 events, 2002–2019/)).toBeInTheDocument()
  })

  it('exports the selected branch from the page header and names it in the filters line and file name', async () => {
    let saved: { blob: Blob; name: string } | null = null
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      saved = { blob: b as Blob, name: '' }
      return 'blob:export'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved!.name = this.download
    })
    renderAt('/assets/trep/overview?branch=PH-COPD', { withExport: true })
    expect(await screen.findByText(/^1 event, 2018–2018/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    const menu = await screen.findByRole('menu')
    expect(menu).toHaveTextContent('Exports the 1 event shown')
    expect(menu).toHaveTextContent('Key events · oldest first · filters: Branch: PH-COPD')
    await userEvent.click(within(menu).getByRole('menuitem', { name: /JSON/ }))
    await waitFor(() => expect(saved?.name).toMatch(/^trep-journey-key-events-ph-copd-\d{4}-\d{2}-\d{2}\.json$/))
    const doc = JSON.parse(await saved!.blob.text())
    expect(doc.filters.branch).toBe('PH-COPD')
    expect(doc.events.map((e: { id: string }) => e.id)).toEqual(['c'])
  })

  it('filters by category through the URL and says when nothing matches', async () => {
    const router = renderAt('/assets/trep/overview?cat=ip')
    expect(await screen.findByText('No events match these filters')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Patents/ }))
    expect(await screen.findByTestId('journey-horizontal')).toBeInTheDocument()
    expect(router.state.location.search).toBe('')
  })

  it('deep-links ?focus= to an event outside the key events: shows all, jumps, opens the sheet and drops the param', async () => {
    const router = renderAt(`/assets/trep/overview?cat=clinical&focus=${encodeURIComponent(DEEP)}`)
    await waitFor(() => expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: DEEP }))
    const search = new URLSearchParams(router.state.location.search)
    expect(search.get('scope')).toBe('all')
    expect(search.get('cat')).toBeNull()
    expect(search.get('focus')).toBeNull()
    await waitFor(() => expect(document.querySelector(`[data-card="${DEEP}"]`)).toHaveClass('animate-journey-flash'))
  })

  it('opens a ?focus= event even when the branches arrive after the events', async () => {
    let releaseBranches!: () => void
    const branchesIn = new Promise<void>((resolve) => (releaseBranches = resolve))
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/assets/trep/branches') await branchesIn
      return base(url)
    })
    const router = renderAt(`/assets/trep/overview?focus=${encodeURIComponent(KEY[0]!.id)}`)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/timeline?scope=key&include=notes&limit=5000', expect.anything()))
    await new Promise((r) => setTimeout(r, 50))
    releaseBranches()
    await waitFor(() => expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: KEY[0]!.id }))
    expect(new URLSearchParams(router.state.location.search).get('focus')).toBeNull()
  })

  it('locates an event in place for the sheet without reopening it', async () => {
    renderAt('/assets/trep/overview')
    await screen.findByTestId('journey-horizontal')
    act(() => useEventSheet.getState().requestLocate('trep', 'b'))
    expect(document.querySelector('[data-card="b"]')).toHaveClass('animate-journey-flash')
    expect(useEventSheet.getState().current).toBeNull()
  })

  it('opens the composer stand-in from "Add to timeline" and says when the journey fails', async () => {
    renderAt('/assets/trep/overview')
    await screen.findByTestId('journey-horizontal')
    await userEvent.click(screen.getByRole('button', { name: 'Add to timeline' }))
    expect(within(screen.getByRole('dialog', { name: 'Add to the journey' })).getByTestId('note-where')).toHaveTextContent('PAH')
  })

  it('says when the journey could not be loaded', async () => {
    fetchMock.mockImplementation(async () => json(500, { code: 'ERROR', message: 'boom' }))
    renderAt('/assets/trep/overview')
    expect(await screen.findByText("The journey couldn't be loaded.")).toBeInTheDocument()
  })

  it('shows a journey-shaped skeleton while loading, for the horizontal track and the tree', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    renderAt('/assets/trep/overview')
    expect(await screen.findByRole('status', { name: 'Loading the journey' })).toBeInTheDocument()
    expect(screen.queryByTestId('journey-horizontal')).not.toBeInTheDocument()
    cleanup()
    renderAt('/assets/trep/overview?view=v')
    expect(await screen.findByRole('status', { name: 'Loading the journey' })).toBeInTheDocument()
  })

  it('retries a failed journey load from the error and then shows the track', async () => {
    const ok = fetchMock.getMockImplementation()!
    let failing = true
    fetchMock.mockImplementation(async (url, init) => (failing && url.includes('/timeline') ? json(500, { code: 'ERROR', message: 'boom' }) : ok(url, init)))
    renderAt('/assets/trep/overview')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("The journey couldn't be loaded.")
    expect(screen.queryByRole('status', { name: 'Loading the journey' })).not.toBeInTheDocument()
    failing = false
    await userEvent.click(within(alert).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByTestId('journey-horizontal')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('saves a note from the composer, scrolls the track to it and opens its detail', async () => {
    const SAVED = ev('note:1', '2010-09-01', 'PAH', { type: 'user_note', via: 'user', key: true, title: 'My note' })
    let saved = false
    const ok = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith('/notes') && init?.method === 'POST') {
        saved = true
        return json(200, SAVED)
      }
      if (saved && url.includes('/timeline?scope=key')) return json(200, { events: [...KEY, SAVED].reverse(), total: KEY.length + 1 })
      return ok(url, init)
    })
    renderAt('/assets/trep/overview')
    await screen.findByTestId('journey-horizontal')
    await userEvent.click(screen.getByRole('button', { name: 'Add to timeline' }))
    const dialog = screen.getByRole('dialog', { name: 'Add to the journey' })
    await userEvent.type(within(dialog).getByLabelText('What happened?'), 'My note')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add manually' }))
    await waitFor(() => expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'note:1' }))
    const post = fetchMock.mock.calls.find(([u, i]) => u.endsWith('/notes') && i?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ title: 'My note', branch: 'PAH', mode: 'manual' })
    expect(screen.queryByRole('dialog', { name: 'Add to the journey' })).not.toBeInTheDocument()
  })

  it('exports exactly what the journey shows: the scope, the filters and the order', async () => {
    let saved: { blob: Blob; name: string } | null = null
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      saved = { blob: b as Blob, name: '' }
      return 'blob:export'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved!.name = this.download
    })
    renderAt('/assets/trep/overview?scope=all&order=newest&ind=PH-COPD', { withExport: true })
    await screen.findByTestId('journey-horizontal')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    const menu = await screen.findByRole('menu')
    expect(menu).toHaveTextContent('Exports the 2 events shown')
    expect(menu).toHaveTextContent('All events · newest first · filters: Indication: PH-COPD')
    await userEvent.click(within(menu).getByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(saved?.name).toMatch(/^trep-journey-all-events-\d{4}-\d{2}-\d{2}\.csv$/))
    const rows = (await saved!.blob.text()).replace(/^\uFEFF/, '').trim().split('\r\n')
    expect(rows.map((r) => r.split(',').slice(0, 3).join(','))).toEqual(['Date,Expected,Title', '2022-11-29,no,Event stop', '2018-05-08,no,Event c'])
    expect(await screen.findByText('Exported 2 events')).toBeInTheDocument()
  })

  it('exports the same journey from a header button when the journey isn’t on screen', async () => {
    const router = createMemoryRouter([{ path: '/assets/:assetId/clinical', element: <JourneyExportButton asset={{ id: 'trep', name: 'Treprostinil' }} label="Export journey" size="default" /> }], {
      initialEntries: ['/assets/trep/clinical?scope=all&order=newest&ind=PH-COPD'],
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    const button = screen.getByRole('button', { name: 'Export journey' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    const menu = await screen.findByRole('menu')
    expect(menu).toHaveTextContent('Exports the 2 events shown')
    expect(menu).toHaveTextContent('All events · newest first · filters: Indication: PH-COPD')
    expect(within(menu).getByRole('menuitem', { name: /PowerPoint deck/ })).toBeInTheDocument()
    // Only the events and annotations: no branches (without a branch filter), no layout.
    expect(fetchMock.mock.calls.map(([u]) => u)).not.toContain('/api/assets/trep/branches')

    // A branch filter: the branches load to place the events on their lanes.
    cleanup()
    const branch = createMemoryRouter([{ path: '/assets/:assetId/clinical', element: <JourneyExportButton asset={{ id: 'trep', name: 'Treprostinil' }} /> }], { initialEntries: ['/assets/trep/clinical?branch=PH-ILD'] })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={branch} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(await screen.findByRole('menu')).toHaveTextContent('Exports the 1 event shown')
    expect(screen.getByRole('menu')).toHaveTextContent('filters: Branch: PH-ILD')
    expect(fetchMock.mock.calls.map(([u]) => u)).toContain('/api/assets/trep/branches')

    // Starred only: the stars come from the annotations.
    cleanup()
    const starred = createMemoryRouter([{ path: '/assets/:assetId/clinical', element: <JourneyExportButton asset={{ id: 'trep', name: 'Treprostinil' }} /> }], { initialEntries: ['/assets/trep/clinical?mine=starred'] })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={starred} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(await screen.findByRole('menu')).toHaveTextContent('Exports the 1 event shown')
  })

  it('says so when an export fails, and lets the user try again', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('Blocked by the browser')
    })
    renderAt('/assets/trep/overview', { withExport: true })
    await screen.findByTestId('journey-horizontal')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /JSON/ }))
    expect(await screen.findByText('The export failed')).toBeInTheDocument()
    expect(screen.getByText('Blocked by the browser')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })
})
