import { memo, type Ref } from 'react'
import { cn } from '@/lib/utils'
import type { BranchModel } from '../journey-model'
import type { TreeGeometry } from './tree-geometry'

const DRAW = 'transition-[stroke-dashoffset,opacity] duration-800 ease-out-soft [stroke-dasharray:1]'
const POP = 'origin-center transition-[scale] duration-500 ease-spring [transform-box:fill-box]'

/**
 * Tree SVG layers (README §6.2): grey lanes, a coloured copy clipped to the scroll probe (the trunk "lights up"),
 * repeated vertical branch labels, fork curves, card connectors, nodes, span bridges, Today line and ⊗ caps.
 * Decorative: the cards carry the same information in the DOM.
 */
export const TreeSvg = memo(function TreeSvg({
  geo,
  model,
  activeId,
  revealed,
  revealAll,
  focusBranch,
  clipId,
  clipRef,
  yFrom,
  yTo,
}: {
  geo: TreeGeometry
  model: BranchModel
  activeId: string | null
  revealed: ReadonlySet<string>
  revealAll: boolean
  focusBranch: string | null
  clipId: string
  clipRef: Ref<SVGRectElement>
  /** Rendered window: only nodes, forks and caps with y inside are drawn (lanes stay full-length). */
  yFrom: number
  yTo: number
}) {
  const isRevealed = (k: string) => revealAll || revealed.has(k)
  const inView = (y: number) => y >= yFrom && y <= yTo
  // Nodes are in row order, so y ascends: slice the window by binary search.
  const bound = (y: number, right: boolean) => {
    let lo = 0
    let hi = geo.nodes.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (right ? geo.nodes[mid]!.y <= y : geo.nodes[mid]!.y < y) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const nodes = geo.nodes.slice(bound(yFrom, false), bound(yTo, true))
  const dim = (id: string) => focusBranch !== null && focusBranch !== id && 'opacity-[0.18]'
  // Newest first (d = −1) time runs up: forks curve in from below, "beyond today" and tails are above.
  const d = geo.dir
  return (
    <svg aria-hidden="true" width={geo.W} height={geo.H} className="pointer-events-none absolute top-0 left-0 z-[1] overflow-visible">
      <defs>
        <clipPath id={clipId}>
          <rect ref={clipRef} x={0} y={0} width={geo.W} height={0} />
        </clipPath>
      </defs>
      {[false, true].map((lit) => (
        <g key={String(lit)} clipPath={lit ? `url(#${clipId})` : undefined} opacity={lit ? 0.9 : 1}>
          {geo.lanes.map((l) => {
            const c = lit ? l.color : '#e4e7ec'
            const solidEnd = geo.yToday !== null && !l.ended ? d * Math.min(d * l.y2, d * geo.yToday) : l.y2
            const top = Math.min(l.y1, l.y2)
            const labels = lit && model.multi && l.label ? Array.from({ length: Math.max(0, Math.floor((Math.abs(l.y2 - l.y1) - 260) / 620)) }, (_, k) => top + 300 + k * 620) : []
            return (
              <g key={l.id} data-lane={lit ? l.id : undefined} className={cn('transition-opacity duration-300', dim(l.id))}>
                {labels.map((y) => (
                  <text key={y} transform={`translate(${l.x + (geo.narrow ? 4 : 7)},${y}) rotate(90)`} fill={l.color} className="text-[10px] font-bold tracking-[0.08em] uppercase opacity-85">
                    {l.label}
                  </text>
                ))}
                {l.px !== null && <path d={`M${l.px},${l.fy - 58 * d} C${l.px},${l.fy - 26 * d} ${l.x},${l.fy - 34 * d} ${l.x},${l.fy - 6 * d}`} stroke={c} strokeWidth={3} strokeLinecap="round" fill="none" />}
                <line x1={l.x} x2={l.x} y1={l.px !== null ? l.fy - 6 * d : l.y1} y2={solidEnd} stroke={c} strokeWidth={l.trunk ? 4 : 3} strokeLinecap="round" />
                {geo.yToday !== null && !l.ended && d * l.y2 > d * geo.yToday && <line x1={l.x} x2={l.x} y1={geo.yToday} y2={l.y2} stroke={c} strokeWidth={l.trunk ? 4 : 3} strokeLinecap="round" strokeDasharray="6 7" />}
                {l.tailY !== null && <line data-tail={lit ? '' : undefined} x1={l.x} x2={l.x} y1={l.y2 + 8 * d} y2={l.tailY} stroke={c} strokeWidth={1.5} strokeDasharray="2 5" opacity={0.5} />}
              </g>
            )
          })}
        </g>
      ))}
      {geo.yToday !== null && <line x1={geo.xMin - 18} x2={geo.xMax + 18} y1={geo.yToday} y2={geo.yToday} stroke="#101828" strokeDasharray="3 3" />}
      {geo.lanes
        .filter((l) => l.px !== null && inView(l.fy))
        .map((l) => (
          <g key={`f${l.id}`} className={cn('transition-opacity duration-300', dim(l.id))}>
            <path d={`M${l.x},${l.fy} L${l.fx2},${l.fy}`} pathLength={1} stroke={l.color} strokeWidth={2} fill="none" className={cn(DRAW, 'delay-150', isRevealed(`f${l.id}`) ? '[stroke-dashoffset:0]' : '[stroke-dashoffset:1]')} />
            <circle cx={l.x} cy={l.fy} r={5} fill="#fff" stroke={l.color} strokeWidth={2.5} className={cn(POP, isRevealed(`f${l.id}`) ? 'scale-100' : 'scale-0')} />
          </g>
        ))}
      {geo.lanes
        .filter((l) => l.ended && inView(l.y2))
        .map((l) => (
          // The cap scales in an inner <g>, so the CSS transform never fights the SVG translate (PHASE_DETAILS pitfall).
          <g key={`x${l.id}`} data-cap={l.id} transform={`translate(${l.x},${l.y2})`}>
            <g className={cn(POP, isRevealed(`x${l.id}`) ? 'scale-100' : 'scale-0')}>
              <circle r={8} fill="#fff" stroke={l.color} strokeWidth={2} />
              <path d="M-3.2,-3.2 L3.2,3.2 M3.2,-3.2 L-3.2,3.2" stroke={l.color} strokeWidth={2} strokeLinecap="round" fill="none" />
            </g>
          </g>
        ))}
      {nodes.map((n) => {
        const c = model.byId.get(n.lane)?.color ?? 'var(--primary)'
        const on = activeId === n.k
        const rv = isRevealed(n.k)
        return (
          <g key={n.k} data-node={n.k} className={cn('transition-opacity duration-300', dim(n.lane))}>
            <path d={`M${n.x},${n.y} L${n.x2},${n.y}`} pathLength={1} stroke={c} strokeWidth={on ? 2.25 : 1.75} strokeLinecap="round" fill="none" opacity={on ? 1 : 0.5} className={cn(DRAW, 'delay-100', rv ? '[stroke-dashoffset:0]' : '[stroke-dashoffset:1]')} />
            {n.span.length > 0 && <line x1={Math.min(n.x, ...n.span)} x2={Math.max(n.x, ...n.span)} y1={n.y} y2={n.y} stroke={c} strokeWidth={2} strokeDasharray="2 3" opacity={rv ? 0.75 : 0} className="transition-opacity delay-400 duration-500" />}
            {n.span.filter((x) => x !== n.x).map((x) => (
              <circle key={x} cx={x} cy={n.y} r={3.5} fill="#fff" stroke={c} strokeWidth={2} className={cn(POP, rv ? 'scale-100' : 'scale-0')} />
            ))}
            <circle
              cx={n.x}
              cy={n.y}
              r={on ? 8 : n.hi ? 6.5 : 5}
              fill={n.up || n.note ? '#fff' : c}
              stroke={n.note ?? (n.up ? c : '#fff')}
              strokeWidth={2.5}
              strokeDasharray={n.up ? '2.5 2' : undefined}
              className={cn(POP, 'transition-[scale,r] duration-[500ms,250ms]', rv ? 'scale-100' : 'scale-0')}
            />
            <circle cx={n.x2} cy={n.y} r={2.5} fill={c} className={cn(POP, 'delay-600', rv ? 'scale-100' : 'scale-0')} />
          </g>
        )
      })}
    </svg>
  )
})
