import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { ArrowLeft, GitCompareArrows } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAssets, type AssetSummary } from '@/features/assets/api'
import { IndicationBadges, SignificanceBadge } from '@/features/assets/components/badges'
import { LoadError } from '@/features/assets/components/competitors/load-error'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { Segmented } from '@/features/assets/components/segmented'
import { todayIso } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useEventSheet } from '@/stores/event-sheet-store'
import { journeyEventsQuery, type JourneyScope, type JourneyTimeline } from '../api'
import { CATEGORIES, CATEGORY_META } from '../constants'
import { BTN_SM, CHIP, CHIP_ON, FOCUS } from '../controls'
import { eventDate } from '../format'
import { eventIndications, indicationOptions } from '../indications'
import type { JourneyEventV3 } from '../types'
import { CMP, COMPARE_COLORS, compareLayout, sharedIndications, type CompareInput, type CompareLane } from './compare-layout'
import { ComparePicker } from './compare-picker'
import { compareIds, MAX_COMPARE } from './compare-url'

const ALL_INDICATIONS = '__all__'
/** The sticky label column (asset names, lane indications). */
const LABEL_W = { wide: 188, narrow: 112 }
const AXIS_H = 30
const GROUP_HEAD = 34
const LANE_PAD = 8

const NO_EVENTS: JourneyEventV3[] = []

/** The journeys' events and states, structurally shared by TanStack Query: the same object until a journey changes. */
const combineJourneys = (rs: UseQueryResult<JourneyTimeline>[]) => ({
  events: rs.map((r) => r.data?.events ?? NO_EVENTS),
  states: rs.map((r) => ({ isPending: r.isPending, isError: r.isError, refetch: r.refetch })),
})
type JourneyState = ReturnType<typeof combineJourneys>['states'][number]

interface Tip {
  e: JourneyEventV3
  asset: string
  color: string
  /** Viewport position of the dot's centre (x) and top / bottom edge (y): the tip is `fixed`, so the scroller never clips it. */
  x: number
  y: number
  below: boolean
}

/**
 * Compare journeys (`/journey/compare?a=<assetId>&b=<assetId>[&c=…]`): up to three assets' journeys stacked on one
 * shared time axis, so the same year lines up in every group. Each asset's events sit in lanes by indication with
 * category-coloured dots; key events by default (`scope=all` for every event); one Indication filter (`ind`) applies
 * to all of them, and indications two journeys share are marked. A dot's tooltip names the event; clicking opens it in
 * the event sheet. The groups scroll sideways together when the years need more room than the screen has.
 */
