import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { useSearch, type SearchResult } from './api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const RESULT: SearchResult = {
  assets: [],
  events: [{ id: 'e1', asset: 'trep', assetName: 'Treprostinil', title: 'Phase 3 trial started: TETON-1', date: '2021-06-01', category: 'clinical', nct_id: 'NCT04708782' }],
}

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => json(200, RESULT))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('useSearch', () => {
  it('sends nothing under two characters, then debounces and encodes the term', async () => {
    const { result, rerender } = renderHook(({ q }) => useSearch(q), { wrapper, initialProps: { q: 't' } })
    await new Promise((r) => setTimeout(r, 250))
    expect(fetchMock).not.toHaveBeenCalled()
    rerender({ q: 'te' })
    rerender({ q: 'tet' })
    rerender({ q: 'teton & co ' })
    await waitFor(() => expect(result.current.data?.events).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=teton+%26+co')
  })

  it('trims and caps the query at 120 characters', async () => {
    renderHook(() => useSearch(`  ${'x'.repeat(200)}  `), { wrapper })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/search?q=${'x'.repeat(120)}`)
  })
})
