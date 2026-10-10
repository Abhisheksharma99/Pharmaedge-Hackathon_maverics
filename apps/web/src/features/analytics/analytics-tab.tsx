import { Activity, Clock, Database, FlaskConical, Landmark } from 'lucide-react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router'
import { ChartCard, ChartGrid } from '@/components/charts/chart-card'
import { Donut } from '@/components/charts/donut'
import { Funnel } from '@/components/charts/funnel'
import { Gantt, GanttScroll, type GanttRow } from '@/components/charts/gantt'
import { HBars } from '@/components/charts/h-bars'
import { Heat } from '@/components/charts/heat'
import { StackBars } from '@/components/charts/stack-bars'
import { Stat, StatRow } from '@/components/charts/stat'
import { VBars } from '@/components/charts/v-bars'
import { LoadError } from '@/features/assets/components/competitors/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { shortIndication } from '@/features/assets/components/competitors/utils'
import { useAssetContext } from '@/features/assets/pages/asset-layout'
import { CATEGORY_META, collectionMeta, PHASE_COLORS, SIGNIFICANCE_COLORS } from '@/features/journey/constants'
import type { EventCategory } from '@/features/journey/types'
import { relativeFuture, todayIso, yearFraction } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { useCardFilter } from '@/components/card-filters'
import { approvedIndications } from './approved'
import { useAssetAnalytics, type AnalyticsLandscapeRow, type AnalyticsTrial, type AssetAnalytics } from './api'
import { mergeSafety, pipelineFacets, pipelineText, trialFacets, trialText } from './card-filter-defs'
import { CardBar, NoMatch } from './card-bar'
import { PipelineMatrix } from './pipeline-matrix'
import { phaseColor, phaseGroup, phaseTag, sortTrialsByPhase } from './trial-phase'

const PHASES = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4']
const APPROVED_SHOWN = 4
const COVERAGE = {
  approved: { label: 'Approved', bg: '#e6f4f2', fg: '#0b7a6f', t: 'approved in' },
  investigational: { label: 'In trials', bg: '#fffaeb', fg: '#b54708', t: 'investigational in' },
  none: { label: '—', bg: '#f9fafb', fg: '#98a2b3', t: 'Not pursued' },
}

/** "Pulmonary arterial hypertension (PAH)" → "PAH". */
const shortLabel = (s: string) => /\(([^()]+)\)\s*$/.exec(s)?.[1] ?? s

const Empty = ({ children }: { children: ReactNode }) => <p className="py-[24px] text-center text-[12px] text-muted-foreground">{children}</p>

/** Axis range padded to whole years around the dated rows and today. */
function yearRange(values: number[]): [number, number] {
  const now = yearFraction(todayIso())
  const finite = [...values, now].filter(Number.isFinite)
  return [Math.floor(Math.min(...finite)) - 1, Math.ceil(Math.max(...finite)) + 1]
}

/** Rows grouped by phase (Phase 1 first), each phase by start date. */
function trialRows(trials: AnalyticsTrial[]): GanttRow[] {
  return sortTrialsByPhase(trials).map((t) => ({
    l: t.name,
    sub: `${t.indication || 'No indication'} · n=${formatNumber(t.enrollment)}`,
    s: yearFraction(t.start),
    e: yearFraction(t.pcd),
    c: phaseColor(t.phase),
    tag: phaseTag(t.phase),
    dash: /terminat|unknown/i.test(t.status),
    tip: `${t.title} · ${t.status}`,
    group: phaseGroup(t.phase),
  }))
}

const ENROLMENT_COLORS = ['#2347d9', '#0b7a6f', '#6941c6', '#e0620f', '#5873e8', '#98a2b3', '#b54708']

function enrolment(trials: AnalyticsTrial[]) {
  const byIndication = new Map<string, number>()
  for (const t of trials) {
    if (!t.enrollment) continue
    const k = t.indication ? shortIndication(t.indication) : 'Unspecified'
    byIndication.set(k, (byIndication.get(k) ?? 0) + t.enrollment)
  }
  return [...byIndication.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l, v], i) => ({ l, v, c: ENROLMENT_COLORS[i % ENROLMENT_COLORS.length]! }))
}

function PipelineCard({ rows }: { rows: AssetAnalytics['pipeline'] }) {
  const { filtered, filters } = useCardFilter(rows, pipelineText, pipelineFacets)
  return (
    <>
      <CardBar {...filters} collapseKey="analytics.pipeline" placeholder="Search indications" />
      {filtered.length ? <PipelineMatrix rows={filtered} /> : <NoMatch />}
    </>
  )
}

function TrialTimeline({ trials }: { trials: AnalyticsTrial[] }) {
  const { filtered, filters } = useCardFilter(trials, trialText, trialFacets('Indication', 'Phase', 'Status'))
  // The axis covers every trial so the bars keep their place while filtering.
  const [t0, t1] = yearRange(trials.flatMap((t) => [yearFraction(t.start), yearFraction(t.pcd)]))
  return (
    <>
      <CardBar {...filters} collapseKey="analytics.trial-timeline" placeholder="Search trials" />
      {filtered.length ? (
        <GanttScroll>
          <Gantt from={t0} to={t1} rows={trialRows(filtered)} />
        </GanttScroll>
      ) : (
        <NoMatch />
      )}
    </>
  )
}

