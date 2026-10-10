import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { useBranches, useEndedBranchEvents, useJourneyEvents } from './api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchMock = vi.fn(async () => json(200, { events: [], total: 0 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('journey hooks', () => {
  it('reads a scope with the team notes and no server-side filters', async () => {
    const { result } = renderHook(() => useJourneyEvents('trep', 'key'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/timeline?scope=key&include=notes&limit=5000', expect.anything())
    expect(client.getQueryData(['asset', 'trep', 'timeline-v3', 'key'])).toEqual({ events: [], total: 0 })
  })

  it('stays idle when disabled', async () => {
    renderHook(() => useJourneyEvents('trep', 'all', { enabled: false }), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the branches', async () => {
    fetchMock.mockResolvedValueOnce(json(200, [{ id: 'PAH', trunk: true }]))
    const { result } = renderHook(() => useBranches('a/b'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'PAH', trunk: true }]))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/a%2Fb/branches', expect.anything())
  })

  it('reads every event of the ended branches, sorted ids in one request, and idles without any', async () => {
    const { result } = renderHook(() => useEndedBranchEvents('trep', ['PH-COPD', 'CLI']), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/timeline?scope=all&branch=CLI%2CPH-COPD&limit=5000', expect.anything())
    fetchMock.mockClear()
    renderHook(() => useEndedBranchEvents('trep', []), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
