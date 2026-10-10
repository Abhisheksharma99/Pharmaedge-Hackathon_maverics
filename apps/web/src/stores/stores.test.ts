import { useEventSheet } from './event-sheet-store'
import { useShellStore } from './shell-store'

beforeEach(() => {
  localStorage.clear()
  useShellStore.setState({ sidebarCollapsed: false, paletteOpen: false, mobileNavOpen: false })
  useEventSheet.setState({ current: null, journeyAsset: null, locate: null })
})

describe('shell store', () => {
  it('opens and closes the palette and the mobile drawer, and sets the sidebar state', () => {
    const shell = useShellStore.getState()
    shell.setPaletteOpen(true)
    shell.setMobileNavOpen(true)
    shell.setSidebarCollapsed(true)
    expect(useShellStore.getState()).toMatchObject({ paletteOpen: true, mobileNavOpen: true, sidebarCollapsed: true })
    useShellStore.getState().toggleSidebar()
    expect(useShellStore.getState().sidebarCollapsed).toBe(false)
  })

  it('remembers the sidebar but never an open overlay', () => {
    useShellStore.getState().setSidebarCollapsed(true)
    useShellStore.getState().setPaletteOpen(true)
    useShellStore.getState().setMobileNavOpen(true)
    const saved = JSON.parse(localStorage.getItem('aj-shell') ?? '{}').state
    expect(saved).toMatchObject({ sidebarCollapsed: true })
    expect(saved).not.toHaveProperty('paletteOpen')
    expect(saved).not.toHaveProperty('mobileNavOpen')
  })
})

describe('event sheet store', () => {
  it('holds the one open event and closes it', () => {
    useEventSheet.getState().openEvent('trep', 'ai:trep:https://example.com/a/b:0')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'ai:trep:https://example.com/a/b:0' })
    useEventSheet.getState().openEvent('nint', 'e2')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'nint', eventId: 'e2' })
    useEventSheet.getState().closeEvent()
    expect(useEventSheet.getState().current).toBeNull()
  })
})

describe('event sheet store: journey seam (Phase 4)', () => {
  it('knows which asset’s journey is on screen and numbers locate requests', () => {
    const sheet = useEventSheet.getState()
    sheet.setJourneyAsset('trep')
    expect(useEventSheet.getState().journeyAsset).toBe('trep')
    sheet.requestLocate('trep', 'ai:trep:https://example.com/a/b:0')
    expect(useEventSheet.getState().locate).toEqual({ assetId: 'trep', eventId: 'ai:trep:https://example.com/a/b:0', seq: 1 })
    sheet.requestLocate('trep', 'ai:trep:https://example.com/a/b:0')
    expect(useEventSheet.getState().locate?.seq).toBe(2)
    sheet.setJourneyAsset(null)
    expect(useEventSheet.getState().journeyAsset).toBeNull()
  })
})
