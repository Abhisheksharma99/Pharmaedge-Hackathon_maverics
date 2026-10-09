import { formatNumber } from '@/lib/format'
import type { Slice } from './donut'

const rate = (v: number, prev: number) => (prev > 0 ? `${Math.round((v / prev) * 100)}%` : '—')

/** Funnel (AI triage): bars sized against the largest step; labels stay visible beside the 62% track. */
export function Funnel({ steps }: { steps: Slice[] }) {
  const max = Math.max(1, ...steps.map((s) => s.v))
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((s, i) => (
        <li key={s.l} className="grid grid-cols-[62%_minmax(0,1fr)] items-center gap-2.5">
          <span className="flex">
            <span
              className="flex h-6 min-w-9 origin-left animate-grow-x items-center rounded-md px-2 text-xs text-white"
              style={{ width: `${Math.min(100, Math.max(8, (s.v / max) * 100))}%`, background: s.c, animationDelay: `${i * 80}ms` }}
            >
              <b className="font-mono font-semibold">{formatNumber(s.v)}</b>
            </span>
          </span>
          <span className="min-w-0 text-xs leading-tight text-secondary-foreground">
            {s.l}
            {i > 0 && <em className="ml-1.5 font-mono text-[11px] text-muted-foreground not-italic">{rate(s.v, steps[i - 1]!.v)}</em>}
          </span>
        </li>
      ))}
    </ol>
  )
}
