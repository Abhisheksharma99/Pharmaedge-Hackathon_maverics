import type { JourneyEventV3 } from '@/features/journey/types'
import { competitorMoves, homeCounts, proximity, upcomingMilestones, whatChanged } from './home-data'

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
