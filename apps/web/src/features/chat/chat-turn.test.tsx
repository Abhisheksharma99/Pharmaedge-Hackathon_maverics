import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import { routes } from '@/routes'
import type { ChatMessage, ChatSession, StreamEvent } from './api'

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
const SESSION: ChatSession = { id: 's1', title: 'TETON readouts', assetId: null, createdAt: '', updatedAt: '' }

const ANSWER: ChatMessage = {
  id: 'm2',
  role: 'assistant',
  content: 'TETON-2 met its primary endpoint [1].',
  cards: [],
  citations: [
    {
      n: 1,
      title: 'TETON-2: inhaled treprostinil in IPF',
      source: 'ClinicalTrials.gov',
      date: '2025-09-01',
      assetId: 'treprostinil',
      assetName: 'Treprostinil',
      collection: 'trial_records',
      recordKey: 'NCT04708782',
      tab: 'clinical',
    },
  ],
  followUps: ['What about TETON-1?'],
  createdAt: '',
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** A turn stream the test feeds one event at a time. */
function turnStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
  const encoder = new TextEncoder()
  return {
    response: () => new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }),
    push: (...events: StreamEvent[]) => controller.enqueue(encoder.encode(events.map((e) => `${JSON.stringify(e)}\n`).join(''))),
    close: () => controller.close(),
  }
}

