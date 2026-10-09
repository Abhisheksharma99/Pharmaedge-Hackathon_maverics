import { FlaskConical, Landmark, Megaphone, ShieldAlert, Stamp, type LucideIcon } from 'lucide-react'
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
