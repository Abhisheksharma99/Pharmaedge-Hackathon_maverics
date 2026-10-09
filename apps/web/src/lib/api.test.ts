import type { Mock } from 'vitest'
import { ApiError, apiFetch, apiStream, setUnauthorizedHandler } from './api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('apiFetch', () => {
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
  let unauthorized: Mock<() => void>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    unauthorized = vi.fn<() => void>()
    setUnauthorizedHandler(unauthorized)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('returns parsed JSON and sends JSON bodies', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }))
    await expect(apiFetch('/things', { method: 'POST', body: { a: 1 } })).resolves.toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/things')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"a":1}' })
  })

  it('turns error responses into ApiError with the server code and message', async () => {
    fetchMock.mockResolvedValue(json(409, { statusCode: 409, code: 'USER_EXISTS', message: 'Already exists' }))
    const err = await apiFetch('/users').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, code: 'USER_EXISTS', message: 'Already exists' })
  })

  it('copes with non-JSON error bodies (e.g. a proxy 502 page)', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }))
    await expect(apiFetch('/users')).rejects.toMatchObject({ status: 502, code: 'ERROR' })
  })

  it('refreshes once for concurrent 401s, then retries each request', async () => {
    let refreshed = false
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') {
        await new Promise((r) => setTimeout(r, 10))
        refreshed = true
        return json(200, { user: {} })
      }
      return refreshed ? json(200, { url }) : json(401, { code: 'TOKEN_INVALID', message: 'expired' })
    })

    const results = await Promise.all([apiFetch('/a'), apiFetch('/b'), apiFetch('/c')])

    expect(results).toEqual([{ url: '/api/a' }, { url: '/api/b' }, { url: '/api/c' }])
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/auth/refresh')).toHaveLength(1)
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('signs out when the refresh fails', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/auth/refresh' ? json(401, { code: 'REFRESH_INVALID', message: 'x' }) : json(401, { code: 'TOKEN_INVALID', message: 'x' }),
    )
    await expect(apiFetch('/assets')).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('never refreshes for the session endpoints themselves', async () => {
    fetchMock.mockResolvedValue(json(401, { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }))
    await expect(apiFetch('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })
})

describe('apiStream', () => {
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setUnauthorizedHandler(vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts JSON and returns the unread response, refreshing once on 401', async () => {
    let refreshed = false
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') {
        refreshed = true
        return json(200, {})
      }
      return refreshed ? new Response('{"type":"done"}\n') : json(401, { code: 'TOKEN_INVALID', message: 'expired' })
    })
    const controller = new AbortController()

    const res = await apiStream('/chat/sessions/s1/turn', { message: 'hi' }, { signal: controller.signal })

    expect(await res.text()).toBe('{"type":"done"}\n')
    const [url, init] = fetchMock.mock.calls.at(-1)!
    expect(url).toBe('/api/chat/sessions/s1/turn')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"message":"hi"}', signal: controller.signal })
  })

  it('throws ApiError for error responses', async () => {
    fetchMock.mockResolvedValue(json(503, { code: 'LLM_UNAVAILABLE', message: 'Asset AI is unavailable' }))
    await expect(apiStream('/chat/sessions/s1/turn', { message: 'hi' })).rejects.toMatchObject({
      status: 503,
      code: 'LLM_UNAVAILABLE',
    })
  })
})
