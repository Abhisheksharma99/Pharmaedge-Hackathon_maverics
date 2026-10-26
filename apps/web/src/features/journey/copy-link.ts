import { toast } from 'sonner'

interface Where {
  pathname: string
  search: string
}

/**
 * The journey as it is on screen: its URL with the view, order, scope, filters and branch (all in the query), without a
 * one-off `focus`.
 */
export function journeyLink(at: Where, origin = window.location.origin): string {
  const p = new URLSearchParams(at.search)
  p.delete('focus')
  const qs = p.toString()
  return `${origin}${at.pathname}${qs ? `?${qs}` : ''}`
}

/**
 * A link that opens one event (`?focus=<id>` scrolls to it and opens its sheet): the on-screen journey's URL when it
 * is this asset's, else the asset's Asset Journey.
 */
export function eventLink(assetId: string, eventId: string, onScreen: Where | null, origin = window.location.origin): string {
  const base = onScreen ? journeyLink(onScreen, origin) : `${origin}/journey/${encodeURIComponent(assetId)}`
  const url = new URL(base)
  url.searchParams.set('focus', eventId)
  return url.toString()
}

/** Copies `url` and says so (a toast); when the clipboard is unavailable or refused, the toast shows the link instead. */
export async function copyLink(url: string, done = 'Link copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast.success(done)
  } catch {
    toast.error('The link couldn’t be copied', { description: url })
  }
}
