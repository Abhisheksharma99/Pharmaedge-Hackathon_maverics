/** Key events per year from `thisYear − 11` to `thisYear + 1` (README §5.2): this year in primary, next year dashed. */
export function Sparkline({ events, thisYear }: { events: { date: string }[]; thisYear: number }) {
  const from = thisYear - 11
  const counts = new Map<number, number>()
  for (const e of events) {
    const year = Number(e.date.slice(0, 4))
    if (year >= from && year <= thisYear + 1) counts.set(year, (counts.get(year) ?? 0) + 1)
  }
  const years = Array.from({ length: 13 }, (_, i) => from + i)
  const max = Math.max(3, ...years.map((y) => counts.get(y) ?? 0))
  return (
    <svg
      width="100%"
      height="30"
      viewBox={`0 0 ${years.length * 10} 30`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Key events per year, ${from}–${thisYear + 1}`}
      className="block"
    >
      {years.map((y, i) => {
        const n = counts.get(y) ?? 0
        const h = Math.max(1.5, (n / max) * 28)
        const future = y > thisYear
        return (
          <rect
            key={y}
            data-year={y}
            data-count={n}
            x={i * 10 + 1.5}
            y={30 - h}
            width={7}
            height={h}
            rx={1.5}
            fill={future ? '#fff' : y === thisYear ? '#2347d9' : '#c7d1f4'}
            stroke={future ? '#98a2b3' : 'none'}
            strokeWidth={0.8}
            strokeDasharray={future ? '2 1.5' : undefined}
          />
        )
      })}
    </svg>
  )
}
