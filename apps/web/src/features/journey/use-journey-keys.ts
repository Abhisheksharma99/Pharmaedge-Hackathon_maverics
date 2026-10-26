import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { JourneyView } from './journey-model'

/** Keys typed into a field never drive the journey or the sheet (README §6.4 "ignored inside inputs"). */
export const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

/** Widgets with their own arrow keys or focus scope: the journey's shortcuts leave them alone. */
const OWN_KEYS = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="combobox"],[role="radiogroup"],[role="tablist"],[role="slider"],[role="grid"]'

export interface JourneyKeys {
  /** Move to the next (1) or previous (−1) event in the view's order. */
  step: (delta: 1 | -1) => void
  search: () => void
  view: (v: JourneyView) => void
  toggleOrder: () => void
  help: () => void
}

/** The shortcuts, as the help dialog lists them and `aria-keyshortcuts` names them. */
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['→', 'j'], label: 'Next event' },
  { keys: ['←', 'k'], label: 'Previous event' },
  { keys: ['Enter'], label: 'Open the focused event' },
  { keys: ['Esc'], label: 'Close the event or this dialog' },
  { keys: ['/'], label: 'Search event titles' },
  { keys: ['h'], label: 'Horizontal view' },
  { keys: ['v'], label: 'Vertical view' },
  { keys: ['n'], label: 'Newest / oldest first' },
  { keys: ['?'], label: 'Show these shortcuts' },
]

/** `aria-keyshortcuts` of an event card. */
export const CARD_KEYS = 'ArrowLeft ArrowRight J K Enter'

const inView = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.bottom > 0 && r.top < window.innerHeight
}

/**
 * The journey's keyboard shortcuts, on the document while the journey is mounted. Never while typing, with a modifier
 * (but Shift for "?"), or inside a widget with its own keys (dialogs, menus, selects, tabs). Event steps need focus
 * in the journey, or nothing focused and the journey on screen, so arrows elsewhere on the page stay theirs.
 */
export function useJourneyKeys(sectionRef: RefObject<HTMLElement | null>, keys: JourneyKeys) {
  const latest = useRef(keys)
  useLayoutEffect(() => {
    latest.current = keys
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || e.metaKey || e.ctrlKey || (e.shiftKey && e.key !== '?')) return
      const t = e.target
      if (isTypingTarget(t) || (t instanceof Element && t.closest(OWN_KEYS))) return
      const k = latest.current
      const section = sectionRef.current
      const stepping = !!section && (section.contains(t as Node) || ((t === document.body || t === document.documentElement) && inView(section)))
      switch (e.key) {
        case 'ArrowRight':
        case 'j':
          if (!stepping) return
          k.step(1)
          break
        case 'ArrowLeft':
        case 'k':
          if (!stepping) return
          k.step(-1)
          break
        case '/':
          k.search()
          break
        case 'h':
        case 'v':
          k.view(e.key)
          break
        case 'n':
          k.toggleOrder()
          break
        case '?':
          k.help()
          break
        default:
          return
      }
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sectionRef])
}
