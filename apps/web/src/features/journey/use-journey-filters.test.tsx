import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { Mock } from 'vitest'
import { useJourneyFilters, VIEW_STORAGE_KEY } from './use-journey-filters'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const PREFS = { journeyView: 'v', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: false } }
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>

function setup(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let router!: ReturnType<typeof createMemoryRouter>
  const wrapper = ({ children }: { children: ReactNode }) => {
    router ??= createMemoryRouter([{ path: '*', element: children }], { initialEntries: [path] })
    return (
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  }
  const hook = renderHook(() => useJourneyFilters(), { wrapper })
  return { ...hook, search: () => new URLSearchParams(router.state.location.search) }
}

beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn(async () => json(404, { code: 'NOT_FOUND', message: 'nope' }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('useJourneyFilters', () => {
  it('defaults to the horizontal view with key events and no filters', async () => {
    const { result } = setup('/assets/trep/overview')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/me/prefs', expect.anything()))
    expect(result.current).toMatchObject({ view: 'h', scope: 'key', cats: [], mine: null, focus: null })
  })

  it('reads the orientation from /me/prefs, the URL first', async () => {
    fetchMock.mockImplementation(async (url) => (url === '/api/me/prefs' ? json(200, PREFS) : json(404)))
    const { result } = setup('/assets/trep/overview')
    await waitFor(() => expect(result.current.view).toBe('v'))
    const other = setup('/assets/trep/overview?view=h')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(other.result.current.view).toBe('h')
  })

  it('falls back to localStorage when prefs are unavailable, and saves a change to prefs, storage and the URL', async () => {
    localStorage.setItem(VIEW_STORAGE_KEY, 'v')
    const { result, search } = setup('/assets/trep/overview')
    expect(result.current.view).toBe('v')
    act(() => result.current.setView('h'))
    await waitFor(() => expect(result.current.view).toBe('h'))
    expect(search().get('view')).toBe('h')
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe('h')
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/me/prefs', expect.objectContaining({ method: 'PATCH', body: '{"journeyView":"h"}' })),
    )
  })

  it('keeps scope, categories and Starred / Team notes in the URL and ignores unknown values', async () => {
    const { result, search } = setup('/assets/trep/overview?cat=ip,bogus&mine=everything&scope=weird')
    expect(result.current).toMatchObject({ scope: 'key', cats: ['ip'], mine: null })
    act(() => result.current.setScope('all'))
    act(() => result.current.toggleCat('clinical'))
    act(() => result.current.setMine('starred'))
    await waitFor(() => expect(result.current).toMatchObject({ scope: 'all', cats: ['ip', 'clinical'], mine: 'starred' }))
    expect(search().toString()).toBe('cat=ip%2Cclinical&mine=starred&scope=all')
    act(() => result.current.toggleCat('ip'))
    act(() => result.current.toggleCat('clinical'))
    act(() => result.current.setScope('key'))
    await waitFor(() => expect(search().toString()).toBe('mine=starred'))
    act(() => result.current.clearFilters())
    await waitFor(() => expect(search().toString()).toBe(''))
  })

  it('round-trips an event id with ":" and "/" through ?focus=, and shows everything without losing it', async () => {
    const id = 'ai:trep:https://example.com/a/b:0'
    const { result, search } = setup(`/assets/trep/overview?cat=ip&mine=notes&focus=${encodeURIComponent(id)}`)
    expect(result.current.focus).toBe(id)
    act(() => result.current.showEverything())
    await waitFor(() => expect(result.current).toMatchObject({ scope: 'all', cats: [], mine: null, focus: id }))
    act(() => result.current.clearFocus())
    await waitFor(() => expect(search().get('focus')).toBeNull())
    act(() => result.current.focusOn(id))
    await waitFor(() => expect(result.current.focus).toBe(id))
  })
})
