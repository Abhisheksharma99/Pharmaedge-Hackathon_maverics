import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import type { AssetSummary } from '@/features/assets/api'
import type { SearchResult } from '@/features/search/api'
import { useEventSheet } from '@/stores/event-sheet-store'
import { useShellStore } from '@/stores/shell-store'
import { CommandPalette } from './command-palette'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const asset = (id: string, name: string, kind: AssetSummary['kind'], aliases: string[], company: string): AssetSummary => ({
  id,
  name,
  aliases,
  company: { name: company },
  tags: {},
  kind,
  status: 'ready',
  updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null,
  competitorOf: [],
})

const ASSETS = [asset('yutrepia', 'Yutrepia', 'competitor', ['Yutrepia'], 'Liquidia'), asset('trep', 'Treprostinil', 'primary', ['Tyvaso', 'Remodulin'], 'United Therapeutics')]
const TETON: SearchResult = {
  assets: [],
  events: [{ id: 'rule:start:NCT04708782', asset: 'trep', assetName: 'Treprostinil', title: 'Phase 3 trial started: TETON-1', date: '2021-06-01', category: 'clinical', nct_id: 'NCT04708782' }],
}

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>

function renderPalette() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <>
            <CommandPalette />
            <Outlet />
          </>
        ),
        children: [
          { index: true, element: <p>Home</p> },
          { path: 'assets/:id/overview', element: <p>Overview</p> },
          { path: 'settings', element: <p>Settings page</p> },
          { path: 'chat', element: <p>Chat</p> },
        ],
      },
    ],
    { initialEntries: ['/'] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  act(() => useShellStore.getState().setPaletteOpen(true))
  return router
}

const searchBox = () => screen.findByRole('combobox', { name: 'Search PharmaEdge' })

beforeEach(() => {
  useShellStore.setState({ paletteOpen: false })
  useEventSheet.setState({ current: null })
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === '/api/assets') return json(200, ASSETS)
    if (url.startsWith('/api/search?q=')) {
      const q = decodeURIComponent(url.slice('/api/search?q='.length).replace(/\+/g, ' ')).toLowerCase()
      return json(200, q.includes('teton') || q.includes('nct04708782') ? TETON : { assets: [], events: [] })
    }
    return json(404, { code: 'NOT_FOUND', message: url })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('CommandPalette', () => {
  it('lists primary assets first with their brands; Enter opens the highlighted asset', async () => {
    const router = renderPalette()
    const trep = await screen.findByRole('option', { name: /Treprostinil/ })
    const options = screen.getAllByRole('option')
    expect(options[0]).toBe(trep)
    expect(trep).toHaveTextContent('Tyvaso · Remodulin · United Therapeutics')
    expect(options[1]).toHaveTextContent('Yutrepia · Liquidia · competitor')
    await waitFor(() => expect(trep).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/assets/trep/overview')
    expect(useShellStore.getState().paletteOpen).toBe(false)
  })

  it('moves the highlight with the arrow keys and the pointer', async () => {
    const router = renderPalette()
    await waitFor(() => expect(screen.getByRole('option', { name: /Treprostinil/ })).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(screen.getByRole('option', { name: /Yutrepia/ })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('option', { name: /Treprostinil/ })).toHaveAttribute('aria-selected', 'false')
    await userEvent.hover(screen.getByRole('option', { name: /Settings/ }))
    await waitFor(() => expect(screen.getByRole('option', { name: /Settings/ })).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/settings')
  })

  it('finds events by title and by NCT id, highlights the first one and opens it in the event sheet', async () => {
    renderPalette()
    await userEvent.type(await searchBox(), 'TETON')
    const event = await screen.findByRole('option', { name: /Phase 3 trial started: TETON-1/ })
    expect(event).toHaveTextContent('Treprostinil · Jun 1, 2021 · NCT04708782')
    await waitFor(() => expect(event).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Enter}')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'rule:start:NCT04708782' })
    expect(useShellStore.getState().paletteOpen).toBe(false)

    act(() => useShellStore.getState().setPaletteOpen(true))
    await userEvent.type(await searchBox(), 'NCT04708782')
    expect(await screen.findByRole('option', { name: /TETON-1/ })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/search?q=NCT04708782', expect.anything())
  })

  it('offers pages and actions, and asks Asset AI about the query', async () => {
    const router = renderPalette()
    await userEvent.type(await searchBox(), 'sett')
    await waitFor(() => expect(screen.getByRole('option', { name: /Settings/ })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.queryByRole('option', { name: /Add an asset/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Ask Asset AI: “sett”/ })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(router.state.location.pathname).toBe('/chat')
    expect(router.state.location.search).toBe('?ask=sett')
  })

  it('does not search events for a single character', async () => {
    renderPalette()
    await userEvent.type(await searchBox(), 't')
    await new Promise((r) => setTimeout(r, 300))
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/search'))).toBe(false)
    expect(screen.queryByRole('group', { name: 'Events' })).not.toBeInTheDocument()
  })
})
