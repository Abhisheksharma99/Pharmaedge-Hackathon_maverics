import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** White section card from the redesign: title row, optional actions, content. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
  hidden,
}: {
  id?: string
  hidden?: boolean
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section id={id} hidden={hidden} className={cn('overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-[24px] gap-y-[12px] px-[20px] pt-[18px] pb-[14px]">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {description && <p className="mt-[2px] text-text-secondary">{description}</p>}
        </div>
        {actions}
      </div>
      <div className={cn('border-t border-hair', bodyClassName)}>{children}</div>
    </section>
  )
}

export interface Kpi {
  label: string
  value: ReactNode
  hint?: string
  icon: LucideIcon
}

/** Key-metrics strip: cells separated by 1px rules inside one rounded frame. */
export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <section aria-label="Key metrics" className="flex flex-wrap gap-px overflow-hidden rounded-[14px] border bg-border">
      {items.map((k) => (
        <div key={k.label} className="flex min-w-0 flex-[1_1_160px] flex-col gap-[6px] bg-card px-[18px] py-[16px]">
          <div className="flex items-center gap-[8px] font-medium text-text-secondary">
            <k.icon className="size-[16px]" />
            {k.label}
          </div>
          <div className="text-[28px] leading-[32px] font-semibold tracking-[-0.02em] tabular-nums">{k.value}</div>
          {k.hint && <div className="text-[12.5px] text-muted-foreground">{k.hint}</div>}
        </div>
      ))}
    </section>
  )
}

/** Centered message for an empty list or a section still being collected. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-[24px] py-[48px] text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mt-[4px] max-w-[440px] text-text-secondary">{children}</p>}
    </div>
  )
}
