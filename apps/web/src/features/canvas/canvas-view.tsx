import { ChevronDown, ChevronRight, ExternalLink, Minus, Pencil, Plus, StickyNote, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CATEGORY_META } from '@/features/assets/components/badges'
import type { EventCategory } from '@/features/assets/api'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CanvasNode } from './api'
import { NODE_H, NODE_W, editNode, hiddenCount, layout } from './tree'

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.25]
const PAD = 24
const REVEAL_STEP_MS = 12 // first paint: nodes appear in reading order
const REVEAL_MAX_MS = 900

const KIND_STYLE: Record<CanvasNode['kind'], string> = {
  asset: 'border-primary bg-primary text-primary-foreground',
  group: 'border-border bg-card font-semibold',
  event: 'border-border bg-card',
  note: 'border-[#f5d48a] bg-[#fff8e6]',
}

function NodeLabel({ node }: { node: CanvasNode }) {
  const tone = node.kind === 'event' && node.category ? CATEGORY_META[node.category as EventCategory]?.tone : undefined
  return (
    <span className="flex min-w-0 items-center gap-[8px]">
      {tone && <span aria-hidden="true" className={cn('h-[28px] w-[4px] shrink-0 rounded-full', tone)} />}
      <span className="min-w-0">
        <span className="line-clamp-2 text-[12.5px] leading-[16px]">{node.label}</span>
        {node.kind === 'event' && node.date && (
          <span className="block font-mono text-[10.5px] leading-[16px] text-muted-foreground">
            {formatDate(node.date)}
            {node.upcoming && ' · upcoming'}
            {node.stale && ' · no longer in the data'}
          </span>
        )}
      </span>
    </span>
  )
}

/**
 * The journey tree drawn left to right (layout: tree.ts), editable: select a node, then rename it, attach a note,
 * delete it, or fold its branch. Pan by scrolling; zoom with the buttons. Changes go to `onChange` (the page saves).
 * Nodes fade in as they appear (a live build, a refresh); `highlight` marks new ones; `readOnly` while building.
 */
