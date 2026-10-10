import { ChevronUp, SlidersHorizontal, X } from 'lucide-react'
import { CHIP, FOCUS } from '@/features/journey/controls'
import { cn } from '@/lib/utils'

const GHOST = cn('inline-flex h-[28px] shrink-0 items-center gap-[4px] rounded-[8px] px-[8px] text-[12.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground', FOCUS)

/**
 * The hide/show control of a filter bar (state from `useCollapsed`). Shown: a quiet "Hide filters". Hidden: a
 * "Filters" chip with the number of filters still applied, and a quick Clear while any are. `controls` is the id of
 * what it hides. One button for both states, so keyboard focus stays on it.
 */
export function FiltersToggle({
  collapsed,
  onCollapsed,
  controls,
  active = 0,
  onClear,
  className,
}: {
  collapsed: boolean
  onCollapsed: (collapsed: boolean) => void
  controls: string
  /** Filters currently applied (they keep applying while the bar is hidden). */
  active?: number
  onClear?: () => void
  className?: string
}) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-[4px]', className)}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={controls}
        aria-label={collapsed ? `Show filters${active ? ` (${active} active)` : ''}` : undefined}
        onClick={() => onCollapsed(!collapsed)}
        className={collapsed ? cn(CHIP, active > 0 && 'border-[#c7d1f4] text-primary') : GHOST}
      >
        {collapsed ? <SlidersHorizontal className="size-[12px]" aria-hidden="true" /> : <ChevronUp className="size-[13px]" aria-hidden="true" />}
        {collapsed ? 'Filters' : 'Hide filters'}
        {collapsed && active > 0 && (
          <span aria-hidden="true" className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-primary px-[4px] text-[10.5px] leading-none font-semibold text-primary-foreground tabular-nums">
            {active}
          </span>
        )}
      </button>
      {collapsed && active > 0 && onClear && (
        <button type="button" onClick={onClear} className={GHOST}>
          <X className="size-[13px]" aria-hidden="true" />
          Clear
        </button>
      )}
    </span>
  )
}
