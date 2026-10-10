import { TriangleAlert } from 'lucide-react'
import { Donut } from '@/components/charts/donut'
import { HBars } from '@/components/charts/h-bars'
import { StackBars } from '@/components/charts/stack-bars'
import { VBars } from '@/components/charts/v-bars'
import type { AnalyticsSpec } from '@/features/journey/types'
import { formatMonth } from '@/lib/format'
import { MilestoneList } from './milestone-list'
import { rows } from './spec-renderable'

/** Renders an AI-built analytic (DATA_CONTRACTS `AnalyticsSpec`). Unknown shapes fall back to a note, never throw. */
export function SpecChart({ spec }: { spec: AnalyticsSpec }) {
  const d = rows(spec.data)
  if (spec.chart === 'hbar' && d.length) return <HBars data={d} unit={spec.unit} />
  if (spec.chart === 'bars' && d.length) return <VBars h={110} data={d} unit={spec.unit} />
  if (spec.chart === 'donut' && d.length) return <Donut size={120} data={d.map((x) => ({ ...x, c: x.c ?? '#98a2b3' }))} />
  if (spec.chart === 'stack' && spec.cols && spec.series?.length) return <StackBars h={120} cols={spec.cols} series={spec.series} />
  if (spec.chart === 'list' && d.length) {
    const items = d as unknown as { l: string; sub?: string; d: string }[]
    return (
      <MilestoneList
        items={items.slice(0, 5).map((x) => ({
          key: x.l,
          month: formatMonth(x.d).split(' ')[0]!,
          year: x.d.slice(0, 4),
          title: x.l,
          sub: x.sub ?? '',
        }))}
      />
    )
  }
  return (
    <p className="m-0 flex gap-1.5 text-[12.5px] text-warning">
      <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
      {spec.chart === 'none' ? (spec.note ?? 'Not available.') : 'This chart can’t be shown here.'}
    </p>
  )
}
