import type { AssetSummary } from '../api'
import { nextSort, parseSort, sortAssets, sortLabel, sortParam, statusLabel } from './asset-search-sort'

const ZERO = { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 }
const asset = (id: string, extra: Partial<AssetSummary> = {}): AssetSummary => ({
  id,
  name: id,
  aliases: [],
  company: { name: 'Co' },
  tags: {},
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: ZERO,
  latestEvent: null,
  competitorOf: [],
  ...extra,
})
const latest = (date: string) => ({ date, title: date, type: 'news' })
const ids = (list: AssetSummary[]) => list.map((a) => a.id)
const idle = () => null

describe('asset sort', () => {
  it('parses and writes ?sort=, ignoring unknown columns', () => {
    expect(parseSort('-events')).toEqual({ key: 'events', desc: true })
    expect(parseSort('name')).toEqual({ key: 'name', desc: false })
    expect(parseSort('-bogus')).toBeNull()
    expect(parseSort(null)).toBeNull()
    expect(sortParam({ key: 'latest', desc: true })).toBe('-latest')
  })

  it('starts counts and dates high-to-low, text A–Z, and flips the same column', () => {
    expect(nextSort(null, 'events')).toEqual({ key: 'events', desc: true })
    expect(nextSort(null, 'company')).toEqual({ key: 'company', desc: false })
    expect(nextSort({ key: 'company', desc: false }, 'company')).toEqual({ key: 'company', desc: true })
    expect(sortLabel({ key: 'latest', desc: true })).toBe('Latest update, newest first')
  })

  it('keeps assets without an update last in both directions, ties in the default order', () => {
    const list = [asset('b'), asset('c', { latestEvent: latest('2026-01-01') }), asset('a'), asset('d', { latestEvent: latest('2025-01-01') })]
    expect(ids(sortAssets(list, { key: 'latest', desc: true }, idle))).toEqual(['c', 'd', 'a', 'b'])
    expect(ids(sortAssets(list, { key: 'latest', desc: false }, idle))).toEqual(['d', 'c', 'a', 'b'])
    expect(ids(sortAssets(list, null, idle))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('sorts status by the pill words, a running crawl reading "Collecting"', () => {
    const list = [asset('ready'), asset('failed', { status: 'failed' }), asset('running')]
    expect(statusLabel(list[2]!, 0.4)).toBe('Collecting')
    expect(ids(sortAssets(list, { key: 'status', desc: false }, (id) => (id === 'running' ? 0.4 : null)))).toEqual(['running', 'failed', 'ready'])
  })
})
