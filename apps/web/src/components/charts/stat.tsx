import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** Analytics stat cell (label with icon, big value, one-line sub). */
export function Stat({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  sub?: string
  color?: string
}) {
  return (
    <div className="flex min-w-0 animate-fade-up flex-col gap-[4px] bg-card px-[16px] py-[14px]">
      <span className="flex items-center gap-[6px] text-[12px] font-medium text-text-secondary">
        <Icon className="size-[14px]" aria-hidden="true" />
        {label}
      </span>
      <span
        className="text-[26px] leading-[30px] font-[650] tracking-[-0.02em] tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
      {sub && <span className="truncate text-[12px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

/** Stats separated by 1px rules inside one rounded frame (auto-fit ≥170px). */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-px overflow-hidden rounded-[14px] border bg-border">
      {children}
    </div>
  )
}
