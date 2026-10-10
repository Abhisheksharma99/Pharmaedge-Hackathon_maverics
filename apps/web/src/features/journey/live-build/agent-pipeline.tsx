import { Check, CircleDashed, Database, Filter, Loader2, Route, Sparkle, TriangleAlert, Users, type LucideIcon } from 'lucide-react'
import { useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { isActive, type JobStep } from '@/features/jobs/api'
import { stepShort } from '@/features/jobs/steps'
import { formatNumber } from '@/lib/format'
import { useElementWidth } from '@/lib/use-element-width'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { CATEGORIES, CATEGORY_META, collectionMeta } from '../constants'
import type { JobProgress, JourneyEventV3 } from '../types'
import { categoryCounts, stepRecordCount, triageCounts, viaCounts } from './build-model'
import { AG_COLL, AG_COLUMNS, AG_EDGES, AG_H, AG_NODES, AG_REASON, AG_SRC, AG_W, edgeState, nodeVisible } from './pipeline-layout'

type Status = JobStep['status']

const NODE = 'absolute rounded-lg border bg-card transition-[border-color,box-shadow,background-color,color] duration-300'
const SHIMMER: CSSProperties = {
  backgroundImage: 'linear-gradient(90deg, transparent 0%, #eef2fd 50%, transparent 100%)',
  backgroundSize: '60% 100%',
  backgroundRepeat: 'no-repeat',
}

function tone(status: Status): string {
  if (status === 'pending') return 'animate-ag-in border-dashed border-[#cfd4dc] bg-[#fcfcfd] text-muted-foreground'
  if (status === 'running') return 'animate-node-run border-primary shadow-[0_0_0_3px_rgba(35,71,217,0.12)]'
  return 'animate-ag-in'
}

const REASON_ICON: Record<string, LucideIcon> = { journey: Route, ai_triage: Filter, ai_events: Sparkle, index: Database }
const REASON_WAITING: Record<string, string> = {
  journey: 'Waits for structured records',
  ai_triage: 'Waits for unstructured records',
  ai_events: 'Extract, date and consolidate',
  index: 'Passages for Asset AI',
}

/** A step that failed or was skipped carries its reason (shown as a warning). */
const warning = (s: JobStep) => (s.status === 'failed' || s.status === 'skipped' ? (s.error ?? s.status) : null)

function StatusGlyph({ status, warn }: { status: Status; warn?: string | null }) {
  if (status === 'running') return <Loader2 aria-hidden="true" className="size-[13px] shrink-0 animate-spin text-primary" />
  if (warn) {
    return (
      <span title={warn} className="inline-flex shrink-0 text-[#c4690f]">
        <TriangleAlert aria-hidden="true" className="size-[12px]" />
      </span>
    )
  }
  if (status === 'done') {
    return (
      <span className="inline-flex size-[14px] shrink-0 animate-ag-in items-center justify-center rounded-full bg-success text-white">
        <Check aria-hidden="true" className="size-[10px]" strokeWidth={3} />
      </span>
    )
  }
  return <CircleDashed aria-hidden="true" className="size-[13px] shrink-0 text-[#c0c6d0]" />
}

/** The legend for the panel header: Planned / Running / Done. */
export function PipelineLegend() {
  return (
    <div className="flex items-center gap-[14px] text-[12px] text-text-secondary">
      <span className="flex items-center gap-[6px]">
        <i className="size-[12px] rounded border border-dashed border-[#b8bfca] bg-[#fcfcfd]" />
        Planned
      </span>
      <span className="flex items-center gap-[6px]">
        <i className="size-[12px] rounded border border-primary shadow-[0_0_0_2px_rgba(35,71,217,0.15)]" />
        Running
      </span>
      <span className="flex items-center gap-[6px]">
        <i className="size-[12px] rounded border border-success bg-success" />
        Done
      </span>
    </div>
  )
}

/**
 * The agent pipeline (README §6.1; geometry from design_files/aj/graph.jsx): source agents → record store → reasoning →
 * outputs, drawn in a 1100×470 design space scaled to the panel (0.58–1.25). Nodes exist for the steps the job plans
 * (dashed until they run) and for collections that hold records; active edges carry particles unless the user
 * prefers reduced motion. Elements keep stable keys, so polls don't replay their entrance animations.
 */
export function AgentPipeline({ job, events, competitors }: { job: JobProgress; events: JourneyEventV3[]; competitors: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const uid = useId().replace(/[^\w-]/g, '')
  const scale = width ? Math.min(1.25, Math.max(0.58, width / AG_W)) : 1
  const offset = width ? Math.max(0, (width - AG_W * scale) / 2) : 0

  const byName = new Map(job.steps.map((s) => [s.name, s]))
  const plan = new Set(byName.keys())
  const order = new Map(job.steps.map((s, i) => [s.name, i]))
  const records = Object.fromEntries(job.records.map((r) => [r.coll, r.count]))
  const maxRecords = Math.max(1, ...job.records.map((r) => r.count))
  const visible = (key: string) => nodeVisible(key, plan, records)
  const edges = AG_EDGES.filter((e) => visible(e.from) && visible(e.to)).map((e) => ({ ...e, state: edgeState(e.steps, byName) }))
  const box = (key: string, step?: string): CSSProperties => {
    const n = AG_NODES[key]!
    return { left: n.x, top: n.y, width: n.w, height: n.h, animationDelay: step ? `${(order.get(step) ?? 0) * 60}ms` : undefined }
  }

  const via = viaCounts(events)
  const cats = categoryCounts(events)
  const ended = !isActive(job.status)
  const building = ['journey', 'ai_events', 'finalize'].some((n) => byName.get(n)?.status === 'running')
  const index = byName.get('index')
  const finalize = byName.get('finalize')
  const comp = byName.get('competitors')

  const reasonSub = (name: string, s: JobStep): string => {
    if (s.status === 'pending') return REASON_WAITING[name] ?? ''
    if (s.status !== 'running' && s.status !== 'done') return warning(s) ?? ''
    if (name === 'journey') return `${s.status === 'done' ? (s.counts.events ?? 0) : via.journey} events by rule`
    if (name === 'ai_triage') {
      if (s.status === 'running') return 'Triaging stored records'
      const t = triageCounts(s.counts)
      return `${t.kept} kept · ${t.dropped} dropped`
    }
    if (name === 'ai_events') return s.status === 'running' ? `${via.ai_events} events` : `${via.ai_events} events · ${s.counts.events ?? 0} candidates`
    return s.status === 'running' ? 'Chunking records for Asset AI' : `${formatNumber(s.counts.chunks ?? 0)} passages`
  }

  return (
    <div ref={ref} className="relative overflow-x-auto overflow-y-hidden" style={{ height: AG_H * scale + 16 }}>
      <div
        data-stage
        className="absolute top-[8px] left-0 origin-top-left"
        style={{ width: AG_W, height: AG_H, transform: `translateX(${offset}px) scale(${scale})` }}
      >
        {AG_COLUMNS.map(([label, x]) => (
          <div key={label} className="absolute top-[2px] text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase" style={{ left: x }}>
            {label}
          </div>
        ))}
        <svg
          role="img"
          aria-labelledby={`${uid}-title`}
          aria-describedby={`${uid}-desc`}
          width={AG_W}
          height={AG_H}
          viewBox={`0 0 ${AG_W} ${AG_H}`}
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
        >
          <title id={`${uid}-title`}>Agent pipeline</title>
          <desc id={`${uid}-desc`}>
            Connections from source agents to the record store, reasoning steps and outputs for {job.assetName}: {edges.filter((e) => e.state === 'active').length}{' '}
            active, {edges.filter((e) => e.state === 'done').length} complete, {edges.filter((e) => e.state === 'pending').length} planned.
          </desc>
          {edges.map((e) => {
            const active = e.state === 'active'
            return (
              <g key={e.id} data-edge={e.id} data-state={e.state}>
                <path
                  id={`${uid}-${e.id}`}
                  d={e.d}
                  pathLength={1}
                  fill="none"
                  strokeDasharray={1}
                  strokeDashoffset={1}
                  stroke={active ? e.color : e.state === 'done' ? '#c9d0dc' : '#e8ebf0'}
                  strokeWidth={active ? (e.faint ? 1.2 : 1.9) : 1.5}
                  opacity={e.faint ? (active ? 0.45 : 0.4) : active ? 0.7 : 1}
                  className="animate-draw transition-[stroke,opacity] duration-400"
                />
                {active &&
                  !reduced &&
                  [0, 1, 2].map((k) => (
                    <circle key={k} data-particle r={e.faint ? 2 : 2.8} fill={e.color} style={{ filter: 'drop-shadow(0 0 2px rgba(35,71,217,0.35))' }}>
                      <animateMotion dur={e.faint ? '1.1s' : '1.5s'} repeatCount="indefinite" begin={`-${k * 0.5}s`}>
                        <mpath href={`#${uid}-${e.id}`} />
                      </animateMotion>
                    </circle>
                  ))}
              </g>
            )
          })}
        </svg>

        {AG_SRC.filter((n) => visible(`s:${n}`)).map((n) => {
          const s = byName.get(n)!
          const warn = warning(s)
          const count = stepRecordCount(s)
          return (
            <div
              key={n}
              data-node={`s:${n}`}
              data-status={s.status}
              title={warn ? `${s.label} · ${warn}` : s.label}
              className={cn(NODE, tone(s.status), 'flex items-center gap-[7px] px-[9px] text-[12px]')}
              style={{ ...box(`s:${n}`, n), ...(s.status === 'running' && SHIMMER) }}
            >
              <StatusGlyph status={s.status} warn={warn} />
              <span className={cn('min-w-0 flex-1 truncate font-medium text-foreground', s.status === 'pending' && 'font-normal text-muted-foreground')}>
                {stepShort(s)}
              </span>
              <span className="font-mono text-[11.5px] text-text-secondary tabular-nums">{count === null ? '' : formatNumber(count)}</span>
            </div>
          )
        })}

        {AG_COLL.filter((c) => visible(`c:${c}`)).map((c) => {
          const n = records[c] ?? 0
          const filling = edges.some((e) => e.to === `c:${c}` && e.state === 'active')
          return (
            <div
              key={c}
              data-node={`c:${c}`}
              className={cn(NODE, 'flex animate-ag-in flex-col justify-center gap-[6px] bg-[#fcfcfd] px-[10px]', filling && 'border-[#b8c4ef] shadow-[0_0_0_3px_rgba(35,71,217,0.07)]')}
              style={box(`c:${c}`)}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11.5px] text-secondary-foreground">{c}</span>
                <span className="font-mono text-[12px] font-semibold tabular-nums">{formatNumber(n)}</span>
              </div>
              <div className="h-[3px] overflow-hidden rounded-[2px] bg-accent">
                <i className="block h-full rounded-[2px] transition-[width] duration-300" style={{ width: `${(n / maxRecords) * 100}%`, background: collectionMeta(c).color }} />
              </div>
            </div>
          )
        })}

        {AG_REASON.filter((n) => visible(`r:${n}`)).map((n) => {
          const s = byName.get(n)!
          const Icon = REASON_ICON[n]!
          return (
            <div
              key={n}
              data-node={`r:${n}`}
              data-status={s.status}
              className={cn(NODE, tone(s.status), 'flex items-center gap-[10px] overflow-hidden px-[12px]')}
              style={{ ...box(`r:${n}`, n), ...(s.status === 'running' && SHIMMER) }}
            >
              <span
                className={cn(
                  'flex size-[32px] shrink-0 items-center justify-center rounded-[9px] bg-muted text-text-secondary transition-colors duration-300',
                  s.status === 'running' && 'bg-primary-soft text-primary',
                  s.status === 'done' && 'bg-success-soft text-success',
                )}
              >
                <Icon aria-hidden="true" className="size-[15px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('flex items-center gap-[6px] text-[13px] font-semibold text-foreground', s.status === 'pending' && 'text-text-secondary')}>
                  {stepShort(s)}
                  {(n === 'ai_triage' || n === 'ai_events') && (
                    <span className="rounded bg-violet-soft px-[5px] text-[10px] leading-[15px] font-semibold text-violet">AI</span>
                  )}
                </div>
                <div className="mt-[2px] truncate text-[11.5px] text-text-secondary">{reasonSub(n, s)}</div>
              </div>
              <StatusGlyph status={s.status} warn={warning(s)} />
              {s.status === 'running' && (
                <div className="absolute inset-x-0 bottom-0 h-[3px] bg-primary-soft">
                  <i className="block h-full w-full animate-blink-dot bg-primary" />
                </div>
              )}
            </div>
          )
        })}

        {visible('o:journey') && (
          <div
            data-node="o:journey"
            className={cn(
              NODE,
              'flex animate-ag-in flex-col gap-[6px] px-[14px] py-[12px]',
              ended
                ? 'border-[#9fd3cb] shadow-[0_0_0_4px_rgba(11,122,111,0.08)]'
                : building
                  ? 'border-primary shadow-[0_0_0_4px_rgba(35,71,217,0.10)]'
                  : !events.length && 'border-dashed',
            )}
            style={box('o:journey')}
          >
            <OutputHeader icon={Route} tile="bg-primary text-white" label="Journey">
              <span
                className={cn(
                  'rounded-full bg-muted px-[7px] py-[2px] text-[11px] font-semibold text-muted-foreground',
                  ended ? 'bg-success-soft text-success' : (events.length > 0 || building) && 'bg-primary-soft text-primary',
                )}
              >
                {ended ? 'Ready' : events.length > 0 || building ? 'Building' : 'Waiting'}
              </span>
            </OutputHeader>
            <div className="mt-[2px] flex items-baseline gap-[6px]">
              <span className="text-[40px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{formatNumber(events.length)}</span>
              <span className="text-text-secondary">events</span>
            </div>
            <div className="mt-[4px] flex h-[6px] gap-[2px] overflow-hidden rounded-[3px]">
              {CATEGORIES.map((c) =>
                cats[c] > 0 ? <i key={c} className="block transition-[flex-grow] duration-400" style={{ flexGrow: cats[c], background: CATEGORY_META[c].color }} /> : null,
              )}
              {!events.length && <i className="block grow bg-hair" />}
            </div>
            <ul className="mt-[4px] grid grid-cols-2 gap-x-[12px] gap-y-[3px] text-[11.5px] text-text-secondary">
              {CATEGORIES.map((c) => (
                <li key={c} className="flex items-center gap-[5px]">
                  <b className="size-[6px] rounded-full" style={{ background: CATEGORY_META[c].color }} />
                  {CATEGORY_META[c].label}
                  <em className="ml-auto font-mono text-[11px] text-foreground not-italic">{cats[c]}</em>
                </li>
              ))}
            </ul>
            <div className="mt-auto truncate font-mono text-[10.5px] text-muted-foreground">
              rules {via.journey} · ai {via.ai_events} · rebuild {via.finalize}
            </div>
          </div>
        )}

        {index && visible('o:assetai') && (
          <div data-node="o:assetai" className={cn(NODE, tone(index.status), 'flex flex-col gap-[6px] px-[14px] py-[12px]')} style={box('o:assetai')}>
            <OutputHeader icon={Sparkle} tile="bg-violet-soft text-violet" label="Asset AI">
              <StatusGlyph status={finalize?.status === 'done' ? 'done' : index.status === 'running' ? 'running' : 'pending'} />
            </OutputHeader>
            <div className="truncate text-[11.5px] text-text-secondary">
              {index.status === 'pending'
                ? 'Index builds after triage'
                : `${formatNumber(index.counts.chunks ?? 0)} passages · ${finalize?.counts.suggested_questions ?? 0} questions`}
            </div>
          </div>
        )}

        {comp && visible('o:compset') && (
          <div data-node="o:compset" className={cn(NODE, tone(comp.status), 'flex flex-col gap-[6px] px-[14px] py-[12px]')} style={box('o:compset')}>
            <OutputHeader icon={Users} tile="bg-orange-soft text-orange" label="Competitor set">
              <StatusGlyph status={comp.status} warn={warning(comp)} />
            </OutputHeader>
            {comp.status === 'done' && competitors.length > 0 ? (
              <div className="flex flex-wrap gap-[4px]">
                {competitors.slice(0, 5).map((c) => (
                  <span key={c} className="animate-ag-in rounded-[5px] bg-orange-soft px-[6px] py-px text-[11px] text-competitor">
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <div className="truncate text-[11.5px] text-text-secondary">
                {comp.status === 'done' ? `${stepRecordCount(comp) ?? 0} competitors` : 'Top 5 by indication and mechanism'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function OutputHeader({ icon: Icon, tile, label, children }: { icon: LucideIcon; tile: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-[8px]">
      <span className={cn('flex size-[28px] shrink-0 items-center justify-center rounded-lg', tile)}>
        <Icon aria-hidden="true" className="size-[15px]" />
      </span>
      <span className="flex-1 font-semibold text-foreground">{label}</span>
      {children}
    </div>
  )
}
