import { Activity, Clock, Database, FlaskConical, Landmark, Stamp } from 'lucide-react'
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
import { useAssetAnalytics, type AnalyticsPatent, type AnalyticsTrial, type AssetAnalytics } from './api'
import { PipelineMatrix } from './pipeline-matrix'

const PHASES = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4']
const PATENT_COLORS = { invalidated: '#b42318', expired: '#98a2b3', inForce: '#6941c6' }
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

function trialRows(trials: AnalyticsTrial[]): GanttRow[] {
  return [...trials]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((t) => {
      const color = PHASE_COLORS[t.phase] ?? '#98a2b3'
      return {
        l: t.name,
        sub: `${t.indication || 'No indication'} · n=${formatNumber(t.enrollment)}`,
        s: yearFraction(t.start),
        e: yearFraction(t.pcd),
        c: color,
        tag: t.phase.replace('Phase ', 'P'),
        dash: /terminat|unknown/i.test(t.status),
        tip: `${t.title} · ${t.status}`,
      }
    })
}

function patentGantt(patents: AnalyticsPatent[]): GanttRow[] {
  return patents.map((p) => ({
    l: p.number,
    sub: p.assignee || p.title,
    s: yearFraction(p.granted),
    e: yearFraction(p.expiry),
    c: p.invalidated ? PATENT_COLORS.invalidated : p.expired ? PATENT_COLORS.expired : PATENT_COLORS.inForce,
    dash: p.invalidated,
    tag: p.invalidated ? 'invalidated' : p.expiry.slice(0, 4),
    tip: `${p.title} · ${p.status}`,
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

function Stats({ data, regions, trialCount }: { data: AssetAnalytics; regions: string[]; trialCount: number }) {
  const s = data.stats
  const today = todayIso()
  const nextExpiring = data.patents.find((p) => !p.invalidated && p.expiry > today)
  const events = data.significance.High + data.significance.Medium + data.significance.Low
  return (
    <StatRow>
      <Stat icon={Landmark} label="Approved indications" value={s.approvedIndications} sub={regions.join(', ') || '—'} color="#0b7a6f" />
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
      <Stat
        icon={Stamp}
        label="Patent runway"
        value={s.patentRunwayYears != null ? `${s.patentRunwayYears.toFixed(1)} yrs` : '—'}
        sub={s.patentRunwayYears != null && nextExpiring ? `${nextExpiring.number} · ${nextExpiring.assignee || nextExpiring.title}` : 'No curated patents'}
        color="#6941c6"
      />
      <Stat icon={Database} label="Evidence records" value={formatNumber(s.evidenceRecords)} sub={`${formatNumber(events)} journey events`} />
    </StatRow>
  )
}

function Charts({ data }: { data: AssetAnalytics }) {
  const { activityByYear, trials, recordsByYear, sourceMix, triageFunnel: fn, patents, landscape, significance } = data
  const trialYears = trials.flatMap((t) => [yearFraction(t.start), yearFraction(t.pcd)])
  const [t0, t1] = yearRange(trialYears)
  const patentYears = patents.flatMap((p) => [yearFraction(p.granted), yearFraction(p.expiry)])
  const [p0, p1] = yearRange(patentYears)
  const years = recordsByYear.map((r) => r.year)
  const evCols = years.length ? Array.from({ length: Math.max(...years) - Math.min(...years) + 1 }, (_, i) => Math.min(...years) + i) : []
  const evSeries = [...new Set(recordsByYear.map((r) => r.coll))].map((coll) => ({
    k: coll,
    l: coll.replace('_records', ''),
    c: collectionMeta(coll).color,
    vals: evCols.map((y) => recordsByYear.filter((r) => r.coll === coll && r.year === y).reduce((s, r) => s + r.n, 0)),
  }))
  const short = landscape.cols.map(shortLabel)
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
        {data.pipeline.length ? <PipelineMatrix rows={data.pipeline} /> : <Empty>No indications or branches yet.</Empty>}
      </ChartCard>
      <ChartCard title="Journey activity by year" description="Events per year by category; hover a year for the breakdown" span={2}>
        {activityByYear.cols.length ? (
          <StackBars
            cols={activityByYear.cols}
            every={activityByYear.cols.length > 18 ? 2 : 1}
            series={activityByYear.series.map((s) => ({ ...s, c: CATEGORY_META[s.k as EventCategory]?.color ?? '#98a2b3' }))}
          />
        ) : (
          <Empty>No dated journey events yet.</Empty>
        )}
      </ChartCard>
      {trials.length > 0 && (
        <ChartCard title="Clinical trial timeline" description="Start to primary completion, coloured by phase" span={2}>
          <GanttScroll>
            <Gantt from={t0} to={t1} rows={trialRows(trials)} />
          </GanttScroll>
        </ChartCard>
      )}
      {trials.length > 0 && (
        <ChartCard title="Trials by phase">
          <VBars data={PHASES.map((p) => ({ l: p.replace('Phase ', 'P'), v: trials.filter((t) => t.phase === p).length, c: PHASE_COLORS[p] }))} />
        </ChartCard>
      )}
      {trials.length > 0 && (
        <ChartCard title="Enrolment by indication" description="Patients across all studies">
          <HBars data={enrolment(trials)} />
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
      {patents.length > 0 && (
        <ChartCard title="Patent runway" description="Grant to expiry; the dashed line is today" span={2}>
          <GanttScroll>
            <Gantt from={p0} to={p1} rows={patentGantt(patents)} />
          </GanttScroll>
        </ChartCard>
      )}
      {landscape.rows.length > 1 && landscape.cols.length > 0 && (
        <ChartCard title="Competitive landscape" description="Indication coverage of ranked competitors" span={2}>
          <Heat
            cols={short}
            rows={landscape.rows.map((r) => ({ l: r.name, sub: r.me ? 'this asset' : (r.company ?? undefined), cells: r.cells }))}
            cell={(r, col) => {
              const c = COVERAGE[(r.cells[landscape.cols[short.indexOf(col)]!] ?? 'none') as keyof typeof COVERAGE] ?? COVERAGE.none
              return { label: c.label, bg: c.bg, fg: c.fg, t: c.label === '—' ? c.t : `${r.l}: ${c.t} ${col}` }
            }}
          />
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
