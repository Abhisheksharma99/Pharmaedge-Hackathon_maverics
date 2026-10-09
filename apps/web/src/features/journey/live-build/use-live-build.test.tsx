import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { JobStep } from '@/features/jobs/api'
import type { JobFeedItem, JobProgress, JourneyEventV3 } from '../types'
import { useLiveBuild } from './use-live-build'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const job = (id: string, extra: Partial<JobProgress> = {}): JobProgress => ({
  id,
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status: 'running',
  steps: [step('regulatory', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: null,
  records: [{ coll: 'fda_records', count: 44 }],
  events_created: 0,
  feed_cursor: 1,
  record_years: [],
  ...extra,
})
const line = (id: number, extra: Partial<JobFeedItem> = {}): JobFeedItem => ({ id, t: '2026-10-09T10:00:00Z', step: 'journey', kind: 'info', text: `line ${id}`, ...extra })
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

/** A fake API whose job, feed and timeline the test changes as the crawl goes on. */
function fakeApi() {
  const api = {
    jobs: [job('j1')] as JobProgress[],
    job: job('j1'),
    feed: [line(1, { step: 'plan' })] as JobFeedItem[],
    timeline: [event('k1')],
    events: { e9: event('e9') } as Record<string, JourneyEventV3>,
    urls: [] as string[],
    timelineCalls: () => api.urls.filter((u) => u === '/api/assets/trep/timeline?scope=key').length,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      api.urls.push(url)
      if (url === '/api/jobs?asset=trep') return json(200, api.jobs)
      if (url === `/api/jobs/${api.job.id}`) return json(200, api.job)
      const feed = /^\/api\/jobs\/[^/]+\/feed\?since=(\d+)$/.exec(url)
      if (feed) {
        const since = Number(feed[1])
        const items = api.feed.filter((l) => l.id > since)
        return json(200, { items, cursor: Math.max(since, ...items.map((l) => l.id)) })
      }
      if (url === '/api/assets/trep/timeline?scope=key') return json(200, { events: api.timeline, total: api.timeline.length })
      const ev = /^\/api\/assets\/trep\/events\/(.+)$/.exec(url)
      const found = ev && api.events[decodeURIComponent(ev[1]!)]
      if (found) return json(200, { event: found, records: [] })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  return api
}

function setup(status: 'onboarding' | 'ready' = 'ready' as 'onboarding' | 'ready') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['asset', 'trep'], { id: 'trep', status })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(({ status }) => useLiveBuild({ id: 'trep', status }), { wrapper, initialProps: { status } })
  const poll = () => act(() => client.refetchQueries({ queryKey: ['job'] }))
  return { client, ...hook, poll }
}

afterEach(() => {
  focusManager.setFocused(undefined)
  vi.unstubAllGlobals()
})

describe('useLiveBuild', () => {
  it('follows the newest job of the asset', async () => {
    const api = fakeApi()
    api.jobs = [job('j2'), job('j1', { status: 'completed' })]
    api.job = job('j2')
    const { result } = setup()
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.job?.id).toBe('j2')
    await waitFor(() => expect(result.current.feed).toHaveLength(1))
    expect(api.urls).not.toContain('/api/jobs/j1')
  })

  it('says when the asset has never been crawled', async () => {
    const api = fakeApi()
    api.jobs = []
    const { result } = setup()
    await waitFor(() => expect(result.current.state).toBe('none'))
  })

  it('refetches the key timeline only when the feed announces an event, and loads that event', async () => {
    const api = fakeApi()
    const { result, poll } = setup()
    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(['k1']))
    expect(api.timelineCalls()).toBe(1)

    api.feed.push(line(2, { kind: 'done', text: '31 events from structured sources' }))
    api.job = { ...api.job, feed_cursor: 2 }
    await poll()
    await waitFor(() => expect(result.current.feed).toHaveLength(2))
    expect(api.timelineCalls()).toBe(1)

    api.feed.push(line(3, { kind: 'event', text: 'Event e9', event_id: 'e9', merged: 1 }))
    api.job = { ...api.job, feed_cursor: 3 }
    await poll()
    await waitFor(() => expect(result.current.latest.map((e) => e.id)).toEqual(['e9']))
    expect(result.current.events.map((e) => e.id)).toEqual(['k1', 'e9'])
    expect(api.urls).toContain('/api/assets/trep/events/e9')
    await waitFor(() => expect(api.timelineCalls()).toBe(2))
  })

  it('keeps the build on screen when a background poll fails', async () => {
    const api = fakeApi()
    const { result, poll } = setup()
    await waitFor(() => expect(result.current.state).toBe('ready'))
    api.job = { ...api.job, id: 'gone' } // /api/jobs/j1 now 404s
    await poll()
    await waitFor(() => expect(api.urls.filter((u) => u === '/api/jobs/j1').length).toBeGreaterThan(1))
    expect(result.current.state).toBe('ready')
    expect(result.current.job?.id).toBe('j1')
  })

  it('drops an announced event that later 404s', async () => {
    const api = fakeApi()
    api.feed.push(line(2, { kind: 'event', text: 'Event e9', event_id: 'e9', merged: 1 }))
    api.job = { ...api.job, feed_cursor: 2 }
    const { result, client } = setup()
    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(['k1', 'e9']))
    delete api.events.e9
    await act(() => client.refetchQueries({ queryKey: ['asset', 'trep', 'event', 'e9'] }))
    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(['k1']))
  })

  it('catches up the feed and reloads the asset when the job ended while the tab was hidden', async () => {
    const api = fakeApi()
    const { result, client } = setup('onboarding')
    await waitFor(() => expect(result.current.feed).toHaveLength(1))
    expect(client.getQueryState(['asset', 'trep'])?.isInvalidated).toBe(false)

    act(() => focusManager.setFocused(false))
    api.feed.push(line(2, { kind: 'done', text: 'Asset ready · 41 key events · 6 branches' }))
    api.job = job('j1', { status: 'completed', feed_cursor: 2, finished_at: '2026-10-09T10:05:00Z' })
    act(() => focusManager.setFocused(true))

    await waitFor(() => expect(result.current.job?.status).toBe('completed'))
    await waitFor(() => expect(result.current.feed.map((l) => l.id)).toEqual([1, 2]))
    // nothing else watches the asset here: only the job-ended reload can have invalidated it
    expect(client.getQueryState(['asset', 'trep'])?.isInvalidated).toBe(true)
  })

  it('reloads an asset still marked onboarding whose job had already ended', async () => {
    const api = fakeApi()
    api.job = job('j1', { status: 'completed', feed_cursor: 1 })
    const { client } = setup('onboarding')
    await waitFor(() => expect(client.getQueryState(['asset', 'trep'])?.isInvalidated).toBe(true))
  })

  it('leaves a ready asset alone when its last job had already ended', async () => {
    const api = fakeApi()
    api.job = job('j1', { status: 'completed', feed_cursor: 1 })
    const { result, client } = setup('ready')
    await waitFor(() => expect(result.current.feed).toHaveLength(1))
    expect(client.getQueryState(['asset', 'trep'])?.isInvalidated).toBe(false)
  })

  describe('end-of-job reload', () => {
    // React Query batches with setTimeout, so only the hook's 3 s timer is captured (and cleared calls tracked)
    let pending: Map<unknown, () => void>
    beforeEach(() => {
      pending = new Map()
      const real = globalThis.setTimeout
      const realClear = globalThis.clearTimeout
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...a: unknown[]) => {
        if (ms !== 3000) return real(fn, ms, ...a)
        const id = {}
        pending.set(id, fn)
        return id as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout)
      vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id: never) => {
        if (pending.delete(id)) return
        realClear(id)
      }) as typeof clearTimeout)
    })
    afterEach(() => vi.restoreAllMocks())
    const fire3s = () => act(() => [...pending.values()].forEach((fn) => fn()))
    const reloads = (client: QueryClient) => {
      const spy = vi.spyOn(client, 'invalidateQueries')
      return () => spy.mock.calls.filter(([f]) => f?.queryKey?.[0] === 'assets').length
    }
    async function endRunning(status: 'onboarding' | 'ready') {
      const api = fakeApi()
      api.job = job('j1', { feed_cursor: 1 })
      const s = setup(status)
      const count = reloads(s.client)
      await waitFor(() => expect(s.result.current.state).toBe('ready'))
      api.job = job('j1', { status: 'completed', feed_cursor: 1, finished_at: '2026-10-09T10:05:00Z' })
      await s.poll()
      await waitFor(() => expect(count()).toBe(1))
      return { ...s, count }
    }

    it('reloads again after 3 s even when the first reload flips the asset to ready', async () => {
      const { rerender, count } = await endRunning('onboarding')
      rerender({ status: 'ready' })
      fire3s()
      expect(count()).toBe(2)
    })

    it('does not reload after unmount', async () => {
      const { unmount, count } = await endRunning('onboarding')
      unmount()
      fire3s()
      expect(count()).toBe(1)
    })

    it('treats the first event line of a new job as a first sighting', async () => {
      const api = fakeApi()
      api.feed = [line(1), line(5, { kind: 'event', event_id: 'e9' })]
      const { result, client } = setup()
      await waitFor(() => expect(result.current.feed).toHaveLength(2))
      expect(api.timelineCalls()).toBe(1)
      api.jobs = [job('j2')]
      api.job = job('j2')
      api.feed = [line(7, { kind: 'event', event_id: 'e9' })]
      await act(() => client.refetchQueries({ queryKey: ['jobs'] }))
      await waitFor(() => expect(result.current.job?.id).toBe('j2'))
      await waitFor(() => expect(result.current.feed.map((l) => l.id)).toEqual([7]))
      expect(api.timelineCalls()).toBe(1)
    })
  })
})
