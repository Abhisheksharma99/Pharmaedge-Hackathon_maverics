import { formatNumber } from '@/lib/format'
import type { Slice } from './donut'

const rate = (v: number, prev: number) => (prev > 0 ? `${Math.round((v / prev) * 100)}%` : '—')

/** Funnel (AI triage): bars sized against the largest step; labels stay visible beside the 62% track. */
export function Funnel({ steps }: { steps: Slice[] }) {
  const max = Math.max(1, ...steps.map((s) => s.v))
  return (
    <ol className="flex flex-col gap-[6px]">
      {steps.map((s, i) => (
        <li key={s.l} className="grid grid-cols-[62%_minmax(0,1fr)] items-center gap-[10px]">
          <span className="flex">
            <span
              className="flex h-[24px] min-w-[36px] origin-left animate-grow-x items-center rounded-[6px] px-[8px] text-[12px] text-white"
              style={{ width: `${Math.min(100, Math.max(8, (s.v / max) * 100))}%`, background: s.c, animationDelay: `${i * 80}ms` }}
            >
              <b className="font-mono font-semibold">{formatNumber(s.v)}</b>
            </span>
          </span>
          <span className="min-w-0 text-[12px] leading-tight text-secondary-foreground">
            {s.l}
            {i > 0 && <em className="ml-[6px] font-mono text-[11px] text-muted-foreground not-italic">{rate(s.v, steps[i - 1]!.v)}</em>}
          </span>
        </li>
      ))}
    </ol>
  )
}
