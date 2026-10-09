import { cn } from '@/lib/utils'

/** Two-to-four way toggle (the redesign's "Landscape / Timeline" switch). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-[10px] bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-lg px-3 font-medium text-text-secondary transition-colors',
            o.value === value && 'bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
