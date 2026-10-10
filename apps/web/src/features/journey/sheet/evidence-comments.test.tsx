import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { annotationsKey } from '../annotations-api'
import type { EventRecord } from '../api'
import type { JourneyEventV3 } from '../types'
import { Comments } from './comments'
import { Evidence } from './evidence'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const EVENT: JourneyEventV3 = { id: 'e1', asset: 'trep', date: '2021-03-31', type: 'approval', category: 'regulatory', title: 'Tyvaso approved', significance: 'High', is_milestone: false, sources: [], via: 'ai_events' }
const rec = (extra: Partial<EventRecord>): EventRecord => ({ collection: 'fda_records', key: 'k', tab: 'regulatory', title: 't', date: '', url: null, record_type: null, source: null, ...extra })

describe('Evidence', () => {
  it('charts the records by collection, opens tab records in the record sheet and pages in a new tab', async () => {
    const onOpen = vi.fn()
    render(
      <Evidence
        event={EVENT}
        onOpenRecord={onOpen}
        records={[rec({ key: 'a', title: 'FDA letter', date: '2021-03-31' }), rec({ collection: 'web_records', key: 'w', tab: null, title: 'Web page', url: 'https://example.com/w' })]}
      />,
    )
    expect(screen.getByRole('img', { name: '2 records' })).toBeInTheDocument()
    expect(screen.getByText('FDA · Regulatory tab')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open FDA letter' }))
    expect(onOpen).toHaveBeenCalledWith({ tab: 'regulatory', key: 'a' })
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('Web')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Web page' })).toHaveAttribute('href', 'https://example.com/w')
    expect(screen.getByText('Extracted and consolidated by AI from 2 records.')).toBeInTheDocument()
  })

  it('explains a hand-made note without records', () => {
    const user = { tag: 'Risk' as const, by: { id: 'u1', name: 'Ana Analyst' }, created_at: '2026-10-01T10:00:00Z', mode: 'manual' as const }
    render(<Evidence event={{ ...EVENT, via: 'user', user }} records={[]} onOpenRecord={() => {}} />)
    expect(screen.getByText('Added manually by Ana Analyst; no source records yet. It will be re-checked on the next refresh.')).toBeInTheDocument()
  })
})

describe('Comments', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('lists the team’s comments and sends a new one with Enter (Shift+Enter breaks the line)', async () => {
    const c1 = { id: 'c1', by: { id: 'u2', name: 'Bo Chen' }, at: '2026-10-08T09:00:00.000Z', text: 'Watch the label' }
    const c2 = { id: 'c2', by: { id: 'u1', name: 'Ana Analyst' }, at: '2026-10-09T10:00:00.000Z', text: 'Line one\nline two' }
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json(201, c2) : json(200, { stars: [], notes: [], comments: { e1: [c1, c2] } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(annotationsKey('trep'), {
      stars: [], notes: [], comments: { e1: [{ id: 'c1', by: { id: 'u2', name: 'Bo Chen' }, at: '2026-10-08T09:00:00.000Z', text: 'Watch the label' }] },
    })
    render(
      <QueryClientProvider client={client}>
        <Comments assetId="trep" eventId="e1" />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('region', { name: 'Comments' })).toHaveTextContent('Comments · 1')
    expect(screen.getByText('BC')).toBeInTheDocument()
    expect(screen.getByText('· Oct 8', { exact: false })).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: 'Add a comment' })
    await userEvent.type(box, 'Line one{Shift>}{Enter}{/Shift}line two{Enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/events/e1/comments', expect.objectContaining({ body: '{"text":"Line one\\nline two"}' })))
    expect(box).toHaveValue('')
    expect(await screen.findByText(/Line one/)).toBeInTheDocument()
  })

  it('rolls the comment back, toasts and restores the draft when the post fails', async () => {
    const err = vi.spyOn(toast, 'error').mockImplementation(() => '')
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { error: 'x' })))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(annotationsKey('trep'), { stars: [], notes: [], comments: {} })
    render(
      <QueryClientProvider client={client}>
        <Comments assetId="trep" eventId="e1" />
      </QueryClientProvider>,
    )
    const box = screen.getByRole('textbox', { name: 'Add a comment' })
    await userEvent.type(box, 'Hello{Enter}')
    await waitFor(() => expect(err).toHaveBeenCalledWith("The comment couldn't be posted."))
    expect(screen.queryByText('Hello', { selector: 'p' })).not.toBeInTheDocument()
    expect(box).toHaveValue('Hello')
  })

  it('shows a skeleton while loading, then an error with a working retry', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (++calls === 1 ? json(500, { error: 'x' }) : json(200, { stars: [], notes: [], comments: { e1: [{ id: 'c1', by: { id: 'u2', name: 'Bo Chen' }, at: '2026-10-08T09:00:00.000Z', text: 'Watch the label' }] } }))),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <Comments assetId="trep" eventId="e1" />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('status', { name: 'Loading comments' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Comments couldn’t be loaded.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Watch the label')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
