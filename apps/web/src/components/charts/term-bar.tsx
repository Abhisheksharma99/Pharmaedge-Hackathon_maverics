import { todayIso, yearFraction } from '@/lib/dates'

/** Trial / patent term (start → end) with the elapsed share filled and a Today marker. */
export function TermBar({
  start,
  end,
  label,
  color,
  today = todayIso(),
}: {
  start: string
  end: string
  label: string
  color: string
  today?: string
}) {
  const t0 = yearFraction(start)
  const t1 = yearFraction(end)
  const now = yearFraction(today)
  const lo = Math.min(t0, now) - 0.5
  const hi = Math.max(t1, now) + 0.5
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100
  const done = t1 > t0 ? Math.min(1, Math.max(0, (now - t0) / (t1 - t0))) : now >= t1 ? 1 : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-[22px] rounded-md border border-hair bg-background">
        <span
          className="absolute top-1 bottom-1 overflow-hidden rounded border"
          style={{ left: `${pct(t0)}%`, width: `${Math.max(0.8, pct(t1) - pct(t0))}%`, background: `${color}26`, borderColor: color }}
        >
          <i className="block h-full opacity-80" style={{ width: `${done * 100}%`, background: color }} />
        </span>
        <span className="absolute -top-1 -bottom-1 w-0 border-l-[1.5px] border-dashed border-foreground" style={{ left: `${pct(now)}%` }}>
          <em className="absolute -top-3.5 -left-3.5 text-[10px] font-semibold not-italic">Today</em>
        </span>
      </div>
      <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{start}</span>
        <span>{label}</span>
        <span>{end}</span>
      </div>
    </div>
  )
}
