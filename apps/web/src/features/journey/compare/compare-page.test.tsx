import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { AssetSummary } from '@/features/assets/api'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEventSheet } from '@/stores/event-sheet-store'
import { JourneyPage } from '../journey-page'
import type { JourneyEventV3 } from '../types'
import { ComparePage } from './compare-page'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const asset = (id: string, name: string, kind: AssetSummary['kind'], competitorOf: string[] = []): AssetSummary => ({
  id, name, aliases: [], company: { name: 'Co' }, tags: {}, kind, status: 'ready', updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null, competitorOf: competitorOf.map((p) => ({ id: p, name: p })),
})
const ASSETS = [asset('treprostinil', 'Treprostinil', 'primary'), asset('macitentan', 'Macitentan', 'competitor', ['treprostinil']), asset('ocre', 'Ocrelizumab', 'primary')]
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'x', date, branch, type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'Low', is_milestone: false, sources: [], via: 'journey', key: true, ...extra,
})
const EVENTS: Record<string, JourneyEventV3[]> = {
  treprostinil: [ev('t1', '2002-05-21', 'PAH'), ev('t2', '2021-03-31', 'PH-ILD', { category: 'clinical' })],
  macitentan: [ev('m1', '2013-10-18', 'PAH'), ev('m2', '2017-06-01', 'CTEPH')],
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/journey/compare', element: <ComparePage /> },
      { path: '/journey/:assetId', element: <JourneyPage /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})
beforeEach(() => {
  useEventSheet.setState({ current: null, journeyAsset: null, locate: null })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/assets') return json(200, ASSETS)
      const m = url.match(/^\/api\/assets\/([^/]+)\/timeline\?scope=(key|all)&include=notes/)
      if (m) return json(200, { events: EVENTS[m[1]!] ?? [], total: 0 })
      if (url.endsWith('/branches')) return json(200, [])
      if (url.endsWith('/annotations')) return json(200, { stars: [], comments: {}, notes: [] })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

const lanes = (group: HTMLElement) => [...group.querySelectorAll<HTMLElement>('[data-lane]')].map((l) => l.dataset.lane)

describe('ComparePage', () => {
  it('stacks each journey on one shared axis with lanes by indication; shared indications are marked', async () => {
    renderAt('/journey/compare?a=treprostinil&b=macitentan')
    expect(await screen.findByRole('heading', { name: 'Treprostinil vs Macitentan' })).toBeInTheDocument()
    const trep = await screen.findByRole('region', { name: 'Treprostinil journey' })
    const maci = screen.getByRole('region', { name: 'Macitentan journey' })
    await waitFor(() => expect(lanes(trep)).toEqual(['PAH', 'PH-ILD']))
    expect(lanes(maci)).toEqual(['PAH', 'CTEPH'])
    expect(within(trep).getByText('PAH').closest('[title]')).toHaveAttribute('title', 'PAH: shared with another compared asset')
    expect(within(maci).getByText('CTEPH').closest('[title]')).toHaveAttribute('title', 'CTEPH')
    // One axis: 2002 (the first event) through today's year, each year once.
    const years = [...screen.getByTestId('compare-axis').querySelectorAll<HTMLElement>('[data-year]')].map((y) => Number(y.dataset.year))
    expect(years[0]).toBe(2002)
    expect(new Set(years).size).toBe(years.length)
    // The same date would sit at the same x: dots are placed by the shared axis, not per group.
    const left = (id: string) => parseFloat((document.querySelector(`[data-dot="${id}"]`) as HTMLElement).style.left)
    expect(left('t1')).toBeLessThan(left('m1'))
    expect(left('m1')).toBeLessThan(left('m2'))
    expect(left('m2')).toBeLessThan(left('t2'))
    // Key events by default.
    expect(fetch).toHaveBeenCalledWith('/api/assets/treprostinil/timeline?scope=key&include=notes&limit=5000', expect.anything())
  })

  it('filters every journey by one indication (shared ones listed first) and shows All on request', async () => {
    const router = renderAt('/journey/compare?a=treprostinil&b=macitentan')
    const trep = await screen.findByRole('region', { name: 'Treprostinil journey' })
    await waitFor(() => expect(lanes(trep)).toHaveLength(2))
    await userEvent.click(screen.getByRole('combobox', { name: 'Indication' }))
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Indication: all', 'PAHshared', 'CTEPH', 'PH-ILD'])
    await userEvent.click(screen.getByRole('option', { name: 'PAHshared' }))
    await waitFor(() => expect(lanes(trep)).toEqual(['PAH']))
    expect(lanes(screen.getByRole('region', { name: 'Macitentan journey' }))).toEqual(['PAH'])
    expect(new URLSearchParams(router.state.location.search).get('ind')).toBe('PAH')
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/assets/macitentan/timeline?scope=all&include=notes&limit=5000', expect.anything()))
  })

  it('opens an event in the sheet from its dot and names it in a tooltip', async () => {
    renderAt('/journey/compare?a=treprostinil&b=macitentan')
    const dot = await screen.findByRole('button', { name: /Event m2/ })
    await userEvent.hover(dot)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Macitentan')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Event m2')
    await userEvent.click(dot)
    expect(useEventSheet.getState().current).toEqual({ assetId: 'macitentan', eventId: 'm2' })
  })

  it('asks for two assets when fewer are tracked', async () => {
    renderAt('/journey/compare?a=treprostinil&b=nope')
    expect(await screen.findByText('Some of these assets aren’t tracked')).toBeInTheDocument()
    expect(screen.getByText(/Not tracked: nope/)).toBeInTheDocument()
  })

  it('is reached from the Asset Journey header, defaulting to the asset and its first competitor', async () => {
    const router = renderAt('/journey/treprostinil')
    await userEvent.click(await screen.findByRole('button', { name: 'Compare…' }))
    const list = screen.getByRole('list', { name: 'Assets to compare' })
    const boxes = within(list).getAllByRole('checkbox')
    expect(boxes.map((b) => [b.textContent?.replace(/Co(Primary|Competitor)$/, ''), b.getAttribute('aria-checked')])).toEqual([
      ['Treprostinil', 'true'],
      ['Macitentan', 'true'],
      ['Ocrelizumab', 'false'],
    ])
    await userEvent.click(boxes[2]!)
    await userEvent.click(screen.getByRole('button', { name: 'Compare 3 journeys' }))
    expect(router.state.location.pathname).toBe('/journey/compare')
    expect(router.state.location.search).toBe('?a=treprostinil&b=macitentan&c=ocre')
  })
})
