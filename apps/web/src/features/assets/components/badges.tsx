import { FlaskConical, Landmark, Megaphone, Stamp, type LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { EventCategory, Significance } from '../api'

const SIGNIFICANCE_STYLE: Record<Significance, string> = {
  High: 'bg-danger-soft text-destructive',
  Medium: 'bg-warning-soft text-warning',
  Low: 'bg-muted text-muted-foreground',
}

export function SignificanceBadge({ value }: { value: Significance }) {
  return (
    <span className={cn('inline-flex h-[20px] items-center rounded-md px-[6px] text-[12px] font-semibold', SIGNIFICANCE_STYLE[value])}>
      {value}
    </span>
  )
}

export const CATEGORY_META: Record<EventCategory, { label: string; icon: LucideIcon; tone: string }> = {
  regulatory: { label: 'Regulatory', icon: Landmark, tone: 'bg-primary-soft text-primary' },
  clinical: { label: 'Clinical', icon: FlaskConical, tone: 'bg-success-soft text-success' },
  company: { label: 'Company', icon: Megaphone, tone: 'bg-orange-soft text-orange' },
  ip: { label: 'Patents', icon: Stamp, tone: 'bg-violet-soft text-violet' },
}

export function CategoryIcon({ category, className }: { category: EventCategory; className?: string }) {
  const meta = CATEGORY_META[category]
  return (
    <span
      className={cn('flex size-[28px] shrink-0 items-center justify-center rounded-[8px]', meta.tone, className)}
      title={meta.label}
    >
      <meta.icon className="size-1/2" />
    </span>
  )
}

/** Small neutral chip (indications, regions, record types). */
export function Chip({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[26px] items-center rounded-[8px] border bg-card px-[10px] text-[12.5px] font-medium text-secondary-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Primary / Competitor pill (Asset Search, cards); the tooltip says how deeply the asset is crawled. */
export function KindBadge({ kind, competitorOf }: { kind: 'primary' | 'competitor'; competitorOf?: string[] }) {
  const primary = kind === 'primary'
  const tip = primary
    ? 'Primary asset · full crawl'
    : `Competitor of ${competitorOf?.length ? competitorOf.join(', ') : 'a tracked asset'} · light crawl`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            'inline-flex h-[19px] items-center gap-[4px] rounded-full px-[7px] align-[1px] text-[10.5px] font-semibold tracking-[0.01em] whitespace-nowrap',
            primary ? 'bg-primary-soft text-primary' : 'bg-orange-soft text-competitor',
          )}
        >
          <i aria-hidden="true" className="size-[5px] rounded-full bg-current" />
          {primary ? 'Primary' : 'Competitor'}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

/** Which indication(s) a row belongs to (PAH, PH-ILD): small primary chips, the rest folded into "+N". */
export function IndicationBadges({ items, max = 2, className }: { items: string[]; max?: number; className?: string }) {
  if (!items.length) return null
  const shown = items.slice(0, max)
  const rest = items.slice(max)
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-[4px]', className)}>
      {shown.map((i) => (
        <span key={i} title={`Indication: ${i}`} className="inline-flex h-[20px] max-w-[160px] items-center truncate rounded-[6px] bg-primary-soft px-[6px] text-[11.5px] font-semibold text-primary">
          {i}
        </span>
      ))}
      {rest.length > 0 && (
        <span title={rest.join(', ')} className="inline-flex h-[20px] items-center rounded-[6px] bg-muted px-[6px] text-[11.5px] font-semibold text-secondary-foreground">
          +{rest.length}
        </span>
      )}
    </span>
  )
}
