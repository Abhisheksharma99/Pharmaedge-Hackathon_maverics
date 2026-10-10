/** Scroll helpers for views driven by the app's scrolling <main> (or the page when nothing else scrolls). */

const isRoot = (el: Element) => el === document.scrollingElement || el === document.documentElement || el === document.body

/** The nearest ancestor that scrolls vertically, else the document's scrolling element. */
export function findScroller(node: Element | null): HTMLElement {
  let el = node?.parentElement ?? null
  while (el && !isRoot(el)) {
    const overflow = getComputedStyle(el).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return el
    el = el.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

/** Height of the scroller's visible area. */
export const viewportHeight = (sc: HTMLElement) => (isRoot(sc) ? window.innerHeight : sc.clientHeight)

/** Top of the scroller's visible area in client coordinates. */
export const viewportTop = (sc: HTMLElement) => (isRoot(sc) ? 0 : sc.getBoundingClientRect().top)

/** Top of `el` in the scroller's content coordinates. */
export const offsetIn = (sc: HTMLElement, el: Element) => el.getBoundingClientRect().top - viewportTop(sc) + sc.scrollTop

/** Listen to the scroller's scroll events (the window's for the page). */
export function onScroll(sc: HTMLElement, fn: () => void): () => void {
  const target: EventTarget = isRoot(sc) ? window : sc
  target.addEventListener('scroll', fn, { passive: true })
  return () => target.removeEventListener('scroll', fn)
}

/** Scroll to `top` (smoothly unless reduced motion); sets scrollTop where scrollTo is missing (jsdom). */
export function scrollToTop(sc: HTMLElement, top: number, smooth: boolean): void {
  const y = Math.max(0, Math.round(top))
  if (typeof sc.scrollTo === 'function') sc.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' })
  else sc.scrollTop = y
}
