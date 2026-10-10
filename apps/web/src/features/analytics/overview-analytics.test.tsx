import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { Mock } from 'vitest'
import type { AnalyticsPin, AnalyticsSpec } from '@/features/journey/types'
import type { AnalyticsBlocks } from './api'
import { OverviewAnalytics } from './overview-analytics'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const BLOCKS: AnalyticsBlocks = {
  pipeline: [
    {
      id: 'pah',
      label: 'PAH',
      full: 'Pulmonary arterial hypertension',
      color: '#2347d9',
      ended: null,
      stage: 4,
      n: 3,
      next: {
        id: 'm1',
        title: 'Phase 3 readout expected: TETON',
        date: '2099-06-01',
      },
      since: '2017-01-01',
    },
  ],
  activityByYear: {
    cols: [2020, 2021],
    series: [{ k: 'clinical', l: 'Clinical', vals: [1, 2] }],
  },
  trials: [
    {
      nct: 'NCT1',
      name: 'TETON',
      title: 't',
      phase: 'Phase 3',
      status: 'RECRUITING',
      start: '2021-01',
      pcd: '2024-01',
      enrollment: 600,
      indication: 'IPF',
      company: true,
      active: true,
    },
  ],
  sourceMix: [{ coll: 'trial_records', n: 4 }],
  patents: [],
  landscape: { cols: [], rows: [] },
  significance: { High: 2, Medium: 1, Low: 0 },
    recordsByYear: [],
  triageFunnel: { screened: 0, relevant: 0, ingested: 0, candidates: 0, journey: 0 },
  stats: { approvedIndications: 0, inDevelopment: [], activeTrials: 0, phase3: 0, patients: 0, nextCatalyst: null, evidenceRecords: 0 },
}
const NO_TRIALS: AnalyticsBlocks = { ...BLOCKS, trials: [] }
const SPEC: AnalyticsSpec = {
  id: 'c1',
  title: 'Net revenue',
  chart: 'hbar',
  data: [{ l: 'A', v: 3 }],
  method: 'web',
  sources: ['sec.gov · 10-K', 'ir.example.com'],
  refreshed_at: '2026-01-01',
}

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let pinsBody: { items: AnalyticsPin[] | null }
function setup(blocks: AnalyticsBlocks, items: AnalyticsPin[] | null = null) {
  pinsBody = { items }
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/analytics/pins'))
      return init?.method === 'PUT' ? json(200, (pinsBody = JSON.parse(String(init.body)))) : json(200, pinsBody)
    if (url.endsWith('/analytics')) return json(200, blocks)
    if (url.endsWith('/analytics/suggestions')) return json(200, [])
    return json(404, { code: 'NOT_FOUND', message: 'x' })
  })
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <OverviewAnalytics asset={{ id: 'trep', name: 'Treprostinil' }} />
    </QueryClientProvider>,
  )
}
const puts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT').map(([u, i]) => [u, JSON.parse(String(i?.body))])
const cards = () => screen.queryAllByRole('region').map((r) => r.getAttribute('aria-label'))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OverviewAnalytics', () => {
  it('shows the trial defaults and the dashed Add tile', async () => {
    setup(BLOCKS)
    expect(await screen.findByRole('region', { name: 'Development pipeline' })).toBeInTheDocument()
    expect(screen.getByText(/Pinned for Treprostinil/)).toBeInTheDocument()
    expect(cards()).toEqual([
      'Pinned analytics',
      'Development pipeline',
      'Next milestones',
      'Journey activity by year',
      'Trials by phase',
      'Enrolment by indication',
    ])
    expect(screen.getAllByRole('button', { name: /Add analytics/ })).toHaveLength(2)
  })

  it('badges each milestone with its indication and filters the cards by search', async () => {
    setup(BLOCKS)
    const user = userEvent.setup()
    const ms = await screen.findByRole('region', { name: 'Next milestones' })
    expect(within(ms).getByText('PAH')).toBeInTheDocument()
    await user.click(within(ms).getByRole('button', { name: 'Show filters' }))
    await user.type(within(ms).getByRole('searchbox'), 'nothing-like-this')
    expect(within(ms).getByText('Nothing matches these filters.')).toBeInTheDocument()
    const enrol = screen.getByRole('region', { name: 'Enrolment by indication' })
    expect(within(enrol).getByText('IPF')).toBeInTheDocument()
    await user.click(within(enrol).getByRole('button', { name: 'Show filters' }))
    await user.type(within(enrol).getByRole('searchbox'), 'zzz')
    expect(within(enrol).queryByText('IPF')).not.toBeInTheDocument()
  })

  it('shows activity, milestones and significance without trial data (milestones hidden when none are expected)', async () => {
    setup({ ...NO_TRIALS, pipeline: [] })
    expect(await screen.findByRole('region', { name: 'Journey activity by year' })).toBeInTheDocument()
    expect(cards()).toEqual(['Pinned analytics', 'Journey activity by year', 'Significance mix'])
  })

  it('removes a card with a PUT of the remaining pins, keeping unknown ones', async () => {
    setup(BLOCKS, [{ key: 'sig' }, { key: 'from-the-future' }, { custom: SPEC }])
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Remove Significance mix' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]).toEqual(['/api/assets/trep/analytics/pins', { items: [{ key: 'from-the-future' }, { custom: SPEC }] }])
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Significance mix' })).not.toBeInTheDocument())
  })

  it('Reset restores exactly the defaults (custom and unknown pins are dropped, as in the prototype)', async () => {
    setup(BLOCKS, [{ key: 'sig' }, { key: 'from-the-future' }, { custom: SPEC }])
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Significance mix' })
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]![1]).toEqual({
      items: ['pipeline', 'milestones', 'activity', 'trialsPhase', 'enrol'].map((key) => ({ key })),
    })
  })

  it('hides a card whose data is missing, without an error', async () => {
    // 'patents' is a retired card id: it is skipped like any unknown pin.
    setup(NO_TRIALS, [{ key: 'enrol' }, { key: 'patents' }, { key: 'sig' }])
    expect(await screen.findByRole('region', { name: 'Significance mix' })).toBeInTheDocument()
    expect(cards()).toEqual(['Pinned analytics', 'Significance mix'])
  })

  it('a custom card names its origin and discloses its sources', async () => {
    setup(BLOCKS, [{ custom: SPEC }])
    const user = userEvent.setup()
    const card = await screen.findByRole('region', { name: 'Net revenue' })
    expect(within(card).getByText('Asset AI · public web sources')).toBeInTheDocument()
    const summary = within(card).getByText('2 sources')
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    await user.click(summary)
    expect(details.open).toBe(true)
    expect(within(card).getByText('sec.gov · 10-K')).toBeInTheDocument()
  })

  it('never shows a custom card that has no sources', async () => {
    setup(BLOCKS, [{ custom: { ...SPEC, sources: [] } }, { key: 'sig' }])
    await screen.findByRole('region', { name: 'Significance mix' })
    expect(cards()).toEqual(['Pinned analytics', 'Significance mix'])
  })

  it('puts a removed card back, with a toast, when the save fails', async () => {
    setup(BLOCKS, [{ key: 'sig' }])
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'id')
    const ok = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) =>
      init?.method === 'PUT' ? json(500, { code: 'ERROR', message: 'boom' }) : ok(url, init),
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Remove Significance mix' }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(await screen.findByRole('region', { name: 'Significance mix' })).toBeInTheDocument()
  })

  it('shows a same-spec custom pin once', async () => {
    setup(BLOCKS, [{ custom: SPEC }, { custom: SPEC }])
    await screen.findByRole('region', { name: 'Net revenue' })
    expect(screen.getAllByRole('region', { name: 'Net revenue' })).toHaveLength(1)
  })

  it('says when the analytics could not be loaded', async () => {
    setup(BLOCKS, [{ key: 'sig' }])
    const ok = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) =>
      url.endsWith('/analytics') ? json(500, { code: 'ERROR', message: 'x' }) : ok(url, init),
    )
    cleanup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <OverviewAnalytics asset={{ id: 'trep', name: 'Treprostinil' }} />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be loaded')
  })

  it('retries a failed analytics load from the alert and then shows the cards', async () => {
    let failing = true
    pinsBody = { items: [{ key: 'sig' }] }
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/analytics/pins')) return json(200, pinsBody)
      if (url.endsWith('/analytics')) return failing ? json(500, { code: 'ERROR', message: 'x' }) : json(200, BLOCKS)
      return json(404, { code: 'NOT_FOUND', message: 'x' })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OverviewAnalytics asset={{ id: 'trep', name: 'Treprostinil' }} />
      </QueryClientProvider>,
    )
    const alert = await screen.findByRole('alert')
    failing = false
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Significance mix' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('spans two columns for wide cards and one for narrow ones', async () => {
    setup(BLOCKS, [{ key: 'pipeline' }, { key: 'sig' }, { custom: SPEC }, { custom: { ...SPEC, id: 'c2', title: 'Share', chart: 'donut' } }])
    const wide = 'min-[701px]:col-span-2'
    expect(await screen.findByRole('region', { name: 'Development pipeline' })).toHaveClass(wide)
    expect(screen.getByRole('region', { name: 'Significance mix' })).not.toHaveClass(wide)
    expect(screen.getByRole('region', { name: 'Net revenue' })).toHaveClass(wide)
    expect(screen.getByRole('region', { name: 'Share' })).not.toHaveClass(wide)
  })
})
