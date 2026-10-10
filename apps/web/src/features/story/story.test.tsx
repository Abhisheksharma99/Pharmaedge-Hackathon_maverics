import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import type { AssetDetail } from '@/features/assets/api'
import type { SavedStory, StoryEvent } from './api'
import { useLiveStories } from './live-store'
import { StoryPanel } from './story-panel'
import { clusterEvents } from './story-timeline'

const json = (status: number, body?: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET = { id: 'trep', name: 'Treprostinil', company: { name: 'United Therapeutics' }, competitors: [{ id: 'nint', name: 'Nintedanib' }], competitorOf: [] } as unknown as AssetDetail
const ev = (id: string, date: string, over: Partial<StoryEvent> = {}): StoryEvent => ({
  id, date, type: 'trial_readout', category: 'clinical', title: `Event ${id}`, significance: 'High', upcoming: false, origin: 'rule',
  source: { collection: 'trial_records', record_key: `ctgov:${id}` }, sources: 1, ...over,
})
const PHILD = ev('phild', '2026-03-09', { type: 'approval', category: 'regulatory', origin: 'ai', title: 'FDA approves inhaled treprostinil for PH-ILD',
  verification: { status: 'unconfirmed', note: 'No FDA approval record within 45 days of this date', against: ['tyvaso'] } })
const TYVASO = ev('tyvaso', '2021-03-31', { type: 'label_expansion', category: 'regulatory', title: 'FDA approves efficacy supplement for Tyvaso' })
const TETON = ev('teton1', '2026-10-08', { title: 'TETON-1 meets primary endpoint', impact: { trading_day: '2026-10-08', base_close: 100, days_measured: 1, day0: 4.2, day5: null, day20: null, dip: null, dip_day: null, dip_close: null, peak: 4.2, peak_day: 0, peak_close: 104 } })
const DECISION = ev('decision', '2027-04-30', { type: 'regulatory_decision_expected', category: 'regulatory', upcoming: true, title: 'FDA decision expected',
  change: { kind: 'changed', field: 'date', before: '2027-03-31', after: '2027-04-30', at: '2026-10-01T00:00:00Z' } })

const SAVED: SavedStory = {
  id: 's1', assetId: 'trep', title: 'Treprostinil · what changed since Sep 2025', question: 'What changed since TETON-2?', spec: { since: '2025-09-01' },
  notes: [{ id: 'n1', text: 'One source misdates the PH-ILD approval.', eventIds: ['phild', 'tyvaso'] }], chapterNames: { 'ch-2': 'IPF push' }, updatedAt: '2026-10-10',
  story: {
    asset: { id: 'trep', name: 'Treprostinil', company: 'United Therapeutics' },
    market: { ticker: 'UTHR', listedName: 'United Therapeutics Corporation', viaParent: false, source: 'test', closes: [{ date: '2026-01-02', close: 400 }, { date: '2026-06-01', close: 500 }] },
    spec: { since: '2025-09-01' },
    range: { from: '2021-01-01', to: '2027-12-31', today: '2026-10-10' },
    approvals: [{ id: 'remo', date: '2002-05-21', region: 'US', product: 'Remodulin', level: 1 }, { id: 'dpi', date: '2022-05-23', region: 'US', product: 'Tyvaso DPI', level: 2 }],
    lanes: [
      { category: 'regulatory', events: [TYVASO, PHILD, DECISION], total: 3 },
      { category: 'clinical', events: [TETON], total: 9 },
      { category: 'company', events: [], total: 0 },
    ],
    changes: {
      since: '2025-09-01', developments: [TETON, PHILD], updates: [{ eventId: 'decision', kind: 'changed', field: 'date', before: '2027-03-31', after: '2027-04-30', at: '2026-10-01T00:00:00Z', title: 'FDA decision expected', category: 'regulatory', eventDate: '2027-04-30' }],
      checks: [PHILD], slides: [{ recordKey: 'slide:1', title: 'TETON-2 results', date: '2025-10-01', metric: 'FVC change', value: '95 mL' }], labels: [], trials: [],
      firstSeen: { total: 3, kept: 2, headline: 1, items: [{ title: 'TETON-1 topline', date: '2026-10-08', source: 'PR Newswire', category: 'trial_readout', decision: 'ingest', url: null }] },
      upcoming: [DECISION],
    },
    chapters: [
      { id: 'ch-1', name: 'Tyvaso DPI approved', from: '2022-05-23', to: '2025-09-01', focus: false, events: 4, byCategory: { regulatory: 2, clinical: 2 }, highlights: [] },
      { id: 'ch-2', name: 'Since Sep 2025', from: '2025-09-01', to: '2026-10-10', focus: true, events: 2, byCategory: { clinical: 1, regulatory: 1 }, highlights: ['teton1'] },
    ],
    compare: null,
    counts: { events: 120, shown: 4, byCategory: { regulatory: 3, clinical: 9 } },
  },
}

let fetchMock: Mock<(url: string) => Promise<Response>>
const lastUrl = () => decodeURIComponent(fetchMock.mock.calls.at(-1)![0])

function renderPanel() {
  fetchMock = vi.fn(async (url: string) =>
    url.includes('compare=nint')
      ? json(200, { ...SAVED, story: { ...SAVED.story, compare: { asset: { id: 'nint', name: 'Nintedanib' }, events: [ev('ofev', '2021-06-01', { type: 'approval', category: 'regulatory', title: 'FDA approves Ofev for SSc-ILD' })], deltas: [{ label: 'First FDA approval', primary: 'May 2002 (Remodulin)', other: 'Oct 2014 (Ofev)', note: 'Treprostinil first by 12.4 years' }] } } })
      : json(200, SAVED),
  )
  vi.stubGlobal('fetch', fetchMock)
  const router = createMemoryRouter(
    [{ path: '/assets/:assetId', element: <Outlet context={ASSET} />, children: [{ path: 'canvas/story/:storyId', element: <StoryPanel storyId="s1" /> }] }],
    { initialEntries: ['/assets/trep/canvas/story/s1'] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}
afterEach(() => {
  vi.unstubAllGlobals()
  useLiveStories.setState({ live: {} })
})

describe('journey story', () => {
  it('assembles a streamed story layer by layer', () => {
    const s = useLiveStories.getState()
    s.start('s9', { assetId: 'trep', title: 'T', question: null, spec: { since: '2025-09-01' } })
    s.layer('s9', 'axis', { range: SAVED.story.range, asset: SAVED.story.asset, counts: SAVED.story.counts })
    s.layer('s9', 'approvals', SAVED.story.approvals)
    s.layer('s9', 'lane', SAVED.story.lanes[0])
    s.layer('s9', 'lane', SAVED.story.lanes[1])
    s.layer('s9', 'notes', { notes: SAVED.notes, chapterNames: { 'ch-1': 'x' } })
    const live = useLiveStories.getState().live.s9!
    expect(live.layers).toEqual(['axis', 'approvals', 'lane', 'lane', 'notes'])
    expect(live.story.lanes.map((l) => l.category)).toEqual(['regulatory', 'clinical'])
    expect(live.notes).toHaveLength(1)
    expect(live.building).toBe(true)
  })

  it('draws the story from the data: question, staircase, lanes, flags, price, notes, chapters and what changed', async () => {
    renderPanel()
    expect(await screen.findByText('Treprostinil · what changed since Sep 2025')).toBeInTheDocument()
    expect(screen.getByText('“What changed since TETON-2?”')).toBeInTheDocument()
    const timeline = screen.getByTestId('story-timeline')
    expect(within(timeline).getByText('Remodulin')).toBeInTheDocument()
    expect(within(timeline).getByText('UTHR')).toBeInTheDocument()
    expect(within(timeline).getByRole('button', { name: /FDA approves inhaled treprostinil for PH-ILD \(Unconfirmed\)/ })).toBeInTheDocument()
    expect(within(timeline).getByRole('button', { name: /FDA decision expected \(Date moved\)/ })).toBeInTheDocument()
    expect(within(timeline).getByText('No events in this range')).toBeInTheDocument() // company lane
    expect(screen.getByText('One source misdates the PH-ILD approval.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /IPF push/ })).toBeInTheDocument() // the model's chapter name
    const changed = screen.getByRole('region', { name: 'What changed' })
    expect(within(changed).getByText(/What changed since/)).toBeInTheDocument()
    expect(within(changed).getByText('+4.2%')).toBeInTheDocument()
    // One tab at a time.
    expect(within(changed).queryByText('FVC change: 95 mL · 1 Oct 2025')).not.toBeInTheDocument()
    await userEvent.click(within(changed).getByRole('tab', { name: /Updated/ }))
    expect(within(changed).getByText('date: 2027-03-31 → 2027-04-30 · 1 Oct 2026')).toBeInTheDocument()
    await userEvent.click(within(changed).getByRole('tab', { name: /Slide conflicts/ }))
    expect(within(changed).getByText('FVC change: 95 mL · 1 Oct 2025')).toBeInTheDocument()
  })

  it('inspects a mark: the check and what it is checked against, evidence and "Ask about this"', async () => {
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /PH-ILD \(Unconfirmed\)/ }))
    const inspector = screen.getByRole('complementary', { name: 'Selected event' })
    expect(within(inspector).getByText('Not confirmed by a regulator record')).toBeInTheDocument()
    expect(within(inspector).getByText(/vs 31 Mar 2021 · FDA approves efficacy supplement for Tyvaso/)).toBeInTheDocument()
    expect(within(inspector).getByRole('button', { name: 'Ask about this' })).toBeInTheDocument()
  })

  it('re-reads the story with the filters: categories, all events, a chapter range, a comparison', async () => {
    renderPanel()
    await screen.findByTestId('story-timeline')
    // A story about a focus window opens zoomed to it (a year before, two years ahead).
    // Highlights only, zoomed to the focus window.
    await waitFor(() => expect(lastUrl()).toMatch(/^\/api\/stories\/s1\?significance=High&from=2024-09-01&to=\d{4}-\d{2}-\d{2}$/))
    expect(screen.getByRole('button', { name: 'Since 1 Sep 2025' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: /^Company/ }))
    expect(lastUrl()).toContain('category=regulatory,clinical,ip,safety')
    await userEvent.click(screen.getByRole('button', { name: 'All events' }))
    expect(lastUrl()).toContain('significance=High,Medium,Low')
    await userEvent.click(screen.getByRole('button', { name: /IPF push/ }))
    expect(lastUrl()).toContain('from=2025-07-03&to=2026-12-09')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'nint')
    expect(lastUrl()).toContain('compare=nint')
    expect(await screen.findByText('Treprostinil vs Nintedanib')).toBeInTheDocument()
    expect(screen.getByText('Treprostinil first by 12.4 years')).toBeInTheDocument()
  })

  it('groups marks that would overlap into one, in date order', () => {
    const x = (d: string) => Number(d.slice(8, 10)) * 5 // day of month × 5 px
    const groups = clusterEvents([ev('a', '2026-01-01'), ev('b', '2026-01-02'), ev('c', '2026-01-03'), ev('d', '2026-01-20')], x)
    expect(groups.map((g) => g.events.map((e) => e.id))).toEqual([['a', 'b', 'c'], ['d']])
  })
})
