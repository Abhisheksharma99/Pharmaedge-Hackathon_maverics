import { useSearchParams } from 'react-router'
import { usePrefs, useSavePrefs } from '@/features/me/api'
import type { JourneyScope } from './api'
import { CATEGORIES } from './constants'
import type { JourneyView, Mine } from './journey-model'
import type { EventCategory } from './types'

/** Orientation fallback while /me/prefs is loading or unavailable (README §6.2 `aj.orient`). */
export const VIEW_STORAGE_KEY = 'aj.orient'

function storedView(): JourneyView | null {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY)
    return v === 'h' || v === 'v' ? v : null
  } catch {
    return null
  }
}

function storeView(v: JourneyView) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, v)
  } catch {
    // Private mode: the URL and /me/prefs still carry it.
  }
}

/**
 * Journey filters live in the URL so links are shareable (README §8): `?view=h|v&scope=all&cat=clinical,ip&mine=starred
 * &focus=<eventId>`. The orientation is the URL's, else the user's `/me/prefs`, else localStorage, else horizontal.
 */
export function useJourneyFilters() {
  const [params, setParams] = useSearchParams()
  const prefs = usePrefs()
  const savePrefs = useSavePrefs()

  const urlView = params.get('view')
  const view: JourneyView = urlView === 'h' || urlView === 'v' ? urlView : (prefs.data?.journeyView ?? storedView() ?? 'h')
  const scope: JourneyScope = params.get('scope') === 'all' ? 'all' : 'key'
  const cats = (params.get('cat') ?? '').split(',').filter((c): c is EventCategory => (CATEGORIES as string[]).includes(c))
  const mineParam = params.get('mine')
  const mine: Mine | null = mineParam === 'starred' || mineParam === 'notes' ? mineParam : null
  const focus = params.get('focus') || null

  const update = (change: (p: URLSearchParams) => void) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        change(next)
        return next
      },
      { replace: true },
    )

  return {
    view,
    scope,
    cats,
    mine,
    focus,
    setView(v: JourneyView) {
      update((p) => p.set('view', v))
      storeView(v)
      savePrefs.mutate({ journeyView: v })
    },
    setScope: (s: JourneyScope) => update((p) => (s === 'key' ? p.delete('scope') : p.set('scope', s))),
    toggleCat: (c: EventCategory) =>
      update((p) => {
        // Read the URL, not this render's `cats`: two quick toggles must both land.
        const now = (p.get('cat') ?? '').split(',').filter((x): x is EventCategory => (CATEGORIES as string[]).includes(x))
        const next = now.includes(c) ? now.filter((x) => x !== c) : [...now, c]
        if (next.length) p.set('cat', next.join(','))
        else p.delete('cat')
      }),
    setMine: (m: Mine | null) => update((p) => (m ? p.set('mine', m) : p.delete('mine'))),
    clearFilters: () =>
      update((p) => {
        p.delete('cat')
        p.delete('mine')
      }),
    /** Every event, unfiltered: the retry when a focused event is filtered out (README §6.2 "Deep link"). */
    showEverything: () =>
      update((p) => {
        p.set('scope', 'all')
        p.delete('cat')
        p.delete('mine')
      }),
    focusOn: (id: string) => update((p) => p.set('focus', id)),
    clearFocus: () => update((p) => p.delete('focus')),
  }
}
