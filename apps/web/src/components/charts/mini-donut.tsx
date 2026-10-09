import type { Slice } from './donut'

/** Small evidence donut in the event detail sheet. */
export function MiniDonut({ data, size = 92, label = 'records' }: { data: Slice[]; size?: number; label?: string }) {
  const total = data.reduce((s, d) => s + d.v, 0)
  const r = size / 2 - 7
  const C = 2 * Math.PI * r
  const mid = size / 2
  const lens = data.map((d) => (total ? (d.v / total) * C : 0))
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0))
  return (
    <svg width={size} height={size} role="img" aria-label={`${total} ${label}`}>
      {data.map((d, i) => (
        <circle
          key={d.l}
          cx={mid}
          cy={mid}
          r={r}
          fill="none"
          stroke={d.c}
          strokeWidth={12}
          strokeDasharray={`${Math.max(0, lens[i]! - 1.5)} ${C}`}
          strokeDashoffset={-offsets[i]!}
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      ))}
      <text x="50%" y="48%" textAnchor="middle" className="fill-foreground text-[18px] font-semibold">
        {total}
      </text>
      <text x="50%" y="64%" textAnchor="middle" className="fill-muted-foreground text-[9.5px]">
        {label}
      </text>
    </svg>
  )
}
