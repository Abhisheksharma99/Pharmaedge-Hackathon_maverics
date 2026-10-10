/** Error returned by the API: `{ statusCode, code, message }`. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** The server's "too many requests" message for a 429, else null (for toasts on the costly AI calls). */
export const rateLimitMessage = (err: unknown): string | null => (err instanceof ApiError && err.status === 429 ? err.message : null)

// Calls that must never trigger a refresh (they *are* the session endpoints).
const NO_REFRESH = new Set(['/auth/login', '/auth/refresh', '/auth/logout'])

let refreshing: Promise<boolean> | null = null
let onUnauthorized: () => void = () => {}

/** Called once a session can't be recovered (refresh failed). */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

/** One refresh for any number of concurrent 401s. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json()
    return new ApiError(res.status, body.code ?? 'ERROR', body.message ?? res.statusText)
  } catch {
    return new ApiError(res.status, 'ERROR', res.statusText || 'Request failed')
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

/**
 * Fetch `/api{path}` with the session cookies. On 401 it refreshes the session
 * once and retries; if that fails the unauthorized handler runs (sign-out).
 */
export async function apiFetch<T>(path: string, { method = 'GET', body, signal }: RequestOptions = {}): Promise<T> {
  const res = await send(path, { method, body, signal })
  return (res.status === 204 ? undefined : await res.json()) as T
}

/**
 * POST JSON to `/api{path}` and hand back the streaming response unread
 * (same session handling and errors as `apiFetch`).
 */
export function apiStream(path: string, body: unknown, { signal }: { signal?: AbortSignal } = {}): Promise<Response> {
  return send(path, { method: 'POST', body, signal })
}

/** One request with the session cookies; refreshes once on 401; throws ApiError unless 2xx. */
async function send(path: string, { method = 'GET', body, signal }: RequestOptions): Promise<Response> {
  const request = () =>
    fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })

  let res = await request()
  if (res.status === 401 && !NO_REFRESH.has(path)) {
    if (await refreshSession()) res = await request()
    if (res.status === 401) onUnauthorized()
  }
  if (!res.ok) throw await toApiError(res)
  return res
}
