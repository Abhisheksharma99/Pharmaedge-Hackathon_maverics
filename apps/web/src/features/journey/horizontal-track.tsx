import { ChevronLeft, ChevronRight, MessageCircle, Plus, Star } from 'lucide-react'
import { memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { CategoryIcon, IndicationBadges, SignificanceBadge } from '@/features/assets/components/badges'
import { formatDay, todayIso } from '@/lib/dates'
import { findScroller, offsetIn, onScroll, scrollToTop, viewportHeight, viewportTop } from '@/lib/scroll'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { BranchChip, NoteTagChip, Targets } from './chips'
import { eventDate } from './format'
import { eventIndications } from './indications'
import { noteColor } from './constants'
import { laneOf, spanOf } from './journey-model'
import { HZ, trackActive, trackHoverAt, trackLayout, trackOffsetFor, trackSeen, trackWindow, type TrackHover, type TrackLane } from './track-layout'
import type { Branch, JourneyEventV3 } from './types'
import type { JourneyViewProps } from './view-types'

/** One flag per lane: has its left end come within 0.75·vw of the viewport's left edge (pinned label fully shown)? */
const labelFlags = (lanes: TrackLane[], p: number, vw: number) =>
  lanes.map((l) => (l.trunk || Math.min(l.x1, l.x2, l.tailX ?? Infinity) <= p + 0.75 * vw ? '1' : '0')).join('')

interface Win {
  first: number
  last: number
  active: number
  seen: number
  lab: string
}

/**
 * Horizontal journey (README §6.3, the default view): a sticky pin inside a block `maxP + vh` tall; scrolling down
 * moves the track left by `p`. Only cards near the viewport are rendered, so 1,000+ event journeys stay smooth.
 * Newest first, the latest event is on the left and the lanes run from the right (layout `dir` −1).
 */
export function HorizontalTrack({ list, newestFirst, model, closures, stars, comments, focusBranch, onOpen, onAdd, onActive, ref }: JourneyViewProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const pinRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const cards = useRef(new Map<number, HTMLButtonElement>())
  const flashTimer = useRef<number | undefined>(undefined)
  const pendingFocus = useRef<number | null>(null)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [size, setSize] = useState({ vw: 1000, vh: 700 })
  const [flash, setFlash] = useState<string | null>(null)
  const [hov, setHov] = useState<TrackHover | null>(null)
  const n = list.length
  const [win, setWin] = useState<Win>(() => ({ first: 0, last: Math.min(n - 1, 12), active: 0, seen: -1, lab: '' }))
  const { vw, vh } = size
  const L = useMemo(
    () => trackLayout({ list, newestFirst, branches: model.list, laneOf: (e) => laneOf(e, model), vw, vh, closures, today: todayIso() }),
    [list, newestFirst, model, vw, vh, closures],
  )
  const starred = useMemo(() => new Set(stars), [stars])

  useLayoutEffect(() => {
    const pin = pinRef.current
    if (!pin) return
    const sc = findScroller(pin)
    const measure = () => setSize((s) => {
      const next = { vw: pin.clientWidth || 1000, vh: viewportHeight(sc) || 700 }
      return next.vw === s.vw && next.vh === s.vh ? s : next
    })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(pin)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const outer = outerRef.current
    if (!outer) return
    const sc = findScroller(outer)
    let raf = 0
    const update = () => {
      const p = Math.min(L.maxP, Math.max(0, viewportTop(sc) - outer.getBoundingClientRect().top))
      if (trackRef.current) trackRef.current.style.transform = `translateX(${-p}px)`
      if (bgRef.current && !reduced) bgRef.current.style.transform = `translateX(${-p * 0.55}px)`
      const [first, last] = trackWindow(p, vw, n)
      const active = trackActive(p, vw, n)
      const seen = trackSeen(p, vw, n)
      const lab = labelFlags(L.lanes, p, vw)
      setWin((w) => (w.first === first && w.last === last && w.active === active && w.lab === lab && seen <= w.seen ? w : { first, last, active, seen: Math.max(w.seen, seen), lab }))
    }
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    const off = onScroll(sc, on)
    on()
    return () => {
      off()
      cancelAnimationFrame(raf)
    }
  }, [L, vw, n, reduced])

  useEffect(() => onActive?.(win.active), [win.active, onActive])

  useEffect(() => {
    const i = pendingFocus.current
    if (i === null) return
    const el = cards.current.get(i)
    if (el) {
      el.focus({ preventScroll: true })
      pendingFocus.current = null
    }
  }, [win])

  const goTo = (i: number) => {
    const outer = outerRef.current
    if (!outer || i < 0 || i >= n) return
    const sc = findScroller(outer)
    scrollToTop(sc, offsetIn(sc, outer) + trackOffsetFor(L, i, vw), !reduced)
  }

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  useImperativeHandle(ref, () => ({
    jump(id) {
      const i = list.findIndex((e) => e.id === id)
      if (i < 0) return false
      goTo(i)
      setFlash(id)
      window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800)
      return true
    },
  }))

  const move = (i: number) => {
    const j = Math.min(n - 1, Math.max(0, i))
    pendingFocus.current = j
    goTo(j)
    const el = cards.current.get(j)
    if (el) {
      el.focus({ preventScroll: true })
      pendingFocus.current = null
    }
  }

  // Stable callbacks for the memoised cards: they read the latest props through a ref, so scroll and hover renders skip them.
  const latest = useRef({ onOpen, move })
  useLayoutEffect(() => {
    latest.current = { onOpen, move }
  })
  const cardApi = useMemo(
    () => ({
      onOpen: (id: string) => latest.current.onOpen(id),
      onMove: (to: number) => latest.current.move(to),
      register: (i: number, el: HTMLButtonElement | null) => {
        if (el) cards.current.set(i, el)
        else cards.current.delete(i)
      },
    }),
    [],
  )

  const hoverAt = (ev: ReactMouseEvent<SVGSVGElement>) => {
    // The SVG moves with the track, so pointer − SVG left is already a track x (README §6.3 "Bug to avoid").
    const r = ev.currentTarget.getBoundingClientRect()
    return trackHoverAt(L, list, ev.clientX - r.left, ev.clientY - r.top)
  }

  const lane = (e: JourneyEventV3) => model.byId.get(laneOf(e, model))!
  const dim = (id: string) => focusBranch !== null && focusBranch !== id
  const nR = L.rows.length
  const d = L.dir
  // Until the first scroll update, use the flags for p = 0 so labels don't flash faded for a frame.
  const labs = win.lab.length === L.lanes.length ? win.lab : labelFlags(L.lanes, 0, vw)
  const shown = n ? list.slice(win.first, win.last + 1).map((e, k) => ({ e, i: win.first + k })) : []

  return (
    <div ref={outerRef} data-testid="journey-horizontal" className="relative -mx-[24px] mt-[20px] max-[900px]:-mx-[14px]" style={{ height: L.maxP + vh }}>
      <div ref={pinRef} className="sticky top-0 overflow-clip bg-[radial-gradient(ellipse_80%_70%_at_50%_50%,color-mix(in_srgb,var(--primary-soft)_60%,var(--background)),transparent_70%)]" style={{ height: vh }}>
        <div ref={bgRef} aria-hidden="true" className="pointer-events-none absolute top-0 left-0 h-full will-change-transform">
          {L.bgYears.map((y) => (
            <span
              key={y.y}
              className="absolute -translate-y-1/2 text-[200px] leading-none font-bold tracking-[-0.06em] text-transparent select-none [-webkit-text-stroke:1.5px_rgba(35,71,217,0.10)]"
              style={{ left: y.bx + vw * 0.3, top: L.bandTop - 70 }}
            >
              {y.y}
            </span>
          ))}
        </div>
        <div ref={trackRef} className="absolute top-0 left-0 h-full will-change-transform" style={{ width: L.TW }}>
          <svg
            aria-hidden="true"
            width={L.TW}
            height={vh}
            className="absolute top-0 left-0 overflow-visible"
            onMouseMove={(ev) => {
              const q = hoverAt(ev)
              setHov((h) => (h && q && h.x === q.x && h.ly === q.ly && h.lane === q.lane ? h : q))
            }}
            onMouseLeave={() => setHov(null)}
            onClick={(ev) => {
              const q = hoverAt(ev)
              if (q) onAdd({ date: q.date, branch: q.lane, prev: q.prev?.title ?? null, next: q.next?.title ?? null })
            }}
          >
            <rect x={0} y={L.bandTop - 6} width={L.TW} height={nR * HZ.ROW + 12} fill="transparent" className="cursor-copy" />
            {L.years.map((y) => (
              <g key={y.y}>
                <line x1={y.x - HZ.COL / 2 + 6} x2={y.x - HZ.COL / 2 + 6} y1={L.top0 + 6} y2={L.bandBot + 8} stroke="#e4e7ec" strokeDasharray="2 4" />
                <text x={y.x - HZ.COL / 2 + 12} y={L.top0 + 20} className="fill-text-secondary font-mono text-[12px] font-semibold">
                  {y.y}
                </text>
              </g>
            ))}
            <line x1={L.todayX} x2={L.todayX} y1={L.bandTop - 16} y2={L.bandBot + 16} stroke="#101828" strokeDasharray="3 3" />
            {/* Newest first with Today before the first column, the first card (above the band) would cover the label. */}
            <text x={L.todayX} y={d < 0 && L.todayX < HZ.PADL ? L.bandBot + 30 : L.bandTop - 22} textAnchor="middle" className="fill-foreground text-[10.5px] font-semibold">
              Today
            </text>
            {L.lanes.map((l) => (
              <g key={l.id} data-lane={l.id} className={cn('transition-opacity duration-300', dim(l.id) && 'opacity-[0.18]')}>
                {l.py !== null && <path d={`M${l.x1 - 64 * d},${l.py} C${l.x1 - 30 * d},${l.py} ${l.x1 - 34 * d},${l.y} ${l.x1},${l.y}`} stroke={l.color} strokeWidth={3} strokeLinecap="round" fill="none" />}
                {/* Solid up to today, dashed beyond it; `d` flips which side is "beyond". */}
                <line x1={l.x1} x2={d * Math.min(d * l.x2, d * L.todayX)} y1={l.y} y2={l.y} stroke={l.color} strokeWidth={l.trunk ? 4 : 3} strokeLinecap="round" />
                {!l.ended && d * l.x2 > d * L.todayX && <line x1={d * Math.max(d * l.x1, d * L.todayX)} x2={l.x2} y1={l.y} y2={l.y} stroke={l.color} strokeWidth={l.trunk ? 4 : 3} strokeLinecap="round" strokeDasharray="6 7" />}
                {l.tailX !== null && <line data-tail x1={l.capX! + 8 * d} x2={l.tailX} y1={l.y} y2={l.y} stroke={l.color} strokeWidth={1.5} strokeDasharray="2 5" opacity={0.5} />}
                {!l.trunk && l.label && (
                  <g transform={`translate(${d > 0 ? l.x1 + 6 : l.x1 - 6 - (l.label.length * 6.6 + 14)},${l.y - 9})`}>
                    <rect width={l.label.length * 6.6 + 14} height={18} rx={9} fill="#fff" stroke={l.color} />
                    <text x={7} y={12.5} fill={l.color} className="text-[10.5px] font-bold">
                      {l.label}
                    </text>
                  </g>
                )}
                {l.capX !== null && (
                  <g data-cap transform={`translate(${l.capX},${l.y})`}>
                    <circle r={8} fill="#fff" stroke={l.color} strokeWidth={2} />
                    <path d="M-3.2,-3.2 L3.2,3.2 M3.2,-3.2 L-3.2,3.2" stroke={l.color} strokeWidth={2} strokeLinecap="round" />
                  </g>
                )}
              </g>
            ))}
            {shown.map(({ e, i }) => {
              const b = lane(e)
              const y = L.rowY(b.id)!
              const up = i % 2 === 0
              const on = i === win.active
              const rv = reduced || i <= win.seen
              const spans = spanOf(e, model).flatMap((id) => L.rowY(id) ?? [])
              const x = L.xs[i]!
              const note = e.user ? noteColor(e.user.tag) : null
              return (
                <g key={e.id} data-node={e.id} className={cn('transition-opacity duration-300', dim(b.id) && 'opacity-[0.18]')}>
                  <line x1={x} x2={x} y1={up ? L.bandTop - 14 : y} y2={up ? y : L.bandBot + 14} stroke={b.color} strokeWidth={1.5} className="transition-opacity delay-200 duration-500" opacity={rv ? (on ? 1 : 0.45) : 0} />
                  {spans.length > 0 && <line x1={x} x2={x} y1={Math.min(y, ...spans)} y2={Math.max(y, ...spans)} stroke={b.color} strokeWidth={2} strokeDasharray="2 3" opacity={rv ? 0.7 : 0} />}
                  {spans.map((sy) => (
                    <circle key={sy} cx={x} cy={sy} r={3.5} fill="#fff" stroke={b.color} strokeWidth={2} />
                  ))}
                  <circle
                    cx={x}
                    cy={y}
                    r={on ? 8 : e.significance === 'High' ? 6.5 : 5}
                    fill={e.is_milestone || note ? '#fff' : b.color}
                    stroke={note ?? (e.is_milestone ? b.color : '#fff')}
                    strokeWidth={2.5}
                    strokeDasharray={e.is_milestone ? '2.5 2' : undefined}
                    className={cn('origin-center transition-transform duration-500 ease-spring [transform-box:fill-box]', rv ? 'scale-100' : 'scale-0')}
                  />
                </g>
              )
            })}
            {hov && (
              <g pointerEvents="none">
                <line x1={hov.x} x2={hov.x} y1={L.bandTop - 10} y2={L.bandBot + 10} stroke="#101828" strokeDasharray="3 3" />
                <circle cx={hov.x} cy={hov.ly} r={9} fill="#fff" strokeWidth={2} stroke={model.byId.get(hov.lane)?.color} />
                <path d={`M${hov.x - 4},${hov.ly} h8 M${hov.x},${hov.ly - 4} v8`} strokeWidth={2} strokeLinecap="round" stroke={model.byId.get(hov.lane)?.color} />
              </g>
            )}
          </svg>
          {hov && (
            <div
              data-hover-pill
              aria-hidden="true"
              className="pointer-events-none absolute z-[8] inline-flex -translate-x-1/2 animate-fade items-center gap-[6px] rounded-full bg-foreground px-[10px] py-[5px] text-[12px] whitespace-nowrap text-white shadow-[0_6px_16px_rgba(16,24,40,0.2)]"
              style={{ left: hov.x, top: hov.ly - 42 }}
            >
              <Plus className="size-[12px]" aria-hidden="true" />
              <b className="font-semibold">{formatDay(hov.date)}</b>
              {model.multi && (
                <span className="font-semibold" style={{ color: `color-mix(in srgb, ${model.byId.get(hov.lane)?.color} 45%, #fff)` }}>
                  · {model.byId.get(hov.lane)?.label}
                </span>
              )}
              <em className="ml-[2px] text-[11px] text-faint not-italic">Click to add a note</em>
            </div>
          )}
          {shown.map(({ e, i }) => (
            <TrackCard
              key={e.id}
              e={e}
              i={i}
              n={n}
              left={L.xs[i]! - HZ.CW / 2}
              edge={i % 2 === 0 ? vh - (L.bandTop - 14) : L.bandBot + 14}
              up={i % 2 === 0}
              active={i === win.active}
              seen={reduced || i <= win.seen}
              dimmed={dim(lane(e).id)}
              flash={flash === e.id}
              starred={starred.has(e.id)}
              nComments={comments[e.id]?.length ?? 0}
              onOpen={cardApi.onOpen}
              onMove={cardApi.onMove}
              register={cardApi.register}
            />
          ))}
        </div>
        <div className="absolute left-0 z-[3] w-[200px] bg-[linear-gradient(90deg,rgba(249,250,251,0.98)_70%,rgba(249,250,251,0))] pl-[18px] max-[900px]:w-[120px] max-[900px]:pl-[8px]" style={{ top: L.bandTop, height: nR * HZ.ROW }}>
          {L.rows.map((b) => {
            const l = L.lanes.find((x) => x.id === b.id)
            if (!l) return null
            const started = l.trunk || labs[L.lanes.indexOf(l)] === '1'
            const sub = started ? (l.trunk ? 'trunk' : l.ended ? 'closed' : (b.status.split(' · ')[0] ?? '')) : `from ${l.first!.date.slice(0, 4)}`
            return (
              <div key={b.id} data-row={b.id} className={cn('flex items-center gap-[7px] text-[12px] text-muted-foreground transition-opacity duration-300', started ? 'opacity-100' : 'opacity-45')} style={{ height: HZ.ROW }}>
                <i aria-hidden="true" className="size-[10px] shrink-0 rounded-full" style={{ background: b.color, boxShadow: `0 0 0 3px color-mix(in srgb, ${b.color} 18%, transparent)` }} />
                <b className="min-w-[54px] text-[12.5px] font-[650]" style={{ color: b.color }}>
                  {b.label || 'Journey'}
                </b>
                <span className="truncate text-[11px] max-[900px]:hidden">{sub}</span>
              </div>
            )
          })}
        </div>
        <button type="button" aria-label="Previous event" disabled={win.active <= 0} onClick={() => goTo(win.active - 1)} className="absolute top-1/2 left-[208px] z-[4] -mt-[20px] flex size-[40px] items-center justify-center rounded-full border bg-card text-secondary-foreground shadow-[0_4px_12px_rgba(16,24,40,0.08)] disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-[900px]:left-[124px]">
          <ChevronLeft className="size-[18px]" />
        </button>
        <button type="button" aria-label="Next event" disabled={win.active >= n - 1} onClick={() => goTo(win.active + 1)} className="absolute top-1/2 right-[16px] z-[4] -mt-[20px] flex size-[40px] items-center justify-center rounded-full border bg-card text-secondary-foreground shadow-[0_4px_12px_rgba(16,24,40,0.08)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-35">
          <ChevronRight className="size-[18px]" />
        </button>
        {n > 0 && <Hud cur={list[Math.min(win.active, n - 1)]!} index={Math.min(win.active, n - 1)} n={n} lane={model.multi ? model.byId.get(laneOf(list[Math.min(win.active, n - 1)]!, model)) : undefined} />}
        {/* The hint needs room beside the centred HUD (narrow tracks, e.g. beside the Asset Journey list). */}
        {vw >= 1060 && (
          <div className="absolute right-[16px] bottom-[14px] z-[4] inline-flex items-center gap-[5px] rounded-full border border-hair bg-card/90 px-[9px] py-[3px] text-[11.5px] text-muted-foreground">
            <Plus className="size-[12px]" aria-hidden="true" />
            Hover a branch to see the date · click to add a note there
          </div>
        )}
      </div>
    </div>
  )
}

