import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { Mock } from 'vitest'
import type { AnalyticsSpec } from '@/features/journey/types'
import { AddAnalyticsDialog } from './add-analytics-dialog'
import type { AnalyticsBlocks } from './api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const BLOCKS = {
  pipeline: [],
  activityByYear: {
    cols: [2020],
    series: [{ k: 'clinical', l: 'Clinical', vals: [1] }],
  },
  trials: [],
  sourceMix: [],
  patents: [],
  landscape: { cols: [], rows: [] },
  significance: { High: 1, Medium: 0, Low: 0 },
    recordsByYear: [],
  triageFunnel: { screened: 0, relevant: 0, ingested: 0, candidates: 0, journey: 0 },
  stats: { approvedIndications: 0, inDevelopment: [], activeTrials: 0, phase3: 0, patients: 0, nextCatalyst: null, evidenceRecords: 0 },
} as AnalyticsBlocks
const SUGGESTIONS = [
  {
    id: 'tta',
    title: 'Time from Phase 3 start to approval',
    why: '4 programmes',
    src: 'index',
    records: 8,
  },
  {
    id: 'rev',
    title: 'Net revenue by product',
    why: 'Not crawled',
    src: 'web',
    records: 0,
    sources: ['sec.gov · 10-K'],
  },
  {
    id: 'share',
    title: 'Prescription share',
    why: 'Licensed',
    src: 'limited',
    records: 0,
  },
]
const STEPS = (n: number) =>
  ['Searching the index', 'Extracting values', 'Building the chart'].map((label, i) => ({
    label,
    status: i < n ? 'done' : i === n ? 'running' : 'pending',
  }))
