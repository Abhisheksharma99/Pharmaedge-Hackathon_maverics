import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { Mock } from 'vitest'
import { useEventSheet } from '@/stores/event-sheet-store'
import { annotationsKey } from './annotations-api'
import { NoteComposer, type NoteDraft } from './note-composer'
import type { Annotations, Branch, JourneyEventV3 } from './types'

const json = (status: number, body?: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const branch = (id: string, label: string, color: string): Branch => ({ id, label, full: label, color, off: 0, status: '', origin: 'rule' })
const BRANCHES = [branch('main', 'PAH', '#2347d9'), branch('ild', 'PH-ILD', '#0b7a6f')]
const DRAFT = { date: '2025-05-23', branch: 'ild', prev: 'Phase 3 starts', next: 'FDA decision' }

const FOUND: JourneyEventV3 = {
  id: 'ai:x:1', asset: 'trep', date: '2025-05-20', type: 'approval', category: 'regulatory', title: 'FDA approves Yutrepia', summary: 'Approved for PAH.',
  significance: 'High', is_milestone: false, via: 'ai_events', branch: 'main', sources: [{ collection: 'fda_records', record_key: 'NDA213005' }],
}

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let client: QueryClient
const onClose = vi.fn()
const onSaved = vi.fn()

function setup(draft: NoteDraft = DRAFT) {
  render(
    <QueryClientProvider client={client}>
      <NoteComposer assetId="trep" draft={draft} branches={BRANCHES} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>,
  )
}
const posts = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/notes'))
const body = (i: number) => JSON.parse(posts()[i]![1]!.body as string)

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData<Annotations>(annotationsKey('trep'), { stars: [], comments: {}, notes: [] })
  client.setQueryData(['asset', 'trep', 'timeline-v3', 'key'], { events: [], total: 0 })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(toast, 'error').mockImplementation(() => 'id')
  onClose.mockReset()
  onSaved.mockReset()
  useEventSheet.setState({ current: null })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('NoteComposer', () => {
  it('shows the where strip and updates it as the fields change', async () => {
    const user = userEvent.setup()
    setup()
    const where = screen.getByTestId('note-where')
    expect(where).toHaveTextContent('May 23, 2025')
    expect(where).toHaveTextContent('PH-ILD')
    expect(where).toHaveTextContent('after “Phase 3 starts” · before “FDA decision”')
    await user.selectOptions(screen.getByLabelText('Branch'), 'main')
    expect(where).toHaveTextContent('PAH')
    const date = screen.getByLabelText('Date')
    await user.clear(date)
    await user.type(date, '2026-01-09')
    expect(where).toHaveTextContent('Jan 9, 2026')
  })

  it('needs a title or context before it can be added', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.getByRole('button', { name: 'Add manually' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Ask Asset AI to find it/ })).toBeDisabled()
    await user.type(screen.getByLabelText('What happened?'), 'Yutrepia approved')
    expect(screen.getByRole('button', { name: 'Add manually' })).toBeEnabled()
  })

  it('adds manually: optimistic note, POST body, onSaved with the saved note', async () => {
    const user = userEvent.setup()
    const saved = { ...FOUND, id: 'note:1', via: 'user' as const }
    let release!: (r: Response) => void
    fetchMock.mockReturnValue(new Promise((r) => (release = r)))
    setup()
    await user.type(screen.getByLabelText('What happened?'), 'Yutrepia approved')
    await user.selectOptions(screen.getByLabelText('Category'), 'clinical')
    await user.click(screen.getByRole('button', { name: 'Question' }))
    await user.click(screen.getByRole('button', { name: 'Add manually' }))
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(client.getQueryData<Annotations>(annotationsKey('trep'))!.notes).toHaveLength(1))
    expect(client.getQueryData<{ events: unknown[] }>(['asset', 'trep', 'timeline-v3', 'key'])!.events).toHaveLength(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/assets/trep/notes')
    expect(body(0)).toEqual({ date: '2025-05-23', branch: 'ild', category: 'clinical', tag: 'Question', title: 'Yutrepia approved', text: '', mode: 'manual' })
    await act(async () => release(json(200, saved)))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(client.getQueryData<Annotations>(annotationsKey('trep'))!.notes).toEqual([saved])
    expect(client.getQueryData<{ events: unknown[] }>(['asset', 'trep', 'timeline-v3', 'key'])!.events).toEqual([saved])
  })

  it('rolls the note back and toasts when saving fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(json(500, { message: 'x' }))
    setup()
    await user.type(screen.getByLabelText('What happened?'), 'Something')
    await user.click(screen.getByRole('button', { name: 'Add manually' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The note couldn't be saved."))
    expect(client.getQueryData<Annotations>(annotationsKey('trep'))!.notes).toEqual([])
    expect(client.getQueryData<{ events: unknown[] }>(['asset', 'trep', 'timeline-v3', 'key'])!.events).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('finds an event, then adds it to the journey with its sources (mode ai)', async () => {
    const user = userEvent.setup()
    let release!: (r: Response) => void
    fetchMock.mockReturnValueOnce(new Promise((r) => (release = r)))
    fetchMock.mockResolvedValueOnce(json(200, { ...FOUND, id: 'note:2', via: 'user' }))
    setup()
    await user.type(screen.getByLabelText('What happened?'), 'Yutrepia')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    expect(screen.getByText('Reading your note')).toBeInTheDocument()
    await act(async () => release(json(200, { kind: 'found', event: FOUND, note: 'Found an FDA approval record.' })))
    expect(await screen.findByText('Found an FDA approval record.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/assets/trep/notes/find')
    expect(screen.getByText('NDA213005')).toBeInTheDocument()
    expect(screen.getByTestId('note-where')).toHaveTextContent('May 20, 2025')
    await user.click(screen.getByRole('button', { name: 'Add to journey' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(body(0)).toEqual({
      date: '2025-05-20', branch: 'main', category: 'regulatory', tag: 'Missed by AI', title: 'FDA approves Yutrepia', text: 'Approved for PAH.', mode: 'ai',
      sources: [{ collection: 'fda_records', record_key: 'NDA213005' }],
    })
  })

  it('asks Asset AI with the context as the title when only context is given (the API requires a title)', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, { kind: 'none', note: 'Nothing matched.' }))
    setup()
    await user.type(screen.getByLabelText(/Context for Asset AI/), 'Heard Yutrepia was approved')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({ title: 'Heard Yutrepia was approved', text: 'Heard Yutrepia was approved' })
  })

  it('opens the matching event when it already exists', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, { kind: 'exists', event: FOUND, note: 'Already on the journey.' }))
    setup()
    await user.type(screen.getByLabelText('What happened?'), 'Yutrepia')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    await user.click(await screen.findByRole('button', { name: /FDA approves Yutrepia/ }))
    expect(onClose).toHaveBeenCalled()
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'ai:x:1' })
  })

  it('keeps it as a note when nothing was found', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, { kind: 'none', note: 'No dated record matched.' }))
    fetchMock.mockResolvedValueOnce(json(200, { ...FOUND, id: 'note:3', via: 'user' }))
    setup()
    await user.type(screen.getByLabelText('What happened?'), 'Rumour')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    await screen.findByText('No dated record matched.')
    await user.click(screen.getByRole('button', { name: 'Keep as a note' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(body(0)).toMatchObject({ title: 'Rumour', mode: 'manual', date: '2025-05-23' })
  })

  it('shows the search steps without spinner animation under reduced motion', async () => {
    const user = userEvent.setup()
    fetchMock.mockReturnValue(new Promise(() => undefined))
    setup()
    await user.type(screen.getByLabelText('What happened?'), 'Rumour')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    const spinner = screen.getByText('Reading your note').querySelector('svg')!
    // Tailwind's motion-safe: variant only applies when the user has not asked for reduced motion.
    expect(spinner.getAttribute('class')).toContain('motion-safe:animate-spin')
    expect(spinner.getAttribute('class')).not.toMatch(/(^|\s)animate-spin/)
  })

  const findCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/notes/find')).map(([, init]) => JSON.parse(init!.body as string))

  it('sends the hover position date to find', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(json(200, { kind: 'none', note: 'No dated record matched.' }))
    setup()
    await user.type(screen.getByLabelText('What happened?'), 'Remodulin approved')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    await screen.findByText('No dated record matched.')
    expect(findCalls()[0]).toMatchObject({ date: '2025-05-23' })
  })

  it('omits the date from find for "Add to timeline" until the user changes it', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(json(200, { kind: 'none', note: 'No dated record matched.' }))
    setup({ date: '', branch: 'main' })
    await user.type(screen.getByLabelText('What happened?'), 'Remodulin approved')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    await screen.findByText('No dated record matched.')
    expect(findCalls()[0]).not.toHaveProperty('date')
    expect(findCalls()[0]).toMatchObject({ title: 'Remodulin approved', branch: 'main' })

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.clear(screen.getByLabelText('Date'))
    await user.type(screen.getByLabelText('Date'), '2002-05-21')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    await waitFor(() => expect(findCalls()).toHaveLength(2))
    expect(findCalls()[1]).toMatchObject({ date: '2002-05-21' })
  })

  it('toasts the rate-limit message when find is throttled', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(json(429, { statusCode: 429, code: 'TOO_MANY_REQUESTS', message: 'You are sending AI requests too quickly.' }))
    setup()
    await user.type(screen.getByLabelText('What happened?'), 'Rumour')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You are sending AI requests too quickly.'))
    expect(screen.getByLabelText('What happened?')).toHaveValue('Rumour')
  })

  it('toasts and returns to the form when the find fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(json(500, { message: 'x' }))
    setup()
    await user.type(screen.getByLabelText('What happened?'), 'Rumour')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Asset AI couldn't search right now."))
    expect(screen.getByLabelText('What happened?')).toHaveValue('Rumour')
  })

  it('goes back to the form from a result', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, { kind: 'none', note: 'No dated record matched.' }))
    setup()
    await user.type(screen.getByLabelText('What happened?'), 'Rumour')
    await user.click(screen.getByRole('button', { name: /Ask Asset AI to find it/ }))
    await screen.findByText('No dated record matched.')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('What happened?')).toHaveValue('Rumour')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
