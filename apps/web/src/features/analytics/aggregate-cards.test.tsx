import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JourneyEventV3 } from '@/features/journey/types'
import type { AnalyticsSpec } from '@/features/journey/types'
import { ActivityBody, EvidenceBody, SignificanceBody, SourceMixBody } from './aggregate-cards'
import { activityFromEvents, significanceFromEvents, sourceMixFromEvents } from './event-aggregates'
import { OverviewAnalytics } from './overview-analytics'
import { SpecChart } from './spec-chart'

const ev = (id: string, date: string, category: string, significance: string, branch: string | undefined, sources: [string, string][], extra: object = {}) =>
  ({
    id, asset: 'trep', date, type: 'x', category, title: `Event ${id}`, significance, is_milestone: false, via: 'journey', branch,
    sources: sources.map(([collection, record_key]) => ({ collection, record_key })), ...extra,
  }) as unknown as JourneyEventV3

const EVENTS = [
  ev('1', '2020-03-01', 'regulatory', 'High', 'PAH', [['fda_records', 'a']]),
  ev('2', '2020-09-01', 'clinical', 'Medium', 'PAH', [['trial_records', 'b'], ['fda_records', 'a']]),
  ev('3', '2021-02-01', 'clinical', 'Low', 'IPF', [['trial_records', 'c']]),
  ev('4', '2021-05-01', 'safety', 'High', 'IPF', [['publication_records', 'd']]),
  ev('5', '2021-06-01', 'company', 'Low', undefined, [], { indications: ['Pulmonary arterial hypertension (PAH)'] }),
  ev('n', '2021-07-01', 'clinical', 'High', 'IPF', [], { via: 'user' }),
]

describe('series recomputed from events', () => {
  const cols = [2020, 2021]
  it('counts per year and category, safety as clinical', () => {
    const a = activityFromEvents(EVENTS.slice(0, 5), cols)
    expect(a.series.find((s) => s.k === 'clinical')!.vals).toEqual([1, 2])
    expect(a.series.find((s) => s.k === 'regulatory')!.vals).toEqual([1, 0])
    expect(a.series.find((s) => s.k === 'ip')!.vals).toEqual([0, 0])
  })
  it('counts significance', () => {
    expect(significanceFromEvents(EVENTS.filter((e) => e.branch === 'IPF' && e.via !== 'user'))).toEqual({ High: 1, Medium: 0, Low: 1 })
  })
  it('counts distinct records per collection, optionally for one source', () => {
    expect(sourceMixFromEvents(EVENTS.slice(0, 2))).toEqual([{ coll: 'fda_records', n: 1 }, { coll: 'trial_records', n: 1 }])
    expect(sourceMixFromEvents(EVENTS.slice(0, 2), 'FDA')).toEqual([{ coll: 'fda_records', n: 1 }])
  })
})

