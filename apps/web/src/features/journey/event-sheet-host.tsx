import { useEventSheet } from '@/stores/event-sheet-store'
import { EventDetailSheet } from './event-detail-sheet'

/**
 * The app's one event sheet (spec §5 "Event sheet host"), mounted in AppLayout. Any surface opens it with
 * `useEventSheet.getState().openEvent(assetId, eventId)`.
 */
export function EventSheetHost() {
  const current = useEventSheet((s) => s.current)
  const close = useEventSheet((s) => s.closeEvent)
  return <EventDetailSheet current={current} onClose={close} />
}
