import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { EventCategory } from '@/features/assets/api'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Story, StoryEvent, StoryNote } from './api'

/**
 * The journey story's timeline (team design: design/competitors-redesign/Timeline.dc.html): a shared time axis, the
 * approvals staircase, the share price, one lane per evidence type, the comparison asset's lane, the focus window
 * and Today. Each layer enters in order (or as it streams in); the plot scrolls sideways on long journeys.
 */

export const CATEGORY_COLOR: Record<EventCategory, string> = {
  regulatory: '#2347D9',
  clinical: '#08916F',
  company: '#E0620F',
  ip: '#7A5AF8',
}
export const CATEGORY_LABEL: Record<EventCategory, string> = {
  regulatory: 'Regulatory',
  clinical: 'Clinical',
  company: 'Company',
  ip: 'Patents',
}

const LABEL_W = 112
const PX_PER_YEAR = 72
const MIN_W = 480
const CLUSTER_PX = 16 // marks closer than this become one count bubble
const ROW = 44
const STAIR = 66
const PRICE = 46
const AXIS = 24
const SIZE = { High: 14, Medium: 11, Low: 8 } as const

const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`)
const STEP_DELAY = 0.35 // s between layers when the story is replayed

/** What badge an event carries, if any: the check outranks the change. */
export function eventFlag(e: StoryEvent): { label: string; tone: 'new' | 'moved' | 'updated' | 'check' } | null {
  if (e.verification?.status === 'unconfirmed') return { label: 'Unconfirmed', tone: 'check' }
  if (e.verification?.status === 'conflict') return { label: 'Conflict', tone: 'check' }
  if (!e.change) return null
  if (e.change.kind === 'added') return { label: 'New', tone: 'new' }
  if (e.change.field === 'date' || e.change.field === 'expected_date') return { label: 'Date moved', tone: 'moved' }
  return { label: 'Updated', tone: 'updated' }
}
const FLAG_STYLE = {
  new: 'bg-[#D1FADF] text-[#05603A]',
  moved: 'bg-[#FEF0C7] text-[#93370D]',
  updated: 'bg-[#E0EAFF] text-[#2347D9]',
  check: 'bg-[#FEE4E2] text-[#912018]',
} as const

function Row({ label, sub, height, delay, children, className }: { label: ReactNode; sub?: ReactNode; height: number; delay: number | null; children: ReactNode; className?: string }) {
  const anim: CSSProperties | undefined = delay === null ? undefined : { animationDelay: `${delay}s` }
  return (
    <div className={cn('relative flex border-b border-hair last:border-0', className)} style={{ height }}>
      <div className="sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-hair bg-card px-[12px] text-[12px]" style={{ width: LABEL_W }}>
        <span className="font-medium text-foreground duration-500 animate-in fade-in fill-mode-both motion-reduce:animate-none" style={anim}>{label}</span>
        {sub && <span className="text-[11.5px] text-muted-foreground">{sub}</span>}
      </div>
      <div className="relative flex-1 duration-500 animate-in fade-in slide-in-from-left-4 fill-mode-both motion-reduce:animate-none" style={anim}>
        {children}
      </div>
    </div>
  )
}

function EventMark({ e, x, top, color, selected, pin, onSelect, delay, faded }: {
  e: StoryEvent; x: number; top: number; color: string; selected: boolean; pin?: number; onSelect: (e: StoryEvent) => void; delay: number | null; faded?: boolean
}) {
  const size = SIZE[e.significance] ?? 8
  const flag = eventFlag(e)
  return (
    <button
      type="button"
      onClick={() => onSelect(e)}
      aria-pressed={selected}
      aria-label={`${formatDate(e.date)}: ${e.title}${flag ? ` (${flag.label})` : ''}`}
      title={`${formatDate(e.date)} · ${e.title}${flag ? ` · ${flag.label}` : ''}`}
      className="absolute -translate-x-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ left: x, top, width: Math.max(size, 18), height: Math.max(size, 18), marginTop: -Math.max(size, 18) / 2, zIndex: selected ? 6 : 3 }}
    >
      <span
        className="absolute top-1/2 left-1/2 block duration-300 animate-in zoom-in-50 fade-in fill-mode-both motion-reduce:animate-none"
        style={{
          width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2,
          borderRadius: e.upcoming ? 2 : '50%', transform: e.upcoming ? 'rotate(45deg)' : undefined,
          background: e.upcoming || faded ? '#fff' : color, border: e.upcoming ? `2px dashed ${color}` : faded ? `2px solid ${color}` : undefined,
          boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : flag?.tone === 'check' ? '0 0 0 2px #fff, 0 0 0 3.5px #D92D20' : '0 0 0 2px #fff',
          animationDelay: delay === null ? undefined : `${delay}s`,
        }}
      />
      {pin !== undefined && (
        <span className="absolute -top-[12px] left-1/2 flex size-[16px] -translate-x-1/2 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white shadow">{pin}</span>
      )}
      {flag && pin === undefined && (
        <span className={cn('pointer-events-none absolute -top-[14px] left-1/2 -translate-x-1/2 rounded-[4px] px-[4px] text-[9px] leading-[13px] font-bold whitespace-nowrap', FLAG_STYLE[flag.tone])}>
          {flag.tone === 'check' ? '!' : flag.label}
        </span>
      )}
    </button>
  )
}

/** Events whose marks would overlap (closer than CLUSTER_PX) grouped, in date order. */
export function clusterEvents(events: StoryEvent[], x: (d: string) => number): { x: number; events: StoryEvent[] }[] {
  const out: { x: number; events: StoryEvent[] }[] = []
  for (const e of events) {
    const ex = x(e.date)
    const last = out.at(-1)
    if (last && ex - last.x < CLUSTER_PX) last.events.push(e)
    else out.push({ x: ex, events: [e] })
  }
  return out
}

function ClusterMark({ events, x, color, selected, pin, onSelect, delay }: {
  events: StoryEvent[]; x: number; color: string; selected: boolean; pin?: number; onSelect: (es: StoryEvent[]) => void; delay: number | null
}) {
  const checks = events.some((e) => eventFlag(e)?.tone === 'check')
  const first = events[0]!
  const last = events.at(-1)!
  return (
    <button
      type="button"
      onClick={() => onSelect(events)}
      aria-pressed={selected}
      aria-label={`${events.length} events, ${formatDate(first.date)} to ${formatDate(last.date)}`}
      title={`${events.length} events · ${formatDate(first.date)} – ${formatDate(last.date)}`}
      className="absolute flex h-[20px] min-w-[20px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-[4px] text-[10px] font-bold text-white outline-none duration-300 animate-in zoom-in-50 fade-in fill-mode-both focus-visible:ring-2 focus-visible:ring-ring motion-reduce:animate-none"
      style={{
        left: x, top: ROW / 2, background: color, zIndex: selected ? 6 : 4,
        boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : checks ? '0 0 0 2px #fff, 0 0 0 3.5px #D92D20' : '0 0 0 2px #fff',
        animationDelay: delay === null ? undefined : `${delay}s`,
      }}
    >
      {events.length}
      {pin !== undefined && (
        <span className="absolute -top-[12px] left-1/2 flex size-[16px] -translate-x-1/2 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white shadow">{pin}</span>
      )}
    </button>
  )
}

export function StoryTimeline({
  story,
  notes,
  selectedId,
  onSelect,
  onSelectMany,
  replayKey,
  live,
}: {
  story: Partial<Story> & { lanes: Story['lanes'] }
  notes: StoryNote[]
  selectedId: string | null
  onSelect: (e: StoryEvent) => void
  /** Several events under one mark: the inspector lists them. */
  onSelectMany: (events: StoryEvent[]) => void
  /** Changing it replays the reveal. */
  replayKey: number
  /** Streaming: layers animate as they arrive instead of on a schedule. */
  live: boolean
}) {
  const range = story.range
  const years = range ? Math.max(1, (ms(range.to) - ms(range.from)) / (365.25 * 86_400_000)) : 1
  // Fill the space there is; scroll sideways only when the range needs more than that.
  const scroller = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(0)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setRoom(el.clientWidth - LABEL_W - 16)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [replayKey])
  const width = Math.max(MIN_W, room, Math.round(years * PX_PER_YEAR))
  const x = useMemo(() => {
    if (!range) return () => 0
    const a = ms(range.from)
    const span = Math.max(1, ms(range.to) - a)
    return (d: string) => ((ms(d) - a) / span) * width
  }, [range, width])
  const anchor = story.changes?.since ?? story.spec?.since ?? range?.today
  // Open on what the question is about: the focus window, else Today (long journeys scroll sideways).
  useEffect(() => {
    const el = scroller.current
    if (!el || !range || !anchor) return
    el.scrollLeft = Math.max(0, x(anchor < range.from ? range.from : anchor) - el.clientWidth * 0.3)
  }, [range, anchor, x, replayKey])
  const pinOf = useMemo(() => {
    const m = new Map<string, number>()
    notes.forEach((n, i) => n.eventIds.forEach((id) => m.has(id) || m.set(id, i + 1)))
    return m
  }, [notes])

  if (!range) return null
  let step = 0
  const delay = () => (live ? null : STEP_DELAY * step++)
  const eventDelay = (base: number | null, i: number) => (base === null ? null : base + Math.min(i * 0.025, 1.2))

  const ticks: { x: number; label: string }[] = []
  const firstYear = Number(range.from.slice(0, 4))
  const lastYear = Number(range.to.slice(0, 4))
  const every = width / years < 48 ? Math.ceil(48 / (width / years)) : 1
  for (let y = firstYear; y <= lastYear; y++) {
    if ((y - firstYear) % every) continue
    const tx = x(`${y}-01-01`)
    if (tx >= 0 && tx <= width) ticks.push({ x: tx, label: String(y) })
  }
  const todayX = range.today >= range.from && range.today <= range.to ? x(range.today) : null
  const since = story.changes?.since ?? story.spec?.since
  const focus = since && since <= range.to ? { left: Math.max(0, x(since)), right: todayX ?? width } : null

  const closes = story.market?.closes ?? []
  const pricePath = (() => {
    if (closes.length < 2) return null
    const vals = closes.map((c) => c.close)
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const y = (v: number) => PRICE - 8 - ((v - lo) / Math.max(1e-9, hi - lo)) * (PRICE - 16)
    return closes.map((c, i) => `${i ? 'L' : 'M'}${x(c.date).toFixed(1)},${y(c.close).toFixed(1)}`).join(' ')
  })()

  const approvals = story.approvals ?? []
  const maxLevel = Math.max(1, approvals.length)
  const axisDelay = delay()

  return (
    <div key={replayKey} ref={scroller} className="relative overflow-x-auto overscroll-x-contain" data-testid="story-timeline">
      <div className="relative" style={{ width: width + LABEL_W }}>
        {/* time axis */}
        <Row label="" height={AXIS} delay={axisDelay}>
          {ticks.map((t) => (
            <span key={t.label} className="absolute top-[4px] -translate-x-1/2 font-mono text-[11px] text-muted-foreground" style={{ left: t.x }}>
              {t.label}
            </span>
          ))}
        </Row>
        {/* focus window, Today and year grid span every row */}
        <div aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 z-0" style={{ left: LABEL_W, width }}>
          {ticks.map((t) => (
            <span key={t.label} className="absolute top-0 bottom-0 w-px bg-hair" style={{ left: t.x }} />
          ))}
          {focus && (
            <span className="absolute top-0 bottom-0 border-x border-[#2347D9]/30 bg-[#2347D9]/[0.06] duration-700 animate-in fade-in fill-mode-both" style={{ left: focus.left, width: Math.max(2, focus.right - focus.left), animationDelay: axisDelay === null ? undefined : `${axisDelay}s` }}>
              <span className="absolute top-[4px] left-[4px] rounded-[4px] bg-primary-soft px-[4px] text-[10px] font-semibold whitespace-nowrap text-primary">since {formatDate(since)}</span>
            </span>
          )}
          {todayX !== null && (
            <span className="absolute top-0 bottom-0 border-l border-dashed border-foreground" style={{ left: todayX }}>
              <span className="absolute top-[2px] left-[4px] rounded-[4px] bg-foreground px-[4px] text-[10px] font-semibold text-background">Today</span>
            </span>
          )}
        </div>

        {/* approvals staircase */}
        {approvals.length > 0 && (() => {
          const d = delay()
          return (
            <Row label="Approved" sub="FDA + EU, cumulative" height={STAIR} delay={d}>
              {approvals.map((a, i) => {
                const left = x(a.date)
                const right = i + 1 < approvals.length ? x(approvals[i + 1]!.date) : width
                const h = 10 + (a.level / maxLevel) * (STAIR - 26)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onSelect({ id: a.id } as StoryEvent)}
                    title={`${formatDate(a.date)} · ${a.product} (${a.region})`}
                    className="absolute bottom-0 origin-bottom border-t-2 border-[#2347D9] bg-primary-soft text-left duration-500 animate-in fade-in slide-in-from-bottom-3 fill-mode-both hover:bg-[#E0EAFF] motion-reduce:animate-none"
                    style={{ left, width: Math.max(2, right - left), height: h, animationDelay: d === null ? undefined : `${d + i * 0.08}s` }}
                  >
                    <span className="absolute -top-[16px] left-[2px] text-[10px] font-semibold whitespace-nowrap text-primary" style={{ top: i % 2 ? -26 : -15 }}>
                      {a.product}
                      <span className="font-normal text-muted-foreground"> {a.region} {a.date.slice(0, 4)}</span>
                    </span>
                  </button>
                )
              })}
            </Row>
          )
        })()}

        {/* share price */}
        {pricePath && (
          <Row label={story.market!.ticker} sub="share price" height={PRICE} delay={delay()}>
            <svg width={width} height={PRICE} className="absolute inset-0" aria-label={`${story.market!.ticker} weekly close`}>
              <path d={pricePath} fill="none" stroke="#98A2B3" strokeWidth={1.25} />
            </svg>
          </Row>
        )}

        {/* one lane per evidence type */}
        {story.lanes.map((lane) => {
          const d = delay()
          const groups = clusterEvents(lane.events, x)
          return (
            <Row key={lane.category} label={CATEGORY_LABEL[lane.category]} sub={`${lane.events.length}${lane.total > lane.events.length ? ` of ${lane.total}` : ''}`} height={ROW} delay={d}>
              <span aria-hidden="true" className="absolute right-0 left-0 h-0.5 bg-[#EAECF0]" style={{ top: ROW / 2 - 1 }} />
              {groups.map((g, i) =>
                g.events.length === 1 ? (
                  <EventMark key={g.events[0]!.id} e={g.events[0]!} x={g.x} top={ROW / 2} color={CATEGORY_COLOR[lane.category]} selected={selectedId === g.events[0]!.id} pin={pinOf.get(g.events[0]!.id)} onSelect={onSelect} delay={eventDelay(d, i)} />
                ) : (
                  <ClusterMark key={g.events[0]!.id} events={g.events} x={g.x} color={CATEGORY_COLOR[lane.category]} selected={g.events.some((e) => e.id === selectedId)} pin={g.events.map((e) => pinOf.get(e.id)).find((n) => n !== undefined)} onSelect={onSelectMany} delay={eventDelay(d, i)} />
                ),
              )}
              {lane.events.length === 0 && <span className="absolute top-[12px] left-[12px] text-[12px] text-muted-foreground">No events in this range</span>}
            </Row>
          )
        })}

        {/* the comparison asset, on the same axis */}
        {story.compare && (() => {
          const d = delay()
          const evs = story.compare.events
          const groups = clusterEvents(evs, x)
          return (
            <Row label={story.compare.asset.name} sub="compared" height={ROW} delay={d} className="bg-background">
              <span aria-hidden="true" className="absolute right-0 left-0 border-t-2 border-dashed border-[#D0D5DD]" style={{ top: ROW / 2 - 1 }} />
              {groups.map((g, i) =>
                g.events.length === 1 ? (
                  <EventMark key={g.events[0]!.id} e={g.events[0]!} x={g.x} top={ROW / 2} color={CATEGORY_COLOR[g.events[0]!.category] ?? '#667085'} selected={selectedId === g.events[0]!.id} onSelect={onSelect} delay={eventDelay(d, i)} faded />
                ) : (
                  <ClusterMark key={g.events[0]!.id} events={g.events} x={g.x} color="#98A2B3" selected={g.events.some((e) => e.id === selectedId)} onSelect={onSelectMany} delay={eventDelay(d, i)} />
                ),
              )}
            </Row>
          )
        })()}
      </div>
    </div>
  )
}
