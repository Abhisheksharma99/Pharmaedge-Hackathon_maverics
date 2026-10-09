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
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-[18px] pb-3.5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-text-secondary">{description}</p>}
        </div>
        {actions}
      </div>
      <div className={cn('border-t border-[#eef0f3]', bodyClassName)}>{children}</div>
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
        <div key={k.label} className="flex min-w-0 flex-[1_1_160px] flex-col gap-1.5 bg-card px-[18px] py-4">
          <div className="flex items-center gap-2 font-medium text-text-secondary">
            <k.icon className="size-4" />
            {k.label}
          </div>
          <div className="text-[28px] leading-8 font-semibold tracking-tight tabular-nums">{k.value}</div>
          {k.hint && <div className="text-[12.5px] text-muted-foreground">{k.hint}</div>}
        </div>
      ))}
    </section>
  )
}

/** Centered message for an empty list or a section still being collected. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 max-w-md text-text-secondary">{children}</p>}
    </div>
  )
}
