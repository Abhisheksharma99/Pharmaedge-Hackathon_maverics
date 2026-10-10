import { Clock, Pill } from 'lucide-react'
import { relativeFuture } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { CATEGORY_META, NOTE_TAGS } from './constants'
import type { Branch, JourneyEventV3, NoteTag } from './types'

/** Branch chip (README §6.2 `ln-chip`): label in the branch colour, tinted fill and border, never colour alone. */
export function BranchChip({ branch, small, current, className }: { branch: Pick<Branch, 'label' | 'color'>; small?: boolean; current?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-[5px] rounded-full border px-[8px] font-semibold whitespace-nowrap',
        small ? 'h-[20px] text-[11px]' : 'h-[22px] text-[11.5px]',
        current && 'shadow-[0_0_0_2px_currentColor]',
        className,
      )}
      style={{ color: branch.color, background: `${branch.color}14`, borderColor: `${branch.color}40` }}
    >
      <i aria-hidden="true" className="size-[6px] rounded-full" style={{ background: branch.color }} />
      {branch.label}
    </span>
  )
}

/** "in 9 months" next to an expected milestone. */
export function CountdownChip({ date }: { date: string }) {
  return (
    <span className="inline-flex items-center gap-[4px] rounded-full bg-primary-soft px-[7px] py-px text-[11.5px] font-semibold whitespace-nowrap text-primary">
      <Clock className="size-[11px]" aria-hidden="true" />
      {relativeFuture(date)}
    </span>
  )
}

/** Team note tag in its tag colour. */
export function NoteTagChip({ tag }: { tag: NoteTag }) {
  const c = NOTE_TAGS[tag]?.color ?? 'var(--violet)'
  return (
    <span
      className="inline-flex h-[20px] items-center rounded-full border px-[8px] text-[11px] font-semibold whitespace-nowrap"
      style={{ color: c, background: `color-mix(in srgb, ${c} 10%, #fff)`, borderColor: `color-mix(in srgb, ${c} 30%, #fff)` }}
    >
      {tag}
    </span>
  )
}

/** Indication pills (category soft colour), product pill and region tag; nothing when the event has none. */
export function Targets({ e, label = false, small, limit }: { e: JourneyEventV3; label?: boolean; small?: boolean; limit?: number }) {
  const meta = CATEGORY_META[e.category] ?? CATEGORY_META.regulatory
  const inds = (e.indications ?? []).slice(0, limit)
  if (!inds.length && !e.product) return null
  const pill = cn('inline-flex items-center gap-[5px] rounded-full whitespace-nowrap', small ? 'h-[20px] px-[7px] text-[11px]' : 'h-[24px] px-[9px] text-[12px]')
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {label && <span className="mr-[2px] text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Targets</span>}
      {inds.map((i) => (
        <span key={i} className={cn(pill, 'font-semibold')} style={{ background: meta.soft, color: meta.color }}>
          {i}
        </span>
      ))}
      {e.product && (
        <span className={cn(pill, 'border bg-card font-medium text-secondary-foreground')}>
          {!small && <Pill className="size-[11px]" aria-hidden="true" />}
          {e.product}
        </span>
      )}
      {label && e.region && <span className="rounded-[5px] bg-muted px-[6px] py-px font-mono text-[11px] text-secondary-foreground">{e.region}</span>}
    </div>
  )
}

/** Identifiers read better in mono (README §6.2 details grid). */
const MONO = /^(NCT|NDA|ANDA|BLA|US ?\d|US |PMID|EMEA|EP\d|WO\d)/

/** Key facts grid (auto-fill 140px cells, 1px hairlines). */
export function DetailsGrid({ details, className }: { details: Record<string, string> | null | undefined; className?: string }) {
  const rows = Object.entries(details ?? {}).filter(([, v]) => v !== null && v !== undefined && String(v) !== '')
  if (!rows.length) return null
  return (
    <dl className={cn('grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-px overflow-hidden rounded-[10px] border border-hair bg-hair', className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0 bg-card px-[10px] py-[7px]">
          <dt className="text-[11px] text-muted-foreground">{k}</dt>
          <dd className={cn('mt-[2px] text-[12.5px] font-medium [overflow-wrap:anywhere]', MONO.test(String(v)) && 'font-mono')}>{String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}