const RESULT: AnalyticsSpec = {
  id: 'r1',
  title: 'Time to approval',
  chart: 'hbar',
  unit: ' yrs',
  data: [{ l: 'Tyvaso', v: 4.2 }],
  method: 'index',
  sources: ['trial_records · NCT1'],
  note: 'IPF uses the expected date.',
  refreshed_at: '2026-01-01',
}

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let polls: unknown[]
function setup(pinned: string[] = []) {
  polls = []
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/analytics/suggestions')) return json(200, SUGGESTIONS)
    if (url.endsWith('/analytics')) return json(200, BLOCKS)
    if (url.endsWith('/analytics/build') && init?.method === 'POST') return json(200, { runId: 'run/1' })
    if (url.endsWith('/analytics/build/run%2F1')) return json(200, polls.length > 1 ? polls.shift() : polls[0])
    return json(404, { code: 'NOT_FOUND', message: 'x' })
  })
  vi.stubGlobal('fetch', fetchMock)
  const onAdd = vi.fn()
  const onClose = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AddAnalyticsDialog assetId="trep" pinned={pinned} onAdd={onAdd} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onAdd, onClose }
}
const post = () => fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AddAnalyticsDialog', () => {
  it('lists suggestions with their source badges and build buttons', async () => {
    setup()
    expect(await screen.findByText('From indexed data · 8 records')).toBeInTheDocument()
    expect(screen.getByText('Needs web search')).toBeInTheDocument()
    expect(screen.getByText('Limited public data')).toBeInTheDocument()
    expect(screen.getByText('sec.gov · 10-K')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Build' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Search & build' })).toHaveLength(2)
  })

  it('adds a library template, and shows already pinned ones as Added', async () => {
    const { onAdd } = setup(['activity'])
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'From your data' }))
    expect(await screen.findByRole('button', { name: 'Added' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledWith({ key: 'sig' })
  })

  it('builds a suggestion: polls the run, shows steps then the result, and pins it', async () => {
    const { onAdd, onClose } = setup()
    const user = userEvent.setup()
    polls.push({ steps: STEPS(1) }, { steps: STEPS(3), result: RESULT })
    await user.click(await screen.findByRole('button', { name: 'Build' }))
    expect(post()![1]!.body).toBe(JSON.stringify({ suggestion: 'tta' }))
    expect(await screen.findByText('Extracting values')).toBeInTheDocument()
    expect(await screen.findByText('Indexed data · no new crawl', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('IPF uses the expected date.')).toBeInTheDocument()
    expect(screen.getByText('trial_records · NCT1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Add to Overview/ }))
    expect(onAdd).toHaveBeenCalledWith({ custom: RESULT })
    expect(onClose).toHaveBeenCalled()
  })

  it('asks for an analysis from the example chips', async () => {
    setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'Ask for an analysis' }))
    expect(screen.getByText('How this works')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build analysis' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Net revenue by product' }))
    polls.push({ steps: STEPS(3), result: RESULT })
    await user.click(screen.getByRole('button', { name: 'Build analysis' }))
    await waitFor(() => expect(post()![1]!.body).toBe(JSON.stringify({ request: 'Net revenue by product' })))
    expect(await screen.findByText('Time to approval')).toBeInTheDocument()
  })

  it("shows 'Not available' for method none and offers no way to pin it", async () => {
    setup()
    const user = userEvent.setup()
    polls.push({
      steps: STEPS(3),
      result: {
        id: 'n',
        title: 'Not enough public data',
        chart: 'none',
        method: 'none',
        sources: [],
        note: 'Needs licensed data.',
        refreshed_at: 'x',
      },
    })
    await user.click((await screen.findAllByRole('button', { name: 'Search & build' }))[1]!)
    expect(await screen.findByText('Not available', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('Needs licensed data.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add to Overview/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('tab', { name: 'Suggested by AI' })).toBeInTheDocument()
  })

  it('shows no values for a result without sources: Not available, nothing to pin', async () => {
    setup()
    const user = userEvent.setup()
    polls.push({ steps: STEPS(3), result: { ...RESULT, sources: [] } })
    await user.click(await screen.findByRole('button', { name: 'Build' }))
    expect(await screen.findByText('Not available', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText('Tyvaso')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add to Overview/ })).not.toBeInTheDocument()
  })

  it('cannot pin a chart type it cannot draw', async () => {
    setup()
    const user = userEvent.setup()
    polls.push({ steps: STEPS(3), result: { ...RESULT, chart: 'gantt', data: undefined } })
    await user.click(await screen.findByRole('button', { name: 'Build' }))
    await screen.findByText('Time to approval', {}, { timeout: 3000 })
    expect(screen.queryByRole('button', { name: /Add to Overview/ })).not.toBeInTheDocument()
  })

  it('says so, with a toast, when the build cannot start', async () => {
    setup()
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'id')
    const ok = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) =>
      init?.method === 'POST' ? json(500, { code: 'ERROR', message: 'boom' }) : ok(url, init),
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Build' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be built')
    expect(toastError).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('tab', { name: 'Suggested by AI' })).toBeInTheDocument()
  })

  it('toasts the rate-limit message when the build is throttled', async () => {
    setup()
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'id')
    const ok = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) =>
      init?.method === 'POST' ? json(429, { statusCode: 429, code: 'TOO_MANY_REQUESTS', message: 'You are sending AI requests too quickly.' }) : ok(url, init),
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Build' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('You are sending AI requests too quickly.'))
  })

  it('stops with Not available when a run ends without a result', async () => {
    setup()
    const user = userEvent.setup()
    polls.push({ status: 'failed', steps: STEPS(1) })
    await user.click(await screen.findByRole('button', { name: 'Build' }))
    expect(await screen.findByText('The analysis ended without a result.', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0)
  })

  it('renders a skipped step as skipped, not pending, and a failed step as an alert', async () => {
    setup()
    const user = userEvent.setup()
    polls.push({
      steps: [
        { label: 'Searching the index', status: 'done' },
        { label: 'Searching public sources', status: 'skipped' },
        { label: 'Extracting values', status: 'failed' },
        { label: 'Building the chart', status: 'pending' },
      ],
    })
    await user.click(await screen.findByRole('button', { name: 'Build' }))
    await screen.findByText('Searching public sources')
    expect(screen.getAllByTestId('step-skipped')).toHaveLength(1)
    expect(screen.getAllByTestId('step-failed')).toHaveLength(1)
    expect(screen.getByText('Searching public sources').closest('div')).toHaveClass('text-muted-foreground')
    expect(screen.getByText('Extracting values').closest('div')).toHaveClass('text-warning')
    expect(screen.getByText('Building the chart').closest('div')).toHaveClass('text-muted-foreground')
  })

  it('moves between tabs with the arrow keys', async () => {
    setup()
    const user = userEvent.setup()
    screen.getByRole('tab', { name: 'Suggested by AI' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'From your data' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })

  it('closes with Esc', async () => {
    const { onClose } = setup()
    await userEvent.setup().keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('tells a failed suggestions load (with a retry) from an empty list', async () => {
    setup()
    const ok = fetchMock.getMockImplementation()!
    let mode: 'fail' | 'empty' | 'ok' = 'fail'
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith('/analytics/suggestions')) return mode === 'fail' ? json(500, { code: 'ERROR', message: 'x' }) : mode === 'empty' ? json(200, []) : ok(url, init)
      return ok(url, init)
    })
    cleanup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AddAnalyticsDialog assetId="trep" pinned={[]} onAdd={vi.fn()} onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Suggestions couldn’t be loaded.')
    expect(screen.queryByText(/No suggestions yet/)).not.toBeInTheDocument()
    mode = 'empty'
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/No suggestions yet/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