function TrialsByPhase({ trials }: { trials: AnalyticsTrial[] }) {
  const { filtered, filters } = useCardFilter(trials, trialText, trialFacets('Indication', 'Status'))
  return (
    <>
      <CardBar {...filters} collapseKey="analytics.trials-by-phase" placeholder="Search trials" />
      <VBars data={PHASES.map((p) => ({ l: p.replace('Phase ', 'P'), v: filtered.filter((t) => t.phase === p).length, c: PHASE_COLORS[p] }))} />
    </>
  )
}

function EnrolmentByIndication({ trials }: { trials: AnalyticsTrial[] }) {
  const { filtered, filters } = useCardFilter(trials, trialText, trialFacets('Phase', 'Status'))
  const data = enrolment(filtered)
  return (
    <>
      <CardBar {...filters} collapseKey="analytics.enrolment" placeholder="Search trials" />
      {data.length ? <HBars data={data} /> : <NoMatch />}
    </>
  )
}

function Landscape({ landscape }: { landscape: AssetAnalytics['landscape'] }) {
  const short = landscape.cols.map(shortLabel)
  const covered = (r: AnalyticsLandscapeRow) => landscape.cols.filter((c) => r.cells[c] && r.cells[c] !== 'none').map(shortLabel)
  const { filtered, filters } = useCardFilter(landscape.rows, (r) => `${r.name} ${r.company ?? ''}`, [{ label: 'Indication', of: covered }])
  const picked = filters.selects[0]?.value
  const cols = picked ? short.filter((c) => c === picked) : short
  return (
    <>
      <CardBar {...filters} collapseKey="analytics.landscape" placeholder="Search assets" />
      {filtered.length ? (
        <Heat
          cols={cols}
          rows={filtered.map((r) => ({ l: r.name, sub: r.me ? 'this asset' : (r.company ?? undefined), cells: r.cells }))}
          cell={(r, col) => {
            const c = COVERAGE[(r.cells[landscape.cols[short.indexOf(col)]!] ?? 'none') as keyof typeof COVERAGE] ?? COVERAGE.none
            return { label: c.label, bg: c.bg, fg: c.fg, t: c.label === '—' ? c.t : `${r.l}: ${c.t} ${col}` }
          }}
        />
      ) : (
        <NoMatch />
      )}
    </>
  )
}

function ApprovedList({ items, regions }: { items: ReturnType<typeof approvedIndications>; regions: string[] }) {
  if (!items.length) return <span className="truncate text-[12px] text-muted-foreground">{regions.join(', ') || '—'}</span>
  const rest = items.slice(APPROVED_SHOWN)
  return (
    <ul className="m-0 flex list-none flex-col gap-[1px] p-0 text-[12px] text-muted-foreground">
      {items.slice(0, APPROVED_SHOWN).map((a) => (
        <li key={a.indication} className="truncate">
          <b className="font-semibold text-foreground">{a.indication}</b>
          {' · '}
          {a.regions.join(', ') || '—'}
        </li>
      ))}
      {rest.length > 0 && (
        <li>
          <span tabIndex={0} title={rest.map((a) => `${a.indication} · ${a.regions.join(', ') || '—'}`).join('\n')} className="cursor-help font-medium text-primary">
            +{rest.length} more
          </span>
        </li>
      )}
    </ul>
  )
}

function Stats({ data, regions, trialCount }: { data: AssetAnalytics; regions: string[]; trialCount: number }) {
  const s = data.stats
  const events = data.significance.High + data.significance.Medium + data.significance.Low
  return (
    <StatRow>
      <Stat icon={Landmark} label="Approved indications" value={s.approvedIndications} color="#0b7a6f">
        <ApprovedList items={approvedIndications(data, regions)} regions={regions} />
      </Stat>
      <Stat icon={FlaskConical} label="In development" value={s.inDevelopment.length} sub={s.inDevelopment.join(', ') || '—'} />
      <Stat
        icon={Activity}
        label="Active trials"
        value={data.trials.length ? s.activeTrials : trialCount}
        sub={data.trials.length ? `${s.phase3} in Phase 3 · ${formatNumber(s.patients)} patients` : 'ClinicalTrials.gov'}
      />
      <Stat
        icon={Clock}
        label="Next catalyst"
        value={s.nextCatalyst ? relativeFuture(s.nextCatalyst.date).replace(/^in /, '') : '—'}
        sub={s.nextCatalyst ? s.nextCatalyst.title : 'None scheduled'}
        color="#2347d9"
      />
      <Stat icon={Database} label="Evidence records" value={formatNumber(s.evidenceRecords)} sub={`${formatNumber(events)} journey events`} />
    </StatRow>
  )
}

