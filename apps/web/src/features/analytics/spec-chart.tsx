import { TriangleAlert } from 'lucide-react'
import { useCardFilter, type FilterFacet } from '@/components/card-filters'
import { Donut } from '@/components/charts/donut'
import { HBars } from '@/components/charts/h-bars'
import { StackBars } from '@/components/charts/stack-bars'
import { VBars } from '@/components/charts/v-bars'
import { shortIndication } from '@/features/assets/components/competitors/utils'
import type { AnalyticsSpec } from '@/features/journey/types'
import { formatMonth } from '@/lib/format'
import { CardBar, NoData } from './card-bar'
import { MilestoneList } from './milestone-list'
import { isRenderable, rows } from './spec-renderable'

/** A spec row as the AI may have written it: label first, optionally tagged with an indication or category. */
type Item = { l: string; sub?: string; indication?: unknown; category?: unknown }

const field = (it: Item, k: 'indication' | 'category') => (typeof it[k] === 'string' && it[k] ? [it[k] as string] : [])

/** Search over labels always; Indication / Category dropdowns only when the rows carry that field. */
function facetsFor(items: Item[]): FilterFacet<Item>[] {
  const out: FilterFacet<Item>[] = []
  if (items.some((i) => field(i, 'indication').length)) out.push({ label: 'Indication', of: (i) => field(i, 'indication').map(shortIndication) })
  if (items.some((i) => field(i, 'category').length)) out.push({ label: 'Category', of: (i) => field(i, 'category') })
  return out
}

/** Renders an AI-built analytic (DATA_CONTRACTS `AnalyticsSpec`). Unknown shapes fall back to a note, never throw. */
export function SpecChart({ spec }: { spec: AnalyticsSpec }) {
  if (isRenderable(spec)) return <FilteredSpec spec={spec} />
  return (
    <p className="m-0 flex gap-1.5 text-[12.5px] text-warning">
      <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
      {spec.chart === 'none' ? (spec.note ?? 'Not available.') : 'This chart can’t be shown here.'}
    </p>
  )
}

function FilteredSpec({ spec }: { spec: AnalyticsSpec }) {
  const d = rows(spec.data)
  // A stacked chart filters its series; every other chart its rows.
  const items: Item[] = spec.chart === 'stack' ? (spec.series ?? []) : d
  const facets = facetsFor(items)
  const { filtered, filters } = useCardFilter(items, (i) => `${i.l} ${i.sub ?? ''}`, facets)
  const placeholder = facets.some((f) => f.label === 'Indication') ? 'Search labels' : 'Search labels (rows have no indication)'
  const bar = <CardBar {...filters} collapseKey={`analytics.spec.${spec.id}`} placeholder={placeholder} />
  if (!filtered.length)
    return (
      <>
        {bar}
        <NoData />
      </>
    )
  const kept = filtered as typeof d
  return (
    <>
      {bar}
      {spec.chart === 'hbar' && <HBars data={kept} unit={spec.unit} />}
      {spec.chart === 'bars' && <VBars h={110} data={kept} unit={spec.unit} />}
      {spec.chart === 'donut' && <Donut size={120} data={kept.map((x) => ({ ...x, c: x.c ?? '#98a2b3' }))} />}
      {spec.chart === 'stack' && <StackBars h={120} cols={spec.cols!} series={filtered as NonNullable<AnalyticsSpec['series']>} />}
      {spec.chart === 'list' && (
        <MilestoneList
          items={(filtered as unknown as { l: string; sub?: string; d: string }[]).slice(0, 5).map((x) => ({
            key: x.l,
            month: formatMonth(x.d).split(' ')[0]!,
            year: x.d.slice(0, 4),
            title: x.l,
            sub: x.sub ?? '',
          }))}
        />
      )}
    </>
  )
}
