import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const SPAN: Record<1 | 2 | 3 | 4, string> = {
  1: '',
  2: 'min-[701px]:col-span-2',
  3: 'min-[701px]:col-span-2 min-[1181px]:col-span-3',
  4: 'min-[701px]:col-span-2 min-[1181px]:col-span-4',
}

/** Chart grid: 4 columns, 2 at ≤1180px, 1 at ≤700px. */
export function ChartGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 min-[701px]:grid-cols-2 min-[1181px]:grid-cols-4', className)}>{children}</div>
  )
}

/** White chart card; a container-query context so charts adapt to the card, not the viewport. */
export function ChartCard({
  title,
  description,
  span = 1,
  actions,
  children,
  className,
}: {
  title: string
  description?: string
  span?: 1 | 2 | 3 | 4
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        '@container flex min-w-0 animate-fade-up flex-col rounded-[14px] border bg-card shadow-panel',
        SPAN[span],
        className,
      )}
    >
      <div className="flex justify-between gap-2.5 px-4 pt-3.5 pb-1">
        <div className="min-w-0">
          <h4 className="text-[13.5px] font-semibold">{title}</h4>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="relative flex-1 px-4 pt-2 pb-3.5">{children}</div>
    </section>
  )
}
