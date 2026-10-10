import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AssetSummary } from '@/features/assets/api'
import { TrackedAssets } from './tracked-assets'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ZERO = { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 }
const asset = (id: string, name: string, kind: AssetSummary['kind'], competitorOf: AssetSummary['competitorOf'] = [], tags: AssetSummary['tags'] = {}): AssetSummary => ({
  id,
  name,
  aliases: [],
  company: { name: 'Co' },
  tags,
  kind,
  status: 'ready',
  updatedAt: null,
  counts: ZERO,
  latestEvent: null,
  competitorOf,
})

function renderSection(assets: AssetSummary[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/assets') return json(200, assets)
      if (url === '/api/portfolio/timeline?competitors=true') return json(200, { assets: [], events: [] })
      if (url === '/api/jobs?status=running') return json(200, [])
      if (url === '/api/assets/trep') return json(200, { id: 'trep', kpis: { approvalRegions: ['US', 'EU'] } })
      if (url === '/api/assets/sota') return json(200, { id: 'sota', kpis: { approvalRegions: ['US'] } })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const router = createMemoryRouter([{ path: '*', element: <TrackedAssets /> }], { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})
afterEach(() => vi.unstubAllGlobals())

describe('TrackedAssets', () => {
  it('shows one card per primary asset with its regions and competitor count', async () => {
    renderSection([asset('trep', 'Treprostinil', 'primary'), asset('sota', 'Sotatercept', 'primary'), asset('nint', 'Nintedanib', 'competitor', [{ id: 'trep', name: 'Treprostinil' }])])
    expect(screen.getByRole('heading', { name: 'Tracked assets' })).toBeInTheDocument()
    expect(await screen.findByText('2 primary · 1 competitor')).toBeInTheDocument()
    const trep = screen.getByRole('link', { name: /Treprostinil/ })
    await waitFor(() => expect(trep).toHaveTextContent('US, EU'))
    expect(trep).toHaveTextContent('1 competitor')
    expect(screen.getByRole('link', { name: /Sotatercept/ })).toHaveTextContent('0 competitors')
    expect(screen.queryByRole('link', { name: /Nintedanib/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Asset Search/ })).toHaveAttribute('href', '/assets')
  })

  it('filters the cards by name and by indication from the asset tags', async () => {
    renderSection([
      asset('trep', 'Treprostinil', 'primary', [], { indications: ['Pulmonary arterial hypertension (PAH)'] }),
      asset('sota', 'Sotatercept', 'primary', [], { investigational_indications: ['Pulmonary hypertension (PH-ILD)'] }),
    ])
    await screen.findByRole('link', { name: /Treprostinil/ })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search assets' }), 'sota')
    expect(screen.queryByRole('link', { name: /Treprostinil/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Indication' }))
    await userEvent.click(await screen.findByRole('option', { name: 'PAH' }))
    expect(screen.getByRole('link', { name: /Treprostinil/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Sotatercept/ })).not.toBeInTheDocument()
  })

  it('invites to add an asset when none is tracked', async () => {
    renderSection([])
    expect(await screen.findByText('No assets yet')).toBeInTheDocument()
  })
})
