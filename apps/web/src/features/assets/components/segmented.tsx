import type { LucideIcon } from 'lucide-react'
import { FOCUS } from '@/features/journey/controls'
import { cn } from '@/lib/utils'

/** Two-to-four way toggle (the redesign's "Landscape / Timeline" switch); options may carry an icon. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; icon?: LucideIcon }[]
  onChange: (value: T) => void
  label: string
  /** Accepted for existing callers; every toggle uses the prototype's .seg metrics (8px track, 6px buttons, 2px gap). */
  variant?: 'default' | 'compact'
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-[2px] rounded-[8px] bg-muted p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-[28px] items-center gap-[5px] font-medium text-text-secondary transition-colors',
            'rounded-[6px] px-[10px]',
            FOCUS,
            o.value === value && 'bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.1)]',
          )}
        >
          {o.icon && <o.icon className="size-[13px]" aria-hidden="true" />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
