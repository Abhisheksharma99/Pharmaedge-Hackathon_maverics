import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { findScroller, viewportTop } from '@/lib/scroll'
import { useElementWidth } from '@/lib/use-element-width'
import { spanOf, type BranchModel } from '../journey-model'
import { estimateRowHeight, rowTops, treeCardWidth, treeGeometry } from './tree-geometry'
import type { TreeRow } from './tree-rows'

/** jsdom and the first frame have no width yet: lay out as a wide flow. */
const FALLBACK_WIDTH = 1200

/**
 * Row heights (measured for rendered rows, estimated for the rest) → row tops → geometry. Measured heights are kept
 * per width and refreshed by one ResizeObserver, so subtree toggles and wrapping re-flow the lanes (PHASE_DETAILS §4).
 * When a row above the viewport turns out taller or shorter than estimated, the scroller is moved by the difference
 * (a manual scroll anchor), so scrolling up never makes the content jump.
 */
export function useTreeLayout(flowRef: RefObject<HTMLDivElement | null>, rows: TreeRow[], model: BranchModel, newestFirst = false) {
  const W = useElementWidth(flowRef) || FALLBACK_WIDTH
  const [measured, setMeasured] = useState<{
    w: number
    h: Map<string, number>
  }>({ w: W, h: new Map() })
  const sizes = measured.w === W ? measured.h : null
  const widthRef = useRef(W)
  useLayoutEffect(() => {
    widthRef.current = W
  }, [W])
  const observer = useRef<ResizeObserver | null>(null)
  const nodes = useRef(new Map<string, HTMLElement>())
  /** Heights the layout currently uses, by row index, and the index of each key (for the anchor's old height). */
  const heightsRef = useRef<number[]>([])
  const indexRef = useRef(new Map<string, number>())
  const measuredRef = useRef(measured)
  useLayoutEffect(() => {
    measuredRef.current = measured
  }, [measured])

  // A new width reflows every row: re-observing makes the ResizeObserver report each rendered row afresh.
  useLayoutEffect(() => {
    const ro = observer.current
    if (!ro) return
    nodes.current.forEach((el) => {
      ro.unobserve(el)
      ro.observe(el)
    })
  }, [W])

  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>())
  /** Stable ref callback per row key, so re-renders don't unobserve and re-observe every row. */
  const register = useCallback(
    (key: string) => {
      let cb = refs.current.get(key)
      if (!cb) {
        cb = (el: HTMLElement | null) => {
          const ro = (observer.current ??=
            typeof ResizeObserver === 'undefined'
              ? null
              : new ResizeObserver((entries) => {
                  const w = widthRef.current
                  const prev = measuredRef.current
                  const h = new Map(prev.w === w ? prev.h : [])
                  let changed = prev.w !== w
                  let shift = 0
                  const flow = flowRef.current
                  const sc = flow ? findScroller(flow) : null
                  const top = sc ? viewportTop(sc) : 0
                  for (const entry of entries) {
                    const k = (entry.target as HTMLElement).dataset.row
                    const height = (entry.target as HTMLElement).offsetHeight
                    if (!k || height <= 0 || Math.abs((h.get(k) ?? 0) - height) <= 0.5) continue
                    const old = h.get(k) ?? heightsRef.current[indexRef.current.get(k) ?? -1] ?? height
                    h.set(k, height)
                    changed = true
                    // A row that ended above the viewport pushes everything below it: compensate.
                    if (sc && entry.target.getBoundingClientRect().top + old <= top) shift += height - old
                  }
                  if (!changed) return
                  const next = { w, h }
                  measuredRef.current = next
                  // Commit the new tops before the scroller moves, so no frame shows one without the other.
                  flushSync(() => setMeasured(next))
                  if (sc && Math.abs(shift) >= 0.5) sc.scrollTop += shift
                }))
          const old = nodes.current.get(key)
          if (old && old !== el) ro?.unobserve(old)
          if (el) {
            nodes.current.set(key, el)
            ro?.observe(el)
          } else nodes.current.delete(key)
        }
        refs.current.set(key, cb)
      }
      return cb
    },
    [flowRef],
  )

  const layout = useMemo(() => {
    const cardW = treeCardWidth(W, model)
    const heights = rows.map((r) => sizes?.get(r.key) ?? estimateRowHeight(r, cardW))
    const indexOf = new Map(rows.map((r, i) => [r.key, i]))
    const { tops, H } = rowTops(heights)
    const geo = treeGeometry({
      W,
      rows,
      tops,
      heights,
      H,
      model,
      spanOf: (e) => spanOf(e, model),
      newestFirst,
    })
    return { W, heights, tops, H, geo, register, sizes, indexOf }
  }, [W, rows, sizes, model, register, newestFirst])
  useLayoutEffect(() => {
    heightsRef.current = layout.heights
    indexRef.current = layout.indexOf
  }, [layout])
  return layout
}
