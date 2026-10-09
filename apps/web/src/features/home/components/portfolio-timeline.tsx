import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { Segmented } from '@/features/assets/components/segmented'
import { useJobProgress, useJobs, type Job } from '@/features/jobs/api'
import { jobProgress, runningByAsset } from '@/features/jobs/steps'
import { CATEGORIES, CATEGORY_META, COLLECTION_META, collectionMeta } from '@/features/journey/constants'
import type { JourneyEventV3 } from '@/features/journey/types'
import { formatDay, formatMonth, todayIso, yearFraction } from '@/lib/dates'
import { useElementWidth } from '@/lib/use-element-width'
import { useEventSheet } from '@/stores/event-sheet-store'
import { eventsByAsset, usePortfolioTimeline, type PortfolioAsset } from '../api'
import { DOT_RADIUS, RANGE_OPTIONS, rangeBounds, rangeTicks, type PortfolioRange } from '../portfolio-scale'

const ROW = 46
const RIGHT_PAD = 14
const MIN_WIDTH = 300
const COLLECTIONS = Object.keys(COLLECTION_META)

const keyOf = (e: JourneyEventV3) => `${e.asset}|${e.id}`
const whenLabel = (e: JourneyEventV3) => (e.is_milestone ? `expected ${formatMonth(e.date)}` : formatDay(e.date))

/** Home "Portfolio timeline" (README §5.2): every tracked journey on one axis; a dot opens the event sheet. */
export function PortfolioTimeline() {
  const running = runningByAsset(useJobs({ status: 'running' }).data)
  const portfolio = usePortfolioTimeline({ live: running.size > 0 })
  // Only an onboarding build shows "Building" and whole-history record ticks; a routine refresh leaves the row as is.
  const onboarding = new Map([...running].filter(([, job]) => job.type === 'onboard'))
  const [range, setRange] = useState<PortfolioRange>('3y')
  const [showCompetitors, setShowCompetitors] = useState(false)
  const data = portfolio.data
  const rows = (data?.assets ?? []).filter((a) => a.kind === 'primary' || showCompetitors)

  return (
    <Panel
      title="Portfolio timeline"
      description="Every journey on one axis. Hollow markers are expected milestones; select one to see its evidence."
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
            <Switch checked={showCompetitors} onCheckedChange={setShowCompetitors} aria-label="Show competitors" />
            Show competitors
          </label>
          <Segmented label="Range" value={range} options={RANGE_OPTIONS} onChange={setRange} />
        </div>
      }
    >
      {portfolio.isPending && (
        <div className="space-y-2 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {portfolio.isError && <p className="p-5 text-destructive">The portfolio timeline couldn't be loaded.</p>}
      {data && rows.length === 0 && <EmptyState title="No assets yet">Add a drug by name with Asset AI to see its journey here.</EmptyState>}
      {data && rows.length > 0 && (
        <>
          <PortfolioPlot assets={data.assets} rows={rows} events={data.events} range={range} running={onboarding} />
          <Legend />
        </>
      )}
    </Panel>
  )
}

/** Mounted with data, so the width is measured on the element that is actually drawn. */
function PortfolioPlot({
  assets,
  rows,
  events,
  range,
  running,
}: {
  assets: PortfolioAsset[]
  rows: PortfolioAsset[]
  events: JourneyEventV3[]
  range: PortfolioRange
  running: Map<string, Job>
}) {
  const openEvent = useEventSheet((s) => s.openEvent)
  const [hover, setHover] = useState<string | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(plotRef)

  const names = new Map(assets.map((a) => [a.id, a.name]))
  const today = yearFraction(todayIso())
  const dated = events.filter((e) => Number.isFinite(yearFraction(e.date)))
  const [y0, y1] = rangeBounds(range, today, dated.map((e) => yearFraction(e.date)))
  const inView = eventsByAsset(
    dated.filter((e) => {
      const v = yearFraction(e.date)
      return v >= y0 && v <= y1
    }),
  )
  const ticks = rangeTicks(range, y0, y1)
  const W = Math.max(width, MIN_WIDTH)
  const plotH = rows.length * ROW
  const x = (v: number) => ((v - y0) / (y1 - y0)) * (W - RIGHT_PAD)
  const tx = x(today)
  const hovered = hover ? dated.find((e) => keyOf(e) === hover) : undefined
  const hoveredRow = hovered ? rows.findIndex((a) => a.id === hovered.asset) : -1

  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] py-3 pr-4 pl-1 sm:grid-cols-[210px_minmax(0,1fr)]">
      <div className="flex flex-col pb-6">
        {rows.map((a) => (
          <RowLabel key={a.id} asset={a} job={running.get(a.id)} names={names} />
        ))}
      </div>
      <div ref={plotRef} className="relative min-w-0">
        <svg width={W} height={plotH + 24} className="block overflow-visible" role="group" aria-label="Portfolio events">
          <defs>
            <pattern id="portfolio-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#eef0f3" strokeWidth="2" />
            </pattern>
          </defs>
          {rows.map((a, i) => (
            <rect key={a.id} x={0} y={i * ROW} width={W - RIGHT_PAD} height={ROW} fill={i % 2 ? '#fff' : '#fafbfc'} />
          ))}
          <rect x={tx} y={0} width={Math.max(0, W - RIGHT_PAD - tx)} height={plotH} fill="url(#portfolio-hatch)" />
          {ticks.map((t) => (
            <line key={t.v} x1={x(t.v)} x2={x(t.v)} y1={0} y2={plotH} stroke="#eef0f3" />
          ))}
          {rows.map((a, i) => {
            const cy = i * ROW + ROW / 2
            const job = running.get(a.id)
            return (
              <g key={a.id}>
                <line x1={0} x2={W - RIGHT_PAD} y1={cy} y2={cy} stroke="#e4e7ec" strokeDasharray={a.kind === 'competitor' ? '2 3' : undefined} />
                {job && <RecordTicks jobId={job.id} cy={cy} x={x} y0={y0} y1={y1} />}
                {(inView.get(a.id) ?? []).map((e) => (
                  <Dot
                    key={keyOf(e)}
                    event={e}
                    assetName={a.name}
                    cx={x(yearFraction(e.date))}
                    cy={cy}
                    active={hover === keyOf(e)}
                    onHover={setHover}
                    onOpen={() => openEvent(e.asset, e.id)}
                  />
                ))}
              </g>
            )
          })}
          <line x1={tx} x2={tx} y1={0} y2={plotH + 4} stroke="#101828" strokeDasharray="3 3" />
          {ticks
            .filter((t) => Math.abs(x(t.v) - tx) > 34)
            .map((t) => (
              <text key={t.v} x={x(t.v)} y={plotH + 18} textAnchor="middle" className="fill-muted-foreground font-mono text-[10.5px]">
                {t.label}
              </text>
            ))}
          <text x={tx} y={plotH + 18} textAnchor="middle" className="fill-foreground text-[10.5px] font-semibold">
            Today
          </text>
        </svg>
        {hovered && hoveredRow >= 0 && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-20 flex w-max max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+8px)] flex-col rounded-lg bg-foreground px-2.5 py-[7px] text-[12px] leading-snug text-white"
            style={{ left: x(yearFraction(hovered.date)), top: hoveredRow * ROW + ROW / 2 - 8 }}
          >
            <b className="font-medium">{hovered.title}</b>
            <span className="text-[11.5px] text-[#c3c9d4]">
              {names.get(hovered.asset) ?? hovered.asset} · {whenLabel(hovered)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function RowLabel({ asset, job, names }: { asset: PortfolioAsset; job?: Job; names: Map<string, string> }) {
  const sub =
    asset.kind === 'competitor'
      ? asset.competitorOf.length
        ? `vs ${asset.competitorOf.map((id) => names.get(id) ?? id).join(', ')}`
        : 'Competitor'
      : (asset.company ?? '')
  return (
    <Link to={`/assets/${encodeURIComponent(asset.id)}/overview`} style={{ height: ROW }} className="flex items-center gap-2.5 rounded-lg px-3 transition-colors hover:bg-accent">
      <AssetTile name={asset.name} kind={asset.kind} size={26} />
      <span className="flex min-w-0 flex-col">
        <b className="truncate font-semibold">{asset.name}</b>
        <span className="truncate text-[12px] text-muted-foreground max-sm:hidden">
          {job ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-warning">
              <i aria-hidden="true" className="size-1.5 animate-blink-dot rounded-full bg-current" />
              Building · {Math.round(jobProgress(job) * 100)}%
            </span>
          ) : (
            sub
          )}
        </span>
      </span>
    </Link>
  )
}

