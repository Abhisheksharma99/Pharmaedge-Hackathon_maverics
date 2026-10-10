import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { Mock } from 'vitest'
import { useJourneyFilters } from './use-journey-filters'

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
  it('defaults to horizontal, oldest first, key events and no filters', () => {
    const { result } = setup('/assets/trep/overview')
    expect(result.current).toMatchObject({ view: 'h', order: 'oldest', scope: 'key', cats: [], mine: null, ind: null, q: '', focus: null })
  })

  it('is horizontal by default whatever was saved before (prefs, localStorage): only the URL opens the vertical view', async () => {
    fetchMock.mockImplementation(async (url) => (url === '/api/me/prefs' ? json(200, PREFS) : json(404)))
    localStorage.setItem('aj.orient', 'v')
    const { result } = setup('/assets/trep/overview')
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current.view).toBe('h')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(setup('/journey/trep?view=v').result.current.view).toBe('v')
  })

  it('toggles orientation and order in the URL, the defaults leaving no param, and saves nothing', async () => {
    const { result, search } = setup('/journey/trep')
    act(() => result.current.setView('v'))
    act(() => result.current.setOrder('newest'))
    await waitFor(() => expect(result.current).toMatchObject({ view: 'v', order: 'newest' }))
    expect(search().toString()).toBe('view=v&order=newest')
    act(() => result.current.setView('h'))
    act(() => result.current.setOrder('oldest'))
    await waitFor(() => expect(search().toString()).toBe(''))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('keeps the indication and title search in the URL; Clear and "show everything" drop them', async () => {
    const { result, search } = setup('/journey/trep?ind=PH-ILD&q=tyvaso')
    expect(result.current).toMatchObject({ ind: 'PH-ILD', q: 'tyvaso' })
    act(() => result.current.setInd('PAH'))
    act(() => result.current.setQuery('teton'))
    await waitFor(() => expect(search().toString()).toBe('ind=PAH&q=teton'))
    act(() => result.current.clearFilters())
    await waitFor(() => expect(search().toString()).toBe(''))
    act(() => result.current.setInd('PAH'))
    act(() => result.current.setOrder('newest'))
    act(() => result.current.showEverything())
    await waitFor(() => expect(search().toString()).toBe('order=newest&scope=all'))
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
