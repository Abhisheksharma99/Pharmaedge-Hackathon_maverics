import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { toQueryString } from '@/features/assets/api'

/** One node of a journey canvas (API: apps/api/src/chat/canvas.ts). */
export interface CanvasNode {
  id: string
  kind: 'asset' | 'group' | 'event' | 'note'
  label: string
  note?: string
  date?: string
  category?: string
  significance?: string
  upcoming?: boolean
  collapsed?: boolean
  /** An event no longer in the stored data: kept for the user to review. */
  stale?: boolean
  eventId?: string
  source?: { collection: string; record_key: string }
  children: CanvasNode[]
}

export interface Canvas {
  id: string
  assetId: string
  title: string
  tree: CanvasNode
  /** Sent back on save; a stale version is refused (409) instead of overwriting newer edits. */
  version: number
  /** building while Asset AI streams its branches in. */
  status: 'building' | 'ready'
  updatedAt: string
}

/** Result of merging the latest journey events into a canvas (edits kept). */
export interface CanvasRefresh {
  canvas: Canvas
  /** Ids of the nodes that are new. */
  added: string[]
  /** Events no longer in the data, in the review group. */
  stale: number
  changed: boolean
}

export type CanvasSummary = Pick<Canvas, 'id' | 'assetId' | 'title' | 'version' | 'updatedAt'>

const listKey = (assetId: string) => ['canvases', 'list', assetId] as const
const canvasKey = (id: string) => ['canvases', 'one', id] as const

export function useCanvases(assetId: string) {
  return useQuery({ queryKey: listKey(assetId), queryFn: () => apiFetch<CanvasSummary[]>(`/canvases${toQueryString({ asset: assetId })}`) })
}

export function useCanvas(id: string | null) {
  return useQuery({
    queryKey: canvasKey(id ?? ''),
    queryFn: () => apiFetch<Canvas>(`/canvases/${encodeURIComponent(id!)}`),
    enabled: id !== null,
    // Opened while Asset AI builds it in another tab or window: check until it is ready.
    refetchInterval: (q) => (q.state.data?.status === 'building' ? 1500 : false),
  })
}

export function useRefreshCanvas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: Pick<Canvas, 'id' | 'version'>) =>
      apiFetch<CanvasRefresh>(`/canvases/${encodeURIComponent(c.id)}/refresh`, { method: 'POST', body: { version: c.version } }),
    onSuccess: ({ canvas, changed }) => {
      if (!changed) return
      qc.setQueryData(canvasKey(canvas.id), canvas)
      qc.invalidateQueries({ queryKey: listKey(canvas.assetId) })
    },
  })
}

export function useSaveCanvas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: Pick<Canvas, 'id' | 'title' | 'tree' | 'version'>) =>
      apiFetch<Canvas>(`/canvases/${encodeURIComponent(c.id)}`, { method: 'PUT', body: { title: c.title, tree: c.tree, version: c.version } }),
    onSuccess: (saved) => {
      qc.setQueryData(canvasKey(saved.id), saved)
      qc.invalidateQueries({ queryKey: listKey(saved.assetId) })
    },
  })
}

export function useDeleteCanvas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/canvases/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: canvasKey(id) })
      qc.invalidateQueries({ queryKey: ['canvases', 'list'] })
    },
  })
}
