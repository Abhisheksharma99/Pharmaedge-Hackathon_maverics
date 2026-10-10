import { useSearchParams } from 'react-router'
import type { JourneyScope } from './api'
import { CATEGORIES } from './constants'
import type { JourneyOrder, JourneyView, Mine } from './journey-model'
import type { EventCategory } from './types'

/** The list filters (categories, Starred / Team notes, indication, title search). */
function clearListFilters(p: URLSearchParams) {
  for (const k of ['cat', 'mine', 'ind', 'q']) p.delete(k)
}

/**
 * Journey filters live in the URL so links are shareable (README §8): `?view=v&order=newest&scope=all&cat=clinical,ip
 * &mine=starred&ind=PAH&q=<title>&focus=<eventId>`. Horizontal and oldest first are the defaults (no param): the
 * orientation is never remembered, so every journey opens the same way.
 */
export function useJourneyFilters() {
  const [params, setParams] = useSearchParams()
  const view: JourneyView = params.get('view') === 'v' ? 'v' : 'h'
  const order: JourneyOrder = params.get('order') === 'newest' ? 'newest' : 'oldest'
  const scope: JourneyScope = params.get('scope') === 'all' ? 'all' : 'key'
  const cats = (params.get('cat') ?? '').split(',').filter((c): c is EventCategory => (CATEGORIES as string[]).includes(c))
  const mineParam = params.get('mine')
  const mine: Mine | null = mineParam === 'starred' || mineParam === 'notes' ? mineParam : null
  const ind = params.get('ind') || null
  const q = params.get('q') ?? ''
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
    order,
    scope,
    cats,
    mine,
    ind,
    q,
    focus,
    setView: (v: JourneyView) => update((p) => (v === 'h' ? p.delete('view') : p.set('view', v))),
    setOrder: (o: JourneyOrder) => update((p) => (o === 'oldest' ? p.delete('order') : p.set('order', o))),
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
    setInd: (i: string | null) => update((p) => (i ? p.set('ind', i) : p.delete('ind'))),
    setQuery: (text: string) => update((p) => (text ? p.set('q', text) : p.delete('q'))),
    clearFilters: () => update(clearListFilters),
    /** Every event, unfiltered: the retry when a focused event is filtered out (README §6.2 "Deep link"). */
    showEverything: () =>
      update((p) => {
        p.set('scope', 'all')
        clearListFilters(p)
      }),
    focusOn: (id: string) => update((p) => p.set('focus', id)),
    clearFocus: () => update((p) => p.delete('focus')),
  }
}
