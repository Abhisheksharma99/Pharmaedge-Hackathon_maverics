import { formatNumber } from '@/lib/format'
import type { BarDatum } from './v-bars'

/** Horizontal bars with labels that clamp to two lines (enrolment by indication, journals). */
export function HBars({ data, unit = '' }: { data: BarDatum[]; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.v))
  return (
    <ul className="flex flex-col gap-[7px]">
      {data.map((d, i) => (
        <li key={d.l} className="grid grid-cols-[minmax(70px,38%)_minmax(0,1fr)_auto] items-center gap-2 text-xs">
          <span className="line-clamp-2 leading-[1.3] text-secondary-foreground">{d.l}</span>
          <span className="h-2 overflow-hidden rounded bg-background">
            <i
              className="block h-full origin-left animate-grow-x rounded"
              style={{ width: `${(d.v / max) * 100}%`, background: d.c ?? '#2347d9', animationDelay: `${i * 50}ms` }}
            />
          </span>
          <span className="font-mono text-[11px] text-text-secondary">
            {formatNumber(d.v)}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  )
}