function Charts({ data }: { data: AssetAnalytics }) {
  const { activityByYear, trials, recordsByYear, sourceMix, triageFunnel: fn, landscape, significance } = data
  const years = recordsByYear.map((r) => r.year)
  const evCols = years.length ? Array.from({ length: Math.max(...years) - Math.min(...years) + 1 }, (_, i) => Math.min(...years) + i) : []
  const evSeries = [...new Set(recordsByYear.map((r) => r.coll))].map((coll) => ({
    k: coll,
    l: coll.replace('_records', ''),
    c: collectionMeta(coll).color,
    vals: evCols.map((y) => recordsByYear.filter((r) => r.coll === coll && r.year === y).reduce((s, r) => s + r.n, 0)),
  }))
  const funnel = [
    { l: 'Unstructured records', v: fn.screened, c: '#98a2b3' },
    { l: 'Relevant to the asset', v: fn.relevant, c: '#5873e8' },
    { l: 'Ingested in full', v: fn.ingested, c: '#2347d9' },
    { l: 'Event candidates', v: fn.candidates, c: '#6941c6' },
    { l: 'Journey events', v: fn.journey, c: '#0b7a6f' },
  ]
  return (
    <ChartGrid>
      <ChartCard title="Development pipeline" description="Furthest stage reached per indication, derived from trials, filings and approvals on the journey" span={2}>
        {data.pipeline.length ? <PipelineCard rows={data.pipeline} /> : <Empty>No indications or branches yet.</Empty>}
      </ChartCard>
      <ChartCard title="Journey activity by year" description="Events per year by category; hover a year for the breakdown" span={2}>
        {activityByYear.cols.length ? (
          <StackBars
            cols={activityByYear.cols}
            every={activityByYear.cols.length > 18 ? 2 : 1}
            series={mergeSafety(activityByYear).series.map((s) => ({ ...s, c: CATEGORY_META[s.k as EventCategory]?.color ?? '#98a2b3' }))}
          />
        ) : (
          <Empty>No dated journey events yet.</Empty>
        )}
      </ChartCard>
      {trials.length > 0 && (
        <ChartCard title="Clinical trial timeline" description="Grouped by phase, then start date; coloured by phase" span={2}>
          <TrialTimeline trials={trials} />
        </ChartCard>
      )}
      {trials.length > 0 && (
        <ChartCard title="Trials by phase">
          <TrialsByPhase trials={trials} />
        </ChartCard>
      )}
      {trials.length > 0 && (
        <ChartCard title="Enrolment by indication" description="Patients across all studies">
          <EnrolmentByIndication trials={trials} />
        </ChartCard>
      )}
      {evSeries.length > 0 && (
        <ChartCard title="Evidence collected over time" description="Stored records by the year they describe" span={2}>
          <StackBars cols={evCols} every={evCols.length > 18 ? 2 : 1} series={evSeries} />
        </ChartCard>
      )}
      {sourceMix.length > 0 && (
        <ChartCard title="Source mix">
          <Donut data={sourceMix.map((m) => ({ l: m.coll.replace('_records', ''), v: m.n, c: collectionMeta(m.coll).color }))} sub="records" />
        </ChartCard>
      )}
      {fn.screened > 0 && (
        <ChartCard title="AI triage funnel" description="Unstructured records to journey events">
          <Funnel steps={funnel} />
        </ChartCard>
      )}
      {landscape.rows.length > 1 && landscape.cols.length > 0 && (
        <ChartCard title="Competitive landscape" description="Indication coverage of ranked competitors" span={2}>
          <Landscape landscape={landscape} />
        </ChartCard>
      )}
      <ChartCard title="Significance mix">
        <Donut
          sub="events"
          data={(['High', 'Medium', 'Low'] as const).map((k) => ({ l: k, v: significance[k], c: SIGNIFICANCE_COLORS[k] }))}
        />
      </ChartCard>
    </ChartGrid>
  )
}

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-[20px]" role="status" aria-label="Loading analytics">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-px overflow-hidden rounded-[14px] border bg-border">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-[8px] bg-card px-[16px] py-[14px]">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-[30px] w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <ChartGrid>
        {[2, 2, 2, 1, 1].map((span, i) => (
          <div
            key={i}
            className={`rounded-[14px] border bg-card p-[16px] ${span === 2 ? 'min-[701px]:col-span-2' : ''}`}
          >
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-[6px] h-3 w-56" />
            <Skeleton className="mt-[16px] h-[150px] w-full" />
          </div>
        ))}
      </ChartGrid>
    </div>
  )
}

/** Asset Analytics tab (README §7.1): stat row and chart grid over `/assets/:id/analytics`. */
export function AnalyticsTab() {
  const asset = useAssetContext()
  const { assetId = '' } = useParams()
  const q = useAssetAnalytics(asset?.id ?? assetId)
  if (q.isPending) return <AnalyticsSkeleton />
  if (q.isError) return <LoadError message="Analytics couldn't be loaded." onRetry={() => void q.refetch()} />
  return (
    <div className="flex flex-col gap-[20px]">
      <Stats data={q.data} regions={asset?.kpis?.approvalRegions ?? []} trialCount={asset?.counts?.trials ?? 0} />
      <Charts data={q.data} />
    </div>
  )
}
