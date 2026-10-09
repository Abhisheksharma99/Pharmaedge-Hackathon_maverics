import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { routes } from '@/routes'
import { AuthProvider, type User } from './auth-context'
import { safeReturnTo } from './route-guards'

const ADMIN: User = { id: '1', email: 'admin@x.com', name: 'Ada Admin', role: 'admin', active: true, createdAt: '' }
const ANALYST: User = { ...ADMIN, id: '2', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst' }

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** A tiny fake API: `session` is who is signed in; `loginResponse` decides the next login. */
function fakeApi(initial: User | null) {
  const state = { session: initial, loginResponse: json(200, { user: ADMIN }) as Response }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return state.session ? json(200, { user: state.session }) : json(401, { code: 'UNAUTHENTICATED', message: 'x' })
      if (url === '/api/auth/refresh') return json(401, { code: 'REFRESH_INVALID', message: 'x' })
      if (url === '/api/auth/logout') {
        state.session = null
        return new Response(null, { status: 204 })
      }
      if (url === '/api/auth/login') {
        if (state.loginResponse.ok) state.session = ADMIN
        return state.loginResponse
      }
      if (url === '/api/users') return json(200, [ADMIN, ANALYST])
      return json(404, { code: 'NOT_FOUND', message: 'x' })
    }),
  )
  return state
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

afterEach(() => vi.unstubAllGlobals())

describe('safeReturnTo', () => {
  it.each([
    ['/assets?x=1', '/assets?x=1'],
    ['//evil.example', '/'],
    ['https://evil.example', '/'],
    ['/\\evil.example', '/'],
    ['', '/'],
    [null, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected)
  })
})

describe('signed out', () => {
  it('redirects to login, then back to the page that was requested', async () => {
    fakeApi(null)
    const router = renderAt('/settings')
    await screen.findByLabelText('Email')
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('?returnTo=%2Fsettings')

    await userEvent.type(screen.getByLabelText('Email'), 'admin@x.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await screen.findByRole('heading', { name: 'Profile' })
    expect(router.state.location.pathname).toBe('/settings')
  })

  it('shows the server message for bad credentials and a friendly one when rate-limited', async () => {
    const api = fakeApi(null)
    api.loginResponse = json(401, { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' })
    renderAt('/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'admin@x.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')

    api.loginResponse = json(429, { code: 'TOO_MANY_REQUESTS', message: 'ThrottlerException' })
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many sign-in attempts'))
  })

  it('ignores an external returnTo', async () => {
    fakeApi(null)
    const router = renderAt('/login?returnTo=%2F%2Fevil.example')
    await userEvent.type(await screen.findByLabelText('Email'), 'admin@x.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

describe('signed in', () => {
  it('keeps analysts out of user management', async () => {
    fakeApi(ANALYST)
    const router = renderAt('/settings/users')
    await screen.findByRole('heading', { name: /Welcome, Ana/ })
    expect(router.state.location.pathname).toBe('/')
  })

  it('lets admins manage users', async () => {
    fakeApi(ADMIN)
    renderAt('/settings/users')
    expect(await screen.findByText('ana@x.com')).toBeInTheDocument()
    // Admins can't change their own role or deactivate themselves.
    expect(screen.getByRole('switch', { name: /Ada Admin/ })).toBeDisabled()
    expect(screen.getByRole('switch', { name: /Ana Analyst/ })).toBeEnabled()
  })

  it('shows a coming-soon page for sections not built yet', async () => {
    fakeApi(ADMIN)
    renderAt('/uploads')
    expect(await screen.findByText('Coming soon')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Uploads' })).toBeInTheDocument()
  })

  it('signs out from the account menu', async () => {
    fakeApi(ADMIN)
    const router = renderAt('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Sign out/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})
