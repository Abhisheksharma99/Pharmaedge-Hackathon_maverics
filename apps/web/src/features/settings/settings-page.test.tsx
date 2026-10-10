import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import type { Prefs } from '@/features/me/api'
import { SettingsPage } from './settings-page'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ADMIN: User = { id: '1', email: 'ana@x.com', name: 'Ana Admin', role: 'admin', active: true, createdAt: '' }
const PREFS: Prefs = { journeyView: 'h', sidebarCollapsed: false, notify: { highEvents: true, crawls: false, weeklyDigest: false } }

let prefs: Prefs
let prefsFails: boolean
let usersFail: boolean
let patchFails: boolean
let fetchMock: ReturnType<typeof vi.fn>

function renderSettings(user: User = ADMIN) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/auth/me') return json(200, { user })
    if (url === '/api/me/prefs' && method === 'GET') return prefsFails ? json(500, { code: 'INTERNAL', message: 'boom' }) : json(200, prefs)
    if (url === '/api/me/prefs' && method === 'PATCH') {
      if (patchFails) return json(500, { code: 'INTERNAL', message: 'boom' })
      const patch = JSON.parse(String(init?.body)) as { notify: Partial<Prefs['notify']> }
      prefs = { ...prefs, notify: { ...prefs.notify, ...patch.notify } }
      return json(200, prefs)
    }
    if (url === '/api/users') return usersFail ? json(500, { code: 'INTERNAL', message: 'boom' }) : json(200, [{ ...ADMIN, id: 'u1' }, { ...ADMIN, id: 'u2', name: 'Bo Analyst', email: 'bo@x.com', role: 'analyst' }])
    return json(404, { code: 'NOT_FOUND', message: url })
  })
  vi.stubGlobal('fetch', fetchMock)
  const router = createMemoryRouter([{ path: '/', element: <SettingsPage /> }], { initialEntries: ['/'] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

const panel = (name: string) => screen.getByRole('heading', { name }).closest('section')!
const patches = () => fetchMock.mock.calls.filter(([u, i]) => u === '/api/me/prefs' && i?.method === 'PATCH')

beforeEach(() => {
  prefs = structuredClone(PREFS)
  prefsFails = false
  usersFail = false
  patchFails = false
})
afterEach(() => vi.unstubAllGlobals())

describe('Settings notification toggles', () => {
  it('reflect the saved prefs and PATCH only the toggled key to /me/prefs', async () => {
    renderSettings()
    const high = await screen.findByRole('switch', { name: 'High-significance events on my assets' })
    const crawls = screen.getByRole('switch', { name: 'Crawl finished or failed' })
    await waitFor(() => expect(high).toBeChecked())
    expect(crawls).not.toBeChecked()

    await userEvent.click(crawls)
    await waitFor(() => expect(crawls).toBeChecked())
    expect(patches()).toHaveLength(1)
    expect(patches()[0][1]).toMatchObject({ body: '{"notify":{"crawls":true}}' })

    await userEvent.click(high)
    await waitFor(() => expect(high).not.toBeChecked())
    expect(patches()[1][1]).toMatchObject({ body: '{"notify":{"highEvents":false}}' })
    expect(crawls).toBeChecked()
  })

  it('keeps the old value when saving fails', async () => {
    patchFails = true
    renderSettings()
    const digest = await screen.findByRole('switch', { name: 'Weekly portfolio digest by email' })
    await waitFor(() => expect(digest).toBeEnabled())
    await userEvent.click(digest)
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(digest).not.toBeChecked()
  })

  it('shows an inline error when the prefs fail to load, and "Try again" reloads them', async () => {
    prefsFails = true
    renderSettings()
    expect(await within(await screen.findByRole('heading', { name: 'Notifications' }).then((h) => h.closest('section')!)).findByRole('alert')).toHaveTextContent(
      "Your notification settings couldn't be loaded.",
    )
    expect(screen.getByRole('switch', { name: 'Crawl finished or failed' })).toBeDisabled()

    prefsFails = false
    await userEvent.click(within(panel('Notifications')).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'High-significance events on my assets' })).toBeChecked())
    expect(within(panel('Notifications')).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Settings team', () => {
  it('lists the team for admins', async () => {
    renderSettings()
    expect(await screen.findByText('Bo Analyst')).toBeInTheDocument()
    expect(panel('Team')).toHaveTextContent('2 members')
  })

  it('shows an inline error when the team fails to load, and "Try again" loads it', async () => {
    usersFail = true
    renderSettings()
    const team = (await screen.findByRole('heading', { name: 'Team' })).closest('section')!
    expect(await within(team).findByRole('alert')).toHaveTextContent("The team couldn't be loaded.")

    usersFail = false
    await userEvent.click(within(team).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Bo Analyst')).toBeInTheDocument()
    expect(within(team).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('hides the team from non-admins', async () => {
    renderSettings({ ...ADMIN, role: 'analyst' })
    await screen.findByRole('heading', { name: 'Notifications' })
    expect(screen.queryByRole('heading', { name: 'Team' })).not.toBeInTheDocument()
  })
})