function Dot({
  event: e,
  assetName,
  cx,
  cy,
  active,
  onHover,
  onOpen,
}: {
  event: JourneyEventV3
  assetName: string
  cx: number
  cy: number
  active: boolean
  onHover: (key: string | null) => void
  onOpen: () => void
}) {
  const color = CATEGORY_META[e.category]?.color ?? '#98a2b3'
  const r = DOT_RADIUS[e.significance] ?? DOT_RADIUS.Low
  const key = keyOf(e)
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${e.title}, ${assetName}, ${whenLabel(e)}`}
      className="cursor-pointer outline-none"
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(key)}
      onBlur={() => onHover(null)}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          onOpen()
        }
      }}
    >
      <circle
        cx={cx}
        cy={cy}
        r={active ? r + 2 : r}
        fill={e.is_milestone ? '#fff' : color}
        stroke={active ? '#101828' : e.is_milestone ? color : '#fff'}
        strokeWidth={e.is_milestone ? 1.8 : 1.5}
        strokeDasharray={e.is_milestone ? '2.4 1.8' : undefined}
      />
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
    </g>
  )
}

/**
 * Key events only exist once a crawl's finalize step has run, so while an asset is being built its row shows the
 * records collected so far, by year and collection (GET /jobs/:id `record_years`), refreshed every 2 s.
 */
function RecordTicks({ jobId, cy, x, y0, y1 }: { jobId: string; cy: number; x: (v: number) => number; y0: number; y1: number }) {
  const job = useJobProgress(jobId)
  const years = (job.data?.record_years ?? []).filter((r) => r.year + 0.5 >= y0 && r.year + 0.5 <= y1)
  const max = Math.max(1, ...years.map((r) => r.n))
  return (
    <g aria-hidden="true">
      {years.map((r) => {
        const h = 4 + (r.n / max) * 14
        const slot = Math.max(0, COLLECTIONS.indexOf(r.coll))
        return (
          <rect
            key={`${r.coll}-${r.year}`}
            data-record-tick=""
            x={x(r.year + 0.5) + (slot - 4) * 2.2}
            y={cy - h / 2}
            width={1.6}
            height={h}
            fill={collectionMeta(r.coll).color}
            opacity={0.55}
            className="animate-fade"
          />
        )
      })}
    </g>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3.5 px-5 pt-1 pb-3.5 text-[12px] text-text-secondary sm:pl-[226px]">
      {CATEGORIES.map((c) => (
        <span key={c} className="flex items-center gap-1.5">
          <i aria-hidden="true" className="size-2 rounded-full" style={{ background: CATEGORY_META[c].color }} />
          {CATEGORY_META[c].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <i aria-hidden="true" className="size-2 rounded-full border-[1.5px] border-dashed border-text-secondary bg-card" />
        Expected
      </span>
    </div>
  )
}
