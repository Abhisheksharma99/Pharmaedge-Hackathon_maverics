import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { JobFeedItem } from '@/features/journey/types'
import { EMPTY_FEED, feedPollInterval, mergeFeed, useJobFeed, type FeedState } from './feed'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const line = (id: number, text = `line ${id}`): JobFeedItem => ({ id, t: '2026-10-09T10:00:00Z', step: 'regulatory', kind: 'info', text })
const JOB = { id: 'j1', status: 'running' as const, feed_cursor: 3 }

/** The feed endpoint over `lines`: what `since` asks for, oldest first, at most 500. */
function serveFeed(lines: () => JobFeedItem[]) {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      const m = /^\/api\/jobs\/j1\/feed\?since=(\d+)$/.exec(url)
      if (!m) return json(404, { code: 'NOT_FOUND', message: url })
      const since = Number(m[1])
      const items = lines().filter((l) => l.id > since).slice(0, 500)
      return json(200, { items, cursor: Math.max(since, ...items.map((i) => i.id)) })
    }),
  )
  return urls
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

afterEach(() => vi.unstubAllGlobals())

describe('mergeFeed', () => {
  it('keeps one line per id, in id order, and never moves the cursor back', () => {
    const first = mergeFeed(EMPTY_FEED, { items: [line(3), line(1), line(2)], cursor: 3 })
    expect(first.items.map((l) => l.id)).toEqual([1, 2, 3])
    expect(first).toMatchObject({ cursor: 3, fresh: 3 })
    const next = mergeFeed({ ...first, fresh: 0 }, { items: [line(3, 'again'), line(4)], cursor: 4 })
    expect(next.items.map((l) => [l.id, l.text])).toEqual([[1, 'line 1'], [2, 'line 2'], [3, 'again'], [4, 'line 4']])
    expect(next).toMatchObject({ cursor: 4, fresh: 1 })
    expect(mergeFeed(next, { items: [], cursor: 2 }).cursor).toBe(4)
  })
})

describe('feedPollInterval', () => {
  const feed = (cursor: number, extra: Partial<FeedState> = {}): FeedState => ({ items: [], cursor, fresh: 0, final: false, ...extra })
  it('polls every 2 s while the job runs, then only until the last line is in', () => {
    expect(feedPollInterval(undefined, undefined)).toBe(false)
    expect(feedPollInterval({ status: 'running', feed_cursor: 9 }, feed(9))).toBe(2000)
    expect(feedPollInterval({ status: 'queued', feed_cursor: 0 }, undefined)).toBe(2000)
    expect(feedPollInterval({ status: 'completed', feed_cursor: 9 }, feed(9))).toBe(false)
    // ended while the last fetch was in flight: one more fetch
    expect(feedPollInterval({ status: 'completed', feed_cursor: 9 }, feed(5))).toBe(2000)
    // a fetch after the end still brought lines: keep going
    expect(feedPollInterval({ status: 'failed', feed_cursor: 9 }, feed(7, { final: true, fresh: 2 }))).toBe(2000)
    // a fetch after the end brought nothing: the missing line will never come
    expect(feedPollInterval({ status: 'completed', feed_cursor: 9 }, feed(7, { final: true }))).toBe(false)
  })
})

describe('useJobFeed', () => {
  it('pages by cursor and keeps lines that arrive twice or out of order once, in order', async () => {
    const pages = [
      { items: [line(2), line(1), line(3)], cursor: 3 },
      { items: [line(3, 'again'), line(4)], cursor: 4 },
    ]
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        return json(200, pages.shift() ?? { items: [], cursor: 4 })
      }),
    )
    const client = newClient()
    const { result } = renderHook(() => useJobFeed(JOB), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.data?.cursor).toBe(3))
    expect(result.current.data?.items.map((l) => l.id)).toEqual([1, 2, 3])

    await act(() => client.refetchQueries({ queryKey: ['job', 'j1', 'feed'] }))
    await waitFor(() => expect(result.current.data?.cursor).toBe(4))
    expect(urls).toEqual(['/api/jobs/j1/feed?since=0', '/api/jobs/j1/feed?since=3'])
    expect(result.current.data?.items.map((l) => [l.id, l.text])).toEqual([
      [1, 'line 1'],
      [2, 'line 2'],
      [3, 'again'],
      [4, 'line 4'],
    ])
  })

  it('resumes from the cached cursor after a remount', async () => {
    let lines = [line(1), line(2), line(3)]
    const urls = serveFeed(() => lines)
    const client = newClient()
    const first = renderHook(() => useJobFeed(JOB), { wrapper: wrapper(client) })
    await waitFor(() => expect(first.result.current.data?.cursor).toBe(3))
    first.unmount()

    lines = [...lines, line(4)]
    const second = renderHook(() => useJobFeed({ ...JOB, feed_cursor: 4 }), { wrapper: wrapper(client) })
    await waitFor(() => expect(second.result.current.data?.cursor).toBe(4))
    expect(urls).toEqual(['/api/jobs/j1/feed?since=0', '/api/jobs/j1/feed?since=3'])
    expect(second.result.current.data?.items.map((l) => l.id)).toEqual([1, 2, 3, 4])
  })

  it('reads every waiting page in one go when more than 500 lines are waiting', async () => {
    const lines = Array.from({ length: 502 }, (_, i) => line(i + 1))
    const urls = serveFeed(() => lines)
    const { result } = renderHook(() => useJobFeed({ id: 'j1', status: 'completed', feed_cursor: 502 }), { wrapper: wrapper(newClient()) })
    await waitFor(() => expect(result.current.data?.cursor).toBe(502))
    expect(urls).toEqual(['/api/jobs/j1/feed?since=0', '/api/jobs/j1/feed?since=500'])
    expect(result.current.data?.items).toHaveLength(502)
  })

  it('marks a fetch made after the job ended as final', async () => {
    serveFeed(() => [line(1)])
    const client = newClient()
    client.setQueryData(['job', 'j1'], { id: 'j1', status: 'completed' })
    const { result } = renderHook(() => useJobFeed({ id: 'j1', status: 'completed', feed_cursor: 2 }), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.data).toMatchObject({ cursor: 1, final: true, fresh: 1 }))
  })

  it('stays idle without a job', () => {
    const urls = serveFeed(() => [])
    const { result } = renderHook(() => useJobFeed(undefined), { wrapper: wrapper(newClient()) })
    expect(result.current.fetchStatus).toBe('idle')
    expect(urls).toEqual([])
  })
})
