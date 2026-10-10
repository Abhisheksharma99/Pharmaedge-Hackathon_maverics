import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './api'
import { NODE_H, NODE_W, countNodes, editNode, hiddenCount, layout } from './tree'

const n = (id: string, children: CanvasNode[] = [], extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, kind: 'group', label: id, children, ...extra })
const tree = n('root', [n('a', [n('a1'), n('a2')]), n('b', [n('b1')], { collapsed: true })])

describe('canvas tree', () => {
  it('lays out columns by depth, stacks leaves and centres parents; collapsed children are not drawn', () => {
    const { placed, width, height } = layout(tree)
    const at = Object.fromEntries(placed.map((p) => [p.node.id, p]))
    expect(placed.map((p) => p.node.id)).toEqual(['root', 'a', 'a1', 'a2', 'b'])
    expect(at.a1!.x).toBe(2 * (at.a!.x - at.root!.x))
    expect(at.a!.y).toBe((at.a1!.y + at.a2!.y) / 2)
    expect(at.b!.y).toBeGreaterThan(at.a2!.y) // b is a leaf while collapsed
    expect(at.root!.y).toBe((at.a!.y + at.b!.y) / 2)
    expect(at.a1!.parentId).toBe('a')
    expect(width).toBe(at.a1!.x + NODE_W)
    expect(height).toBe(at.b!.y + NODE_H)
  })

  it('edits immutably: rename, add, remove a subtree; untouched branches keep their identity; the root stays', () => {
    const renamed = editNode(tree, 'a1', (x) => ({ ...x, label: 'renamed' }))
    expect(renamed.children[0]!.children[0]!.label).toBe('renamed')
    expect(tree.children[0]!.children[0]!.label).toBe('a1')
    expect(renamed.children[1]).toBe(tree.children[1])
    const added = editNode(tree, 'b', (x) => ({ ...x, collapsed: false, children: [...x.children, n('note')] }))
    expect(countNodes(added)).toBe(countNodes(tree) + 1)
    expect(countNodes(editNode(tree, 'a', () => null))).toBe(3)
    expect(editNode(tree, 'root', () => null)).toBe(tree)
    expect(hiddenCount(tree.children[1]!)).toBe(1)
  })
})
