import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/format'
import { useAdverseEvents } from '../api'
import { EmptyState, Panel } from './panel'

const config = { count: { label: 'Reports', color: 'var(--chart-1)' } } satisfies ChartConfig

/** FAERS reports received per year. A volume signal (usage + reporting), not a safety verdict. */
export function AdverseEventsChart({ assetId }: { assetId: string }) {
  const series = useAdverseEvents(assetId)
  const byYear = new Map<string, number>()
  for (const { month, count } of series.data ?? []) {
    const year = month.slice(0, 4)
    byYear.set(year, (byYear.get(year) ?? 0) + count)
  }
  const data = [...byYear.entries()].map(([year, count]) => ({ year, count }))
  const total = data.reduce((sum, d) => sum + d.count, 0)

  return (
    <Panel
      title="Adverse event reports (FDA FAERS)"
      description={total ? `${formatNumber(total)} reports. Volume reflects usage and reporting, not a safety verdict.` : undefined}
    >
      {series.isPending && <Skeleton className="m-5 h-40" />}
      {series.data && data.length === 0 && <EmptyState title="No FAERS reports for this asset" />}
      {data.length > 0 && (
        <ChartContainer config={config} className="h-48 w-full px-2 py-3">
          <BarChart data={data} margin={{ left: 4, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="year" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => formatNumber(v)} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartContainer>
      )}
    </Panel>
  )
}
