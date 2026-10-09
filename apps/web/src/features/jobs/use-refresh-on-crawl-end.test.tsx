import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useAssets } from '@/features/assets/api'
import { usePortfolioTimeline } from '@/features/home/api'
import type { Job } from './api'
import { useRefreshOnCrawlEnd } from './use-refresh-on-crawl-end'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const RUNNING = { id: 'j1', asset: 'trep', type: 'onboard', status: 'running', steps: [] } as unknown as Job

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useRefreshOnCrawlEnd', () => {
  it('refetches portfolio and assets when a running job disappears, and again ~3 s later', async () => {
    let jobs: Job[] = [RUNNING]
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/jobs?status=running') return json(200, jobs)
      if (url === '/api/portfolio/timeline?competitors=true') return json(200, { assets: [], events: [] })
      if (url === '/api/assets') return json(200, [])
      return json(404, { code: 'NOT_FOUND', message: url })
    })
    vi.stubGlobal('fetch', fetchMock)
    const count = (u: string) => fetchMock.mock.calls.filter(([x]) => x === u).length
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    renderHook(
      () => {
        useRefreshOnCrawlEnd()
        usePortfolioTimeline()
        useAssets()
      },
      { wrapper },
    )
    await vi.waitFor(() => expect(count('/api/assets')).toBe(1))
    await vi.waitFor(() => expect(count('/api/portfolio/timeline?competitors=true')).toBe(1))

    await vi.waitFor(() => expect(client.getQueryData(['jobs', { status: 'running' }])).toEqual([RUNNING]))

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    jobs = []
    await client.invalidateQueries({ queryKey: ['jobs'] })
    await vi.waitFor(() => expect(count('/api/assets')).toBe(2))
    expect(count('/api/portfolio/timeline?competitors=true')).toBe(2)

    await vi.advanceTimersByTimeAsync(3100)
    await vi.waitFor(() => expect(count('/api/assets')).toBe(3))
    expect(count('/api/portfolio/timeline?competitors=true')).toBe(3)
  })
})
