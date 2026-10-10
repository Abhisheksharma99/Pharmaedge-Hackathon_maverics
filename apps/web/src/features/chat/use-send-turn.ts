import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useLiveCanvases } from '@/features/canvas/live-store'
import { useLiveStories } from '@/features/story/live-store'
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
  const building = new Set<string>() // canvases this turn is streaming
  const live = useLiveCanvases.getState()
  const stories = useLiveStories.getState()
  const storiesSeen = new Set<string>() // stories this turn streamed

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
      } else if (event.type === 'canvas_start') {
        building.add(event.canvasId)
        live.start(event.canvasId, { assetId: event.assetId, title: event.title, tree: event.tree })
      } else if (event.type === 'story_start') {
        storiesSeen.add(event.storyId)
        stories.start(event.storyId, { assetId: event.assetId, title: event.title, question: event.question, spec: event.spec })
      } else if (event.type === 'story_layer') {
        if (!useLiveStories.getState().live[event.storyId]) {
          // Notes for a story built in an earlier turn: hold them until the saved story reloads.
          stories.start(event.storyId, { assetId: '', title: '', question: null, spec: {} })
          stories.finish(event.storyId)
        }
        storiesSeen.add(event.storyId)
        stories.layer(event.storyId, event.layer, event.data)
      } else if (event.type === 'card' && event.card.type === 'story') {
        // Built and saved: the story view switches to the saved story (filters work from here on).
        await qc.invalidateQueries({ queryKey: ['stories'] })
        stories.finish(event.card.storyId)
        update((turn) => applyEvent(turn, event))
      } else if (event.type === 'canvas_nodes') {
        live.addNodes(event.canvasId, event.parentId, event.nodes)
      } else if (event.type === 'card' && event.card.type === 'canvas' && building.has(event.card.canvasId)) {
        // Built and saved: load the saved canvas (editable) in place of the live one.
        building.delete(event.card.canvasId)
        await qc.invalidateQueries({ queryKey: ['canvases'] })
        live.finish(event.card.canvasId)
        update((turn) => applyEvent(turn, event))
      } else if (event.type === 'navigate') {
        useTurnStore.getState().setNav({ sessionId, to: event.to })
        if (event.to.tab === 'canvas') qc.invalidateQueries({ queryKey: ['canvases', 'list'] })
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
    if (storiesSeen.size) {
      // The saved story now carries the notes: reload it, then drop the live copy.
      await qc.invalidateQueries({ queryKey: ['stories'] })
      storiesSeen.forEach((id) => {
        stories.finish(id)
        stories.drop(id)
      })
    }
    if (building.size) {
      // Cut off mid-build: the server removes a half-built canvas, so drop the live one too.
      building.forEach((id) => live.finish(id))
      qc.invalidateQueries({ queryKey: ['canvases'] })
    }
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
