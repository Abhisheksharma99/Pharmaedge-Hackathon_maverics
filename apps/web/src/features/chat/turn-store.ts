import { create } from 'zustand'
import type { Card, StreamEvent } from './api'

export interface ToolActivity {
  id: string
  label: string
  /** Set when the tool returned, e.g. "8 passages". */
  summary: string | null
}

/** A question being answered: what has streamed in so far. */
export interface Turn {
  userText: string
  tools: ToolActivity[]
  text: string
  cards: Card[]
  status: 'streaming' | 'error' | 'stopped'
  error: string | null
  controller: AbortController
}

/** Fold one stream event into the turn (answer/done are handled by the sender). */
export function applyEvent(turn: Turn, event: StreamEvent): Turn {
  switch (event.type) {
    case 'tool_call':
      return { ...turn, tools: [...turn.tools, { id: event.id, label: event.label, summary: null }] }
    case 'tool_result':
      return {
        ...turn,
        tools: turn.tools.map((t) => (t.id === event.id ? { ...t, summary: event.summary } : t)),
      }
    case 'card':
      return { ...turn, cards: [...turn.cards, event.card] }
    case 'token':
      return { ...turn, text: turn.text + event.text }
    case 'error':
      return { ...turn, status: 'error', error: event.message }
    default:
      return turn
  }
}

interface TurnState {
  /** In-flight (or failed / stopped) turn per chat session. */
  turns: Record<string, Turn>
  start: (sessionId: string, userText: string, controller: AbortController) => void
  update: (sessionId: string, change: (turn: Turn) => Turn) => void
  clear: (sessionId: string) => void
}

export const useTurnStore = create<TurnState>()((set) => ({
  turns: {},
  start: (sessionId, userText, controller) =>
    set((s) => ({
      turns: {
        ...s.turns,
        [sessionId]: { userText, tools: [], text: '', cards: [], status: 'streaming', error: null, controller },
      },
    })),
  update: (sessionId, change) =>
    set((s) => {
      const turn = s.turns[sessionId]
      return turn ? { turns: { ...s.turns, [sessionId]: change(turn) } } : s
    }),
  clear: (sessionId) =>
    set((s) => {
      const { [sessionId]: _, ...rest } = s.turns
      return { turns: rest }
    }),
}))

export const useTurn = (sessionId: string | null) => useTurnStore((s) => (sessionId ? s.turns[sessionId] : undefined))
