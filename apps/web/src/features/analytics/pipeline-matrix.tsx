import { STAGES, BRANCH_PALETTE } from '@/features/journey/constants'
import { relativeFuture } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { PipelineRow } from './api'

const COLS = 'grid-cols-[minmax(96px,180px)_repeat(5,minmax(30px,1fr))_minmax(110px,180px)] @max-[640px]:grid-cols-[84px_repeat(5,minmax(0,1fr))]'
const HATCH = 'repeating-linear-gradient(45deg,#d0d5dd 0 6px,#e4e7ec 6px 12px)'
const READOUT = /^(Phase \d readout expected|FDA decision expected \(PDUFA date\)): /

/** Development pipeline: one bar per branch/indication to its furthest stage, with the next milestone on the right. */
export function PipelineMatrix({ rows }: { rows: PipelineRow[] }) {
  return (
    <div className="flex flex-col gap-[6px] text-[12px]">
      <div className={cn('grid items-center', COLS)} aria-hidden="true">
        <span className="pl-[10px] text-left text-[10.5px] font-semibold tracking-[0.05em] text-muted-foreground uppercase @max-[640px]:text-[9px] @max-[640px]:tracking-normal" />
        {STAGES.map((s) => (
          <span key={s} className="text-center text-[10.5px] font-semibold tracking-[0.05em] text-muted-foreground uppercase @max-[640px]:text-[9px] @max-[640px]:tracking-normal">
            {s}
          </span>
        ))}
        <span className="pl-[10px] text-left text-[10.5px] font-semibold tracking-[0.05em] text-muted-foreground uppercase @max-[640px]:hidden">Next</span>
      </div>
      {rows.map((r, i) => {
        const color = r.color ?? BRANCH_PALETTE[i % BRANCH_PALETTE.length]!
        const stage = STAGES[Math.min(Math.max(r.stage, 0), STAGES.length - 1)]!
        const ended = !!r.ended
        return (
          <div key={r.id} className={cn('grid items-center', COLS)}>
            <span className="flex min-w-0 items-center gap-[6px]">
              <i className="size-[8px] shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
              <b className="font-[650]">{r.label}</b>
              <em className="truncate text-[11px] text-muted-foreground not-italic @max-[900px]:hidden">{r.full}</em>
            </span>
            <span className="relative grid h-[30px] grid-cols-5 rounded-[8px] bg-background [grid-column:span_5]">
              {STAGES.map((s, k) => (
                <i key={s} className={cn('border-l border-dashed border-[#e4e7ec]', k === 0 && 'border-l-0')} />
              ))}
              <span
                className="absolute top-[5px] bottom-[5px] left-0 flex origin-left animate-grow-x items-center justify-end rounded-[6px] pr-[8px]"
                style={{
                  width: `${((r.stage + 0.55) / STAGES.length) * 100}%`,
                  background: ended ? HATCH : color,
                  animationDelay: `${i * 80}ms`,
                }}
              >
                <em className={cn('text-[11px] font-semibold whitespace-nowrap not-italic @max-[640px]:text-[10px]', ended ? 'text-secondary-foreground' : 'text-white')}>
                  {ended ? `${stage} · terminated` : stage}
                </em>
              </span>
            </span>
            <span className="flex min-w-0 flex-col pl-[10px] leading-[1.25] @max-[640px]:hidden">
              {r.next ? (
                <>
                  <b className="truncate text-[11.5px] font-medium">{r.next.title.replace(READOUT, '')}</b>
                  <em className="text-[11px] font-semibold text-primary not-italic">{relativeFuture(r.next.date)}</em>
                </>
              ) : (
                <em className="text-[11px] font-semibold text-primary not-italic">{r.since ? `since ${r.since.slice(0, 4)}` : '—'}</em>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
