import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { Mock } from 'vitest'
import { AuthContext, type AuthContextValue, type User } from '@/features/auth/use-auth'
import { useEventSheet } from '@/stores/event-sheet-store'
import { annotationsKey } from './annotations-api'
import { NoteActions } from './note-actions'
import type { Annotations, JourneyEventV3 } from './types'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const user = (id: string, role: User['role'] = 'analyst'): User => ({ id, email: `${id}@x.test`, name: id.toUpperCase(), role, active: true, createdAt: '2026-01-01' })

const NOTE: JourneyEventV3 = {
  id: 'note:1', asset: 'trep', date: '2025-05-23', type: 'note', category: 'regulatory', title: 'Yutrepia approved', summary: 'Heard at ATS.',
  significance: 'Medium', is_milestone: false, sources: [], via: 'user', key: true, branch: 'main',
  user: { tag: 'Important', by: { id: 'ana', name: 'Ana' }, created_at: '2026-10-01T10:00:00Z', mode: 'manual' },
}
const EVENT: JourneyEventV3 = { ...NOTE, id: 'ev:1', via: 'journey', user: undefined }
const OTHER: JourneyEventV3 = { ...NOTE, id: 'note:2', title: 'Other note' }

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let client: QueryClient
const timeline = () => client.getQueryData<{ events: JourneyEventV3[]; total: number }>(['asset', 'trep', 'timeline-v3', 'key'])!
const notes = () => client.getQueryData<Annotations>(annotationsKey('trep'))!.notes

function setup(event: JourneyEventV3, me: User | null = user('ana')) {
  const auth: AuthContextValue = { user: me, isLoading: false, login: vi.fn(), logout: vi.fn() }
  render(
    <QueryClientProvider client={client}>
      <AuthContext value={auth}>
        <NoteActions assetId="trep" event={event} />
      </AuthContext>
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
})
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  client.setQueryData<Annotations>(annotationsKey('trep'), { stars: [], comments: {}, notes: [NOTE, OTHER] })
  client.setQueryData(['asset', 'trep', 'timeline-v3', 'key'], { events: [NOTE, EVENT, OTHER], total: 3 })
  client.setQueryData(['asset', 'trep', 'branches'], [])
  client.setQueryData(['asset', 'trep', 'event', 'note:1'], { event: NOTE, records: [], neighbors: { prev: null, next: null } })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(toast, 'error').mockImplementation(() => 'id')
  vi.spyOn(toast, 'success').mockImplementation(() => 'id')
  useEventSheet.setState({ current: { assetId: 'trep', eventId: 'note:1' } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('NoteActions', () => {
  it('has no Edit or Delete on journey events', () => {
    setup(EVENT)
    expect(screen.queryByRole('button', { name: 'Edit note' })).not.toBeInTheDocument()
  })

  it.each([
    ['the author', user('ana'), true],
    ['an admin', user('root', 'admin'), true],
    ['another analyst', user('bob'), false],
    ['nobody signed in', null, false],
  ] as const)('shows Edit and Delete to %s: %s', (_who, me, shown) => {
    setup(NOTE, me)
    expect(!!screen.queryByRole('button', { name: 'Edit note' })).toBe(shown)
    expect(!!screen.queryByRole('button', { name: 'Delete note' })).toBe(shown)
  })

  it('edits a note: sends only what changed and shows the change at once', async () => {
    let release!: (r: Response) => void
    fetchMock.mockImplementation((_url, init) =>
      init?.method === 'PATCH' ? new Promise((r) => (release = r)) : Promise.resolve(json(200, { stars: [], comments: {}, notes: [] })),
    )
    setup(NOTE)
    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    const title = screen.getByRole('textbox', { name: 'What happened?' })
    expect(title).toHaveValue('Yutrepia approved')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await userEvent.clear(title)
    await userEvent.type(title, 'Yutrepia approved by FDA ')
    await userEvent.click(screen.getByRole('button', { name: 'Risk' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!
    expect(url).toBe('/api/assets/trep/notes/note%3A1')
    expect(JSON.parse(init!.body as string)).toEqual({ title: 'Yutrepia approved by FDA', tag: 'Risk' })
    // Optimistic: every cached copy changes before the server answers.
    expect(notes()[0]).toMatchObject({ title: 'Yutrepia approved by FDA', user: { tag: 'Risk' } })
    expect(timeline().events[0]!.title).toBe('Yutrepia approved by FDA')
    expect(client.getQueryData<{ event: JourneyEventV3 }>(['asset', 'trep', 'event', 'note:1'])!.event.title).toBe('Yutrepia approved by FDA')
    expect(timeline().events[2]!.title).toBe('Other note')
    release(json(200, { ...NOTE, title: 'Yutrepia approved by FDA', user: { ...NOTE.user!, tag: 'Risk' } }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Note updated'))
  })

  it('puts the old note back with a toast when the edit is refused', async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === 'PATCH' ? json(403, { code: 'NOT_AUTHOR', message: 'Only the author or an admin can change this note.' }) : new Promise(() => {}),
    )
    setup(NOTE)
    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'What happened?' }), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The note couldn't be saved."))
    expect(notes()[0]!.title).toBe('Yutrepia approved')
    expect(timeline().events[0]!.title).toBe('Yutrepia approved')
  })

  it('deletes a note after confirming: it leaves the journey and the sheet closes', async () => {
    fetchMock.mockImplementation(async (_url, init) => (init?.method === 'DELETE' ? json(204) : new Promise(() => {})))
    setup(NOTE)
    await userEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(screen.getByText(/“Yutrepia approved” leaves the journey/)).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete note' }).at(-1)!)
    await waitFor(() => expect(useEventSheet.getState().current).toBeNull())
    expect(fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')![0]).toBe('/api/assets/trep/notes/note%3A1')
    expect(notes().map((n) => n.id)).toEqual(['note:2'])
    expect(timeline()).toMatchObject({ total: 2, events: [{ id: 'ev:1' }, { id: 'note:2' }] })
    expect(toast.success).toHaveBeenCalledWith('Note deleted')
  })

  it('keeps the note when the delete fails', async () => {
    fetchMock.mockImplementation(async (_url, init) => (init?.method === 'DELETE' ? json(500, { code: 'ERROR', message: 'boom' }) : new Promise(() => {})))
    setup(NOTE)
    await userEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete note' }).at(-1)!)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The note couldn't be deleted."))
    expect(notes().map((n) => n.id)).toEqual(['note:1', 'note:2'])
    expect(timeline().total).toBe(3)
    expect(useEventSheet.getState().current).not.toBeNull()
  })
})
