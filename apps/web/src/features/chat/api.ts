import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import {
  toQueryString,
  type AssetSummary,
  type EventCategory,
  type RecordTab,
  type Significance,
} from '@/features/assets/api'
import type { Job } from '@/features/jobs/api'
import type { CanvasNode } from '@/features/canvas/api'
import type { StorySpec } from '@/features/story/api'

export interface ChatSession {
  id: string
  title: string
  assetId: string | null
  createdAt: string
  updatedAt: string
}

export interface Citation {
  n: number
  title: string
  source: string
  date: string
  url?: string
  assetId: string
  assetName: string
  collection: string
  recordKey: string
  /** Asset page record tab that shows the record. */
  tab: RecordTab
}

/** What the resolver found for a new asset; the user confirms (or edits) it. */
export interface Identity {
  id: string
  name: string
  aliases: string[]
  company: { name: string; website?: string; ir_url?: string }
  website_verified: boolean
  ir_verified: boolean
  tags: {
    indications: string[]
    investigational_indications?: string[]
    mechanism?: string
    modality?: string
  }
  /** Records each source returned, e.g. `{ fda: 1, trials: 23 }`. */
  sources: Record<string, number>
  exists: boolean
  existing: { id: string; kind: 'primary' | 'competitor'; status: AssetSummary['status'] } | null
  plan: { name: string; label: string; note: string }[]
  plan_summary: string
  notes: string[]
}

export interface TimelineCardEvent {
  id: string
  assetId: string
  assetName: string
  date: string
  title: string
  category: EventCategory
  significance: Significance
  is_milestone: boolean
  sources: { collection: string; record_key: string }[]
}

export type Card =
  | { type: 'identity'; identity: Identity }
  | { type: 'job'; jobId: string; assetId: string; assetName: string }
  | {
      type: 'comparison'
      title: string
      columns: { id: string; name: string; company: string }[]
      rows: { label: string; values: string[] }[]
    }
  | { type: 'timeline'; title: string; assetId: string; events: TimelineCardEvent[] }
  | { type: 'canvas'; canvasId: string; assetId: string; title: string; nodes: number; groups: { label: string; events: number }[] }
  | { type: 'story'; storyId: string; assetId: string; title: string; events: number; changes: number; checks: number; compare: string | null }

/** A view Asset AI asks the app to open: an asset tab, or a canvas on the canvas tab. */
export interface NavTarget {
  assetId: string
  tab: string
  canvasId?: string
  /** A journey story, shown in the canvas area. */
  storyId?: string
  /** A cited source record to open over the tab. */
  record?: { tab: string; key: string }
}

/** The reader's own thumbs up / down on an answer, with an optional short reason. */
export interface ChatFeedback {
  rating: 'up' | 'down'
  reason: string | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  /** Markdown; cites sources with [n]. */
  content: string
  cards: Card[]
  citations: Citation[]
  followUps: string[]
  createdAt: string
  /** Answers only: the reader's rating, null when not rated. */
  feedback?: ChatFeedback | null
}

/** One line of the NDJSON stream from `POST /chat/sessions/:id/turn`. */
export type StreamEvent =
  | { type: 'tool_call'; id: string; name: string; label: string }
  | { type: 'tool_result'; id: string; name: string; summary: string }
  | { type: 'card'; card: Card }
  | { type: 'navigate'; to: NavTarget }
  | { type: 'canvas_start'; canvasId: string; assetId: string; title: string; tree: CanvasNode }
  | { type: 'canvas_nodes'; canvasId: string; parentId: string; nodes: CanvasNode[] }
  | { type: 'story_start'; storyId: string; assetId: string; title: string; question: string | null; spec: StorySpec }
  | { type: 'story_layer'; storyId: string; layer: string; data: unknown }
  | { type: 'token'; text: string }
  | { type: 'answer'; message: ChatMessage }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' }

/** A source record to show in the record sheet. */
export interface OpenRecord {
  assetId: string
  tab: RecordTab
  recordKey: string
}

export interface CreateAssetBody {
  name: string
  aliases: string[]
  company: { name: string; website?: string; ir_url?: string }
  tags: { indications: string[]; investigational_indications?: string[]; mechanism?: string; modality?: string }
  chatSessionId?: string
}