export function ComparePage() {
  const [params, setParams] = useSearchParams()
  const idsKey = compareIds(params).join(',')
  const scope: JourneyScope = params.get('scope') === 'all' ? 'all' : 'key'
  const ind = params.get('ind') || null
  const assets = useAssets()
  const byId = useMemo(() => new Map((assets.data ?? []).map((a) => [a.id, a])), [assets.data])
  const picked = useMemo(() => (idsKey ? idsKey.split(',') : []).flatMap((id) => byId.get(id) ?? []), [idsKey, byId])
  const unknown = assets.data && idsKey ? idsKey.split(',').filter((id) => !byId.has(id)) : []
  const journeys = useQueries({ queries: picked.map((a) => journeyEventsQuery(a.id, scope)), combine: combineJourneys })

  const set = (k: string, v: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v) next.set(k, v)
        else next.delete(k)
        return next
      },
      { replace: true },
    )

  const inputs = useMemo<CompareInput[]>(
    () => picked.map((a, i) => ({ id: a.id, name: a.name, color: COMPARE_COLORS[i]!, events: journeys.events[i] ?? NO_EVENTS })),
    [picked, journeys.events],
  )
  const shared = useMemo(() => sharedIndications(inputs), [inputs])
  // Shared indications first.
  const options = useMemo(() => {
    const all = indicationOptions(inputs.flatMap((x) => x.events), eventIndications)
    return [...all.filter((i) => shared.has(i)), ...all.filter((i) => !shared.has(i))]
  }, [inputs, shared])

  const actions = assets.data && (
    <ComparePicker assets={assets.data} initial={picked.map((a) => a.id)} keep={params}>
      <Button variant="outline" size="sm" className={BTN_SM}>
        <GitCompareArrows /> Change assets
      </Button>
    </ComparePicker>
  )
  const back = picked[0] ? `/journey/${encodeURIComponent(picked[0].id)}` : '/journey'

  return (
    <Page
      title="Compare journeys"
      description="Each asset’s journey on one shared time axis: the same years line up, so you can see who got where first."
      actions={actions}
      crumb={
        <Link to={back} className={cn('inline-flex w-max items-center gap-[4px] rounded-sm text-[12.5px] font-medium text-text-secondary hover:text-foreground', FOCUS)}>
          <ArrowLeft className="size-[12px]" aria-hidden="true" /> Asset Journey
        </Link>
      }
    >
      {assets.isError ? (
        <LoadError message="Assets couldn't be loaded." onRetry={() => void assets.refetch()} />
      ) : assets.isPending ? (
        <Skeleton className="h-[360px] rounded-[14px]" />
      ) : picked.length < 2 ? (
        <section className="rounded-[14px] border bg-card shadow-panel">
          <EmptyState title={unknown.length ? 'Some of these assets aren’t tracked' : 'Pick two or three assets to compare'}>
            {unknown.length > 0 && <>Not tracked: {unknown.join(', ')}. </>}
            Choose up to {MAX_COMPARE} tracked assets with <b className="font-semibold">Change assets</b>.
          </EmptyState>
        </section>
      ) : (
        <Panel
          title={picked.map((a) => a.name).join(' vs ')}
          description={`${scope === 'key' ? 'Key events' : 'Every event'}${ind ? ` in ${ind}` : ''}, lanes by indication. Hover a dot for the event; click to open it.`}
          bodyClassName="flex flex-col"
        >
          <div className="flex flex-wrap items-center gap-[8px] px-[20px] py-[12px]">
            {picked.map((a, i) => (
              <Link key={a.id} to={`/journey/${encodeURIComponent(a.id)}`} className={cn(CHIP, 'text-foreground')}>
                <i aria-hidden="true" className="size-[8px] rounded-full" style={{ background: COMPARE_COLORS[i] }} />
                {a.name}
              </Link>
            ))}
            <span aria-hidden="true" className="mx-[4px] h-[20px] w-px bg-border max-[640px]:hidden" />
            <Segmented label="Events shown" value={scope} onChange={(s) => set('scope', s === 'key' ? null : s)} options={[{ value: 'key', label: 'Key events' }, { value: 'all', label: 'All' }]} />
            {(options.length > 1 || ind) && (
              <Select value={ind ?? ALL_INDICATIONS} onValueChange={(v) => set('ind', v === ALL_INDICATIONS ? null : v)}>
                <SelectTrigger size="sm" aria-label="Indication" className={cn(CHIP, 'max-w-[220px] min-w-[140px] justify-between', ind && CHIP_ON)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_INDICATIONS}>Indication: all</SelectItem>
                  {options.map((i) => (
                    <SelectItem key={i} value={i}>
                      {i}
                      {shared.has(i) && <span className="ml-[6px] text-[11px] font-semibold text-primary">shared</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-[12px] text-text-secondary">
              {CATEGORIES.map((c) => (
                <span key={c} className="inline-flex items-center gap-[5px]">
                  <i aria-hidden="true" className="size-[8px] rounded-full" style={{ background: CATEGORY_META[c].color }} />
                  {CATEGORY_META[c].label}
                </span>
              ))}
            </span>
          </div>
          {unknown.length > 0 && <p className="px-[20px] pb-[8px] text-[12.5px] text-muted-foreground">Not tracked, left out: {unknown.join(', ')}.</p>}
          <CompareChart picked={picked} inputs={inputs} states={journeys.states} ind={ind} />
        </Panel>
      )}
    </Page>
  )
}

function CompareChart({ picked, inputs, states, ind }: { picked: AssetSummary[]; inputs: CompareInput[]; states: JourneyState[]; ind: string | null }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const [tip, setTip] = useState<Tip | null>(null)
  const openEvent = useEventSheet((s) => s.openEvent)
  const labelW = width < 640 ? LABEL_W.narrow : LABEL_W.wide

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth || 1000)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The tip is placed in the viewport: any scroll (the chart's or the page's) takes it away.
  const tipShown = tip !== null
  useEffect(() => {
    if (!tipShown) return
    const hide = () => setTip(null)
    document.addEventListener('scroll', hide, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', hide, { capture: true })
  }, [tipShown])

  const L = useMemo(() => compareLayout(inputs, { fit: width - labelW, ind, today: todayIso() }), [inputs, width, labelW, ind])
  const loaded = states.every((q) => !q.isPending)
  // When the years overflow (narrow screens), open on the recent years: Today about four-fifths across.
  const scrolled = useRef(false)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !loaded || scrolled.current) return
    scrolled.current = true
    el.scrollLeft = Math.max(0, L.todayX - (width - labelW) * 0.8)
  }, [loaded, L, width, labelW])
  const show = (el: HTMLElement, e: JourneyEventV3, g: CompareInput) => {
    const r = el.getBoundingClientRect()
    const below = r.top < 190
    setTip({ e, asset: g.name, color: g.color, x: Math.min(window.innerWidth - 138, Math.max(138, r.left + r.width / 2)), y: below ? r.bottom + 6 : r.top - 6, below })
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain">
      <div data-testid="compare-chart" className="relative pb-[12px]" style={{ width: labelW + L.width }}>
        {/* Year grid and Today, behind every group: one axis for all. */}
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0" style={{ top: AXIS_H, left: labelW, width: L.width }}>
          {L.years.map((y) => (
            <span key={y.y} className={cn('absolute top-0 bottom-0 border-l border-dashed', y.label ? 'border-[#e4e7ec]' : 'border-[#f2f4f7]')} style={{ left: y.x }} />
          ))}
          <span className="absolute top-0 bottom-0 border-l border-dashed border-foreground/50" style={{ left: L.todayX }} />
        </div>
        <div aria-hidden="true" data-testid="compare-axis" className="flex border-b border-hair" style={{ height: AXIS_H }}>
          <span className="sticky left-0 z-[2] shrink-0 border-r border-hair bg-card" style={{ width: labelW }} />
          <span className="relative shrink-0" style={{ width: L.width }}>
            {L.years.map(
              (y) =>
                y.label &&
                Math.abs(y.x + L.pxPerYear / 2 - L.todayX) > 30 && (
                  <span key={y.y} data-year={y.y} className="absolute top-[8px] -translate-x-1/2 font-mono text-[11.5px] font-semibold text-text-secondary" style={{ left: y.x + L.pxPerYear / 2 }}>
                    {y.y}
                  </span>
                ),
            )}
            <span className="absolute top-[8px] -translate-x-1/2 rounded-full bg-foreground px-[6px] text-[10.5px] leading-[16px] font-semibold text-white" style={{ left: L.todayX }}>
              Today
            </span>
          </span>
        </div>
        {L.groups.map((g, gi) => {
          const a = picked[gi]!
          const q = states[gi]!
          return (
            <section key={g.asset.id} aria-label={`${g.asset.name} journey`} data-group={g.asset.id} className="relative border-b border-hair last:border-b-0">
              <div className="flex" style={{ height: GROUP_HEAD }}>
                <div className="sticky left-0 z-[2] flex shrink-0 items-center gap-[7px] border-r border-hair bg-card pr-[8px] pl-[16px] max-[640px]:pl-[10px]" style={{ width: labelW, boxShadow: `inset 3px 0 0 ${g.asset.color}` }}>
                  <b className="truncate font-[650]" style={{ color: g.asset.color }}>
                    {g.asset.name}
                  </b>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground max-[640px]:hidden">{q.isPending ? '' : g.n}</span>
                </div>
                <span className="sr-only">
                  {a.kind === 'primary' ? 'Primary' : 'Competitor'}, {a.company.name}, {g.n} events
                </span>
              </div>
              {q.isError ? (
                <div className="sticky left-0 py-[8px] pl-[16px]" style={{ width: Math.min(560, labelW + L.width) }}>
                  <LoadError message={`${g.asset.name}’s journey couldn't be loaded.`} onRetry={() => void q.refetch()} />
                </div>
              ) : q.isPending ? (
                <div className="flex">
                  <span className="sticky left-0 shrink-0 border-r border-hair bg-card" style={{ width: labelW }} />
                  <Skeleton className="my-[8px] ml-[12px] h-[44px] w-[60%] rounded-[8px]" />
                </div>
              ) : g.lanes.length === 0 ? (
                <div className="flex">
                  <span className="sticky left-0 shrink-0 border-r border-hair bg-card" style={{ width: labelW }} />
                  <p className="sticky px-[12px] py-[10px] text-[12.5px] text-muted-foreground" style={{ left: labelW }}>
                    {ind ? `No events in ${ind}.` : 'No dated events yet.'}
                  </p>
                </div>
              ) : (
                g.lanes.map((lane) => <Lane key={lane.id} lane={lane} asset={g.asset} labelW={labelW} width={L.width} onTip={show} onLeave={() => setTip(null)} onOpen={(id) => openEvent(g.asset.id, id)} />)
              )}
            </section>
          )
        })}
        {tip && <Tooltip tip={tip} />}
      </div>
    </div>
  )
}

function Lane({ lane, asset, labelW, width, onTip, onLeave, onOpen }: { lane: CompareLane; asset: CompareInput; labelW: number; width: number; onTip: (el: HTMLElement, e: JourneyEventV3, g: CompareInput) => void; onLeave: () => void; onOpen: (id: string) => void }) {
  const h = lane.rows * CMP.ROW + LANE_PAD * 2
  const x0 = lane.dots[0]!.x
  const x1 = lane.dots[lane.dots.length - 1]!.x
  // Arrow keys move along the lane; only its first dot is in the tab order.
  const onKeyDown = (ev: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    ev.preventDefault()
    const dots = [...(ev.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[data-dot]') ?? [])]
    dots[dots.indexOf(ev.currentTarget) + step]?.focus()
  }
  return (
    <div className="flex" data-lane={lane.id} style={{ height: h }}>
      <div className="sticky left-0 z-[2] flex shrink-0 items-start border-r border-hair bg-card pr-[8px] pl-[16px] max-[640px]:pl-[10px]" style={{ width: labelW, paddingTop: LANE_PAD + (CMP.ROW - 20) / 2 }}>
        <span
          title={lane.shared ? `${lane.id}: shared with another compared asset` : lane.id}
          className={cn('inline-flex h-[20px] max-w-full min-w-0 items-center gap-[4px] rounded-[6px] px-[6px] text-[11.5px] font-semibold', lane.shared ? 'bg-primary-soft text-primary ring-1 ring-primary/40' : 'bg-muted text-secondary-foreground')}
        >
          <span className="truncate">{lane.id}</span>
          {lane.shared && <span className="sr-only"> (shared)</span>}
        </span>
      </div>
      <div className={cn('relative shrink-0', lane.shared && 'bg-[color-mix(in_srgb,var(--primary-soft)_45%,transparent)]')} style={{ width }}>
        <span aria-hidden="true" className="absolute h-[2px] rounded-full opacity-35" style={{ left: x0, width: Math.max(2, x1 - x0), top: LANE_PAD + CMP.ROW / 2 - 1, background: asset.color }} />
        {lane.dots.map(({ e, x, row }, k) => {
          const c = CATEGORY_META[e.category] ?? CATEGORY_META.regulatory
          const hollow = e.is_milestone || e.via === 'user'
          const size = e.significance === 'High' ? 12 : 10
          return (
            <button
              key={e.id}
              type="button"
              data-dot={e.id}
              tabIndex={k === 0 ? 0 : -1}
              aria-label={`${eventDate(e)}: ${e.title} (${c.label})`}
              onClick={() => onOpen(e.id)}
              onMouseEnter={(ev) => onTip(ev.currentTarget, e, asset)}
              onMouseLeave={onLeave}
              onFocus={(ev) => onTip(ev.currentTarget, e, asset)}
              onBlur={onLeave}
              onKeyDown={onKeyDown}
              className="absolute flex size-[18px] -translate-x-1/2 items-center justify-center rounded-full hover:z-[1] focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-primary"
              style={{ left: x, top: LANE_PAD + row * CMP.ROW }}
            >
              <i
                aria-hidden="true"
                className="block rounded-full border-2 transition-transform hover:scale-125"
                style={{ width: size, height: size, borderColor: hollow ? c.color : '#fff', background: hollow ? '#fff' : c.color, boxShadow: hollow ? undefined : `0 0 0 1px ${c.color}` }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Tooltip({ tip }: { tip: Tip }) {
  const { e } = tip
  const c = CATEGORY_META[e.category] ?? CATEGORY_META.regulatory
  return (
    <div
      role="tooltip"
      className={cn('pointer-events-none fixed z-[60] flex w-[260px] -translate-x-1/2 flex-col gap-[6px] rounded-[10px] border bg-popover px-[12px] py-[10px] text-[12.5px] shadow-[0_10px_28px_rgba(16,24,40,0.14)]', !tip.below && '-translate-y-full')}
      style={{ left: tip.x, top: tip.y }}
    >
      <span className="flex items-center gap-[6px] text-[11.5px] text-text-secondary">
        <i aria-hidden="true" className="size-[7px] rounded-full" style={{ background: tip.color }} />
        <b className="font-semibold" style={{ color: tip.color }}>
          {tip.asset}
        </b>
        <span className="font-mono">{eventDate(e, { day: true })}</span>
        <span className="flex-1" />
        <SignificanceBadge value={e.significance} />
      </span>
      <b className="line-clamp-3 leading-[1.35] font-semibold text-pretty">{e.title}</b>
      <span className="flex flex-wrap items-center gap-[6px]">
        <span className="inline-flex items-center gap-[5px] text-[11.5px] font-semibold" style={{ color: c.color }}>
          <i aria-hidden="true" className="size-[7px] rounded-full" style={{ background: c.color }} />
          {c.label}
        </span>
        <IndicationBadges items={eventIndications(e)} max={3} />
      </span>
    </div>
  )
}
