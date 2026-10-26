import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { useHomeWatchlistOnly, useMarkNotificationsRead, useNotifications, usePrefs, useSavePrefs, useWatchlist, type NotificationList, type Prefs } from './api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const LIST: NotificationList = {
  items: [
    { id: 'n1', kind: 'high_event', title: 'FDA accepts Tyvaso sNDA', sub: 'Treprostinil', link: '/assets/trep/overview', read: false, at: '2026-10-09T10:00:00Z' },
    { id: 'n2', kind: 'job_failed', title: 'Sotatercept: 1 step failed', sub: 'Patents', link: '/jobs/j2', read: false, at: '2026-10-09T09:00:00Z' },
  ],
  unread: 2,
}

describe('notifications', () => {
  it('marks one, then all, read and keeps the cached list in step', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url === '/api/notifications') return json(200, LIST)
      if (url === '/api/notifications/read') return json(200, { unread: String(init?.body).includes('ids') ? 1 : 0 })
      return json(404, { code: 'NOT_FOUND', message: url })
    })
    const { result } = renderHook(() => ({ list: useNotifications(), read: useMarkNotificationsRead() }), { wrapper })
    await waitFor(() => expect(result.current.list.data?.unread).toBe(2))

    await act(() => result.current.read.mutateAsync({ ids: ['n1'] }))
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications/read', expect.objectContaining({ method: 'POST', body: '{"ids":["n1"]}' }))
    await waitFor(() => expect(result.current.list.data).toMatchObject({ unread: 1, items: [{ id: 'n1', read: true }, { id: 'n2', read: false }] }))

    await act(() => result.current.read.mutateAsync({}))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/notifications/read', expect.objectContaining({ body: '{}' }))
    await waitFor(() => expect(result.current.list.data).toMatchObject({ unread: 0, items: [{ read: true }, { read: true }] }))
  })
})

describe('notifications with an empty ids list', () => {
  it('makes no request and leaves the cache unchanged', async () => {
    fetchMock.mockImplementation(async (url) => (url === '/api/notifications' ? json(200, LIST) : json(404, { code: 'NOT_FOUND', message: url })))
    const { result } = renderHook(() => ({ list: useNotifications(), read: useMarkNotificationsRead() }), { wrapper })
    await waitFor(() => expect(result.current.list.data?.unread).toBe(2))
    await act(() => result.current.read.mutateAsync({ ids: [] }))
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/notifications/read')).toBe(false)
    expect(result.current.list.data).toEqual(LIST)
  })
})

describe('prefs', () => {
  it('reads prefs and caches what a partial PATCH returns', async () => {
    const prefs: Prefs = { journeyView: 'h', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: false } }
    fetchMock.mockImplementation(async (_url, init) => json(200, init?.method === 'PATCH' ? { ...prefs, sidebarCollapsed: true } : prefs))
    const { result } = renderHook(() => ({ prefs: usePrefs(), save: useSavePrefs() }), { wrapper })
    await waitFor(() => expect(result.current.prefs.data?.sidebarCollapsed).toBe(false))
    await act(() => result.current.save.mutateAsync({ sidebarCollapsed: true }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/me/prefs', expect.objectContaining({ method: 'PATCH', body: '{"sidebarCollapsed":true}' }))
    await waitFor(() => expect(result.current.prefs.data?.sidebarCollapsed).toBe(true))
  })
})

describe('watchlist', () => {
  const prefs: Prefs = { journeyView: 'h', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: false }, watchlist: ['trep'], homeWatchlistOnly: false }

  it('toggles stars at once, sends the whole list built from the cache, and keeps what the server returns', async () => {
    let release = () => {}
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method !== 'PATCH') return json(200, prefs)
      await new Promise<void>((r) => (release = r))
      return json(200, { ...prefs, ...JSON.parse(String(init.body)) })
    })
    const { result } = renderHook(() => useWatchlist(), { wrapper })
    await waitFor(() => expect(result.current.ids).toEqual(['trep']))
    act(() => result.current.toggle('sota'))
    await waitFor(() => expect(result.current.ids).toEqual(['trep', 'sota']))
    act(() => result.current.toggle('trep'))
    await waitFor(() => expect(result.current.ids).toEqual(['sota']))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/me/prefs', expect.objectContaining({ method: 'PATCH', body: '{"watchlist":["sota"]}' }))
    act(() => release())
    await waitFor(() => expect(result.current.ids).toEqual(['sota']))
  })

  it('reloads the stored list when saving fails', async () => {
    let fail = () => {}
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method !== 'PATCH') return json(200, prefs)
      await new Promise<void>((r) => (fail = r))
      return json(500, { code: 'INTERNAL', message: 'boom' })
    })
    const { result } = renderHook(() => useWatchlist(), { wrapper })
    await waitFor(() => expect(result.current.ids).toEqual(['trep']))
    act(() => result.current.toggle('sota'))
    await waitFor(() => expect(result.current.ids).toEqual(['trep', 'sota']))
    act(() => fail())
    await waitFor(() => expect(result.current.ids).toEqual(['trep']))
  })

  it("remembers Home's Watchlist chip", async () => {
    fetchMock.mockImplementation(async (_url, init) => json(200, init?.method === 'PATCH' ? { ...prefs, homeWatchlistOnly: true } : prefs))
    const { result } = renderHook(() => useHomeWatchlistOnly(), { wrapper })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    act(() => result.current[1](true))
    await waitFor(() => expect(result.current[0]).toBe(true))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/me/prefs', expect.objectContaining({ method: 'PATCH', body: '{"homeWatchlistOnly":true}' }))
  })
})