export const sessionsKey = (assetId?: string) => ['chat', 'sessions', assetId ?? null] as const
export const messagesKey = (sessionId: string) => ['chat', 'messages', sessionId] as const

/** The user's sessions, newest first; `assetId` narrows to one asset's sessions. */
export function useChatSessions(assetId?: string) {
  return useQuery({
    queryKey: sessionsKey(assetId),
    queryFn: () => apiFetch<ChatSession[]>(`/chat/sessions${toQueryString({ asset: assetId })}`),
  })
}

/** Paused (`enabled: false`) while a turn is in flight so the stream and the list never overlap. */
export function useChatMessages(sessionId: string | null, enabled = true) {
  return useQuery({
    queryKey: messagesKey(sessionId ?? ''),
    queryFn: () => apiFetch<ChatMessage[]>(`/chat/sessions/${encodeURIComponent(sessionId!)}/messages`),
    enabled: sessionId !== null && enabled,
  })
}

export function useCreateChatSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assetId?: string) =>
      apiFetch<ChatSession>('/chat/sessions', { method: 'POST', body: assetId ? { assetId } : {} }),
    onSuccess: (session) => {
      // Show it right away (newest first) and start with an empty thread; the refetch confirms.
      const prepend = (old: ChatSession[] | undefined) => old && [session, ...old]
      qc.setQueryData(sessionsKey(), prepend)
      if (session.assetId) qc.setQueryData(sessionsKey(session.assetId), prepend)
      qc.setQueryData(messagesKey(session.id), [])
      qc.invalidateQueries({ queryKey: ['chat', 'sessions'] })
    },
  })
}

export function useDeleteChatSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch<void>(`/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
    onSuccess: (_, sessionId) => {
      qc.removeQueries({ queryKey: messagesKey(sessionId) })
      qc.invalidateQueries({ queryKey: ['chat', 'sessions'] })
    },
  })
}

/** Rename one of the user's chats: the history shows the new title at once and goes back if the server refuses. */
export function useRenameChatSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      apiFetch<ChatSession>(`/chat/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title } }),
    onMutate: async ({ id, title }) => {
      await qc.cancelQueries({ queryKey: ['chat', 'sessions'] })
      const prev = qc.getQueriesData<ChatSession[]>({ queryKey: ['chat', 'sessions'] })
      qc.setQueriesData<ChatSession[]>({ queryKey: ['chat', 'sessions'] }, (old) => old?.map((s) => (s.id === id ? { ...s, title } : s)))
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['chat', 'sessions'] }),
  })
}

/**
 * Rate an answer (one rating per answer: rating again replaces the rating and its reason). The thumb shows as selected at once and goes back
 * if the server refuses.
 */
export function useAnswerFeedback(sessionId: string) {
  const qc = useQueryClient()
  const key = messagesKey(sessionId)
  const put = (turnId: string, feedback: ChatFeedback | null) =>
    qc.setQueryData<ChatMessage[]>(key, (old) => old?.map((m) => (m.id === turnId ? { ...m, feedback } : m)))
  return useMutation({
    mutationFn: ({ turnId, rating, reason }: { turnId: string; rating: ChatFeedback['rating']; reason?: string }) =>
      apiFetch<ChatFeedback>(`/chat/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/feedback`, {
        method: 'POST',
        body: reason ? { rating, reason } : { rating },
      }),
    onMutate: async ({ turnId, rating, reason }) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<ChatMessage[]>(key)?.find((m) => m.id === turnId)?.feedback ?? null
      put(turnId, { rating, reason: reason || null })
      return { before }
    },
    onSuccess: (saved, { turnId }) => put(turnId, saved),
    onError: (_err, { turnId }, ctx) => put(turnId, ctx?.before ?? null),
  })
}

/** Confirm & start crawl: creates the asset and its onboarding job (the API adds a job card to the chat). */
export function useCreateAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateAssetBody) =>
      apiFetch<{ asset: AssetSummary; job: Job }>('/assets', { method: 'POST', body }),
    onSuccess: ({ asset }, body) => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      qc.invalidateQueries({ queryKey: ['asset', asset.id] })
      qc.invalidateQueries({ queryKey: ['jobs'] })
      if (body.chatSessionId) qc.invalidateQueries({ queryKey: messagesKey(body.chatSessionId) })
    },
  })
}
