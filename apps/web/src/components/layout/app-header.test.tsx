import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import type { Job, JobStep } from '@/features/jobs/api'
import type { NotificationList } from '@/features/me/api'
import { useShellStore } from '@/stores/shell-store'
import { AppHeader } from './app-header'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
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
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const NOTES: NotificationList = {
  items: [
    { id: 'n1', kind: 'high_event', title: 'FDA accepts Tyvaso sNDA', sub: 'Treprostinil', link: '/assets/trep/overview?focus=e1', read: false, at: minutesAgo(5) },
    { id: 'n2', kind: 'job_failed', title: 'Sotatercept: 1 step failed', sub: 'Patents', link: 'https://evil.example/x', read: false, at: minutesAgo(180) },
    { id: 'n3', kind: 'onboarding_finished', title: 'Ensifentrine journey is ready', sub: '41 journey events', link: '/assets/ensi/overview', read: true, at: '2026-09-01T10:00:00Z' },
  ],
  unread: 2,
}

type Calls = { url: string; init?: RequestInit }[]

function fakeApi(overrides: Record<string, () => Response | Promise<Response>> = {}): Calls {
  const calls: Calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const override = overrides[url]
      if (override) return override()
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/jobs?status=running') return json(200, [RUNNING])
      if (url === '/api/notifications') return json(200, NOTES)
      if (url === '/api/notifications/read') return json(200, { unread: String(init?.body).includes('ids') ? 1 : 0 })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  return calls
}

function renderHeader() {
  const router = createMemoryRouter([{ path: '*', element: <AppHeader /> }], { initialEntries: ['/'] })
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

beforeEach(() => useShellStore.setState({ paletteOpen: false, mobileNavOpen: false }))
afterEach(() => vi.unstubAllGlobals())

describe('AppHeader', () => {
  it('opens the palette and the mobile navigation, and links Add asset to Asset AI', async () => {
    fakeApi()
    renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Search (⌘K)' }))
    expect(useShellStore.getState().paletteOpen).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(useShellStore.getState().mobileNavOpen).toBe(true)
    expect(screen.getByRole('link', { name: /Add asset/ })).toHaveAttribute('href', '/chat?intent=add')
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
  })

  it('shows the running crawl with its step and progress, linking to the live build', async () => {
    fakeApi()
    renderHeader()
    const chip = await screen.findByRole('link', { name: /Treprostinil crawl: Rules engine, 50%/ })
    expect(chip).toHaveAttribute('href', '/assets/trep/overview?build=1')
    expect(chip).toHaveTextContent('50%')
  })

  it('says all crawls finished when nothing runs', async () => {
    fakeApi({ '/api/jobs?status=running': () => json(200, []) })
    renderHeader()
    expect(await screen.findByText('All crawls finished')).toBeInTheDocument()
  })

  it('lists notifications, follows an in-app link and marks it read, then marks all read', async () => {
    const calls = fakeApi()
    const router = renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))
    const first = await screen.findByRole('button', { name: /FDA accepts Tyvaso sNDA/ })
    expect(first).toHaveTextContent('5m ago')
    expect(screen.getByRole('button', { name: /Sotatercept: 1 step failed/ })).toHaveTextContent('3h ago')
    expect(screen.getAllByRole('img', { name: 'Unread' })).toHaveLength(2)
    await userEvent.click(first)
    expect(router.state.location.pathname).toBe('/assets/trep/overview')
    expect(router.state.location.search).toBe('?focus=e1')
    await waitFor(() => expect(calls.find((c) => c.url === '/api/notifications/read')?.init?.body).toBe('{"ids":["n1"]}'))

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/notifications/read').at(-1)?.init?.body).toBe('{}'))
  })

  it('does not follow links that leave the app', async () => {
    fakeApi()
    const router = renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))
    await userEvent.click(await screen.findByRole('button', { name: /Sotatercept: 1 step failed/ }))
    expect(router.state.location.pathname).toBe('/')
  })

  it.each(['//evil.com', '/\\evil.com', 'javascript:alert(1)'])('does not follow %s but still marks it read', async (link) => {
    const calls = fakeApi({
      '/api/notifications': () => json(200, { items: [{ ...NOTES.items[0]!, link }], unread: 1 }),
    })
    const router = renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    await userEvent.click(await screen.findByRole('button', { name: /FDA accepts Tyvaso sNDA/ }))
    expect(router.state.location.pathname).toBe('/')
    await waitFor(() => expect(calls.find((c) => c.url === '/api/notifications/read')?.init?.body).toBe('{"ids":["n1"]}'))
  })

  it('keeps the bell usable when notifications cannot load', async () => {
    fakeApi({ '/api/notifications': () => json(500, { code: 'ERROR', message: 'down' }) })
    renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText("Notifications couldn't be loaded.")).toBeInTheDocument()
  })

  it('retries a failed notifications load from the popover', async () => {
    let down = true
    fakeApi({ '/api/notifications': () => (down ? json(500, { code: 'ERROR', message: 'down' }) : json(200, NOTES)) })
    renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Notifications couldn't be loaded.")
    down = false
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: /FDA accepts Tyvaso sNDA/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a loading state in the popover while notifications load', async () => {
    fakeApi({ '/api/notifications': () => new Promise<Response>(() => {}) })
    renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(await screen.findByRole('status', { name: 'Loading notifications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
  })

  it('says "You\'re all caught up" when there are no notifications', async () => {
    fakeApi({ '/api/notifications': () => json(200, { items: [], unread: 0 }) })
    renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
  })

  it('shows no crawl status, rather than a false "All crawls finished", when jobs cannot load', async () => {
    const calls = fakeApi({ '/api/jobs?status=running': () => json(500, { code: 'ERROR', message: 'down' }) })
    renderHeader()
    await screen.findByRole('button', { name: 'Notifications, 2 unread' })
    await waitFor(() => expect(calls.some((c) => c.url === '/api/jobs?status=running')).toBe(true))
    expect(screen.queryByText('All crawls finished')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /crawl:/ })).not.toBeInTheDocument()
  })
})
