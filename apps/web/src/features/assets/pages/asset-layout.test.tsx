import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import { routes } from '@/routes'

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
const ASSET = {
  id: 'trep',
  name: 'Treprostinil',
  aliases: [],
  company: { name: 'United Therapeutics' },
  tags: { indications: ['PAH'] },
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null,
  competitorOf: [],
  kpis: { approvalRegions: [], activeTrials: 0, activePhase3: 0, upcomingMilestones: 0 },
  competitors: [],
  suggestedQuestions: [],
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let assetStatus: number
let fetchMock: ReturnType<typeof vi.fn>

function renderAsset(id: string) {
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/auth/me') return json(200, { user: USER })
    if (url === `/api/assets/${id}`) return assetStatus === 200 ? json(200, ASSET) : json(assetStatus, { code: assetStatus === 404 ? 'NOT_FOUND' : 'INTERNAL', message: 'x' })
    return json(404, { code: 'NOT_FOUND', message: url })
  })
  vi.stubGlobal('fetch', fetchMock)
  const router = createMemoryRouter(routes, { initialEntries: [`/assets/${id}/overview`] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('AssetLayout load failures', () => {
  it('says "Asset not found" without a retry on a 404', async () => {
    assetStatus = 404
    renderAsset('nope')
    expect(await screen.findByRole('heading', { name: 'Asset not found' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Asset Search' })).toHaveAttribute('href', '/assets')
  })

  it('shows an inline error with "Try again" on a server error, and the retry loads the asset', async () => {
    assetStatus = 500
    renderAsset('trep')
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The asset couldn’t be loaded.')

    assetStatus = 200
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Treprostinil' })).toBeInTheDocument()
    // (The overview's own panels hit unmocked endpoints; only the layout's error must be gone.)
    expect(screen.queryByText('The asset couldn’t be loaded.')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/assets/trep')).toHaveLength(2)
  })
})
