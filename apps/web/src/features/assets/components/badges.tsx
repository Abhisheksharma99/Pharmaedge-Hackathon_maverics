import { FlaskConical, Landmark, Megaphone, ShieldAlert, Stamp, type LucideIcon } from 'lucide-react'
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
    <span className={cn('inline-flex h-5 items-center rounded-md px-1.5 text-xs font-semibold', SIGNIFICANCE_STYLE[value])}>
      {value}
    </span>
  )
}

export const CATEGORY_META: Record<EventCategory, { label: string; icon: LucideIcon; tone: string }> = {
  regulatory: { label: 'Regulatory', icon: Landmark, tone: 'bg-[#eef2fd] text-primary' },
  clinical: { label: 'Clinical', icon: FlaskConical, tone: 'bg-success-soft text-success' },
  safety: { label: 'Safety', icon: ShieldAlert, tone: 'bg-danger-soft text-destructive' },
  company: { label: 'Company', icon: Megaphone, tone: 'bg-orange-soft text-orange' },
  ip: { label: 'Patents', icon: Stamp, tone: 'bg-violet-soft text-violet' },
}

export function CategoryIcon({ category, className }: { category: EventCategory; className?: string }) {
  const meta = CATEGORY_META[category]
  return (
    <span
      className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', meta.tone, className)}
      title={meta.label}
    >
      <meta.icon className="size-3.5" />
    </span>
  )
}

/** Small neutral chip (indications, regions, record types). */
export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[26px] items-center rounded-lg border bg-card px-2.5 text-[12.5px] font-medium text-secondary-foreground',
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
            'inline-flex h-[19px] items-center gap-1 rounded-full px-[7px] align-[1px] text-[10.5px] font-semibold tracking-[0.01em] whitespace-nowrap',
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
