import { useEventSheet } from '@/stores/event-sheet-store'
import { EventSheetStub } from './event-sheet-stub'

/**
 * The app's one event sheet (spec §5 "Event sheet host"), mounted in AppLayout. Any surface opens it with
 * `useEventSheet.getState().openEvent(assetId, eventId)`. Phase 4 renders EventDetailSheet here instead of the stub.
 */
export function EventSheetHost() {
  const current = useEventSheet((s) => s.current)
  const close = useEventSheet((s) => s.closeEvent)
  return <EventSheetStub assetId={current?.assetId ?? null} eventId={current?.eventId ?? null} onClose={close} />
}
