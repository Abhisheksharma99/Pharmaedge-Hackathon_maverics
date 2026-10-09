import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useEventsById, useTimelineV3 } from './api'
import type { JourneyEventV3 } from './types'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const event = (id: string): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date: '2021-04-01',
  type: 'approval',
  category: 'regulatory',
  title: `Event ${id}`,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.unstubAllGlobals())

describe('journey hooks', () => {
  it('reads the key-event timeline', async () => {
    const fetchMock = vi.fn(async () => json(200, { events: [event('e1')], total: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTimelineV3('trep', { scope: 'key' }), { wrapper })
    await waitFor(() => expect(result.current.data?.total).toBe(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/timeline?scope=key', expect.anything())
  })

  it('loads events by id in the order given, URL-encoded, leaving out the ones that fail', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        const id = decodeURIComponent(url.split('/events/')[1] ?? '')
        return id === 'gone' ? json(404, { code: 'EVENT_NOT_FOUND', message: 'Event not found' }) : json(200, { event: event(id), records: [] })
      }),
    )
    const ids = ['ai:trep:https://example.com/a/b:0', 'gone', 'e2']
    const { result } = renderHook(() => useEventsById('trep', ids), { wrapper })
    await waitFor(() => expect(result.current.map((e) => e.id)).toEqual(['ai:trep:https://example.com/a/b:0', 'e2']))
    expect(urls).toContain('/api/assets/trep/events/ai%3Atrep%3Ahttps%3A%2F%2Fexample.com%2Fa%2Fb%3A0')
  })
})