const wrap = (ui: React.ReactNode, fetchMock = vi.fn(async () => new Response(JSON.stringify({ events: EVENTS, total: EVENTS.length }), { status: 200 }))) => {
  vi.stubGlobal('fetch', fetchMock)
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
}
beforeAll(() => {
  // jsdom lacks the pointer-capture calls Radix Select makes.
  Element.prototype.hasPointerCapture ??= () => false
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const ACTIVITY = { cols: [2020, 2021], series: [{ k: 'clinical', l: 'Clinical', vals: [9, 9] }] }
const open = (card: HTMLElement) => userEvent.click(within(card).getByRole('button', { name: 'Show filters' }))
async function pick(card: HTMLElement, label: string, option: string) {
  await userEvent.click(within(card).getByRole('combobox', { name: label }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

describe('aggregate cards', () => {
  it('activity by year: API series until a filter is on, then the filtered events', async () => {
    wrap(<section aria-label="card"><ActivityBody assetId="trep" activity={ACTIVITY} /></section>)
    const card = screen.getByRole('region', { name: 'card' })
    expect(within(card).getByRole('img')).toHaveAccessibleName('2020: 9, 2021: 9')
    await open(card)
    await pick(card, 'Indication', 'PAH')
    // PAH: events 1, 2 (2020) and 5 (2021, from its enrichment indication).
    expect(within(card).getByRole('img')).toHaveAccessibleName('2020: 2, 2021: 1')
    await pick(card, 'Category', 'Clinical')
    expect(within(card).getByRole('img')).toHaveAccessibleName('2020: 1, 2021: 0')
    expect(within(card).getByText('1 of 5')).toBeInTheDocument()
  })

  it('says when a filter leaves no data', async () => {
    wrap(<section aria-label="card"><ActivityBody assetId="trep" activity={ACTIVITY} /></section>)
    const card = screen.getByRole('region', { name: 'card' })
    await open(card)
    await userEvent.type(within(card).getByRole('searchbox'), 'zzz')
    expect(await within(card).findByText('No data for this filter')).toBeInTheDocument()
  })

  it('significance mix filters by indication and category', async () => {
    wrap(<section aria-label="card"><SignificanceBody assetId="trep" significance={{ High: 7, Medium: 7, Low: 7 }} /></section>)
    const card = screen.getByRole('region', { name: 'card' })
    await open(card)
    await pick(card, 'Indication', 'IPF')
    expect(within(card).getByRole('img')).toHaveAccessibleName('High: 1, Medium: 0, Low: 1')
    await pick(card, 'Category', 'Clinical')
    expect(within(card).getByRole('img')).toHaveAccessibleName('High: 1, Medium: 0, Low: 1')
  })

  it('source mix filters by indication and source', async () => {
    wrap(<section aria-label="card"><SourceMixBody assetId="trep" sourceMix={[{ coll: 'fda_records', n: 50 }]} /></section>)
    const card = screen.getByRole('region', { name: 'card' })
    await open(card)
    await pick(card, 'Indication', 'PAH')
    expect(within(card).getByRole('img')).toHaveAccessibleName('FDA: 1, ClinicalTrials.gov: 1')
    await pick(card, 'Source', 'FDA')
    expect(within(card).getByRole('img')).toHaveAccessibleName('FDA: 1')
  })

  it('evidence over time filters by source only', async () => {
    wrap(<section aria-label="card"><EvidenceBody recordsByYear={[{ coll: 'fda_records', year: 2020, n: 2 }, { coll: 'trial_records', year: 2022, n: 1 }]} /></section>)
    const card = screen.getByRole('region', { name: 'card' })
    expect(within(card).getByRole('img')).toHaveAccessibleName('2020: 2, 2021: 0, 2022: 1')
    await open(card)
    await pick(card, 'Source', 'FDA')
    expect(within(card).getByRole('img')).toHaveAccessibleName('2020: 2, 2021: 0, 2022: 0')
    expect(within(card).queryByRole('combobox', { name: 'Indication' })).not.toBeInTheDocument()
  })
})

describe('AI-built spec charts', () => {
  const base: AnalyticsSpec = { id: 's', title: 'T', chart: 'hbar', method: 'index', sources: ['x'], refreshed_at: '2026-01-01' }
  it('searches labels, with the reason when rows carry no indication', async () => {
    render(<SpecChart spec={{ ...base, data: [{ l: 'Alpha', v: 3 }, { l: 'Beta', v: 2 }] }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show filters' }))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('Search labels (rows have no indication)'), 'alp')
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole('searchbox'), 'q')
    expect(screen.getByText('No data for this filter')).toBeInTheDocument()
  })
  it('adds an Indication filter when rows carry one', async () => {
    render(<SpecChart spec={{ ...base, data: [{ l: 'Alpha', v: 3, indication: 'PAH' }, { l: 'Beta', v: 2, indication: 'IPF' }] }} />)
    const root = document.body
    await userEvent.click(screen.getByRole('button', { name: 'Show filters' }))
    await pick(root, 'Indication', 'IPF')
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })
})

describe('pinned Overview cards', () => {
  it('carry the same filters', async () => {
    const blocks = {
      pipeline: [], activityByYear: ACTIVITY, trials: [], recordsByYear: [], sourceMix: [], patents: [], landscape: { cols: [], rows: [] },
      significance: { High: 1, Medium: 1, Low: 1 }, triageFunnel: { screened: 0, relevant: 0, ingested: 0, candidates: 0, journey: 0 },
      stats: { approvedIndications: 0, inDevelopment: [], activeTrials: 0, phase3: 0, patients: 0, nextCatalyst: null, evidenceRecords: 0 },
    }
    wrap(<OverviewAnalytics asset={{ id: 'trep', name: 'Trep' }} />, vi.fn(async (url: string) => {
      const u = String(url)
      if (u.endsWith('/analytics/pins')) return new Response(JSON.stringify({ items: [{ key: 'activity' }, { key: 'sig' }] }), { status: 200 })
      if (u.endsWith('/analytics')) return new Response(JSON.stringify(blocks), { status: 200 })
      return new Response(JSON.stringify({ events: EVENTS, total: EVENTS.length }), { status: 200 })
    }) as never)
    const card = await screen.findByRole('region', { name: 'Journey activity by year' })
    await open(card)
    await pick(card, 'Indication', 'IPF')
    expect(within(card).getByRole('img')).toHaveAccessibleName('2020: 0, 2021: 2')
    const sig = screen.getByRole('region', { name: 'Significance mix' })
    expect(within(sig).getByRole('button', { name: 'Show filters' })).toBeInTheDocument()
  })
})
