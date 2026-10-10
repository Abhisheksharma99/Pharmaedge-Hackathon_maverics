import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import type { Mock } from 'vitest'
import { ME_KEY } from '@/features/auth/auth-context'
import { annotationsKey, useAddComment, useAnnotations, useToggleStar } from './annotations-api'
import type { Annotations } from './types'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const EVENT_ID = 'ai:trep:https://example.com/a/b:0'
const ENCODED = encodeURIComponent(EVENT_ID)
const BASE: Annotations = { stars: ['other'], comments: {}, notes: [] }

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
const cached = () => client.getQueryData<Annotations>(annotationsKey('trep'))

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(ME_KEY, { id: 'u1', name: 'Ana Analyst' })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(toast, 'error').mockImplementation(() => 'id')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('annotations', () => {
  it('loads the annotations of an asset', async () => {
    fetchMock.mockResolvedValue(json(200, BASE))
    const { result } = renderHook(() => useAnnotations('trep'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(BASE))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/annotations', expect.anything())
  })

  it('stars at once with the encoded event id, and unstars with DELETE', async () => {
    client.setQueryData(annotationsKey('trep'), BASE)
    let release: (r: Response) => void = () => {}
    fetchMock.mockImplementation((url) => (url.endsWith('/star') ? new Promise((r) => (release = r)) : Promise.resolve(json(200, cached()))))
    const { result } = renderHook(() => useToggleStar('trep'), { wrapper })
    act(() => result.current.mutate({ eventId: EVENT_ID, on: true }))
    await waitFor(() => expect(cached()?.stars).toEqual(['other', EVENT_ID]))
    expect(fetchMock).toHaveBeenCalledWith(`/api/assets/trep/events/${ENCODED}/star`, expect.objectContaining({ method: 'PUT' }))
    await act(async () => release(json(204)))
    fetchMock.mockResolvedValue(json(204))
    await act(() => result.current.mutateAsync({ eventId: EVENT_ID, on: false }))
    expect(cached()?.stars).toEqual(['other'])
    expect(fetchMock).toHaveBeenCalledWith(`/api/assets/trep/events/${ENCODED}/star`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('rolls the star back and says so when saving fails', async () => {
    client.setQueryData(annotationsKey('trep'), BASE)
    fetchMock.mockImplementation(async (url) => (url.endsWith('/star') ? json(500, { code: 'ERROR', message: 'boom' }) : json(200, BASE)))
    const { result } = renderHook(() => useToggleStar('trep'), { wrapper })
    await act(() => result.current.mutateAsync({ eventId: EVENT_ID, on: true }).catch(() => undefined))
    expect(cached()?.stars).toEqual(['other'])
    expect(toast.error).toHaveBeenCalledWith("The star couldn't be saved.")
  })

  it('shows a comment as you at once, then the saved one', async () => {
    client.setQueryData(annotationsKey('trep'), BASE)
    let release: (r: Response) => void = () => {}
    fetchMock.mockImplementation(() => new Promise((r) => (release = r)))
    const { result } = renderHook(() => useAddComment('trep'), { wrapper })
    act(() => result.current.mutate({ eventId: EVENT_ID, text: 'Check the label' }))
    await waitFor(() => expect(cached()?.comments[EVENT_ID]).toMatchObject([{ by: { id: 'u1', name: 'Ana Analyst' }, text: 'Check the label' }]))
    expect(fetchMock).toHaveBeenCalledWith(`/api/assets/trep/events/${ENCODED}/comments`, expect.objectContaining({ method: 'POST', body: '{"text":"Check the label"}' }))
    const saved = { id: 'c1', by: { id: 'u1', name: 'Ana Analyst' }, at: '2026-10-09T10:00:00.000Z', text: 'Check the label' }
    await act(async () => release(json(201, saved)))
    await waitFor(() => expect(cached()?.comments[EVENT_ID]).toEqual([saved]))
  })

  it('removes a comment that failed to post and says so', async () => {
    client.setQueryData(annotationsKey('trep'), BASE)
    fetchMock.mockResolvedValue(json(400, { code: 'BAD', message: 'too long' }))
    const { result } = renderHook(() => useAddComment('trep'), { wrapper })
    await act(() => result.current.mutateAsync({ eventId: EVENT_ID, text: 'x' }).catch(() => undefined))
    expect(cached()?.comments[EVENT_ID]).toBeUndefined()
    expect(toast.error).toHaveBeenCalledWith("The comment couldn't be posted.")
  })
})
