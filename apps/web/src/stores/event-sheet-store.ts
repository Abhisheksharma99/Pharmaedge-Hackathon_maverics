import { create } from 'zustand'
import { createFocusReturn } from '@/lib/focus-return'
import { paletteFocus } from './shell-store'

export interface OpenEvent {
  assetId: string
  eventId: string
}

/** A request from the sheet to scroll the on-screen journey to an event (`seq` makes repeats distinct). */
export interface LocateRequest extends OpenEvent {
  seq: number
}

interface EventSheetState {
  current: OpenEvent | null
  /** Asset whose journey is on screen (JourneySection mounted): the sheet can locate its events in place. */
  journeyAsset: string | null
  locate: LocateRequest | null
  openEvent: (assetId: string, eventId: string) => void
  closeEvent: () => void
  setJourneyAsset: (assetId: string | null) => void
  requestLocate: (assetId: string, eventId: string) => void
}

/**
 * The app's one event sheet (spec §5 "Event sheet host"): any surface calls `openEvent`, and `EventSheetHost`
 * in AppLayout renders the sheet.
 */
export const eventSheetFocus = createFocusReturn()

export const useEventSheet = create<EventSheetState>()((set, get) => ({
  current: null,
  journeyAsset: null,
  locate: null,
  openEvent: (assetId, eventId) => {
    if (!get().current) eventSheetFocus.remember(paletteFocus)
    set({ current: { assetId, eventId } })
  },
  closeEvent: () => set({ current: null }),
  setJourneyAsset: (journeyAsset) => set({ journeyAsset }),
  requestLocate: (assetId, eventId) => set({ locate: { assetId, eventId, seq: (get().locate?.seq ?? 0) + 1 } }),
}))
