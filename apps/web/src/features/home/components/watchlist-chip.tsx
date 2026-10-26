import { Star } from 'lucide-react'
import { CHIP, CHIP_ON } from '@/features/journey/controls'
import { cn } from '@/lib/utils'

/** Home's "Watchlist" filter chip: limits every card to starred assets; off (and disabled) with nothing starred. */
export function WatchlistChip({ count, on, onChange, className }: { count: number; on: boolean; onChange: (on: boolean) => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={count === 0}
      title={count === 0 ? 'Star assets (on their cards) to build your watchlist' : on ? 'Showing your watchlist only' : 'Show only your watchlist on every card'}
      onClick={() => onChange(!on)}
      className={cn(CHIP, 'h-[32px] disabled:cursor-not-allowed disabled:opacity-60', on && CHIP_ON, className)}
    >
      <Star className={cn('size-[14px]', on ? 'fill-current' : 'text-[#f79009]')} aria-hidden="true" />
      Watchlist
      <span className={cn('rounded-[5px] px-[5px] text-[11.5px] tabular-nums', on ? 'bg-card' : 'bg-muted')}>{count}</span>
    </button>
  )
}
