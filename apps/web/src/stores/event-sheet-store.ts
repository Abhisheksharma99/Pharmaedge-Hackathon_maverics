import { create } from 'zustand'
import { createFocusReturn } from '@/lib/focus-return'
import { paletteFocus } from './shell-store'

export interface OpenEvent {
  assetId: string
  eventId: string
}

interface EventSheetState {
  current: OpenEvent | null
  openEvent: (assetId: string, eventId: string) => void
  closeEvent: () => void
}

/**
 * The app's one event sheet (spec §5 "Event sheet host"): any surface calls `openEvent`, and `EventSheetHost`
 * in AppLayout renders the sheet.
 */
export const eventSheetFocus = createFocusReturn()

export const useEventSheet = create<EventSheetState>()((set, get) => ({
  current: null,
  openEvent: (assetId, eventId) => {
    if (!get().current) eventSheetFocus.remember(paletteFocus)
    set({ current: { assetId, eventId } })
  },
  closeEvent: () => set({ current: null }),
}))
