import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AssetSummary } from '@/features/assets/api'
import type { Job, JobStep } from '@/features/jobs/api'
import type { Prefs } from '@/features/me/api'
import { useShellStore } from '@/stores/shell-store'
import { AppSidebar } from './app-sidebar'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const asset = (id: string, name: string, kind: AssetSummary['kind']): AssetSummary => ({
  id,
  name,
  aliases: [],
  company: { name: 'Co' },
  tags: {},
  kind,
  status: 'ready',
  updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null,
  competitorOf: [],
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
const PREFS: Prefs = { journeyView: 'h', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: false } }
const ASSETS = [asset('trep', 'Treprostinil', 'primary'), asset('sota', 'Sotatercept', 'primary'), asset('nint', 'Nintedanib', 'competitor')]

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>

function fakeApi({ jobs = [RUNNING], prefs = PREFS }: { jobs?: Job[]; prefs?: Prefs } = {}) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assets') return json(200, ASSETS)
    if (url === '/api/jobs?status=running') return json(200, jobs)
    if (url === '/api/me/prefs') return json(200, init?.method === 'PATCH' ? { ...prefs, ...JSON.parse(String(init.body)) } : prefs)
    return json(404, { code: 'NOT_FOUND', message: url })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function renderSidebar(path = '/') {
  const router = createMemoryRouter([{ path: '*', element: <AppSidebar /> }], { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => useShellStore.setState({ sidebarCollapsed: false, lastAssetId: null, mobileNavOpen: false }))
afterEach(() => vi.unstubAllGlobals())

describe('AppSidebar', () => {
  it('lists primary assets under "Your assets" with build progress, and marks Crawl jobs live', async () => {
    fakeApi()
    renderSidebar('/assets/sota/clinical')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const trep = await within(nav).findByRole('link', { name: /Treprostinil/ })
    expect(within(nav).getByText('Your assets')).toBeInTheDocument()
    expect(trep).toHaveAttribute('href', '/assets/trep/overview')
    expect(trep).toHaveTextContent('50%')
    expect(within(nav).getByRole('link', { name: /Sotatercept/ })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).queryByRole('link', { name: /Nintedanib/ })).not.toBeInTheDocument()
    const live = await within(nav).findByRole('img', { name: 'A crawl is running' })
    expect(within(nav).getByRole('link', { name: /Crawl jobs/ })).toContainElement(live)
  })

  it('shows no live dot or progress when nothing runs', async () => {
    fakeApi({ jobs: [] })
    renderSidebar()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const trep = await within(nav).findByRole('link', { name: /Treprostinil/ })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/jobs?status=running', expect.anything()))
    expect(trep).not.toHaveTextContent('%')
    expect(within(nav).queryByRole('img', { name: 'A crawl is running' })).not.toBeInTheDocument()
  })

  it('navigates from every item', async () => {
    fakeApi()
    useShellStore.setState({ lastAssetId: 'trep' })
    const router = renderSidebar()
    await screen.findByRole('link', { name: /^Treprostinil/ })
    const expected: [RegExp, string][] = [
      [/^Home$/, '/'],
      [/^Asset Search$/, '/assets'],
      [/^Asset AI$/, '/chat'],
      [/^Asset Journey$/, '/assets/trep/overview'],
      [/^Company IR$/, '/assets/trep/company-ir'],
      [/^Conferences$/, '/assets/trep/conferences'],
      [/^Uploads/, '/uploads'],
      [/^Crawl jobs/, '/jobs'],
      [/^Treprostinil/, '/assets/trep/overview'],
      [/^Sotatercept/, '/assets/sota/overview'],
      [/^Settings$/, '/settings'],
    ]
    for (const [name, path] of expected) {
      await userEvent.click(screen.getByRole('link', { name }))
      expect(router.state.location.pathname).toBe(path)
    }
  })

  it('applies the saved collapsed preference and saves each toggle', async () => {
    fakeApi({ prefs: { ...PREFS, sidebarCollapsed: true } })
    renderSidebar()
    const expand = await screen.findByRole('button', { name: 'Expand sidebar' })
    expect(screen.queryByText('Your assets')).not.toBeInTheDocument()
    await userEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/me/prefs', expect.objectContaining({ method: 'PATCH', body: '{"sidebarCollapsed":false}' })),
    )
  })

  it('keeps working when prefs and jobs cannot be loaded', async () => {
    fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => (url === '/api/assets' ? json(200, ASSETS) : json(500, { code: 'ERROR', message: 'down' })))
    vi.stubGlobal('fetch', fetchMock)
    renderSidebar()
    expect(await screen.findByRole('link', { name: /^Treprostinil/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(useShellStore.getState().sidebarCollapsed).toBe(true)
  })

  it('opens as a drawer from the store and closes when a link is followed', async () => {
    fakeApi()
    const router = renderSidebar()
    act(() => useShellStore.getState().setMobileNavOpen(true))
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })
    expect(within(drawer).queryByRole('button', { name: /sidebar/ })).not.toBeInTheDocument()
    await userEvent.click(within(drawer).getByRole('link', { name: /^Asset Search$/ }))
    expect(router.state.location.pathname).toBe('/assets')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useShellStore.getState().mobileNavOpen).toBe(false)
  })

  it('closes the drawer when the viewport widens past 900px, and ignores narrowing', async () => {
    fakeApi()
    let onChange: (e: { matches: boolean }) => void = () => {}
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q,
      addEventListener: (_: string, fn: typeof onChange) => (onChange = fn),
      removeEventListener: vi.fn(),
    }))
    renderSidebar()
    act(() => useShellStore.getState().setMobileNavOpen(true))
    await screen.findByRole('dialog', { name: 'Navigation' })

    act(() => onChange({ matches: false }))
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument()

    act(() => onChange({ matches: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useShellStore.getState().mobileNavOpen).toBe(false)
  })

  it('returns focus to the opener when the drawer closes', async () => {
    fakeApi()
    renderSidebar()
    const opener = document.body.appendChild(document.createElement('button'))
    opener.focus()
    act(() => useShellStore.getState().setMobileNavOpen(true))
    await screen.findByRole('dialog', { name: 'Navigation' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
