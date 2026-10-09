import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AssetDetail } from '@/features/assets/api'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import { routes } from '@/routes'
import { useShellStore } from '@/stores/shell-store'

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }

const ASSET: AssetDetail = {
  id: 'treprostinil',
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
  competitors: [
    {
      id: 'sotatercept',
      name: 'Sotatercept',
      company: 'Merck & Co.',
      reason: 'Approved for PAH',
      basis: 'indication',
      stage: 'approved',
      coverage: { PAH: 'approved' },
      other_indications: [],
    },
  ],
  suggestedQuestions: ['Who is closest to approval?'],
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function fakeApi() {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const method = init?.method ?? 'GET'
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/assets/treprostinil') return json(200, ASSET)
      if (url === '/api/chat/sessions?asset=treprostinil') return json(200, [])
      if (url === '/api/chat/sessions' && method === 'POST') {
        return json(201, { id: 's9', title: '', assetId: 'treprostinil', createdAt: '', updatedAt: '' })
      }
      if (url === '/api/chat/sessions/s9/turn') return new Response('{"type":"token","text":"Sotatercept"}\n')
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  return calls
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => useShellStore.setState({ assetAiOpen: false }))
afterEach(() => vi.unstubAllGlobals())

describe('Asset AI panel on an asset page', () => {
  it('opens from the header with the asset context, and the first question starts an asset chat', async () => {
    const calls = fakeApi()
    renderAt('/assets/treprostinil/overview')

    // The Competitors tab shows how many competitors there are.
    expect(await screen.findByRole('link', { name: 'Competitors 1' })).toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Ask Asset AI' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(useShellStore.getState().assetAiOpen).toBe(true)

    const panel = await screen.findByRole('complementary', { name: 'Asset AI' })
    expect(panel).toHaveTextContent('Context')
    expect(panel).toHaveTextContent('Competitors')
    await userEvent.click(await screen.findByRole('button', { name: 'Who is closest to approval?' }))

    await waitFor(() => expect(calls.some((c) => c.url === '/api/chat/sessions/s9/turn')).toBe(true))
    const create = calls.find((c) => c.url === '/api/chat/sessions' && c.init?.method === 'POST')
    expect(create?.init?.body).toBe('{"assetId":"treprostinil"}')
    expect(await screen.findByText('Who is closest to approval?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Close Asset AI' }))
    expect(screen.queryByRole('complementary', { name: 'Asset AI' })).not.toBeInTheDocument()
  })
})
