/**
 * base.css control sizes in px. The app root is 13px, so Tailwind's rem scale (`h-8` = 26px) and the shared button's
 * `size="sm"` (10.4px text) render ~19% smaller than the handoff; Phase 4's surfaces size their controls explicitly
 * (the shared button itself is Phase 7's).
 */

/** `.btn.btn-sm`: 32px, 8px radius, 13px text, 14px icons. */
export const BTN_SM = 'h-[32px] gap-[8px] rounded-lg px-[12px] text-[13px] [&_svg:not([class*=size-])]:size-[14px]'

/** `.icon-btn`: 32px square. */
export const ICON_BTN = 'size-[32px] rounded-lg'

/** Visible keyboard focus for raw buttons and links (README §9): a 2px primary outline, shown for keyboard focus only. */
export const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
