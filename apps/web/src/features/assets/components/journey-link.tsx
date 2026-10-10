import { CATEGORY_META } from '@/features/journey/constants'
import { FOCUS } from '@/features/journey/controls'
import { cn } from '@/lib/utils'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { RecordEventRef } from '../api'

/** The Journey column cell: a link dot that opens the record's first journey event, or a dash. */
export function JourneyLink({ assetId, events }: { assetId: string; events: RecordEventRef[] | undefined }) {
  const openEvent = useEventSheet((s) => s.openEvent)
  const event = events?.[0]
  if (!event) return <span className="text-muted-foreground">—</span>
  return (
    <button
      type="button"
      title={event.title}
      aria-label={`Open in the journey: ${event.title}`}
      onClick={(e) => {
        e.stopPropagation()
        openEvent(assetId, event.id)
      }}
      className={cn('inline-flex items-center gap-[5px] rounded-sm text-[12px] font-medium text-primary hover:underline', FOCUS)}
    >
      <i className="size-[7px] rounded-full" style={{ background: CATEGORY_META[event.category]?.color }} />
      Event
    </button>
  )
}
