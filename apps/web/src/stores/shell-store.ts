import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createFocusReturn } from '@/lib/focus-return'

interface ShellState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  /** Last asset page visited; the sidebar's asset sections link back to it. */
  lastAssetId: string | null
  setLastAssetId: (id: string) => void
  /** Asset AI drawer on asset pages. */
  assetAiOpen: boolean
  setAssetAiOpen: (open: boolean) => void
  /** ⌘K command palette. */
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  /** Off-canvas navigation below 900px. */
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
}

export const paletteFocus = createFocusReturn()
export const mobileNavFocus = createFocusReturn()
export const assetAiFocus = createFocusReturn()

/** Layout preferences, remembered per browser; overlays always start closed. */
export const useShellStore = create<ShellState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      lastAssetId: null,
      setLastAssetId: (id) => set({ lastAssetId: id }),
      assetAiOpen: false,
      setAssetAiOpen: (open) => {
        if (open && !get().assetAiOpen) assetAiFocus.remember()
        set({ assetAiOpen: open })
      },
      paletteOpen: false,
      setPaletteOpen: (open) => {
        if (open && !get().paletteOpen) paletteFocus.remember()
        set({ paletteOpen: open })
      },
      mobileNavOpen: false,
      setMobileNavOpen: (open) => {
        if (open && !get().mobileNavOpen) mobileNavFocus.remember()
        set({ mobileNavOpen: open })
      },
    }),
    {
      name: 'aj-shell',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, lastAssetId: s.lastAssetId, assetAiOpen: s.assetAiOpen }),
    },
  ),
)
