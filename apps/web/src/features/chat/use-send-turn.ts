import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ApiError, apiStream } from '@/lib/api'
import { messagesKey, type ChatMessage, type StreamEvent } from './api'
import { readNdjson } from './ndjson'
import { applyEvent, useTurnStore, type Turn } from './turn-store'

const UNAVAILABLE = 'Asset AI couldn’t answer right now. Try again.'

/** Stand-in for the user's message until the session's messages are refetched. */
const localUserMessage = (content: string): ChatMessage => ({
  id: `local-${Date.now()}`,
  role: 'user',
  content,
  cards: [],
  citations: [],
  followUps: [],
  createdAt: new Date().toISOString(),
})

/**
 * Ask one question in a session and stream the answer into the turn store.
 * Runs outside any component, so navigating (e.g. /chat → /chat/:id) doesn't cut it off.
 */
async function runTurn(qc: QueryClient, sessionId: string, text: string): Promise<void> {
  const store = useTurnStore.getState()
  const controller = new AbortController()
  store.start(sessionId, text, controller)
  // A stopped turn may still settle after a newer one started: only touch our own.
  const update = (change: (turn: Turn) => Turn) =>
    store.update(sessionId, (turn) => (turn.controller === controller ? change(turn) : turn))
  let answered = false

  try {
    const res = await apiStream(`/chat/sessions/${encodeURIComponent(sessionId)}/turn`, { message: text }, {
      signal: controller.signal,
    })
    if (!res.body) throw new Error('Empty response')
    for await (const event of readNdjson<StreamEvent>(res.body)) {
      if (event.type === 'done') break
      if (event.type === 'answer') {
        answered = true
        qc.setQueryData<ChatMessage[]>(messagesKey(sessionId), (old = []) => [...old, localUserMessage(text), event.message])
        if (useTurnStore.getState().turns[sessionId]?.controller === controller) store.clear(sessionId)
      } else {
        update((turn) => applyEvent(turn, event))
      }
    }
    if (!answered) {
      update((turn) => (turn.status === 'streaming' ? { ...turn, status: 'error', error: 'The answer was cut off. Try again.' } : turn))
    }
  } catch (err) {
    if (controller.signal.aborted) update((turn) => ({ ...turn, status: 'stopped' }))
    else update((turn) => ({ ...turn, status: 'error', error: err instanceof ApiError ? err.message : UNAVAILABLE }))
  } finally {
    if (answered) qc.invalidateQueries({ queryKey: messagesKey(sessionId) })
    // The first question names the session and every turn bumps updatedAt.
    qc.invalidateQueries({ queryKey: ['chat', 'sessions'] })
  }
}

/** `send(sessionId, text)` streams a turn; `stop(sessionId)` aborts it (partial text is kept). */
export function useSendTurn() {
  const qc = useQueryClient()
  const send = useCallback((sessionId: string, text: string) => void runTurn(qc, sessionId, text), [qc])
  const stop = useCallback((sessionId: string) => useTurnStore.getState().turns[sessionId]?.controller.abort(), [])
  return { send, stop }
}
