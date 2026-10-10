import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import { routes } from '@/routes'

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
const SESSION = { id: 's1', title: 'TETON readouts', assetId: null, createdAt: '', updatedAt: '' }
const MESSAGES = [{ id: 'm1', role: 'user', content: 'How did TETON-2 read out?', cards: [], citations: [], followUps: [], createdAt: '' }]

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const broken = { sessions: false, messages: false }

function renderChat(path: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/assets') return json(200, [])
      if (url === '/api/chat/sessions') return broken.sessions ? json(500, { code: 'INTERNAL', message: 'boom' }) : json(200, [SESSION])
      if (url === '/api/chat/sessions/s1/messages') return broken.messages ? json(500, { code: 'INTERNAL', message: 'boom' }) : json(200, MESSAGES)
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const router = createMemoryRouter(routes, { initialEntries: [path] })
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

beforeEach(() => Object.assign(broken, { sessions: false, messages: false }))
afterEach(() => vi.unstubAllGlobals())

describe('Chat error states', () => {
  it('shows an inline error in the history when the chats fail to load, and retries', async () => {
    broken.sessions = true
    renderChat('/chat')
    const history = await screen.findByRole('navigation', { name: 'Chat history' })
    expect(await within(history).findByRole('alert')).toHaveTextContent('Chats couldn’t be loaded.')

    broken.sessions = false
    await userEvent.click(within(history).getByRole('button', { name: 'Try again' }))
    expect(await within(history).findByRole('link', { name: /TETON readouts/ })).toBeInTheDocument()
    expect(within(history).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an inline error in the conversation when its messages fail to load, and retries', async () => {
    broken.messages = true
    renderChat('/chat/s1')
    const alert = await screen.findByText('This conversation couldn’t be loaded.')
    expect(alert.closest('[role="alert"]')).toBeInTheDocument()

    broken.messages = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('How did TETON-2 read out?')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('This conversation couldn’t be loaded.')).not.toBeInTheDocument())
  })
})
