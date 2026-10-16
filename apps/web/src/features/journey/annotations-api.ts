import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ME_KEY, type User } from '@/features/auth/use-auth'
import { apiFetch } from '@/lib/api'
import type { Annotations, EventCategory, EventComment, JourneyEventV3, NoteTag, SourceRef } from './types'

const enc = encodeURIComponent
let tempSeq = 0
export const annotationsKey = (assetId: string) => ['asset', assetId, 'annotations'] as const

/** Stars (yours), comments and notes (the team's) on an asset's journey (DATA_CONTRACTS §B.3). */
export function useAnnotations(assetId: string) {
  return useQuery({
    queryKey: annotationsKey(assetId),
    queryFn: () => apiFetch<Annotations>(`/assets/${enc(assetId)}/annotations`),
    staleTime: 30_000,
  })
}

/** Star or unstar an event: the star flips at once and flips back with a toast if the server refuses. */
export function useToggleStar(assetId: string) {
  const qc = useQueryClient()
  const key = annotationsKey(assetId)
  return useMutation({
    mutationFn: ({ eventId, on }: { eventId: string; on: boolean }) =>
      apiFetch<void>(`/assets/${enc(assetId)}/events/${enc(eventId)}/star`, { method: on ? 'PUT' : 'DELETE' }),
    onMutate: async ({ eventId, on }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Annotations>(key)
      if (prev) {
        const stars = on ? [...new Set([...prev.stars, eventId])] : prev.stars.filter((s) => s !== eventId)
        qc.setQueryData<Annotations>(key, { ...prev, stars })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      toast.error("The star couldn't be saved.")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

/** Post a team comment: it shows at once (as you) and is removed again with a toast if the post fails. */
export function useAddComment(assetId: string) {
  const qc = useQueryClient()
  const key = annotationsKey(assetId)
  return useMutation({
    mutationFn: ({ eventId, text }: { eventId: string; text: string }) =>
      apiFetch<EventComment>(`/assets/${enc(assetId)}/events/${enc(eventId)}/comments`, { method: 'POST', body: { text } }),
    onMutate: async ({ eventId, text }) => {
      await qc.cancelQueries({ queryKey: key })
      // Not cached yet (a comment typed before the annotations arrived): load them so the comment can show at once.
      const prev = qc.getQueryData<Annotations>(key) ?? (await qc.ensureQueryData({ queryKey: key, queryFn: () => apiFetch<Annotations>(`/assets/${enc(assetId)}/annotations`) }).catch(() => undefined))
      const me = qc.getQueryData<User | null>(ME_KEY)
      const temp: EventComment = { id: `temp:${++tempSeq}`, by: { id: me?.id ?? '', name: me?.name ?? 'You' }, at: new Date().toISOString(), text }
      if (prev) qc.setQueryData<Annotations>(key, { ...prev, comments: { ...prev.comments, [eventId]: [...(prev.comments[eventId] ?? []), temp] } })
      return { prev, temp }
    },
    onSuccess: (saved, { eventId }, ctx) => {
      qc.setQueryData<Annotations>(key, (old) =>
        old && { ...old, comments: { ...old.comments, [eventId]: (old.comments[eventId] ?? []).map((c) => (c.id === ctx.temp.id ? saved : c)) } },
      )
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      toast.error("The comment couldn't be posted.")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

export interface NewNote {
  date: string
  branch: string
  category: EventCategory
  tag: NoteTag
  title: string
  text: string
  mode: 'manual' | 'ai'
  sources?: SourceRef[]
}

interface TimelineCache {
  events: JourneyEventV3[]
  total: number
}

const timelineKey = (assetId: string) => ['asset', assetId, 'timeline-v3'] as const

/** Newest first, as the API sends the timeline. */
const insertByDate = (events: JourneyEventV3[], note: JourneyEventV3) => {
  const at = events.findIndex((e) => e.date <= note.date)
  return at < 0 ? [...events, note] : [...events.slice(0, at), note, ...events.slice(at)]
}

/**
 * Add a team note: it shows at once in the annotations and in every cached journey timeline, is swapped for the saved
 * note when the POST returns, and is taken out again with a toast if the POST fails (DATA_CONTRACTS §B.3).
 */
export function useAddNote(assetId: string) {
  const qc = useQueryClient()
  const key = annotationsKey(assetId)
  return useMutation({
    mutationFn: (note: NewNote) => apiFetch<JourneyEventV3>(`/assets/${enc(assetId)}/notes`, { method: 'POST', body: note }),
    onMutate: async (note) => {
      await Promise.all([qc.cancelQueries({ queryKey: key }), qc.cancelQueries({ queryKey: timelineKey(assetId) })])
      const me = qc.getQueryData<User | null>(ME_KEY)
      const temp: JourneyEventV3 = {
        id: `temp:${Date.now()}`,
        asset: assetId,
        date: note.date,
        type: 'user_note',
        category: note.category,
        title: note.title,
        summary: note.text,
        significance: note.tag === 'Important' || note.tag === 'Risk' ? 'High' : 'Medium',
        is_milestone: false,
        sources: note.sources ?? [],
        via: 'user',
        branch: note.branch,
        user: { tag: note.tag, by: { id: me?.id ?? '', name: me?.name ?? 'You' }, created_at: new Date().toISOString(), mode: note.mode },
      }
      qc.setQueryData<Annotations>(key, (old) => old && { ...old, notes: [...old.notes, temp] })
      qc.setQueriesData<TimelineCache>(
        { queryKey: timelineKey(assetId) },
        (old) => old?.events && { events: insertByDate(old.events, temp), total: old.total + 1 },
      )
      return { temp }
    },
    onSuccess: (saved, _note, ctx) => {
      const swap = (events: JourneyEventV3[]) => events.map((e) => (e.id === ctx.temp.id ? saved : e))
      qc.setQueryData<Annotations>(key, (old) => old && { ...old, notes: swap(old.notes) })
      qc.setQueriesData<TimelineCache>({ queryKey: timelineKey(assetId) }, (old) => old?.events && { ...old, events: swap(old.events) })
    },
    onError: (_err, _note, ctx) => {
      // Remove only the temp note: other cache changes made while the POST was in flight stay.
      if (ctx) {
        const drop = (events: JourneyEventV3[]) => events.filter((e) => e.id !== ctx.temp.id)
        qc.setQueryData<Annotations>(key, (old) => old && { ...old, notes: drop(old.notes) })
        qc.setQueriesData<TimelineCache>(
          { queryKey: timelineKey(assetId) },
          (old) => old?.events && { events: drop(old.events), total: old.total - 1 },
        )
      }
      toast.error("The note couldn't be saved.")
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: timelineKey(assetId) })]),
  })
}

/** The fields of a team note that can change after it was added (DATA_CONTRACTS §B.3, PATCH /notes/:id). */
export type NotePatch = Partial<Pick<NewNote, 'date' | 'branch' | 'category' | 'tag' | 'title' | 'text'>>

interface EventDetailCache {
  event: JourneyEventV3
}

const eventKey = (assetId: string, id: string) => ['asset', assetId, 'event', id] as const

/** Puts `apply` through every cached copy of the asset's notes: annotations, journey timelines and the open event. */
function rewriteNote(qc: QueryClient, assetId: string, id: string, apply: (events: JourneyEventV3[]) => JourneyEventV3[]) {
  qc.setQueryData<Annotations>(annotationsKey(assetId), (old) => old && { ...old, notes: apply(old.notes) })
  qc.setQueriesData<TimelineCache>({ queryKey: timelineKey(assetId) }, (old) => {
    if (!old?.events) return old
    const events = apply(old.events)
    return { events, total: old.total + events.length - old.events.length }
  })
  qc.setQueryData<EventDetailCache>(eventKey(assetId, id), (old) => {
    if (!old) return old
    const [event] = apply([old.event])
    return event ? { ...old, event } : old
  })
}

/** Refetch what a note change touches: the annotations, the timelines and the events (their neighbours move with it). */
const refetchNotes = (qc: QueryClient, assetId: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: annotationsKey(assetId) }),
    qc.invalidateQueries({ queryKey: timelineKey(assetId) }),
    qc.invalidateQueries({ queryKey: ['asset', assetId, 'event'] }),
  ])

/**
 * Edit a team note (its author or an admin): the change shows at once everywhere the note is cached, the saved note
 * replaces it when the PATCH returns, and a failed PATCH puts the old note back with a toast.
 */
export function useUpdateNote(assetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NotePatch }) =>
      apiFetch<JourneyEventV3>(`/assets/${enc(assetId)}/notes/${enc(id)}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await Promise.all([qc.cancelQueries({ queryKey: annotationsKey(assetId) }), qc.cancelQueries({ queryKey: timelineKey(assetId) })])
      const before = qc.getQueryData<Annotations>(annotationsKey(assetId))?.notes.find((n) => n.id === id) ?? qc.getQueryData<EventDetailCache>(eventKey(assetId, id))?.event
      const edit = (e: JourneyEventV3): JourneyEventV3 => ({
        ...e,
        ...(patch.date !== undefined && { date: patch.date }),
        ...(patch.branch !== undefined && { branch: patch.branch }),
        ...(patch.category !== undefined && { category: patch.category }),
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.text !== undefined && { summary: patch.text }),
        ...(patch.tag !== undefined && e.user && { user: { ...e.user, tag: patch.tag } }),
      })
      rewriteNote(qc, assetId, id, (events) => events.map((e) => (e.id === id ? edit(e) : e)))
      return { before }
    },
    onSuccess: (saved, { id }) => rewriteNote(qc, assetId, id, (events) => events.map((e) => (e.id === id ? saved : e))),
    onError: (_err, { id }, ctx) => {
      const before = ctx?.before
      if (before) rewriteNote(qc, assetId, id, (events) => events.map((e) => (e.id === id ? before : e)))
      toast.error("The note couldn't be saved.")
    },
    onSettled: () => refetchNotes(qc, assetId),
  })
}

/**
 * Delete a team note (its author or an admin), with its stars and comments: it leaves every cached list at once and
 * comes back with a toast if the server refuses.
 */
export function useDeleteNote(assetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/assets/${enc(assetId)}/notes/${enc(id)}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await Promise.all([qc.cancelQueries({ queryKey: annotationsKey(assetId) }), qc.cancelQueries({ queryKey: timelineKey(assetId) })])
      const annotations = qc.getQueryData<Annotations>(annotationsKey(assetId))
      const timelines = qc.getQueriesData<TimelineCache>({ queryKey: timelineKey(assetId) })
      qc.setQueryData<Annotations>(annotationsKey(assetId), (old) => old && { ...old, notes: old.notes.filter((n) => n.id !== id) })
      qc.setQueriesData<TimelineCache>({ queryKey: timelineKey(assetId) }, (old) => {
        if (!old?.events) return old
        const events = old.events.filter((e) => e.id !== id)
        return { events, total: old.total - (old.events.length - events.length) }
      })
      return { annotations, timelines }
    },
    onSuccess: (_void, id) => qc.removeQueries({ queryKey: eventKey(assetId, id) }),
    onError: (_err, _id, ctx) => {
      if (ctx?.annotations) qc.setQueryData(annotationsKey(assetId), ctx.annotations)
      for (const [key, data] of ctx?.timelines ?? []) qc.setQueryData(key, data)
      toast.error("The note couldn't be deleted.")
    },
    onSettled: () => refetchNotes(qc, assetId),
  })
}

export interface FindNoteInput {
  title: string
  text: string
  date?: string
  branch?: string
}

/** What Asset AI found for a note: a new event (`found`), one already on the journey (`exists`) or nothing (`none`). */
export interface FindNoteResult {
  kind: 'found' | 'exists' | 'none'
  event?: JourneyEventV3
  note: string
}

/** Ask Asset AI to find the dated event a note describes (DATA_CONTRACTS §B.3). */
export function useFindNote(assetId: string) {
  return useMutation({
    mutationFn: (input: FindNoteInput) => apiFetch<FindNoteResult>(`/assets/${enc(assetId)}/notes/find`, { method: 'POST', body: input }),
  })
}