function fakeApi() {
  const state = { messages: [] as ChatMessage[], sessions: [SESSION], turn: turnStream(), calls: [] as { url: string; init?: RequestInit }[] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      state.calls.push({ url, init })
      const method = init?.method ?? 'GET'
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/assets') return json(200, [])
      if (url === '/api/chat/sessions' && method === 'GET') return json(200, state.sessions)
      if (url === '/api/chat/sessions' && method === 'POST') {
        const created = { ...SESSION, id: 's2', title: '' }
        state.sessions = [created, ...state.sessions]
        return json(201, created)
      }
      if (/^\/api\/chat\/sessions\/s\d\/messages$/.test(url)) return json(200, state.messages)
      if (/^\/api\/chat\/sessions\/s\d\/turn$/.test(url)) return state.turn.response()
      if (url === '/api/assets/treprostinil/record/clinical?key=NCT04708782') {
        return json(200, { key: 'NCT04708782', title: 'TETON-2: inhaled treprostinil in IPF', nct_id: 'NCT04708782', date: '2025-09-01' })
      }
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  return state
}

function renderAt(path: string | string[], strict = false) {
  const router = createMemoryRouter(routes, { initialEntries: Array.isArray(path) ? path : [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
  render(strict ? <StrictMode>{app}</StrictMode> : app)
  return router
}

afterEach(() => vi.unstubAllGlobals())

describe('Asset AI chat', () => {
  it('streams tool activity, then tokens, then the cited answer', async () => {
    const api = fakeApi()
    renderAt('/chat/s1')

    await userEvent.type(await screen.findByLabelText('Ask Asset AI'), 'How did TETON-2 read out?{Enter}')
    expect(await screen.findByText('How did TETON-2 read out?')).toBeInTheDocument()
    const post = api.calls.find((c) => c.url === '/api/chat/sessions/s1/turn')
    expect(post?.init).toMatchObject({ method: 'POST', body: '{"message":"How did TETON-2 read out?"}' })
    // While streaming, Stop replaces Send.
    expect(screen.getByRole('button', { name: 'Stop answering' })).toBeInTheDocument()

    api.turn.push({ type: 'tool_call', id: 't1', name: 'search_evidence', label: 'Searching evidence: TETON results' })
    expect(await screen.findByText('Searching evidence: TETON results')).toBeInTheDocument()
    api.turn.push({ type: 'tool_result', id: 't1', name: 'search_evidence', summary: '8 passages' })
    expect(await screen.findByText('8 passages')).toBeInTheDocument()

    api.turn.push({ type: 'token', text: 'TETON-2 met its ' }, { type: 'token', text: 'primary endpoint' })
    expect(await screen.findByText('TETON-2 met its primary endpoint')).toBeInTheDocument()

    api.messages = [{ ...ANSWER, id: 'm1', role: 'user', content: 'How did TETON-2 read out?', citations: [], followUps: [] }, ANSWER]
    api.turn.push({ type: 'answer', message: ANSWER }, { type: 'done' })
    api.turn.close()

    const chip = await screen.findByRole('button', { name: 'Source 1: TETON-2: inhaled treprostinil in IPF' })
    expect(screen.queryByText('Searching evidence: TETON results')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What about TETON-1?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()

    await userEvent.click(chip)
    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('NCT04708782')).toBeInTheDocument()
  })

  it('shows a stream error inline, keeps the partial answer and retries', async () => {
    const api = fakeApi()
    renderAt('/chat/s1')
    await userEvent.type(await screen.findByLabelText('Ask Asset AI'), 'Summarize TETON{Enter}')

    api.turn.push({ type: 'token', text: 'Partial answer' }, { type: 'error', code: 'LLM_UNAVAILABLE', message: 'Asset AI is unavailable' }, { type: 'done' })
    api.turn.close()

    expect(await screen.findByRole('alert')).toHaveTextContent('Asset AI is unavailable')
    expect(screen.getByText('Partial answer')).toBeInTheDocument()

    api.turn = turnStream()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(api.calls.filter((c) => c.url === '/api/chat/sessions/s1/turn')).toHaveLength(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('creates the session on the first question in a new chat, then opens it', async () => {
    const api = fakeApi()
    const router = renderAt('/chat?intent=add')

    const input = await screen.findByLabelText('Ask Asset AI')
    expect(input).toHaveValue('Add ')
    await waitFor(() => expect(input).toHaveFocus())
    await userEvent.type(input, 'sotatercept{Enter}')

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/s2'))
    expect(await screen.findByText('Add sotatercept')).toBeInTheDocument()
    const create = api.calls.find((c) => c.url === '/api/chat/sessions' && c.init?.method === 'POST')
    expect(create?.init?.body).toBe('{}')
    expect(api.calls.some((c) => c.url === '/api/chat/sessions/s2/turn')).toBe(true)
  })

  it('asks the question from ?ask= once, in a new session', async () => {
    const api = fakeApi()
    const router = renderAt(`/chat?ask=${encodeURIComponent('What changed this month?')}`)

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/s2'))
    expect(await screen.findByText('What changed this month?')).toBeInTheDocument()
    expect(api.calls.filter((c) => c.url === '/api/chat/sessions' && c.init?.method === 'POST')).toHaveLength(1)
    expect(api.calls.filter((c) => c.url === '/api/chat/sessions/s2/turn')).toHaveLength(1)
    expect(api.calls.find((c) => c.url === '/api/chat/sessions/s2/turn')?.init?.body).toBe('{"message":"What changed this month?"}')
  })

  it('does not re-ask when going Back after an auto-sent ?ask= question', async () => {
    const api = fakeApi()
    const router = renderAt(['/chat/s1', `/chat?ask=${encodeURIComponent('What changed this month?')}`])

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/s2'))
    expect(await screen.findByText('What changed this month?')).toBeInTheDocument()
    await router.navigate(-1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/s1'))
    expect(router.state.location.search).toBe('')
    expect(api.calls.filter((c) => c.url === '/api/chat/sessions' && c.init?.method === 'POST')).toHaveLength(1)
    expect(api.calls.filter((c) => c.url.endsWith('/turn'))).toHaveLength(1)
  })

  it('sends the ?ask= question once under StrictMode double-mounting and leaves the ask param behind', async () => {
    const api = fakeApi()
    const router = renderAt(`/chat?ask=${encodeURIComponent('What changed this month?')}`, true)

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/s2'))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByText('What changed this month?')).toBeInTheDocument()
    expect(api.calls.filter((c) => c.url === '/api/chat/sessions' && c.init?.method === 'POST')).toHaveLength(1)
    expect(api.calls.filter((c) => c.url === '/api/chat/sessions/s2/turn')).toHaveLength(1)
  })
})
