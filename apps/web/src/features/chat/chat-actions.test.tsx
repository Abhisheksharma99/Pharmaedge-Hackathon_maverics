import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import { routes } from '@/routes'
import type { ChatMessage, ChatSession, Citation } from './api'

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
const SESSIONS: ChatSession[] = [
  { id: 's1', title: 'TETON readouts', assetId: 'trep', createdAt: '', updatedAt: '' },
  { id: 's2', title: 'Patent cliff', assetId: null, createdAt: '', updatedAt: '' },
]

const cite = (n: number, assetId: string, assetName: string): Citation => ({
  n,
  title: `Record ${n}`,
  source: 'ClinicalTrials.gov',
  date: '2025-09-01',
  url: `https://example.org/r${n}`,
  assetId,
  assetName,
  collection: 'trial_records',
  recordKey: `NCT${n}`,
  tab: 'clinical',
})

const QUESTION: ChatMessage = { id: 'q1', role: 'user', content: 'How did TETON-2 read out?', cards: [], citations: [], followUps: [], createdAt: '' }
const answer = (citations: Citation[]): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  content: 'TETON-2 met its **primary** endpoint [1].',
  cards: [],
  citations,
  followUps: [],
  createdAt: '',
  feedback: null,
})

/** The chat page is a lazy route: its first load can take a few seconds on a busy machine. */
const LOAD = { timeout: 8000 }

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function fakeApi(messages: ChatMessage[]) {
  const state = { sessions: SESSIONS.map((s) => ({ ...s })), calls: [] as { url: string; method: string; body: unknown }[] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      state.calls.push({ url, method, body })
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/assets') return json(200, [{ id: 'trep', name: 'Treprostinil' }, { id: 'nint', name: 'Nintedanib' }])
      if (url === '/api/chat/sessions' && method === 'GET') return json(200, state.sessions)
      if (url === '/api/chat/sessions/s1/messages') return json(200, messages)
      if (url === '/api/chat/sessions/s1/turns/a1/feedback') return json(200, { rating: body.rating, reason: body.reason ?? null })
      const rename = /^\/api\/chat\/sessions\/(s\d)$/.exec(url)
      if (rename && method === 'PATCH') {
        const s = state.sessions.find((x) => x.id === rename[1])!
        s.title = body.title
        return json(200, s)
      }
      if (/^\/api\/assets\/\w+\/branches$/.test(url)) return json(200, [])
      const note = /^\/api\/assets\/(\w+)\/notes$/.exec(url)
      if (note && method === 'POST') return json(201, { id: 'note:1', asset: note[1], ...body, summary: body.text, type: 'note', via: 'user' })
      return json(404, { code: 'NOT_FOUND', message: url })
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
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeAll(() => {
  // jsdom lacks pointer capture; sonner's toast (the "View" action) uses it on pointer down.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
})
afterEach(() => vi.unstubAllGlobals())

describe('Asset AI answer actions', () => {
  it('rates an answer: the thumb shows as selected, then an optional reason is sent', async () => {
    const api = fakeApi([QUESTION, answer([cite(1, 'trep', 'Treprostinil')])])
    const user = userEvent.setup()
    renderAt('/chat/s1')

    const down = await screen.findByRole('button', { name: 'Not helpful' }, LOAD)
    expect(down).toHaveAttribute('aria-pressed', 'false')
    await user.click(down)
    expect(await screen.findByRole('button', { name: 'You rated this not helpful' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(api.calls.find((c) => c.url.endsWith('/feedback'))?.body).toEqual({ rating: 'down' }))

    const form = screen.getByRole('form', { name: 'Feedback reason' })
    await user.click(within(form).getByRole('button', { name: 'Missing information' }))
    await user.type(within(form).getByLabelText(/What went wrong/), ' about EU trials')
    await user.click(within(form).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(api.calls.filter((c) => c.url.endsWith('/feedback')).at(-1)?.body).toEqual({ rating: 'down', reason: 'Missing information about EU trials' }))
    expect(await screen.findByText('“Missing information about EU trials”')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Feedback reason' })).not.toBeInTheDocument()

    // Switching thumbs replaces the rating.
    await user.click(screen.getByRole('button', { name: 'Helpful' }))
    expect(await screen.findByRole('button', { name: 'You rated this helpful' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a stored rating as selected', async () => {
    fakeApi([QUESTION, { ...answer([]), feedback: { rating: 'up', reason: 'Clear' } }])
    renderAt('/chat/s1')
    expect(await screen.findByRole('button', { name: 'You rated this helpful' }, LOAD)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('“Clear”')).toBeInTheDocument()
  })

  it('copies the answer as Markdown with footnotes, or as plain text', async () => {
    fakeApi([QUESTION, answer([cite(1, 'trep', 'Treprostinil')])])
    const user = userEvent.setup()
    renderAt('/chat/s1')

    await user.click(await screen.findByRole('button', { name: 'Copy (Markdown with sources)' }, LOAD))
    expect(await navigator.clipboard.readText()).toBe(
      'TETON-2 met its **primary** endpoint [^1].\n\n[^1]: Record 1 (ClinicalTrials.gov, 1 Sep 2025, Treprostinil). <https://example.org/r1>\n',
    )
    await user.click(screen.getByRole('button', { name: 'Copy as plain text' }))
    expect(await navigator.clipboard.readText()).toBe(
      'TETON-2 met its primary endpoint [1].\n\nSources:\n[1] Record 1 (ClinicalTrials.gov, 1 Sep 2025, Treprostinil). https://example.org/r1',
    )
  })

  it('saves an answer about several assets to the chosen asset’s journey as an Important note, then links to it', async () => {
    const api = fakeApi([QUESTION, answer([cite(1, 'trep', 'Treprostinil'), cite(2, 'nint', 'Nintedanib'), cite(3, 'nint', 'Nintedanib')])])
    const user = userEvent.setup()
    const router = renderAt('/chat/s1')

    await user.click(await screen.findByRole('button', { name: 'Save to journey' }, LOAD))
    const dialog = await screen.findByRole('dialog', { name: 'Save to journey' })
    const save = within(dialog).getByRole('button', { name: 'Save note' })
    expect(save).toBeDisabled()
    const which = within(dialog).getByLabelText(/several assets: which journey/)
    expect(within(which).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose an asset', 'Nintedanib', 'Treprostinil'])
    expect(within(dialog).getByLabelText('Title')).toHaveValue('How did TETON-2 read out?')
    expect((within(dialog).getByLabelText('Note') as HTMLTextAreaElement).value).toContain('Sources:\n[1] Record 1')

    await user.selectOptions(which, 'trep')
    expect(within(dialog).getByText('1 cited source record attached')).toBeInTheDocument()
    await user.click(save)

    await waitFor(() => expect(api.calls.find((c) => c.url === '/api/assets/trep/notes')).toBeDefined())
    expect(api.calls.find((c) => c.url === '/api/assets/trep/notes')?.body).toMatchObject({
      tag: 'Important',
      title: 'How did TETON-2 read out?',
      category: 'clinical',
      mode: 'manual',
      sources: [{ collection: 'trial_records', record_key: 'NCT1' }],
    })
    expect(await screen.findByText('Saved to the journey')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Save to journey' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View' }))
    await waitFor(() => expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/journey/trep?focus=note%3A1'))
  })

  it('saves straight to the one asset an answer is about', async () => {
    fakeApi([QUESTION, answer([cite(1, 'trep', 'Treprostinil')])])
    const user = userEvent.setup()
    renderAt('/chat/s1')
    await user.click(await screen.findByRole('button', { name: 'Save to journey' }, LOAD))
    const dialog = await screen.findByRole('dialog', { name: 'Save to journey' })
    expect(within(dialog).queryByRole('combobox', { name: /which journey/i })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Treprostinil')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save note' })).toBeEnabled()
  })
})

describe('Asset AI history and export', () => {
  it('searches the chats by title and renames one in place', async () => {
    const api = fakeApi([QUESTION, answer([])])
    const user = userEvent.setup()
    renderAt('/chat/s1')

    const nav = await screen.findByRole('navigation', { name: 'Chat history' }, LOAD)
    expect(await within(nav).findByText('Patent cliff', {}, LOAD)).toBeInTheDocument()
    const search = screen.getAllByLabelText('Search chats')[0]!
    await user.type(search, 'teton')
    expect(within(nav).queryByText('Patent cliff')).not.toBeInTheDocument()
    expect(within(nav).getByText('TETON readouts')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 chats')).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'zzz')
    expect(within(nav).getByText('No chats match “zzz”.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    await user.click(within(nav).getByRole('button', { name: 'Rename chat “Patent cliff”' }))
    const field = within(nav).getByLabelText('Chat title')
    await user.clear(field)
    await user.type(field, 'Nintedanib patents{Enter}')
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/api/chat/sessions/s2', body: { title: 'Nintedanib patents' } }))
    expect(await within(nav).findByText('Nintedanib patents')).toBeInTheDocument()

    // Escape cancels without saving.
    await user.click(within(nav).getByRole('button', { name: 'Rename chat “TETON readouts”' }))
    await user.type(within(nav).getByLabelText('Chat title'), 'xyz{Escape}')
    expect(within(nav).getByText('TETON readouts')).toBeInTheDocument()
    expect(api.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
  })

  it('exports the conversation as Markdown from the header menu', async () => {
    fakeApi([QUESTION, answer([cite(1, 'trep', 'Treprostinil')])])
    const blobs: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => (blobs.push(b), 'blob:x'), revokeObjectURL: () => {} }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    renderAt('/chat/s1')

    await screen.findByRole('button', { name: 'Not helpful' }, LOAD)
    await user.click(screen.getByRole('button', { name: /Export/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Markdown/ }))
    await waitFor(() => expect(blobs).toHaveLength(1))
    const md = await blobs[0]!.text()
    expect(md).toMatch(/^# TETON readouts\n/)
    expect(md).toContain('## Q1. How did TETON-2 read out?')
    expect(md).toContain('TETON-2 met its **primary** endpoint [^1].')
    expect(md).toContain('[^1]: Record 1 (ClinicalTrials.gov, 1 Sep 2025, Treprostinil). <https://example.org/r1>')
    expect(click.mock.contexts[0]).toHaveProperty('download', expect.stringMatching(/^asset-ai-teton-readouts-\d{4}-\d{2}-\d{2}\.md$/))
    expect(await screen.findByText('Conversation exported')).toBeInTheDocument()
    click.mockRestore()
  })
})