export function CanvasView({
  tree,
  onChange,
  onOpenSource,
  highlight,
  readOnly = false,
}: {
  tree: CanvasNode
  onChange: (tree: CanvasNode) => void
  onOpenSource: (source: NonNullable<CanvasNode['source']>) => void
  highlight?: ReadonlySet<string>
  readOnly?: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(3)
  const { placed, width, height } = useMemo(() => layout(tree), [tree])
  const at = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed])
  const selected = selectedId ? at.get(selectedId)?.node : undefined
  const scale = ZOOMS[zoom]!
  const scroller = useRef<HTMLDivElement>(null)
  // Nodes on the first paint cascade in; nodes that arrive later (streamed branches, refreshes) fade in at once.
  const firstPaint = useRef(true)
  useEffect(() => {
    firstPaint.current = false
    // Open on the root: it sits halfway down a tall tree.
    const root = placed[0]
    const el = scroller.current
    if (root && el) el.scrollTop = Math.max(0, (root.y + NODE_H / 2) * scale + PAD - el.clientHeight / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [])

  const edit = (id: string, change: (n: CanvasNode) => CanvasNode | null) => onChange(editNode(tree, id, change))
  const rename = (id: string, label: string) => {
    setEditingId(null)
    const text = label.trim().slice(0, 300)
    if (text) edit(id, (n) => (n.label === text ? n : { ...n, label: text }))
  }
  const addNote = (parent: CanvasNode) => {
    const id = crypto.randomUUID()
    edit(parent.id, (n) => ({ ...n, collapsed: undefined, children: [...n.children, { id, kind: 'note', label: 'New note', children: [] }] }))
    setSelectedId(id)
    setEditingId(id)
  }

  return (
    <div className="overflow-hidden rounded-[14px] border bg-card shadow-panel">
      <div role="toolbar" aria-label="Canvas tools" className="flex flex-wrap items-center gap-[8px] border-b border-hair px-[16px] py-[10px]">
        <Button variant="outline" size="sm" disabled={!selected || readOnly} onClick={() => selected && setEditingId(selected.id)}>
          <Pencil /> Rename
        </Button>
        <Button variant="outline" size="sm" disabled={!selected || readOnly} onClick={() => selected && addNote(selected)}>
          <StickyNote /> Add note
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selected || selected.kind === 'asset' || readOnly}
          onClick={() => {
            if (selected) edit(selected.id, () => null)
            setSelectedId(null)
          }}
        >
          <Trash2 /> Delete
        </Button>
        <Button variant="outline" size="sm" disabled={!selected?.source} onClick={() => selected?.source && onOpenSource(selected.source)}>
          <ExternalLink /> Open source
        </Button>
        <span className="mx-[4px] min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
          {selected ? selected.label : 'Select a node to edit it. Double-click to rename.'}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>
          <Minus />
        </Button>
        <span className="w-[40px] text-center font-mono text-[12px] text-muted-foreground">{Math.round(scale * 100)}%</span>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)}>
          <Plus />
        </Button>
      </div>
      <div ref={scroller} className="overflow-auto bg-background" style={{ height: 'min(68vh, 760px)' }}>
        <div style={{ width: width * scale + PAD * 2, height: height * scale + PAD * 2, padding: PAD }}>
          <div className="relative origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
            <svg aria-hidden="true" width={width} height={height} className="pointer-events-none absolute inset-0">
              {placed.map((p, i) => {
                const parent = p.parentId ? at.get(p.parentId) : undefined
                if (!parent) return null
                const x1 = parent.x + NODE_W
                const y1 = parent.y + NODE_H / 2
                const y2 = p.y + NODE_H / 2
                const mid = (x1 + p.x) / 2
                return (
                  <path
                    key={p.node.id}
                    d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${p.x},${y2}`}
                    fill="none"
                    stroke="#d0d5dd"
                    strokeWidth={1.5}
                    className="duration-500 animate-in fade-in fill-mode-both"
                    style={{ animationDelay: firstPaint.current ? `${Math.min(i * REVEAL_STEP_MS, REVEAL_MAX_MS)}ms` : undefined }}
                  />
                )
              })}
            </svg>
            {placed.map(({ node, x, y }, i) => (
              <div
                key={node.id}
                className="absolute flex items-center duration-500 animate-in fade-in fill-mode-both slide-in-from-left-2"
                style={{ left: x, top: y, width: NODE_W, height: NODE_H, animationDelay: firstPaint.current ? `${Math.min(i * REVEAL_STEP_MS, REVEAL_MAX_MS)}ms` : undefined }}
              >
                {editingId === node.id ? (
                  <input
                    autoFocus
                    aria-label="Node label"
                    defaultValue={node.label}
                    maxLength={300}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => rename(node.id, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="h-full w-full rounded-[10px] border-2 border-primary bg-card px-[10px] text-[12.5px] outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    aria-pressed={selectedId === node.id}
                    onClick={() => setSelectedId(node.id)}
                    onDoubleClick={() => !readOnly && setEditingId(node.id)}
                    title={node.label}
                    className={cn(
                      'h-full w-full rounded-[10px] border px-[10px] text-left shadow-panel outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                      KIND_STYLE[node.kind],
                      node.children.length > 0 && 'pr-[36px]',
                      node.stale && 'border-dashed bg-muted/60 text-muted-foreground',
                      highlight?.has(node.id) && 'ring-2 ring-success ring-offset-1',
                      selectedId === node.id && 'ring-2 ring-primary ring-offset-1',
                    )}
                  >
                    <NodeLabel node={node} />
                  </button>
                )}
                {highlight?.has(node.id) && (
                  <span className="absolute -top-[8px] left-[8px] rounded-full bg-success px-[6px] text-[10px] leading-[16px] font-semibold text-white">New</span>
                )}
                {node.children.length > 0 && editingId !== node.id && (
                  <button
                    type="button"
                    aria-expanded={!node.collapsed}
                    aria-label={node.collapsed ? `Expand ${node.label}` : `Collapse ${node.label}`}
                    disabled={readOnly}
                    onClick={() => edit(node.id, (n) => ({ ...n, collapsed: n.collapsed ? undefined : true }))}
                    className="absolute right-[6px] flex h-[24px] min-w-[24px] items-center justify-center gap-[2px] rounded-[6px] border bg-card px-[4px] text-[10.5px] font-semibold text-text-secondary hover:bg-accent"
                  >
                    {node.collapsed ? (
                      <>
                        {hiddenCount(node)}
                        <ChevronRight className="size-[12px]" />
                      </>
                    ) : (
                      <ChevronDown className="size-[12px]" />
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
