import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { assetMatches, byKindThenName, useAssetDetails, type AssetSummary } from './assets/api'
import { eventsByAsset, usePortfolioTimeline } from './home/api'
import { useJobProgress } from './jobs/api'
import { useEvent } from './journey/api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const BASE: AssetSummary = {
  id: 'x',
  name: 'X',
  aliases: [],
  company: { name: 'Co' },
  tags: {},
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null,
  competitorOf: [],
}
const asset = (name: string, kind: AssetSummary['kind'], extra: Partial<AssetSummary> = {}): AssetSummary => ({ ...BASE, id: name.toLowerCase(), name, kind, ...extra })

describe('asset helpers', () => {
  it('matches every word against name, brands, company, indications and mechanism', () => {
    const trep = asset('Treprostinil', 'primary', {
      aliases: ['Tyvaso'],
      company: { name: 'United Therapeutics' },
      tags: { indications: ['PAH'], investigational_indications: ['PH-ILD'], mechanism: 'Prostacyclin analogue' },
    })
    expect(assetMatches(trep, 'tyvaso')).toBe(true)
    expect(assetMatches(trep, 'united pah')).toBe(true)
    expect(assetMatches(trep, 'ph-ild prostacyclin')).toBe(true)
    expect(assetMatches(trep, 'ofev')).toBe(false)
    expect(assetMatches(trep, '   ')).toBe(true)
  })

  it('sorts primary assets first, then by name', () => {
    const list = [asset('Yutrepia', 'competitor'), asset('Treprostinil', 'primary'), asset('Nintedanib', 'competitor'), asset('Sotatercept', 'primary')]
    expect([...list].sort(byKindThenName).map((a) => a.name)).toEqual(['Sotatercept', 'Treprostinil', 'Nintedanib', 'Yutrepia'])
  })

  it('groups events by asset, keeping their order', () => {
    const groups = eventsByAsset([{ asset: 'a', n: 1 }, { asset: 'b', n: 2 }, { asset: 'a', n: 3 }])
    expect(groups.get('a')?.map((e) => e.n)).toEqual([1, 3])
    expect(groups.get('b')?.map((e) => e.n)).toEqual([2])
  })
})

describe('Phase 1b route hooks', () => {
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
  let client: QueryClient
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const EVENT_ID = 'ai:trep:https://example.com/a/b:0'

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url === '/api/portfolio/timeline?competitors=true') return json(200, { assets: [], events: [] })
      if (url === `/api/assets/trep/events/${encodeURIComponent(EVENT_ID)}`) {
        return json(200, { event: { id: EVENT_ID }, records: [], neighbors: { prev: null, next: null }, branchStats: { index: 1, total: 1, prevSameBranch: null } })
      }
      if (url === '/api/jobs/j1') return json(200, { id: 'j1', status: 'completed', steps: [], records: [{ coll: 'fda_records', count: 4 }], events_created: 2, feed_cursor: 0, record_years: [] })
      if (url === '/api/assets/trep') return json(200, { id: 'trep', kpis: { approvalRegions: ['US'] } })
      if (url === '/api/assets/nint') return json(200, { id: 'nint', kpis: { approvalRegions: [] } })
      return json(404, { code: 'NOT_FOUND', message: url })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('call the routes with encoded event ids and expose the live-build counters', async () => {
    const { result } = renderHook(
      () => ({
        portfolio: usePortfolioTimeline(),
        event: useEvent('trep', EVENT_ID),
        closed: useEvent('trep', null),
        job: useJobProgress('j1'),
        details: useAssetDetails(['trep', 'nint']),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.portfolio.isSuccess && result.current.event.isSuccess && result.current.job.isSuccess).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/events/ai%3Atrep%3Ahttps%3A%2F%2Fexample.com%2Fa%2Fb%3A0', expect.anything())
    expect(result.current.closed.fetchStatus).toBe('idle')
    expect(result.current.job.data?.records).toEqual([{ coll: 'fda_records', count: 4 }])
    await waitFor(() => expect(result.current.details.trep?.kpis.approvalRegions).toEqual(['US']))
    expect(result.current.details.nint?.kpis.approvalRegions).toEqual([])
  })
})
