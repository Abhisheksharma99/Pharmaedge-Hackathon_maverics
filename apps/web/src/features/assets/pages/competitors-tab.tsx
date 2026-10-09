import { Activity, CalendarClock, Crosshair, FlaskConical, Layers, Loader2 } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMonth, formatNumber } from '@/lib/format'
import type { AssetDetail } from '../api'
import { useCompetitors, type CompetitorsOverview } from '../competitors-api'
import { CompetitiveSignals } from '../components/competitors/competitive-signals'
import { CompetitorMilestones } from '../components/competitors/competitor-milestones'
import { HeadToHead } from '../components/competitors/head-to-head'
import { IdentifyCompetitors } from '../components/competitors/identify-competitors'
import { LandscapeTable } from '../components/competitors/landscape-table'
import { LoadError } from '../components/competitors/load-error'
import { shortIndication } from '../components/competitors/utils'
import { EmptyState, KpiStrip, Panel } from '../components/panel'
import { useAssetContext } from './asset-layout'

function Kpis({ data }: { data: CompetitorsOverview }) {
  const { kpis, reference } = data
  return (
    <KpiStrip
      items={[
        {
          label: 'Tracked competitors',
          icon: Crosshair,
          value: formatNumber(kpis.tracked),
          hint: kpis.collecting > 0 ? `${kpis.collecting} still collecting` : 'By shared indication and mechanism',
        },
        {
          label: 'Competing assets',
          icon: Layers,
          value: formatNumber(Math.max(kpis.candidates, kpis.tracked)),
          hint: `${kpis.tracked} key competitors profiled below`,
        },
        {
          label: 'Indications',
          icon: Activity,
          value: formatNumber(reference.indications.length),
          hint: reference.indications.map(shortIndication).join(' · ') || undefined,
        },
        { label: 'Active Phase III', icon: FlaskConical, value: formatNumber(kpis.activePhase3), hint: 'Competitor trials in progress' },
        {
          label: 'Upcoming milestones',
          icon: CalendarClock,
          value: formatNumber(kpis.upcomingMilestones),
          hint: kpis.firstMilestone ? `Next 24 months · first ${formatMonth(kpis.firstMilestone)}` : 'Next 24 months',
        },
      ]}
    />
  )
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <Skeleton className="h-[108px] rounded-[14px]" />
      <Skeleton className="h-[360px] rounded-[14px]" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-[300px] rounded-[14px]" />
        <Skeleton className="h-[300px] rounded-[14px]" />
      </div>
    </div>
  )
}

function PrimaryCompetitors({ asset }: { asset: AssetDetail }) {
  const competitors = useCompetitors(asset.id)
  const data = competitors.data

  if (!data) {
    return competitors.isError ? (
      <LoadError message="The competitive landscape couldn't be loaded." onRetry={() => competitors.refetch()} />
    ) : (
      <Loading />
    )
  }
  if (data.kpis.tracked === 0 && data.landscape.every((r) => r.isReference)) return <IdentifyCompetitors asset={asset} />

  const { collecting } = data.kpis
  return (
    <>
      <Kpis data={data} />
      {collecting > 0 && (
        <p role="status" className="flex items-center gap-2 rounded-[10px] border border-warning-border bg-warning-soft px-3.5 py-2.5 text-warning">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {collecting === 1 ? '1 competitor is' : `${collecting} competitors are`} still being collected; figures fill in as their crawls finish.
        </p>
      )}
      <LandscapeTable data={data} />
      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <HeadToHead data={data} />
        <CompetitiveSignals signals={data.signals} />
      </div>
      <CompetitorMilestones milestones={data.milestones} />
    </>
  )
}

/** Competitor assets don't get their own landscape; point back to the primaries they compete with. */
function CompetitorNote({ asset }: { asset: AssetDetail }) {
  const primaries = (asset as { competitorOf?: { id: string; name: string }[] }).competitorOf ?? []
  return (
    <Panel title="Competitive landscape">
      <EmptyState title="Competitors are tracked for primary assets">
        {primaries.length > 0 && (
          <>
            {asset.name} is tracked as a competitor of{' '}
            {primaries.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && ', '}
                <Link to={`/assets/${encodeURIComponent(p.id)}/competitors`} className="font-medium text-primary hover:underline">
                  {p.name}
                </Link>
              </Fragment>
            ))}
            .
          </>
        )}
      </EmptyState>
    </Panel>
  )
}

export function CompetitorsTab() {
  const asset = useAssetContext()
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em]">Competitors</h2>
        <p className="mt-0.5 text-[14px] text-text-secondary">Competitive landscape and evidence comparison for {asset.name}</p>
      </div>
      {asset.kind === 'competitor' ? <CompetitorNote asset={asset} /> : <PrimaryCompetitors asset={asset} />}
    </div>
  )
}
