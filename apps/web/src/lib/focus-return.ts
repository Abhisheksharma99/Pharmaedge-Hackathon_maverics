/**
 * Focus return for store-driven overlays (no Radix Trigger): `remember()` when it opens, and pass `onCloseAutoFocus`
 * to the dialog content so closing hands focus back to the element that had it (Radix would focus a null trigger).
 * An overlay opened from inside another dialog (palette -> event sheet) inherits that dialog's return target via
 * `remember(outer)`, since the element that had focus disappears with the dialog.
 */
export interface FocusReturn {
  remember: (outer?: FocusReturn) => void
  target: () => HTMLElement | null
  onCloseAutoFocus: (e: Event) => void
}

export function createFocusReturn(): FocusReturn {
  let saved: HTMLElement | null = null
  return {
    remember(outer) {
      const active = document.activeElement
      saved = active instanceof HTMLElement ? active : null
      if (outer && saved?.closest('[role="dialog"]')) saved = outer.target()
    },
    target: () => saved,
    onCloseAutoFocus(e) {
      e.preventDefault()
      // preventScroll: a card that is off-screen but still rendered must not drag a clipped / pinned scroller sideways.
      if (saved?.isConnected) saved.focus({ preventScroll: true })
    },
  }
}
