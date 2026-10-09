import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { JourneyEventV3 } from '@/features/journey/types'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { PortfolioTimeline } from '../api'
import { CompetitiveSignals } from './competitive-signals'
import { NextMilestones } from './next-milestones'
import { WhatChanged } from './what-changed'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const src = (n: number) => ({ collection: 'articles', record_key: `https://news.example/${n}` })
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
  key: true,
  ...extra,
})

const PORTFOLIO: PortfolioTimeline = {
  assets: [
    { id: 'trep', name: 'Treprostinil', kind: 'primary', company: 'United Therapeutics', status: 'ready', progress: null, competitorOf: [] },
    { id: 'sota', name: 'Sotatercept', kind: 'primary', company: 'Merck', status: 'ready', progress: null, competitorOf: [] },
    { id: 'nint', name: 'Nintedanib', kind: 'competitor', company: 'Boehringer Ingelheim', status: 'ready', progress: null, competitorOf: ['trep'] },
  ],
  events: [
    ev('d1', 'trep', '2026-10-05', { title: 'FDA accepts Tyvaso sNDA for IPF', via: 'ai_events', sources: [src(1), src(2), src(3), src(4)] }),
    ev('d2', 'sota', '2026-09-20', { title: 'HYPERION results presented', significance: 'Medium', category: 'clinical' }),
    ev('d3', 'nint', '2026-08-01', { title: 'Ofev included in Medicare negotiation', significance: 'Medium', category: 'company' }),
    ev('old', 'trep', '2026-01-01', { title: 'Old news' }),
    ev('m1', 'trep', '2026-12-01', { title: 'TETON-2 readout', is_milestone: true, significance: 'Medium', category: 'clinical' }),
    ev('m2', 'sota', '2027-03-31', { title: 'EU decision expected', is_milestone: true }),
    ev('m3', 'nint', '2028-01-01', { title: 'Ofev patent expiry', is_milestone: true, category: 'ip' }),
    ev('m4', 'nint', '2027-02-01', { title: 'Ofev label update expected', is_milestone: true }),
  ],
}

function renderWith(ui: ReactElement, portfolio: PortfolioTimeline = PORTFOLIO) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url === '/api/portfolio/timeline?competitors=true' ? json(200, portfolio) : json(404, { code: 'NOT_FOUND', message: url }))),
  )
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T09:00:00'))
  useEventSheet.setState({ current: null })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('WhatChanged', () => {
  it('groups key events by recency, tags competitors and AI events, and opens the sheet', async () => {
    renderWith(<WhatChanged />)
    const week = await screen.findByRole('region', { name: 'Last 7 days' })
    const title = within(week).getByRole('button', { name: 'FDA accepts Tyvaso sNDA for IPF' })
    expect(week).toHaveTextContent('AI · 4 sources')
    expect(week).toHaveTextContent('Oct 5, 2026')
    expect(within(week).getByRole('link', { name: 'Treprostinil' })).toHaveAttribute('href', '/assets/trep/overview')
    expect(within(screen.getByRole('region', { name: 'Last 30 days' })).getByText('HYPERION results presented')).toBeInTheDocument()
    const quarter = screen.getByRole('region', { name: 'Last 90 days' })
    expect(quarter).toHaveTextContent('Ofev included in Medicare negotiation')
    expect(within(quarter).getByText('Competitor')).toBeInTheDocument()
    expect(screen.queryByText('Old news')).not.toBeInTheDocument()
    await userEvent.click(title)
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'd1' })
  })

  it('reads "Quiet quarter" when nothing changed', async () => {
    renderWith(<WhatChanged />, { ...PORTFOLIO, events: [] })
    expect(await screen.findByText('Quiet quarter')).toBeInTheDocument()
    expect(screen.getByText('No new key events in the last 90 days.')).toBeInTheDocument()
  })
})

describe('NextMilestones', () => {
  it('lists milestones soonest first with a countdown, and opens the sheet', async () => {
    renderWith(<NextMilestones />)
    const items = await screen.findAllByRole('button', { name: /readout|decision|expiry/ })
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringContaining('TETON-2 readout'),
      expect.stringContaining('EU decision expected'),
      expect.stringContaining('Ofev patent expiry'),
    ])
    expect(items[0]).toHaveTextContent('Dec2026')
    expect(items[0]).toHaveTextContent('in 2 months')
    await userEvent.click(items[1])
    expect(useEventSheet.getState().current).toEqual({ assetId: 'sota', eventId: 'm2' })
  })
})

describe('CompetitiveSignals', () => {
  it('lists recent competitor moves, then near-term milestones, skipping far-future ones', async () => {
    renderWith(<CompetitiveSignals />)
    const rows = await screen.findAllByRole('button', { name: /Ofev/ })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Ofev included in Medicare negotiation')
    expect(rows[0]).toHaveTextContent('vs Treprostinil')
    expect(rows[0]).toHaveTextContent('Aug 1, 2026')
    expect(rows[1]).toHaveTextContent('Ofev label update expected')
    expect(rows[1]).toHaveTextContent('expected Feb 2027')
    expect(screen.queryByText('Ofev patent expiry')).not.toBeInTheDocument()
  })
})
