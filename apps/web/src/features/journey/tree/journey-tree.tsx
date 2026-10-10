import { Flag, GitMerge, Pill, Plus, X } from 'lucide-react'
import { memo, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import { formatMonth } from '@/lib/format'
import { formatDay, todayIso } from '@/lib/dates'
import { findScroller, offsetIn, onScroll, scrollToTop, viewportHeight, viewportTop } from '@/lib/scroll'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { BranchChip } from '../chips'
import { isDated, laneOf, type BranchModel } from '../journey-model'
import type { JourneyEventV3 } from '../types'
import type { JourneyViewProps } from '../view-types'
import { treeActiveAt, treeGutters, treeHoverAt, treeWindow, type TreeGeometry, type TreeHover } from './tree-geometry'
import { treeRows, type TreeRow } from './tree-rows'
import { TreeCard } from './tree-card'
import { TreeSvg } from './tree-svg'
import { useTreeLayout } from './use-tree-layout'

export interface JourneyTreeProps extends JourneyViewProps {
  onStar: (id: string) => void
  /** A subtree's linked event: scroll, flash and open it. */
  onJump: (id: string) => void
}

/** Rows rendered beyond the viewport, above and below. */
const OVERSCAN = 1200

/**
 * Journey tree (README §6.2, the alternate view): branch lanes fork off their parent programme; cards alternate around
 * the trunk. Geometry comes from row heights (measured or estimated), so only rows near the viewport are rendered.
 */
export function JourneyTree({ assetId, list, model, closures, stars, comments, focusBranch, onOpen, onAdd, onActive, onStar, onJump, ref }: JourneyTreeProps) {
  const flowRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<SVGRectElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const clipId = `jt-lit-${useId().replace(/:/g, '')}`
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const revealAll = reduced || typeof IntersectionObserver === 'undefined'
  // Undated events are left off the view (they still open in the sheet); node indices refer to this dated list.
  const dated = useMemo(() => list.filter(isDated), [list])
  const rows = useMemo(() => treeRows(dated, model, closures, todayIso()), [dated, model, closures])
  const { geo, tops, heights, register, sizes, indexOf } = useTreeLayout(flowRef, rows, model)
  const [win, setWin] = useState<[number, number]>([0, Math.min(rows.length - 1, 14)])
  const [active, setActive] = useState(0)
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const [openT, setOpenT] = useState<Set<string>>(() => new Set())
  const [flash, setFlash] = useState<string | null>(null)
    const byId = useMemo(() => new Map(list.map((e) => [e.id, e])), [list])
  const starred = useMemo(() => new Set(stars), [stars])
  const probeRef = useRef(0)
  const flashTimer = useRef(0)
  const g = treeGutters(model)
  const yFrom = tops[win[0]] ?? 0
  const yTo = win[1] >= win[0] ? (tops[win[1]] ?? 0) + (heights[win[1]] ?? 0) : 0
  const isRevealed = (k: string) => revealAll || revealed.has(k)

  // Scroll: lit trunk clip, sticky labels, parallax years, active card, rendered window (rAF-throttled, refs only).
  useEffect(() => {
    const flow = flowRef.current
    if (!flow) return
    const sc = findScroller(flow)
    let raf = 0
    const update = () => {
      const vh = viewportHeight(sc)
      const top = viewportTop(sc) - flow.getBoundingClientRect().top
      const probe = top + vh * 0.55
      clipRef.current?.setAttribute('height', String(Math.max(0, probe)))
      labelsRef.current?.querySelectorAll<HTMLElement>('[data-ly]').forEach((el) => el.toggleAttribute('data-on', Number(el.dataset.ly) <= probe))
      probeRef.current = probe
      if (!reduced) parallax(flow, probe)
      const a = treeActiveAt(geo.nodes, probe)
      setActive((x) => (x === a ? x : a))
      const [f, l] = treeWindow(tops, heights, top - OVERSCAN, top + vh + OVERSCAN)
      setWin((w) => (w[0] === f && w[1] === l ? w : [f, l]))
    }
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    const off = onScroll(sc, on)
    window.addEventListener('resize', on)
    on()
    return () => {
      off()
      window.removeEventListener('resize', on)
      cancelAnimationFrame(raf)
    }
  }, [geo, tops, heights, reduced])

  // Rows that mount as the window moves get their parallax offset at once, not on the next scroll event.
  useLayoutEffect(() => {
    if (!reduced && flowRef.current) parallax(flowRef.current, probeRef.current)
  }, [win, reduced])

  useEffect(() => {
    onActive?.(active)
  }, [active, onActive])

  // Reveal on scroll: rendered rows fade in once, staggered 90 ms per batch (max 4). One observer; rows are
  // observed as they mount and released as they unmount or reveal.
  const io = useRef<IntersectionObserver | null>(null)
  const watched = useRef(new Set<Element>())
  useEffect(() => {
    const flow = flowRef.current
    if (revealAll || !flow) return
    const sc = findScroller(flow)
    const seen = watched.current
    const observer = new IntersectionObserver(
      (entries) => {
        const shown = entries.filter((x) => x.isIntersecting)
        if (!shown.length) return
        shown.forEach((x, i) => {
          ;(x.target as HTMLElement).style.setProperty('--dl', `${Math.min(i, 4) * 90}ms`)
          observer.unobserve(x.target)
          seen.delete(x.target)
        })
        setRevealed((prev) => new Set([...prev, ...shown.map((x) => (x.target as HTMLElement).dataset.row!)]))
      },
      { root: sc === document.documentElement ? null : sc, threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )
    io.current = observer
    return () => {
      observer.disconnect()
      seen.clear()
      io.current = null
    }
  }, [revealAll])
  useEffect(() => {
    const observer = io.current
    const flow = flowRef.current
    if (!observer || !flow) return
    const seen = watched.current
    for (const el of seen) {
      if (!el.isConnected) {
        observer.unobserve(el)
        seen.delete(el)
      }
    }
    flow.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => {
      if (!revealed.has(el.dataset.row!) && !seen.has(el)) {
        seen.add(el)
        observer.observe(el)
      }
    })
  }, [win, rows, revealed, revealAll])

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  // Latest layout for the jump loop, which re-reads it every frame as rows are measured.
  const live = useRef({ tops, sizes, indexOf })
  useLayoutEffect(() => {
    live.current = { tops, sizes, indexOf }
  })
  const stopJump = useRef<() => void>(() => {})
  useEffect(() => () => stopJump.current(), [])

  useImperativeHandle(ref, () => ({
    jump(id) {
      const flow = flowRef.current
      if (!flow || !live.current.indexOf.has(id) || rows[live.current.indexOf.get(id)!]?.kind !== 'event') return false
      const sc = findScroller(flow)
      stopJump.current()
      // Glide towards the row's current position (30% of the viewport), re-reading it each frame: rows measured on the
      // way change the tops, so the target moves until the row itself is measured and in place (README §6.2 retry).
      let raf = 0
      let settled = 0
      let stuck = 0
      const cancel = () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('wheel', cancel)
        window.removeEventListener('touchstart', cancel)
        window.removeEventListener('keydown', cancel)
      }
      stopJump.current = cancel
      window.addEventListener('wheel', cancel, { passive: true })
      window.addEventListener('touchstart', cancel, { passive: true })
      window.addEventListener('keydown', cancel)
      const frame = () => {
        const { tops: t, sizes: s, indexOf: ix } = live.current
        const i = ix.get(id)
        if (i === undefined) return cancel()
        const max = Math.max(0, sc.scrollHeight - viewportHeight(sc))
        const target = Math.min(max, Math.max(0, offsetIn(sc, flow) + t[i]! - viewportHeight(sc) * 0.3))
        const cur = sc.scrollTop
        const d = target - cur
        if (Math.abs(d) < 2) {
          if (s?.has(id) || ++settled > 20) return cancel()
        } else {
          const step = reduced || Math.abs(d) < 24 ? d : d * 0.2
          const before = sc.scrollTop
          scrollToTop(sc, cur + (Math.abs(step) < 1 ? Math.sign(d) : step), false)
          stuck = sc.scrollTop === before ? stuck + 1 : 0
          if (stuck > 6) return cancel()
        }
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
      setFlash(id)
      window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800)
      return true
    },
  }))

    const dim = (id: string) => focusBranch !== null && focusBranch !== id
  const marker: CSSProperties = geo.narrow ? { marginLeft: g.nw } : { marginLeft: geo.tx, transform: 'translateX(-50%)' }
  const curIdx = Math.min(active, dated.length - 1)
  const cur = dated[curIdx]
  const curLane = cur && model.multi ? model.byId.get(laneOf(cur, model)) : undefined
  const activeId = cur?.id ?? null
  /**
   * Card reveal: opacity + slide (±56px, 30px when narrow) + scale, staggered by `--dl`. Tailwind v4 slides with the
   * `translate`/`scale` properties, so those are what transition (the durations replace TreeCard's `duration-300`).
   */
  const reveal = (k: string, side: 'l' | 'r' | null) =>
    cn(
      'transition-[opacity,translate,scale,box-shadow,border-color] duration-[700ms,800ms,800ms,300ms,300ms] ease-out-soft delay-[var(--dl,0ms),var(--dl,0ms),var(--dl,0ms),0ms,0ms]',
      isRevealed(k) ? 'translate-x-0 scale-100 opacity-100' : cn('scale-[0.97] opacity-0', geo.narrow ? 'translate-x-[30px]' : side === 'l' ? '-translate-x-[56px]' : 'translate-x-[56px]'),
    )
  /** Fork / closed row reveal (story.css .tc-fork): 0.6 s fade, 0.7 s slide of 40px (30px narrow), no stagger. */
  const revealFork = (k: string, side: 'l' | 'r') =>
    cn(
      'transition-[opacity,translate] duration-[600ms,700ms] ease-out-soft',
      isRevealed(k) ? 'translate-x-0 opacity-100' : cn('opacity-0', geo.narrow ? 'translate-x-[30px]' : side === 'l' ? '-translate-x-[40px]' : 'translate-x-[40px]'),
    )

  const renderRow = (r: TreeRow) => {
    switch (r.kind) {
      case 'root':
        return (
          <div className="pb-[12px] text-[12.5px] text-text-secondary">
            <Marker style={marker} narrow={geo.narrow}>
              <span className="flex size-[30px] items-center justify-center rounded-full bg-primary text-white shadow-[0_0_0_6px_var(--background),0_0_0_7px_#e4e7ec]">
                <Pill className="size-[14px]" aria-hidden="true" />
              </span>
              <span>
                Journey begins · <b className="text-foreground">{dated[0] ? formatMonth(dated[0].date) : ''}</b>
                {model.multi && (
                  <>
                    {' · '}
                    <b style={{ color: model.trunk.color }}>{model.trunk.label}</b> trunk
                  </>
                )}
              </span>
            </Marker>
          </div>
        )
      case 'year':
        return (
          <div className={cn('relative pt-[40px] pb-[18px] transition-opacity duration-600', isRevealed(r.key) ? 'opacity-100' : 'opacity-0')}>
            <span
              data-bgyear
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 -mt-[90px] -translate-x-1/2 text-[180px] leading-none font-bold tracking-[-0.06em] whitespace-nowrap text-transparent tabular-nums select-none will-change-[translate] [-webkit-text-stroke:1.5px_rgba(35,71,217,0.11)] max-[979px]:-mt-[55px] max-[979px]:text-[110px]"
              style={{ left: geo.narrow ? '62%' : geo.tx }}
            >
              {r.year}
            </span>
            <Marker style={marker} narrow={geo.narrow}>
              <span className="relative rounded-full border bg-card px-[12px] py-[3px] font-mono text-[13px] font-semibold shadow-[0_0_0_5px_var(--background)]">{r.year}</span>
              <span className="relative bg-background px-[6px] text-[12px] text-muted-foreground">
                {r.n} event{r.n === 1 ? '' : 's'}
              </span>
            </Marker>
          </div>
        )
      case 'today':
        return (
          <div className={cn('pt-[36px] pb-[14px] transition-opacity duration-600', isRevealed(r.key) ? 'opacity-100' : 'opacity-0')}>
            <Marker style={marker} narrow={geo.narrow}>
              <span className="inline-flex items-center gap-[6px] rounded-full bg-foreground px-[12px] py-[4px] text-[12px] font-semibold text-white shadow-[0_0_0_5px_var(--background)]">
                <i aria-hidden="true" className="size-[6px] animate-blink-dot rounded-full bg-white" />
                Today · {formatDay(todayIso())}
              </span>
              <span className="bg-background px-[6px] text-[12px] text-muted-foreground">Expected milestones below</span>
            </Marker>
          </div>
        )
      case 'fork':
      case 'end': {
        const end = r.kind === 'end'
        const parent = model.byId.get(r.branch.from ?? '')?.label ?? model.trunk.label
        return (
          <div className={cn('flex pt-[22px] pb-[4px]', geo.narrow || r.side === 'r' ? 'justify-end' : 'justify-start', dim(r.branch.id) && 'opacity-30')}>
            <div
              className={cn('flex items-center gap-[12px] rounded-xl border-[1.5px] border-dashed bg-card px-[14px] py-[10px]', revealFork(r.key, r.side))}
              style={{ width: geo.cardW, borderColor: r.branch.color }}
            >
              <span
                className={cn('flex size-[28px] shrink-0 items-center justify-center rounded-full', end ? 'border-[1.5px] bg-card' : 'text-white')}
                style={end ? { borderColor: r.branch.color, color: r.branch.color } : { background: r.branch.color }}
              >
                {end ? <X className="size-[13px]" aria-hidden="true" /> : <GitMerge className="size-[14px]" aria-hidden="true" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="text-[13px] text-secondary-foreground">
                  {end ? 'Branch closed · ' : 'New branch · '}
                  <b className="font-semibold" style={{ color: r.branch.color }}>
                    {end ? r.branch.label : r.branch.full}
                  </b>
                </span>
                <span className="text-[12px] text-pretty text-muted-foreground">
                  {r.kind === 'end'
                    ? `${r.branch.ended ?? 'Closed'} ${formatMonth(r.closure.date)} · ${r.closure.title}`
                    : `Forked from ${parent}${r.branch.why ? ` · ${r.branch.why}` : ''}`}
                </span>
              </span>
              {r.kind === 'fork' && (
                <span className="flex flex-col items-end font-mono text-[18px] leading-none font-semibold" style={{ color: r.branch.color }}>
                  {r.n}
                  <em className="mt-[2px] font-sans text-[10.5px] font-normal text-muted-foreground not-italic">events</em>
                </span>
              )}
            </div>
          </div>
        )
      }
      case 'event': {
        const e = r.e
        return (
          <article
            aria-labelledby={`${clipId}-t-${r.i}`}
            className={cn('flex py-[14px]', geo.narrow || r.side === 'r' ? 'justify-end' : 'justify-start', dim(r.lane) && 'opacity-30 transition-opacity duration-300')}
          >
            <TreeCard
              assetId={assetId}
              titleId={`${clipId}-t-${r.i}`}
              e={e}
              lane={model.multi ? (model.byId.get(r.lane) ?? null) : null}
              open={openT.has(e.id)}
              onToggle={() => setOpenT((s) => (s.has(e.id) ? new Set([...s].filter((x) => x !== e.id)) : new Set([...s, e.id])))}
              starred={starred.has(e.id)}
              nComments={comments[e.id]?.length ?? 0}
              onStar={() => onStar(e.id)}
              onOpen={() => onOpen(e.id)}
              onJump={onJump}
              resolve={(id) => byId.get(id)}
              className={cn(
                'w-(--cw)',
                reveal(r.key, r.side),
                activeId === e.id && 'border-[#c7d1f4]',
                // box-shadow is shared by the active glow, the starred ring and the flash: merge instead of overriding.
                activeId === e.id && (starred.has(e.id) ? 'shadow-[inset_0_0_0_2px_var(--star),0_16px_40px_rgba(35,71,217,0.1)]' : 'shadow-card-active'),
                flash === e.id && 'animate-journey-flash',
              )}
            />
          </article>
        )
      }
      case 'finish':
        return (
          <div className="mt-[28px] text-[12.5px] text-text-secondary">
            <Marker style={marker} narrow={geo.narrow}>
              <span className="flex size-[30px] items-center justify-center rounded-full border-[1.5px] border-dashed border-faint bg-card text-text-secondary">
                <Flag className="size-[13px]" aria-hidden="true" />
              </span>
              <span>{r.milestones ? 'Projected milestones are dashed' : 'End of the recorded journey'}</span>
            </Marker>
          </div>
        )
    }
  }

  return (
    <>
      <div ref={flowRef} data-testid="journey-tree" className="relative mt-[20px]" style={{ height: geo.H, '--cw': `${geo.cardW}px`, overflowAnchor: 'none' } as CSSProperties}>
        {model.multi && (
          <div ref={labelsRef} aria-hidden="true" className="sticky top-0 z-[6] h-0">
            {geo.narrow ? (
              <div className="absolute top-[6px] right-0 left-0 flex flex-wrap gap-[4px] rounded-[10px] border bg-card/95 px-[8px] py-[6px] shadow-[0_4px_12px_rgba(16,24,40,0.06)] backdrop-blur-sm">
                {geo.lanes.map((l) => (
                  <span
                    key={l.id}
                    data-ly={l.y1}
                    className="inline-flex items-center gap-[5px] rounded-full border px-[7px] py-px text-[11px] font-semibold opacity-35 transition-opacity data-[on]:opacity-100"
                    style={{
                      color: l.color,
                      borderColor: `color-mix(in srgb, ${l.color} 30%, #fff)`,
                    }}
                  >
                    <i className="size-[6px] rounded-full" style={{ background: l.color }} />
                    {l.label}
                  </span>
                ))}
              </div>
            ) : (
              [...geo.lanes]
                .sort((a, b) => a.x - b.x)
                .map((l, i) => (
                  <span
                    key={l.id}
                    data-ly={l.y1}
                    className={cn(
                      'absolute -translate-x-1/2 -translate-y-[6px] rounded-full border bg-card/95 px-[8px] py-[2px] text-[11px] font-semibold whitespace-nowrap opacity-0 shadow-[0_2px_6px_rgba(16,24,40,0.06)] transition-[opacity,translate] duration-300 data-[on]:translate-y-0 data-[on]:opacity-100',
                      dim(l.id) && 'data-[on]:opacity-35',
                    )}
                    style={{
                      left: l.x,
                      top: i % 2 ? 32 : 8,
                      color: l.color,
                      borderColor: l.color,
                    }}
                  >
                    {l.label}
                  </span>
                ))
            )}
          </div>
        )}
        <Gutter flowRef={flowRef} geo={geo} byId={byId} model={model} onAdd={onAdd} />
        <TreeSvg geo={geo} model={model} activeId={activeId} revealed={revealed} revealAll={revealAll} focusBranch={focusBranch} clipId={clipId} clipRef={clipRef} yFrom={yFrom} yTo={yTo} />
        {rows.slice(win[0], win[1] + 1).map((r, k) => {
          const i = win[0] + k
          return (
            <div key={r.key} ref={register(r.key)} data-row={r.key} className={cn('absolute right-0 left-0', r.kind !== 'year' && 'z-[2]')} style={{ top: tops[i] }}>
              {renderRow(r)}
            </div>
          )
        })}
      </div>
      {cur && (
        <div aria-hidden="true" className="sticky bottom-[16px] z-[5] mx-auto flex w-max items-center gap-[10px] rounded-full border bg-card/95 px-[14px] py-[6px] text-[12.5px] shadow-[0_6px_18px_rgba(16,24,40,0.08)] backdrop-blur-sm">
          <span className="font-mono font-semibold">{cur.date.slice(0, 4)}</span>
          {curLane?.label && <BranchChip branch={curLane} small />}
          <span className="font-mono text-muted-foreground">
            {String(curIdx + 1).padStart(2, '0')}/{String(dated.length).padStart(2, '0')}
          </span>
          <span aria-hidden="true" className="h-[4px] w-[120px] overflow-hidden rounded-[2px] bg-accent">
            <i className="block h-full bg-primary transition-[width] duration-300" style={{ width: `${((curIdx + 1) / dated.length) * 100}%` }} />
          </span>
        </div>
      )}
    </>
  )
}

/** Gutter hover-to-add: owns the hover state, so moving the mouse re-renders only this, never the rows or the SVG. */
const Gutter = memo(function Gutter({ flowRef, geo, byId, model, onAdd }: { flowRef: RefObject<HTMLDivElement | null>; geo: TreeGeometry; byId: Map<string, JourneyEventV3>; model: BranchModel; onAdd: JourneyViewProps['onAdd'] }) {
  const [gh, setGh] = useState<TreeHover | null>(null)
  const gutLeft = Math.max(0, geo.xMin - 22)
  const hoverAt = (ev: ReactMouseEvent<HTMLDivElement>) => {
    const r = flowRef.current!.getBoundingClientRect()
    return treeHoverAt(geo, byId, ev.clientX - r.left, ev.clientY - r.top)
  }
  return (
        <div
      data-testid="tree-gutter"
      className="absolute top-0 z-[4] cursor-copy"
      style={{
        left: gutLeft,
        width: geo.xMax - gutLeft + 22,
        height: geo.H,
      }}
      onMouseMove={(ev) => setGh(hoverAt(ev))}
      onMouseLeave={() => setGh(null)}
      onClick={(ev) => {
        const q = hoverAt(ev)
        if (q)
          onAdd({
            date: q.date,
            branch: q.lane,
            prev: q.prev?.title ?? null,
            next: q.next?.title ?? null,
          })
      }}
    >
      {gh && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -mt-[9px] flex size-[18px] items-center justify-center rounded-full border-2 bg-card"
            style={{
              top: gh.y,
              left: gh.lx - gutLeft - 9,
              borderColor: gh.color,
              color: gh.color,
              boxShadow: `0 0 0 4px color-mix(in srgb, ${gh.color} 15%, transparent)`,
            }}
          >
            <Plus className="size-[11px]" />
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute z-[8] inline-flex items-center gap-[6px] rounded-full bg-foreground px-[10px] py-[5px] text-[12px] whitespace-nowrap text-white shadow-[0_6px_16px_rgba(16,24,40,0.2)]',
              geo.narrow ? '-translate-y-[140%]' : '-translate-y-1/2',
            )}
            style={{ top: gh.y, left: gh.lx - gutLeft + 16 }}
          >
            <b className="font-semibold">{formatDay(gh.date)}</b>
            {model.multi && (
              <span
                className="font-semibold"
                style={{
                  color: `color-mix(in srgb, ${gh.color} 45%, #fff)`,
                }}
              >
                · {gh.label}
              </span>
            )}
            <em className="ml-[2px] text-[11px] text-faint not-italic">Click to add a note</em>
          </span>
        </>
      )}
    </div>
  )
})

/** Parallax numeral: 0.45× against the probe, written as the `translate` property (it keeps the -50% centring). */
function parallax(flow: HTMLElement, probe: number) {
  flow.querySelectorAll<HTMLElement>('[data-bgyear]').forEach((el) => {
    const row = el.closest<HTMLElement>('[data-row]')!
    el.style.translate = `-50% ${((row.offsetTop + row.offsetHeight / 2 - probe) * -0.45).toFixed(1)}px`
  })
}

function Marker({ style, narrow, children }: { style: CSSProperties; narrow: boolean; children: ReactNode }) {
  return (
    <div className={cn('relative z-[3] flex w-max max-w-[90%] flex-col gap-[4px]', narrow ? 'items-start text-left' : 'items-center text-center')} style={style}>
      {children}
    </div>
  )
}
