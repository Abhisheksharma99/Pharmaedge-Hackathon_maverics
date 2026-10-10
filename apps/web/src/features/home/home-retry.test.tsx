import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import { HomePage } from './home-page'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
const fail = () => json(500, { code: 'INTERNAL', message: 'boom' })

/** Which backing endpoints currently fail; flip a flag to let the next fetch succeed. */
const broken = { portfolio: true, assets: true, jobs: true }
const hits = { portfolio: 0, assets: 0, jobs: 0 }

function renderHome() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/portfolio/timeline?competitors=true') {
        hits.portfolio++
        return broken.portfolio ? fail() : json(200, { assets: [], events: [] })
      }
      if (url === '/api/assets') {
        hits.assets++
        return broken.assets ? fail() : json(200, [])
      }
      if (url === '/api/jobs?status=running' || url === '/api/jobs?limit=10') {
        hits.jobs++
        return broken.jobs ? fail() : json(200, [])
      }
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const router = createMemoryRouter([{ path: '/', element: <HomePage /> }], { initialEntries: ['/'] })
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

const panel = (name: string) => screen.getByRole('heading', { name }).closest('section')!

beforeEach(() => {
  Object.assign(broken, { portfolio: true, assets: true, jobs: true })
  Object.assign(hits, { portfolio: 0, assets: 0, jobs: 0 })
})
afterEach(() => vi.unstubAllGlobals())

describe('Home panel error states', () => {
  it('shows an inline error per failed panel, and retrying the portfolio recovers every panel that reads it', async () => {
    renderHome()
    for (const [title, message] of [
      ['Portfolio timeline', "The portfolio timeline couldn't be loaded."],
      ['What changed', "Recent events couldn't be loaded."],
      ['Next milestones', "Milestones couldn't be loaded."],
      ['Competitive signals', "Competitor events couldn't be loaded."],
    ] as const) {
      await waitFor(() => expect(within(panel(title)).getByRole('alert')).toHaveTextContent(message))
    }

    broken.portfolio = false
    const before = hits.portfolio
    await userEvent.click(within(panel('What changed')).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(within(panel('What changed')).queryByRole('alert')).not.toBeInTheDocument())
    expect(hits.portfolio).toBeGreaterThan(before)
    // The same query feeds the other three panels, so they are no longer in error either.
    for (const title of ['Portfolio timeline', 'Next milestones', 'Competitive signals']) {
      expect(within(panel(title)).queryByRole('alert')).not.toBeInTheDocument()
    }
  })

  it('retries Tracked assets and Crawls on their own queries', async () => {
    renderHome()
    await waitFor(() => expect(within(panel('Tracked assets')).getByRole('alert')).toHaveTextContent("Assets couldn't be loaded."))
    await waitFor(() => expect(within(panel('Crawls')).getByRole('alert')).toHaveTextContent("Crawl jobs couldn't be loaded."))

    broken.assets = false
    await userEvent.click(within(panel('Tracked assets')).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(within(panel('Tracked assets')).queryByRole('alert')).not.toBeInTheDocument())
    // Crawls is a separate query: still failing until its own retry.
    expect(within(panel('Crawls')).getByRole('alert')).toBeInTheDocument()

    broken.jobs = false
    await userEvent.click(within(panel('Crawls')).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(within(panel('Crawls')).queryByRole('alert')).not.toBeInTheDocument())
  })
})
