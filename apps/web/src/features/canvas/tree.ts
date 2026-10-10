import type { CanvasNode } from './api'

/** Box and spacing of the drawn tree (px). */
export const NODE_W = 240
export const NODE_H = 48
const COL_GAP = 72
const ROW_GAP = 14

export interface Placed {
  node: CanvasNode
  x: number
  y: number
  parentId: string | null
}

/**
 * Left-to-right tree layout: a column per depth, leaves stacked in reading order, each parent centred on its
 * visible children. Children of a collapsed node are not placed.
 */
export function layout(root: CanvasNode): { placed: Placed[]; width: number; height: number } {
  const placed: Placed[] = []
  let row = 0
  let depthMax = 0
  const place = (node: CanvasNode, depth: number, parentId: string | null): number => {
    depthMax = Math.max(depthMax, depth)
    const kids = node.collapsed ? [] : node.children
    const item: Placed = { node, x: depth * (NODE_W + COL_GAP), y: 0, parentId }
    placed.push(item)
    if (!kids.length) {
      item.y = row++ * (NODE_H + ROW_GAP)
    } else {
      const ys = kids.map((k) => place(k, depth + 1, node.id))
      item.y = (ys[0]! + ys.at(-1)!) / 2
    }
    return item.y
  }
  place(root, 0, null)
  return { placed, width: depthMax * (NODE_W + COL_GAP) + NODE_W, height: Math.max(1, row) * (NODE_H + ROW_GAP) - ROW_GAP }
}

/** A copy of the tree with `change` applied to node `id` (returning null removes the node and its subtree). */
export function editNode(tree: CanvasNode, id: string, change: (n: CanvasNode) => CanvasNode | null): CanvasNode {
  const walk = (n: CanvasNode): CanvasNode | null => {
    if (n.id === id) return change(n)
    const children = n.children.map(walk).filter((c): c is CanvasNode => c !== null)
    return children.length === n.children.length && children.every((c, i) => c === n.children[i]) ? n : { ...n, children }
  }
  return walk(tree) ?? tree // the root cannot be removed
}

export const countNodes = (n: CanvasNode): number => 1 + n.children.reduce((s, c) => s + countNodes(c), 0)

/** Children hidden under a collapsed node. */
export const hiddenCount = (n: CanvasNode): number => (n.collapsed ? countNodes(n) - 1 : 0)