interface TrackCardProps {
  e: JourneyEventV3
  i: number
  n: number
  left: number
  /** `bottom` offset for cards above the band, `top` offset for those below. */
  edge: number
  up: boolean
  active: boolean
  seen: boolean
  dimmed: boolean
  flash: boolean
  starred: boolean
  nComments: number
  onOpen: (id: string) => void
  onMove: (to: number) => void
  register: (i: number, el: HTMLButtonElement | null) => void
}

/** One event card of the pinned track; memoised on primitives so a scroll or hover render only touches cards whose state changed. */
const TrackCard = memo(function TrackCard({ e, i, n, left, edge, up, active, seen, dimmed, flash, starred, nComments, onOpen, onMove, register }: TrackCardProps) {
  const note = e.user ? noteColor(e.user.tag) : null
  const style: CSSProperties = {
    left,
    width: HZ.CW,
    ...(up ? { bottom: edge } : { top: edge }),
    // Stagger only the reveal (opacity, transform), as the prototype does — not the hover border/shadow.
    transitionDelay: `${(i % 3) * 60}ms, ${(i % 3) * 60}ms, 0ms, 0ms`,
    ...(note && { borderColor: note }),
  }
  return (
    <button
      ref={(el) => register(i, el)}
      type="button"
      data-card={e.id}
      tabIndex={active ? 0 : -1}
      onClick={() => onOpen(e.id)}
      onKeyDown={(ev) => {
        const to = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : null
        if (to === null) return
        ev.preventDefault()
        onMove(to)
      }}
      className={cn(
        'absolute flex flex-col gap-[7px] rounded-[14px] border bg-card px-[14px] py-[12px] text-left transition-[opacity,transform,border-color,box-shadow] duration-700 ease-out-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        // Theme shadows/borders are emitted after arbitrary ones, so the active card must not carry them.
        active ? '' : 'shadow-panel hover:border-input hover:shadow-card-hover',
        !seen ? (up ? 'translate-y-[-26px] opacity-0' : 'translate-y-[26px] opacity-0') : dimmed ? 'opacity-30' : 'opacity-100',
        active && 'border-[#c7d1f4] shadow-[0_14px_34px_rgba(35,71,217,0.13)] hover:border-[#c7d1f4] hover:shadow-[0_14px_34px_rgba(35,71,217,0.13)]',
        e.is_milestone && 'border-dashed',
        flash && 'animate-journey-flash',
      )}
      style={style}
    >
      <span className="flex items-center gap-[7px] text-[11.5px] text-text-secondary">
        <CategoryIcon category={e.category} className="size-[22px] rounded-md" />
        <span className="font-mono">{eventDate(e, { short: true })}</span>
        {starred && <Star aria-label="Starred" className="size-[12px] fill-star text-star-stroke" />}
        {nComments > 0 && (
          <span className="inline-flex items-center gap-[3px] text-muted-foreground">
            <MessageCircle className="size-[11px]" aria-hidden="true" />
            {nComments}
          </span>
        )}
        <span className="flex-1" />
        <SignificanceBadge value={e.significance} />
      </span>
      <span className={cn('line-clamp-2 leading-[1.3] font-semibold text-pretty', e.significance === 'High' ? 'text-[15px]' : 'text-[14px]')}>{e.title}</span>
      <span className="flex flex-wrap gap-[4px]">
        {e.user && <NoteTagChip tag={e.user.tag} />}
        <IndicationBadges items={eventIndications(e)} max={2} />
        {/* Product only: the indications are the badges. */}
        <Targets e={e} small limit={0} />
      </span>
    </button>
  )
})

/**
 * The year / branch / position HUD (screenshots 07-08, story.css `.tc-hud`): inside the pinned track, bottom-centre, so it
 * is only on screen while the track is pinned — never over the header or the KPIs.
 */
function Hud({ cur, index, n, lane }: { cur: JourneyEventV3; index: number; n: number; lane: Branch | undefined }) {
  return (
    <div aria-hidden="true" data-testid="journey-hud" className="absolute bottom-[16px] left-1/2 z-[5] flex w-max -translate-x-1/2 items-center gap-[10px] rounded-full border bg-card/95 px-[14px] py-[6px] text-[12.5px] shadow-[0_6px_18px_rgba(16,24,40,0.08)] backdrop-blur-md">
      <b className="font-mono font-semibold">{cur.date.slice(0, 4)}</b>
      {lane && <BranchChip branch={lane} small />}
      <span className="font-mono text-muted-foreground">
        {String(index + 1).padStart(2, '0')}/{String(n).padStart(2, '0')}
      </span>
      <span className="h-[4px] w-[120px] overflow-hidden rounded-sm bg-accent">
        <i className="block h-full bg-primary transition-[width] duration-300" style={{ width: `${((index + 1) / n) * 100}%` }} />
      </span>
    </div>
  )
}
