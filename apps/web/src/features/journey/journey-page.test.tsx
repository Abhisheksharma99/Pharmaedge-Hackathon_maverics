import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AssetSummary } from '@/features/assets/api'
import { useShellStore } from '@/stores/shell-store'
import { JourneyPage } from './journey-page'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const asset = (id: string, name: string, kind: AssetSummary['kind'], indications: string[], company = 'United Therapeutics'): AssetSummary => ({
  id, name, aliases: [], company: { name: company }, tags: { indications }, kind, status: 'ready', updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null, competitorOf: kind === 'competitor' ? [{ id: 'treprostinil', name: 'Treprostinil' }] : [],
})
// Unsorted on purpose: the page lists primary assets first, then by name.
const ASSETS = [
  asset('sotatercept', 'Sotatercept', 'competitor', ['Pulmonary arterial hypertension (PAH)'], 'Merck'),
  asset('treprostinil', 'Treprostinil', 'primary', ['Pulmonary arterial hypertension (PAH)', 'Pulmonary hypertension with interstitial lung disease (PH-ILD)']),
  asset('ocrelizumab', 'Ocrelizumab', 'primary', ['Multiple sclerosis (MS)'], 'Roche'),
]

function renderAt(path: string) {
  return renderPage(path).router
}

function renderPage(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/journey', element: <JourneyPage /> },
      { path: '/journey/:assetId', element: <JourneyPage /> },
    ],
    { initialEntries: [path] },
  )
  const { unmount } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { router, unmount }
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})
beforeEach(() => {
  useShellStore.setState({ lastAssetId: null })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/assets') return json(200, ASSETS)
      if (url.includes('/timeline')) return json(200, { events: [], total: 0 })
      if (url.endsWith('/branches')) return json(200, [])
      if (url.endsWith('/annotations')) return json(200, { stars: [], comments: {}, notes: [] })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('JourneyPage', () => {
  it('lists every asset, primary first, with company, kind and indication badges', async () => {
    renderAt('/journey/treprostinil')
    const list = await screen.findByRole('navigation', { name: 'Tracked assets' })
    const items = within(list).getAllByRole('link')
    expect(items.map((a) => a.querySelector('b')!.textContent)).toEqual(['Ocrelizumab', 'Treprostinil', 'Sotatercept'])
    expect(items[2]).toHaveTextContent('SotaterceptCompetitorMerckPAH')
    expect(items[1]).toHaveTextContent('TreprostinilPrimaryUnited TherapeuticsPAHPH-ILD')
    expect(items[1]).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Treprostinil' })).toBeInTheDocument()
    expect(await screen.findByText('No journey events yet')).toBeInTheDocument()
  })

  it('opens the first primary asset when none was viewed, else the last asset viewed', async () => {
    const router = renderAt('/journey')
    await waitFor(() => expect(router.state.location.pathname).toBe('/journey/ocrelizumab'))
    useShellStore.setState({ lastAssetId: 'sotatercept' })
    const other = renderAt('/journey?view=v&order=newest')
    await waitFor(() => expect(other.state.location.pathname).toBe('/journey/sotatercept'))
    expect(other.state.location.search).toBe('?view=v&order=newest')
  })

  it('selects another asset through the URL, keeping orientation and order, and remembers it', async () => {
    const router = renderAt('/journey/treprostinil?order=newest&ind=PAH')
    const list = await screen.findByRole('navigation', { name: 'Tracked assets' })
    await userEvent.click(within(list).getByRole('link', { name: /Sotatercept/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/journey/sotatercept'))
    expect(router.state.location.search).toBe('?order=newest')
    expect(useShellStore.getState().lastAssetId).toBe('sotatercept')
  })

  it('filters the list by name, indication and kind', async () => {
    renderAt('/journey/treprostinil')
    const list = await screen.findByRole('navigation', { name: 'Tracked assets' })
    const search = screen.getByRole('searchbox', { name: 'Search assets' })
    await userEvent.type(search, 'roche')
    expect(within(list).getAllByRole('link')).toHaveLength(1)
    await userEvent.clear(search)
    await userEvent.click(screen.getByRole('combobox', { name: 'Indication' }))
    await userEvent.click(await screen.findByRole('option', { name: 'PH-ILD' }))
    expect(within(list).getAllByRole('link').map((a) => a.querySelector('b')!.textContent)).toEqual(['Treprostinil'])
    await userEvent.click(screen.getByRole('combobox', { name: 'Indication' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Indication: all' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Kind' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Competitor' }))
    expect(within(list).getAllByRole('link').map((a) => a.querySelector('b')!.textContent)).toEqual(['Sotatercept'])
  })

  it('hides the asset list so the journey takes the full width, remembers it, and shows it again', async () => {
    const { unmount } = renderPage('/journey/treprostinil')
    await screen.findByRole('navigation', { name: 'Tracked assets' })
    const hide = screen.getByRole('button', { name: 'Hide assets' })
    expect(hide).toHaveAttribute('aria-expanded', 'true')
    const list = document.getElementById(hide.getAttribute('aria-controls')!)!
    await userEvent.click(hide)
    expect(list).not.toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Tracked assets' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Treprostinil' })).toBeInTheDocument()
    const show = screen.getByRole('button', { name: /Show assets/ })
    expect(show).toHaveAttribute('aria-expanded', 'false')
    expect(show).toHaveAttribute('aria-controls', list.id)
    expect(show).toHaveFocus()
    // Remembered on the next visit.
    unmount()
    renderPage('/journey/treprostinil')
    await userEvent.click(await screen.findByRole('button', { name: /Show assets/ }))
    expect(await screen.findByRole('navigation', { name: 'Tracked assets' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Hide assets' })).toHaveFocus()
  })

  it('keeps the list up for an asset that isn’t tracked, even when hidden', async () => {
    localStorage.setItem('aj.collapsed.journey.asset-list', '1')
    renderAt('/journey/nope')
    expect(await screen.findByRole('navigation', { name: 'Tracked assets' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Hide assets' })).not.toBeInTheDocument()
  })

  it('says when the asset in the URL is not tracked', async () => {
    renderAt('/journey/nope')
    expect(await screen.findByText('This asset isn’t tracked')).toBeInTheDocument()
  })
})
