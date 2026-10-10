import { useEffect } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router'
import { ASSET_TABS } from '@/features/assets/pages/asset-layout'
import type { NavTarget } from './api'
import { useTurnStore } from './turn-store'

/** App path of a view Asset AI asked to open: built here from its parts, and only for a known tab. */
export function viewPath(to: NavTarget): string {
  const tab = ASSET_TABS.some((t) => t.path === to.tab) ? to.tab : 'overview'
  const canvas = tab === 'canvas' && to.storyId ? `/story/${encodeURIComponent(to.storyId)}` : tab === 'canvas' && to.canvasId ? `/${encodeURIComponent(to.canvasId)}` : ''
  const record = to.record ? `?${new URLSearchParams({ rtab: to.record.tab, record: to.record.key })}` : ''
  return `/assets/${encodeURIComponent(to.assetId)}/${tab}${canvas}${record}`
}

/**
 * The full-page chat does not leave the conversation on its own: Asset AI's navigation becomes a prompt with an
 * "Open" action (the asset panel follows it directly, useFollowNavigation).
 */
export function useOfferNavigation(sessionId: string | null) {
  const navigate = useNavigate()
  const nav = useTurnStore((s) => s.nav)
  const clearNav = useTurnStore((s) => s.setNav)
  useEffect(() => {
    if (!nav || nav.sessionId !== sessionId) return
    clearNav(null)
    const path = viewPath(nav.to)
    const what = nav.to.storyId ? 'the journey story' : nav.to.record ? 'the source record' : nav.to.canvasId ? 'the canvas' : `${nav.to.tab}`
    toast.info(`Asset AI opened ${what}`, { action: { label: 'Open', onClick: () => navigate(path) } })
  }, [nav, sessionId, navigate, clearNav])
}

/**
 * Follow Asset AI's navigation (open_view, build_journey_tree) for one chat session. Used by the asset-page panel,
 * which stays beside the page it opens; the full-screen chat does not follow (its cards link to the view instead).
 */
export function useFollowNavigation(sessionId: string | null) {
  const navigate = useNavigate()
  const nav = useTurnStore((s) => s.nav)
  const clearNav = useTurnStore((s) => s.setNav)
  useEffect(() => {
    if (!nav || nav.sessionId !== sessionId) return
    clearNav(null)
    navigate(viewPath(nav.to))
  }, [nav, sessionId, navigate, clearNav])
}
