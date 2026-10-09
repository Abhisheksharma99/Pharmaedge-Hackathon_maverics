import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { useRefreshOnCrawlEnd } from '@/features/jobs/use-refresh-on-crawl-end'
import { EventSheetHost } from '@/features/journey/event-sheet-host'
import { useShellStore } from '@/stores/shell-store'
import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'
import { CommandPalette } from './command-palette'

/** ⌘K / Ctrl+K anywhere toggles the command palette (README §5.1). */
function usePaletteShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      const { paletteOpen, setPaletteOpen } = useShellStore.getState()
      setPaletteOpen(!paletteOpen)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function AppLayout() {
  usePaletteShortcut()
  useRefreshOnCrawlEnd()
  return (
    <div className="flex h-dvh overflow-hidden">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <EventSheetHost />
    </div>
  )
}
