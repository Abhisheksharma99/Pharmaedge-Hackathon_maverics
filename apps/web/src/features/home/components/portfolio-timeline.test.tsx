import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { Job, JobStep } from '@/features/jobs/api'
import type { JourneyEventV3 } from '@/features/journey/types'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { PortfolioTimeline as Portfolio } from '../api'
import { PortfolioTimeline } from './portfolio-timeline'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

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
const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const RUNNING: Job = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'onboard',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: null,
  finished_at: null,
}

const PORTFOLIO: Portfolio = {
  assets: [
    { id: 'trep', name: 'Treprostinil', kind: 'primary', company: 'United Therapeutics', status: 'onboarding', progress: 0.1, competitorOf: [] },
    { id: 'sota', name: 'Sotatercept', kind: 'primary', company: 'Merck', status: 'ready', progress: null, competitorOf: [] },
    { id: 'nint', name: 'Nintedanib', kind: 'competitor', company: 'Boehringer Ingelheim', status: 'ready', progress: null, competitorOf: ['trep'] },
  ],
  events: [
    ev('e1', 'trep', '2025-03-01', { title: 'Phase 3 trial started: TETON-1', category: 'clinical' }),
    ev('e2', 'trep', '2027-03-31', { title: 'TETON-2 readout expected', category: 'clinical', is_milestone: true, significance: 'Medium' }),
    ev('e3', 'nint', '2026-03-09', { title: 'Ofev approved for PPF' }),
    ev('e4', 'sota', '2005-05-21', { title: 'First patent filed', category: 'ip', significance: 'Low' }),
    ev('e5', 'trep', '', { title: 'Undated event' }),
  ],
}

function serve(portfolio: Response = json(200, PORTFOLIO), job: Job = RUNNING) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/portfolio/timeline?competitors=true') return portfolio.clone()
      if (url === '/api/jobs?status=running') return json(200, [job])
      if (url === '/api/jobs/j1') {
        return json(200, {
          ...job,
          records: [],
          events_created: 0,
          feed_cursor: 0,
          record_years: [
            { coll: 'fda_records', year: 2024, n: 4 },
            { coll: 'trial_records', year: 2025, n: 9 },
            { coll: 'fda_records', year: 2010, n: 2 },
          ],
        })
      }
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
}

function renderTimeline() {
  const router = createMemoryRouter([{ path: '*', element: <PortfolioTimeline /> }], { initialEntries: ['/'] })
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

describe('PortfolioTimeline', () => {
  it('shows primary rows with live build progress, and competitors on demand', async () => {
    serve()
    renderTimeline()
    const trep = await screen.findByRole('link', { name: /Treprostinil/ })
    await waitFor(() => expect(trep).toHaveTextContent('Building · 50%'))
    expect(trep).toHaveAttribute('href', '/assets/trep/overview')
    expect(screen.getByRole('link', { name: /Sotatercept/ })).toHaveTextContent('Merck')
    expect(screen.queryByRole('link', { name: /Nintedanib/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Show competitors' }))
    expect(screen.getByRole('link', { name: /Nintedanib/ })).toHaveTextContent('vs Treprostinil')
    expect(screen.getByRole('button', { name: /Ofev approved for PPF/ })).toBeInTheDocument()
  })

  it('treats a running refresh on a built asset as routine: dots stay, no Building label or record ticks', async () => {
    serve(json(200, PORTFOLIO), { ...RUNNING, type: 'refresh' })
    renderTimeline()
    const trep = await screen.findByRole('link', { name: /Treprostinil/ })
    expect(await screen.findByRole('button', { name: /Phase 3 trial started: TETON-1/ })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(trep).not.toHaveTextContent('Building')
    expect(vi.mocked(fetch).mock.calls.some(([u]) => u === '/api/jobs/j1')).toBe(false)
  })

  it('filters dots by range: 3 years by default, ±1 year, all time; undated events are never drawn', async () => {
    serve()
    renderTimeline()
    expect(await screen.findByRole('button', { name: /Phase 3 trial started: TETON-1, Treprostinil, Mar 1, 2025/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TETON-2 readout expected, Treprostinil, expected Mar 2027/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /First patent filed/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '±1 year' }))
    expect(screen.queryByRole('button', { name: /TETON-1/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TETON-2/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'All time' }))
    expect(screen.getByRole('button', { name: /First patent filed, Sotatercept, May 21, 2005/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TETON-1/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Undated event/ })).not.toBeInTheDocument()
    expect(document.querySelector('[cx="NaN"]')).toBeNull()
  })

  it('shows a tooltip on hover and opens the event sheet on click or Enter', async () => {
    serve()
    renderTimeline()
    const dot = await screen.findByRole('button', { name: /Phase 3 trial started: TETON-1/ })
    await userEvent.hover(dot)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Treprostinil · Mar 1, 2025')
    await userEvent.click(dot)
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'e1' })
    act(() => useEventSheet.getState().closeEvent())
    fireEvent.keyDown(screen.getByRole('button', { name: /TETON-2/ }), { key: 'Enter' })
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'e2' })
  })

  it('fills the row of an asset being built with record ticks by year', async () => {
    serve()
    renderTimeline()
    await waitFor(() => expect(document.querySelectorAll('rect[data-record-tick]')).toHaveLength(2))
  })

  it('shows the empty and error states', async () => {
    serve(json(200, { assets: [], events: [] }))
    renderTimeline()
    expect(await screen.findByText('No assets yet')).toBeInTheDocument()
  })

  it('says when the timeline cannot be loaded', async () => {
    serve(json(500, { code: 'ERROR', message: 'down' }))
    renderTimeline()
    expect(await screen.findByText("The portfolio timeline couldn't be loaded.")).toBeInTheDocument()
  })
})
