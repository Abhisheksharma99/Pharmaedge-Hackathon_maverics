import { create } from 'zustand'
import type { CanvasNode } from './api'

/**
 * Canvases Asset AI is building right now, as their branches stream in (chat events canvas_start / canvas_nodes).
 * The canvas tab draws these until the saved canvas is ready; the turn clears them when it ends.
 */
interface LiveCanvas {
  assetId: string
  title: string
  tree: CanvasNode
}

interface LiveCanvasState {
  live: Record<string, LiveCanvas>
  start: (canvasId: string, canvas: LiveCanvas) => void
  addNodes: (canvasId: string, parentId: string, nodes: CanvasNode[]) => void
  finish: (canvasId: string) => void
}

const addUnder = (n: CanvasNode, parentId: string, nodes: CanvasNode[]): CanvasNode =>
  n.id === parentId ? { ...n, children: [...n.children, ...nodes] } : { ...n, children: n.children.map((c) => addUnder(c, parentId, nodes)) }

export const useLiveCanvases = create<LiveCanvasState>((set) => ({
  live: {},
  start: (canvasId, canvas) => set((s) => ({ live: { ...s.live, [canvasId]: canvas } })),
  addNodes: (canvasId, parentId, nodes) =>
    set((s) => {
      const c = s.live[canvasId]
      return c ? { live: { ...s.live, [canvasId]: { ...c, tree: addUnder(c.tree, parentId, nodes) } } } : s
    }),
  finish: (canvasId) =>
    set((s) => {
      const { [canvasId]: _done, ...rest } = s.live
      return { live: rest }
    }),
}))
