import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ShellState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  /** Last asset page visited; the sidebar's asset sections link back to it. */
  lastAssetId: string | null
  setLastAssetId: (id: string) => void
  /** Asset AI drawer on asset pages. */
  assetAiOpen: boolean
  setAssetAiOpen: (open: boolean) => void
}

/** Layout preferences, remembered per browser. */
export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      lastAssetId: null,
      setLastAssetId: (id) => set({ lastAssetId: id }),
      assetAiOpen: false,
      setAssetAiOpen: (open) => set({ assetAiOpen: open }),
    }),
    { name: 'aj-shell' },
  ),
)
