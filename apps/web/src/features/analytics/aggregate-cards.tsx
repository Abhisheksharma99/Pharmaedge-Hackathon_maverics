import { useCardFilter } from '@/components/card-filters'
import { Donut } from '@/components/charts/donut'
import { StackBars } from '@/components/charts/stack-bars'
import { CATEGORY_META, SIGNIFICANCE_COLORS, collectionMeta } from '@/features/journey/constants'
import type { EventCategory } from '@/features/journey/types'
import type { AnalyticsBlocks } from './api'
import { mergeSafety } from './card-filter-defs'
import { CardBar, NoData } from './card-bar'
import {
  CATEGORY_FACET,
  INDICATION_FACET,
  SIGNIFICANCE_FACET,
  SOURCE_FACET,
  activityFromEvents,
  eventText,
  isFiltering,
  significanceFromEvents,
  sourceMixFromEvents,
  useChartEvents,
} from './event-aggregates'

const Loading = () => <p className="py-[24px] text-center text-[12px] text-muted-foreground">Loading events…</p>

/**
 * The aggregate charts (activity by year, significance mix, source mix) with their filter bars. Unfiltered they draw the
 * API's blocks; with a filter on they are recomputed from the journey's events. `compact` is the pinned Overview version.
 */
export function ActivityBody({ assetId, activity, compact }: { assetId: string; activity: AnalyticsBlocks['activityByYear']; compact?: boolean }) {
  const { events, pending } = useChartEvents(assetId)
  const { filtered, filters } = useCardFilter(events, eventText, [INDICATION_FACET, CATEGORY_FACET, SIGNIFICANCE_FACET])
  const active = isFiltering(filters)
  const data = active ? activityFromEvents(filtered, activity.cols) : mergeSafety(activity)
  const empty = active && !pending && !filtered.length
  const long = activity.cols.length > (compact ? 16 : 18)
  return (
    <>
      <CardBar {...filters} collapseKey={compact ? 'analytics.custom.activity' : 'analytics.activity'} placeholder="Search events" />
      {active && pending ? (
        <Loading />
      ) : empty ? (
        <NoData />
      ) : (
        <StackBars
          h={compact ? 120 : undefined}
          cols={data.cols}
          every={long ? (compact ? 3 : 2) : 1}
          series={data.series.map((s) => ({ ...s, c: CATEGORY_META[s.k as EventCategory]?.color ?? '#98a2b3' }))}
        />
      )}
    </>
  )
}

export function SignificanceBody({ assetId, significance, compact }: { assetId: string; significance: AnalyticsBlocks['significance']; compact?: boolean }) {
  const { events, pending } = useChartEvents(assetId)
  const { filtered, filters } = useCardFilter(events, eventText, [INDICATION_FACET, CATEGORY_FACET])
  const active = isFiltering(filters)
  const data = active ? significanceFromEvents(filtered) : significance
  return (
    <>
      <CardBar {...filters} collapseKey={compact ? 'analytics.custom.significance' : 'analytics.significance'} placeholder="Search events" />
      {active && pending ? (
        <Loading />
      ) : active && !filtered.length ? (
        <NoData />
      ) : (
        <Donut size={compact ? 120 : undefined} sub="events" data={(['High', 'Medium', 'Low'] as const).map((k) => ({ l: k, v: data[k], c: SIGNIFICANCE_COLORS[k] }))} />
      )}
    </>
  )
}

export function SourceMixBody({ assetId, sourceMix, compact }: { assetId: string; sourceMix: AnalyticsBlocks['sourceMix']; compact?: boolean }) {
  const { events, pending } = useChartEvents(assetId)
  const { filtered, filters } = useCardFilter(events, eventText, [INDICATION_FACET, SOURCE_FACET])
  const active = isFiltering(filters)
  const data = active ? sourceMixFromEvents(filtered, filters.selects.find((s) => s.label === 'Source')?.value) : sourceMix
  return (
    <>
      <CardBar {...filters} collapseKey={compact ? 'analytics.custom.sources' : 'analytics.source-mix'} placeholder="Search events" />
      {active && pending ? (
        <Loading />
      ) : active && !data.length ? (
        <NoData />
      ) : (
        <>
          <Donut
            size={compact ? 120 : undefined}
            sub="records"
            data={data.map((m) => ({ l: collectionMeta(m.coll).label, v: m.n, c: collectionMeta(m.coll).color }))}
          />
          {active && <p className="m-0 mt-[6px] text-center text-[11.5px] text-muted-foreground">Records the matching journey events cite</p>}
        </>
      )}
    </>
  )
}

/** Stored records by year: records carry no indication, so this one filters by source only. */
export function EvidenceBody({ recordsByYear }: { recordsByYear: AnalyticsBlocks['recordsByYear'] }) {
  const { filtered, filters } = useCardFilter(recordsByYear, (r) => collectionMeta(r.coll).label, [{ label: 'Source', of: (r) => [collectionMeta(r.coll).label] }])
  const colls = (rs: typeof recordsByYear) => new Set(rs.map((r) => r.coll)).size
  // The axis covers every record so the bars keep their place while filtering.
  const years = recordsByYear.map((r) => r.year)
  const cols = years.length ? Array.from({ length: Math.max(...years) - Math.min(...years) + 1 }, (_, i) => Math.min(...years) + i) : []
  const series = [...new Set(filtered.map((r) => r.coll))].map((coll) => ({
    k: coll,
    l: coll.replace('_records', ''),
    c: collectionMeta(coll).color,
    vals: cols.map((y) => filtered.filter((r) => r.coll === coll && r.year === y).reduce((s, r) => s + r.n, 0)),
  }))
  return (
    <>
      <CardBar {...filters} shown={colls(filtered)} total={colls(recordsByYear)} collapseKey="analytics.evidence" placeholder="Search sources" />
      {series.length ? <StackBars cols={cols} every={cols.length > 18 ? 2 : 1} series={series} /> : <NoData />}
    </>
  )
}
