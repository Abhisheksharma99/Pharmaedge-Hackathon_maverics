import { Star } from 'lucide-react'
import { useWatchlist } from '@/features/me/api'
import { FOCUS } from '@/features/journey/controls'
import { cn } from '@/lib/utils'

/** Star an asset onto the signed-in user's watchlist (Home's Watchlist chip limits every card to these). */
export function WatchStar({ id, name, className }: { id: string; name: string; className?: string }) {
  const { ids, toggle } = useWatchlist()
  const on = ids.includes(id)
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`Watch ${name}`}
      title={on ? 'On your watchlist' : 'Add to your watchlist'}
      onClick={(e) => {
        // Cards and rows open the asset; the star only stars it.
        e.preventDefault()
        e.stopPropagation()
        toggle(id)
      }}
      className={cn(
        'flex size-[28px] shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        on && 'text-[#f79009] hover:text-[#dc6803]',
        FOCUS,
        className,
      )}
    >
      <Star className={cn('size-[15px]', on && 'fill-current')} aria-hidden="true" />
    </button>
  )
}
