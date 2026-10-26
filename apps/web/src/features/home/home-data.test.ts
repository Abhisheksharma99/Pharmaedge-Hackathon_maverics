import type { JourneyEventV3 } from '@/features/journey/types'
import type { PortfolioTimeline } from './api'
import { competitorMoves, formatVisit, homeCounts, isNewSince, newSince, proximity, scopePortfolio, upcomingMilestones, whatChanged } from './home-data'

const TODAY = '2026-10-09'
const ev = (id: string, asset: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset,
  date,
  type: 'approval',
  category: 'regulatory',
  title: id,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
  ...extra,
})

const EVENTS = [
  ev('d1', 'trep', '2026-10-05'),
  ev('d2', 'sota', '2026-09-20', { significance: 'Medium' }),
  ev('d3', 'nint', '2026-08-01', { significance: 'Medium' }),
  ev('old', 'trep', '2026-01-01'),
  ev('low', 'trep', '2026-10-01', { significance: 'Low' }),
  ev('m1', 'trep', '2026-12-01', { is_milestone: true, significance: 'Medium' }),
  ev('m2', 'sota', '2027-03-31', { is_milestone: true }),
  ev('m3', 'nint', '2028-01-01', { is_milestone: true }),
  ev('stale', 'sota', '2026-09-01', { is_milestone: true }),
  ev('undated', 'trep', ''),
  ev('partial', 'trep', '2026-10'),
]

describe('home data', () => {
  it('groups the last 90 days of High and Medium events by recency, newest first', () => {
    expect(whatChanged(EVENTS, TODAY).map((g) => [g.label, g.events.map((e) => e.id)])).toEqual([
      ['Last 7 days', ['d1']],
      ['Last 30 days', ['partial', 'd2']],
      ['Last 90 days', ['d3']],
    ])
  })

  it('lists expected milestones from today on, soonest first', () => {
    expect(upcomingMilestones(EVENTS, TODAY).map((e) => e.id)).toEqual(['m1', 'm2', 'm3'])
    expect(upcomingMilestones(EVENTS, TODAY, 2).map((e) => e.id)).toEqual(['m1', 'm2'])
  })

  it('counts new events and upcoming milestones, ignoring undated events and past milestones', () => {
    expect(homeCounts(EVENTS, TODAY)).toEqual({ new30: 4, high30: 2, new90: 5, next6m: 2, next12m: 2 })
  })

  it('lists competitor moves: last 12 months newest first, then next 12 months soonest first', () => {
    const more = [
      ...EVENTS,
      ev('p1', 'nint', '2026-10-01'),
      ev('far', 'nint', '2042-12-01', { is_milestone: true }),
      ev('ancient', 'nint', '2024-01-01'),
      ev('soon', 'nint', '2027-02-01', { is_milestone: true }),
      ev('partial', 'nint', '2026', { is_milestone: true }),
      ev('undated', 'nint', ''),
    ]
    const ids = competitorMoves(more, (id) => id === 'nint', TODAY).map((e) => e.id)
    expect(ids).toEqual(['p1', 'd3', 'soon'])
  })

  it('turns days to go into a proximity bar width', () => {
    expect(proximity(0)).toBe(100)
    expect(proximity(274)).toBe(50)
    expect(proximity(548)).toBe(4)
    expect(proximity(-10)).toBe(100)
  })
})

describe('scopePortfolio', () => {
  const asset = (id: string, kind: 'primary' | 'competitor', competitorOf: string[] = []) => ({ id, name: id, kind, company: null, status: 'ready' as const, progress: null, competitorOf })
  const DATA: PortfolioTimeline = {
    assets: [asset('trep', 'primary'), asset('sota', 'primary'), asset('nint', 'competitor', ['trep']), asset('mace', 'competitor', ['sota'])],
    events: [ev('a', 'trep', '2026-01-01'), ev('b', 'sota', '2026-01-01'), ev('c', 'nint', '2026-01-01'), ev('d', 'mace', '2026-01-01')],
  }

  it('keeps everything without a watchlist', () => {
    expect(scopePortfolio(DATA, null)).toBe(DATA)
  })

  it('keeps watched primaries, their competitors and watched competitors, with their events', () => {
    const out = scopePortfolio(DATA, new Set(['trep']))
    expect(out.assets.map((a) => a.id)).toEqual(['trep', 'nint'])
    expect(out.events.map((e) => e.id)).toEqual(['a', 'c'])
    expect(scopePortfolio(DATA, new Set(['mace'])).assets.map((a) => a.id)).toEqual(['mace'])
  })
})

describe('new since the previous visit', () => {
  const SINCE = '2026-10-06T12:00:00.000Z'
  const seen = (id: string, asset: string, date: string, first_seen?: string) => ({ ...ev(id, asset, date), first_seen })

  it('is stored after the previous visit; nothing is new without a visit or a first-seen time', () => {
    expect(isNewSince(seen('a', 'trep', '2020-01-01', '2026-10-07T08:00:00Z'), SINCE)).toBe(true)
    expect(isNewSince(seen('a', 'trep', '2020-01-01', '2026-10-06T11:59:59Z'), SINCE)).toBe(false)
    expect(isNewSince(seen('a', 'trep', '2020-01-01'), SINCE)).toBe(false)
    expect(isNewSince(seen('a', 'trep', '2020-01-01', '2026-10-07T08:00:00Z'), null)).toBe(false)
  })

  it('lists new events newest-dated first and counts the assets they touch', () => {
    const out = newSince(
      [seen('old', 'trep', '2019-05-01', '2026-10-08T00:00:00Z'), seen('seen', 'sota', '2026-10-01', '2026-01-01T00:00:00Z'), seen('new', 'nint', '2026-10-05', '2026-10-07T00:00:00Z'), seen('m', 'trep', '2027-01-01', '2026-10-07T00:00:00Z')],
      SINCE,
    )
    expect(out.events.map((e) => e.id)).toEqual(['m', 'new', 'old'])
    expect(out.assets).toBe(2)
  })
})

describe('formatVisit', () => {
  const NOW = new Date(2026, 9, 9, 9, 0) // Fri Oct 9, 09:00 local

  it('reads today, a weekday within the week, else the date', () => {
    expect(formatVisit(new Date(2026, 9, 9, 7, 5).toISOString(), NOW)).toBe('07:05 today')
    expect(formatVisit(new Date(2026, 9, 6, 14, 5).toISOString(), NOW)).toBe('Tue 14:05')
    expect(formatVisit(new Date(2026, 9, 3, 0, 0).toISOString(), NOW)).toBe('Sat 00:00')
    expect(formatVisit(new Date(2026, 9, 2, 23, 59).toISOString(), NOW)).toBe('Oct 2, 23:59')
  })
})
