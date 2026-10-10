# v3 Phase 4: Journey Views + Event Detail Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete v3 asset Overview — KPI strip → pinned analytics (pulled forward from Phase 6) → the v3 journey — the horizontal branch track (default), the indication-branch tree (alternate), shared header/filters/HUD with `?focus=` deep links — and replace the Phase 2 stub with the comprehensive event detail sheet used by every event surface.

**Architecture:** Web only (`apps/web`), on top of Phase 3 (live build). The Overview is composed first (wave 2): KPI strip → `OverviewAnalytics` (`features/analytics/*`: blocks + per-user pins over the Phase 0 chart primitives) → a journey slot that the v3 `JourneySection` fills in wave 5. Pure modules carry all geometry and are unit-tested: `journey-model.ts` (branch model, filters, closures, lineage, subtree), `hover-add.ts` (hover-date interpolation, spec §7), `track-layout.ts` (horizontal track: columns, lanes, caps, windowing, hover) and `tree/tree-rows.ts` + `tree/tree-geometry.ts` (tree rows and lanes/nodes computed from row heights — no DOM reads, so off-screen rows have geometry and long journeys can be windowed). Components: `JourneySection` (header, URL filters, view switch, HUD, focus/locate flow) renders `HorizontalTrack` or `JourneyTree`; both render only rows/cards near the viewport. `EventDetailSheet` (+ `sheet/*` sections) replaces `EventSheetStub` inside the Phase 2 `EventSheetHost`, opened through the same `useEventSheet` store, which gains a small seam (`journeyAsset`, `requestLocate`) so the sheet can locate events in place. Note creation is Phase 5: hover-to-add and "Add to timeline" open `NoteDraftDialog`, a stand-in that shows the Where strip and that Phase 5 replaces with `NoteComposer`.

**Tech Stack:** React 19, TypeScript 6 (`verbatimModuleSyntax`: type-only imports use `import type`/`type`), Tailwind v4 (no new CSS files; one keyframe in `index.css`), shadcn (radix-nova) `Sheet`/`Dialog`/`Button`/`Skeleton`, TanStack Query 5, zustand 5, react-router 8, lucide-react, sonner, vitest 4 + Testing Library (jsdom), `fetch` mocked with `vi.stubGlobal` as in the existing tests.

**Spec:** `docs/superpowers/specs/2026-10-09-asset-journey-v3-design.md` (§3 horizontal default, §4.1 key events + "All" windowed, §4.2 branches, §5 event sheet host, §7 tests); screens `docs/design/asset-journey-v3/README.md` §4 (tokens, motion), §6.2–6.4, §8, §9; `SCREENS.md` 7–11 (+ `screenshots/07–11`); `IMPLEMENTATION_PLAN.md` Phase 4 + acceptance 2–7; `PHASE_DETAILS.md` Phase 4; `DATA_CONTRACTS.md` §A, §B.1, §B.3, §B.5; prototype `design_files/aj/{story,horizontal,sheet,enrich}.jsx`, `aj/story.css` (geometry and visuals ported, never shipped).

**Code blocks:** a block whose first line is `// file: <path>` is the complete content of that file — a new file, or a full replacement where the step says **Replace** (paths from the repo root; the `// file:` line is part of the file, as in earlier phases). Other blocks are before/after snippets to apply exactly. Commands run from the repo root of your worktree unless they start with `cd`.

**Phase 3 first:** this plan is written against main @af0304f (Phase 3, live build, landed). Phase 3 owns `features/journey/live-build/*`, `useTimelineV3`/`useEventsById` in `features/journey/api.ts`, `features/journey/api.test.tsx` and `features/assets/pages/overview-tab.test.tsx`, and `OverviewTab`'s early return that renders `<LiveBuild>` (onboarding, failed-with-a-job or `?build=1`). Phase 4 leaves that seam alone: it only appends to `journey/api.ts` (Task 1), swaps the `import { JourneyTimeline } …` line and the `grid … xl:grid-cols-[minmax(0,1fr)_400px]` block inside the `journey` element of `OverviewTab` (Task 20), wires Phase 3's "Just added" rows to the event sheet (Task 6), and names its own tests `journey-api.test.tsx` and `overview-journey.test.tsx`. Every snippet below was applied and verified on af0304f.

## Global Constraints

- Only `apps/web` changes. No new API routes. Routes read: `GET /api/assets/:id/timeline?scope=key|all&include=notes&limit=5000` (the journey; notes merged; no category/significance/milestone params — filters are client-side so chip counts stay right), `GET /api/assets/:id/timeline?scope=all&branch=<ended ids>&limit=5000` (closure dates of ended branches), `GET /api/assets/:id/branches` (`Branch[]`, trunk first; `[]` = one unlabeled trunk), `GET /api/assets/:id/events/:eventId` (`{ event, records, neighbors, branchStats }`), `GET /api/assets/:id/annotations`, `PUT|DELETE /api/assets/:id/events/:eventId/star`, `POST /api/assets/:id/events/:eventId/comments` `{text}` (≤2,000 chars), `GET /api/assets/:id/records/regulatory?q=<application>&pageSize=100`, `GET|PATCH /api/me/prefs` (`journeyView: 'h'|'v'`).
- Event ids contain `:` and `/` and can exceed 200 chars: `encodeURIComponent` in every path and in `?focus=`; never build ids into CSS selectors without `CSS.escape`-free attribute matching (`[data-card="…"]` in tests only).
- Query keys: `['asset', id, 'timeline-v3', 'key'|'all']`, `['asset', id, 'timeline-v3', 'ended', ids]`, `['asset', id, 'branches']`, `['asset', id, 'annotations']`, `['asset', id, 'event', eventId]` (Phase 2). All `staleTime` 60 s except annotations 30 s; the crawl-end refresh (`['asset', id]` prefix, Phase 2) and Phase 3's `['asset', id, 'timeline-v3']` invalidation cover them.
- URL state (README §8): `?view=h|v&scope=all&cat=clinical,ip&mine=starred|notes&focus=<id>`; defaults (`key`, no cats, no mine) are not written; updates use `replace`. Orientation: URL, else `/me/prefs.journeyView`, else `localStorage['aj.orient']`, else `'h'`; changing it writes all three. Focused branch is local state.
- Horizontal constants (README §6.3, `aj/horizontal.jsx`): column 178, card 304, left pad 236, row 34, card area 196 above and below, ruler 30, band vertically centred; trunk starts at pad − 110, a branch 74px before its first event, fork curve from the parent row; solid lane to Today, dashed after; cards alternate above/below; reveal when `x − p < vw − 40` (monotonic); pinned labels 200px (120px ≤900px), faded until `x1 ≤ p + 0.75·vw`; parallax years at 0.55×, ≥520px apart; arrows at left 208 / right 16; hover pill 42px above the row; SVG pointer x is already a track coordinate.
- Tree constants (README §6.2, `aj/story.jsx`): lane gap 40 (wide) / 16 (narrow, flow < 980px); gutters `gl = −minOff·40 + 30`, `gr = maxOff·40 + 30`; trunk x `round((W + gl − gr)/2)` (narrow `14 + (−minOff)·16`); card width `(W − gl − gr)/2 − 8` (narrow `W − (14 + (maxOff − minOff)·16 + 26)`); node 48px below a card row's top (14 padding + 34); fork curve `M px,fy−58 C px,fy−26 x,fy−34 x,fy−6`; vertical lane labels every 620px; sticky labels at top 8/32 alternating; parallax `(rowCentre − probe)·−0.45`, probe at 55% of the viewport; deep-link scroll puts the card at 30% of the viewport; flash 1.8 s.
- Card typography (README §4): High 21px / Medium 18px / Low 14.5px titles (650, −0.015em, balance); Low cards hide details and "Why it matters"; milestone cards dashed; starred cards `inset 0 0 0 2px #fdb022`; note cards bordered and tinted in the tag colour. Sheet 560px, title 20px, sections 20px apart with 11px uppercase labels.
- Colours only from tokens / data: category and collection colours from `features/journey/constants.ts`, branch colours from the branch doc (`branch.color`), tag colours from `NOTE_TAGS`, star `fill-star`/`text-star-stroke`; no new hex colours except the handoff's `#e4e7ec` lanes, `#d0d5dd` elbows, `#c7d1f4` active borders and `#101828` Today lines.
- Copy verbatim: "Journey"; "{n} events, {yyyy}–{yyyy} · {k} indication branches. Each new indication forks off the programme that led to it; select a branch to focus it." (single trunk: "… Open a card’s subtree for its evidence and linked events."); "How this journey was built"; "Tree" / "Horizontal"; "Key events" / "All"; "Add to timeline"; "Trunk" / "from {parent}" / "{status} · since {yyyy}"; "Starred", "Team notes", "Clear"; "New branch · {full}" / "Forked from {parent} · {why}" / "events"; "Branch closed · {label}" / "{Terminated} {Mmm yyyy} · {title}"; "Today · {Mmm d, yyyy}" / "Expected milestones below"; "Journey begins · {Mmm yyyy} · {trunk} trunk"; "Projected milestones are dashed" / "End of the recorded journey"; hover pill "{Mmm d, yyyy} · {Branch} Click to add a note"; "Hover a branch to see the date · click to add a note there"; card footer "Subtree"/"Hide subtree", "Details"; sheet "Show on the journey timeline" (elsewhere) / "Locate on timeline" (on the asset's Overview), "Position in the journey", "#k of n", "Branch", "Event k of n on this branch, x days after “…”", "Targets", "Trial · …", "Patent term · …", "Regulatory path · …", "Details", "Why it matters · ", "Evidence", "Linked events", "Comments", "Add a comment for your team…", "Comment", "Previous"/"Next"; errors "The journey couldn't be loaded." / "This event couldn't be loaded."; toasts "The star couldn't be saved." / "The comment couldn't be posted.".
- Motion (README §4): ease `ease-out-soft`, spring `ease-spring`; card reveal opacity + `translateX(±56px) scale(.97)` 700 ms with `--dl` stagger 90 ms (max 4); connectors draw with `pathLength=1` dash offset; nodes pop `scale(0→1)` on an inner element (SVG transform never shared with a CSS transform). `prefers-reduced-motion: reduce` (and jsdom, where `matchMedia` is missing): everything revealed at once, no parallax layer, `scrollTo` without smooth behaviour; the global rule in `index.css` already zeroes durations.
- Performance: scroll handlers are rAF-throttled and write transforms/clip heights through refs; React state changes only when the rendered window, the active index or the revealed set changes. Both views render only rows/cards near the viewport (horizontal: visible columns ± 3; tree: ±1,200px), so "All" on Infliximab (~1,270 events) stays smooth.
- Accessibility (README §9): timeline SVGs `aria-hidden`; cards are buttons/articles with visible text; the horizontal track keeps one tab stop (roving `tabIndex`; ←/→/Home/End move between cards); the sheet traps focus (Radix), returns focus to the opener (`eventSheetFocus`), ←/→ navigate and Esc closes except inside inputs/textareas (Esc there leaves the field, keeping the draft); Enter sends a comment, Shift+Enter breaks the line; branch chips always carry their label.
- Decisions (spec/handoff silent or real data differs — binding):
  - **Closure date of an ended branch** = its latest `trial_stopped`/`trial_terminated`/`trial_withdrawn`/`application_withdrawn`/`withdrawal` event over all events (else its latest event). The branch docs carry no closure date, so the section reads the ended branches' events (`?scope=all&branch=…`). Treprostinil PH-COPD therefore caps at Nov 2022 (PERFECT OLE terminated) although its last key events are 2024–2025 publications; events after a closure hang on a dotted tail.
  - **Undated events** (no parsable date) are left off both views; the header says "{n} undated event(s) … not placed on the timeline." They still open in the sheet.
  - **Prev/next and the position strip** follow the API's neighbour pool: key events (+ notes) for a key event or note, all events otherwise. The strip uses the cached journey timeline of that scope; linked events not in it load "All" lazily.
  - **Focus flow:** `?focus=` (and "Locate on timeline" / prev-next / subtree links for events not in the current list) shows everything (`scope=all`, no category/mine filters) once and retries when the data arrives; if the event is still not on the journey the sheet opens anyway. Deep links open the sheet; in-place locates don't re-open it. The `focus` param is removed once handled.
  - **Stars and comments** ship in Phase 4 (sheet, cards, Starred chip) using the Phase 1b annotations API; notes (composer, find, note styling beyond the tag colour) are Phase 5.
  - **Overview = KPI strip → pinned analytics → journey** (acceptance 2). The old flat journey list and its right column (Upcoming milestones, FAERS chart) leave the Overview. Pinned analytics ship now with the six Overview templates and Reset/remove; the **Add analytics** tile renders disabled ("Coming in the next update") because its dialog (library / AI suggestions / ask / web search), custom pins and the Analytics tab are Phase 6. **Add to timeline** and hover-to-add render and open the Where-strip stand-in; the composer itself is Phase 5.
  - **Records-tab "In the journey"** links are Phase 6 (records columns); every other event surface (Home, ⌘K, chat timeline card, Overview milestones, competitor signals and milestones, journey views) opens the sheet in Phase 4.
- Tests mock `fetch` with `vi.stubGlobal`; jsdom has no layout, `IntersectionObserver`, `matchMedia` or `Element.scrollTo` — the code falls back (width 1000/1200, all revealed, `scrollTop` assignment). `cd apps/web && npm run lint && npx tsc -b && npm test` green at every task. Tasks do not commit; the phase commits once in Task 21, on `main`, never staging `infra/mongo/*`.

## Review Focus

- **Overview composition and pins:** KPI strip → pinned analytics → journey in that order; default pins depend on trial data; removing a card and Reset PUT the per-user list; missing data hides a card instead of erroring; unknown/custom pins are kept. Tests: Task 8, Task 9, Task 20.

- **Event ids with `:` and `/` (and >200 chars) in paths and `?focus=`:** the sheet, star and comment URLs encode them; `?focus=` round-trips through `useJourneyFilters`; jump/locate find them. Tests: Task 3 (encoded star/comment URLs), Task 4 (focus round-trip), Task 16 (encoded event fetch), Task 17/18 (`jump` with `ai:trep:https://…`), Task 19 (deep link to an AI event outside the key scope).
- **Assets with 0 branches, undated or partial dates:** one unlabeled trunk, no forks/branch cards/chips, no `NaN` in any SVG; partial dates sort and interpolate as the period start; undated events are counted, not drawn. Tests: Task 2 (`branchModel([])`, partial-date order, `fullDate`), Task 10/11 (single trunk, empty list), Task 14 (single-trunk header), Task 17/18 (`NaN` absent, single trunk), Task 19 (undated count is derived from the API list).
- **1,000+ events ("All" on Infliximab):** only cards/rows near the viewport are in the DOM. Tests: Task 10 (`trackWindow` < 20 of 1,270), Task 11 (`treeWindow`), Task 17 (≤ 13 cards rendered for 1,270), Task 18 (< 60 rows rendered for 1,270).
- **Hover date accuracy:** the date shown and handed to the composer lies between the neighbouring cards (inclusive) even at month ends, is monotonic and full `YYYY-MM-DD`; horizontal x is a track coordinate. Tests: Task 2 (`hoverDate` property tests), Task 10 (`trackHoverAt`), Task 11 (`treeHoverAt`), Task 17/18 (pill text = composer date and branch).
- **PH-COPD cap at 2022 / closed branches:** the cap sits at the closure date between the right columns (horizontal) and in a "Branch closed" row before the next later event (tree), with later events on a dotted tail. Tests: Task 2 (`branchClosures`), Task 10, Task 11, Task 17, Task 18, Task 19 (closure read from `scope=all&branch=PH-COPD`).
- **Focus return and the real sheet replacing the stub:** the Phase 2 `app-layout` focus-return tests and the host tests stay green; closing after "Locate on timeline" returns focus; the error title is "Event unavailable", the last event stays shown while the sheet animates out, and a record opened from one event closes when another event is shown. Tests: Task 16, Task 21 (full suite incl. `app-layout.test.tsx`).
- **Keyboard in the sheet:** ←/→ navigate, ignored inside the comment box; Esc in the box leaves the box, the next Esc closes. Test: Task 16.
- **Orientation persistence:** `/me/prefs` PATCH with localStorage fallback when prefs 404; URL wins. Tests: Task 4, Task 19.

## Task Dependencies

| Wave | Tasks (mutually independent, run in parallel) | Depends on |
|---|---|---|
| 1 | 1, 2, 3, 5, 6, 7, 8 | — |
| 2 | 9 (8) · 4 (1, 2) · 10 (2, 5) · 11 (2) · 12 (1, 2, 5) · 13 (1, 2, 3, 5) · 14 (1, 2) · 15 (1, 2, 5) | wave 1 |
| 3 | 16 (1, 2, 3, 5, 12, 13) · 17 (2, 5, 10) · 18 (2, 5, 10, 11, 15) | wave 2 |
| 4 | 19 (1–5, 14, 16, 17, 18) | wave 3 |
| 5 | 20 (9, 19; fills the Overview's journey slot) | wave 4 |
| 6 | 21 (phase gate) | all |

The Overview composition (KPI strip → pinned analytics → journey slot) lands in wave 2 (Task 9), usable on its own with the v2 list in the slot. No two tasks in the same wave touch the same file. Files touched by more than one task (different waves): `apps/web/src/features/assets/pages/tabs.tsx` → Task 9 (wave 2: analytics + slot), Task 20 (wave 5: slot → `JourneySection`). Single owners of existing shared files: `apps/web/src/features/journey/api.ts`, `src/stores/event-sheet-store.ts`, `src/stores/stores.test.ts` → Task 1; `src/index.css` → Task 2; `src/features/assets/components/segmented.tsx` → Task 14; `src/features/journey/event-sheet-host.tsx`, `event-sheet-host.test.tsx`, `event-sheet-stub.tsx` (deleted) → Task 16; `src/features/assets/components/milestones.tsx` (deleted) → Task 9; `src/features/assets/api.ts`, `src/features/assets/pages/evidence-tab.tsx`, `src/features/assets/components/journey-timeline.tsx` (deleted), `src/features/chat/asset-panel.test.tsx` → Task 20; `src/features/chat/components/*` → Task 7; `src/features/assets/components/competitors/*`, `src/features/assets/pages/competitors-tab.test.tsx`, `src/features/journey/live-build/just-added.tsx` → Task 6. Shared new modules (one owner, consumed later): `journey-model.ts`, `hover-add.ts`, `lib/scroll.ts` → Task 2; `chips.tsx`, `format.ts`, `note-draft-dialog.tsx`, `sheet/sheet-section.tsx` → Task 5; `features/analytics/*` → Task 8; `view-types.ts` → Task 10.

---
### Task 1: Journey data hooks and the event-sheet store seam

**Files:**
- Modify: `apps/web/src/features/journey/api.ts` (append hooks; `EventRecord` index signature)
- Modify: `apps/web/src/stores/event-sheet-store.ts` (Replace)
- Modify: `apps/web/src/stores/stores.test.ts`
- Test: `apps/web/src/features/journey/journey-api.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`lib/api.ts`), `toQueryString` (`features/assets/api.ts`), `Branch`, `JourneyEventV3` (`features/journey/types.ts`), `createFocusReturn` (`lib/focus-return.ts`), `paletteFocus` (`stores/shell-store.ts`) — existing.
- Produces:
  - `features/journey/api.ts`: `type JourneyScope = 'key' | 'all'`; `interface JourneyTimeline { events: JourneyEventV3[]; total: number }`; `useJourneyEvents(assetId: string, scope: JourneyScope, opts?: { enabled?: boolean })` (key `['asset', id, 'timeline-v3', scope]`); `useBranches(assetId)` (key `['asset', id, 'branches']`) → `Branch[]`; `useEndedBranchEvents(assetId, ended: string[])` (key `['asset', id, 'timeline-v3', 'ended', sortedIds]`, idle for `[]`) → `JourneyTimeline`; `EventRecord` gains `[field: string]: unknown`.
  - `stores/event-sheet-store.ts`: `useEventSheet` keeps `current`, `openEvent(assetId, eventId)`, `closeEvent()` and adds `journeyAsset: string | null`, `locate: LocateRequest | null`, `setJourneyAsset(assetId: string | null)`, `requestLocate(assetId, eventId)` (`seq` increments); `interface LocateRequest extends OpenEvent { seq: number }`.

- [ ] **Step 1: Write the failing tests**

```tsx
// file: apps/web/src/features/journey/journey-api.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { useBranches, useEndedBranchEvents, useJourneyEvents } from './api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchMock = vi.fn(async () => json(200, { events: [], total: 0 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('journey hooks', () => {
  it('reads a scope with the team notes and no server-side filters', async () => {
    const { result } = renderHook(() => useJourneyEvents('trep', 'key'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/timeline?scope=key&include=notes&limit=5000', expect.anything())
    expect(client.getQueryData(['asset', 'trep', 'timeline-v3', 'key'])).toEqual({ events: [], total: 0 })
  })

  it('stays idle when disabled', async () => {
    renderHook(() => useJourneyEvents('trep', 'all', { enabled: false }), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the branches', async () => {
    fetchMock.mockResolvedValueOnce(json(200, [{ id: 'PAH', trunk: true }]))
    const { result } = renderHook(() => useBranches('a/b'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'PAH', trunk: true }]))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/a%2Fb/branches', expect.anything())
  })

  it('reads every event of the ended branches, sorted ids in one request, and idles without any', async () => {
    const { result } = renderHook(() => useEndedBranchEvents('trep', ['PH-COPD', 'CLI']), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/timeline?scope=all&branch=CLI%2CPH-COPD&limit=5000', expect.anything())
    fetchMock.mockClear()
    renderHook(() => useEndedBranchEvents('trep', []), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

Append to `apps/web/src/stores/stores.test.ts` and reset the new fields in its `beforeEach`:

Before:
```ts
  localStorage.clear()
  useShellStore.setState({ sidebarCollapsed: false, paletteOpen: false, mobileNavOpen: false })
  useEventSheet.setState({ current: null })
})
```
After:
```ts
  localStorage.clear()
  useShellStore.setState({ sidebarCollapsed: false, paletteOpen: false, mobileNavOpen: false })
  useEventSheet.setState({ current: null, journeyAsset: null, locate: null })
})
```

Before:
```ts
  })
})
```
After:
```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/features/journey/journey-api.test.tsx src/stores/stores.test.ts`
Expected: FAIL — `useJourneyEvents is not a function` (journey-api.test.tsx) and `setJourneyAsset is not a function` (stores.test.ts).

- [ ] **Step 3: Implement**

In `apps/web/src/features/journey/api.ts`:

Before:
```ts
import { toQueryString, type RecordTab } from '@/features/assets/api'
import { ApiError, apiFetch } from '@/lib/api'
import type { JourneyEventV3 } from './types'

/** A source record of an event, resolved for the evidence list. */
```
After:
```ts
import { toQueryString, type RecordTab } from '@/features/assets/api'
import { ApiError, apiFetch } from '@/lib/api'
import type { Branch, JourneyEventV3 } from './types'

/** A source record of an event, resolved for the evidence list. */
```

Before:
```ts
  record_type: string | null
  source: string | null
}
```
After:
```ts
  record_type: string | null
  source: string | null
  /** The record's own fields, as its tab lists them (trial dates, patent term, application number…). */
  [field: string]: unknown
}
```

Before:
```ts
  })
}
```
After:
```ts
  })
}

/** "Key events" (spec §4.1) or every event. */
export type JourneyScope = 'key' | 'all'

export interface JourneyTimeline {
  events: JourneyEventV3[]
  total: number
}

/** The API caps `limit` at 5000; the largest journey today has ~1,300 events. */
const JOURNEY_LIMIT = 5000

/**
 * A journey scope with the team's notes merged (`include=notes`), newest first as the API sends it. No category,
 * significance or milestone filters are sent: the views filter on the client, so chip counts stay right. (Phase 3's
 * `useTimelineV3` sends neither `include=notes` nor a limit above the API's default 500, so the journey uses this.)
 */
export function useJourneyEvents(assetId: string, scope: JourneyScope, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['asset', assetId, 'timeline-v3', scope],
    queryFn: () =>
      apiFetch<JourneyTimeline>(`/assets/${encodeURIComponent(assetId)}/timeline?scope=${scope}&include=notes&limit=${JOURNEY_LIMIT}`),
    enabled,
    staleTime: 60_000,
  })
}

/** Indication branches, trunk first; `[]` means a single trunk (DATA_CONTRACTS §B.1). */
export function useBranches(assetId: string) {
  return useQuery({
    queryKey: ['asset', assetId, 'branches'],
    queryFn: () => apiFetch<Branch[]>(`/assets/${encodeURIComponent(assetId)}/branches`),
    staleTime: 60_000,
  })
}

/**
 * Every event of the ended branches (scope=all), so each closed lane is capped where its programme stopped — the
 * branch docs carry no closure date. Idle when no branch has ended.
 */
export function useEndedBranchEvents(assetId: string, ended: string[]) {
  const ids = [...ended].sort()
  return useQuery({
    queryKey: ['asset', assetId, 'timeline-v3', 'ended', ids],
    queryFn: () =>
      apiFetch<JourneyTimeline>(`/assets/${encodeURIComponent(assetId)}/timeline${toQueryString({ scope: 'all', branch: ids, limit: JOURNEY_LIMIT })}`),
    enabled: ids.length > 0,
    staleTime: 60_000,
  })
}
```

**Replace** the file:

```ts
// file: apps/web/src/stores/event-sheet-store.ts
import { create } from 'zustand'
import { createFocusReturn } from '@/lib/focus-return'
import { paletteFocus } from './shell-store'

export interface OpenEvent {
  assetId: string
  eventId: string
}

/** A request from the sheet to scroll the on-screen journey to an event (`seq` makes repeats distinct). */
export interface LocateRequest extends OpenEvent {
  seq: number
}

interface EventSheetState {
  current: OpenEvent | null
  /** Asset whose journey is on screen (JourneySection mounted): the sheet can locate its events in place. */
  journeyAsset: string | null
  locate: LocateRequest | null
  openEvent: (assetId: string, eventId: string) => void
  closeEvent: () => void
  setJourneyAsset: (assetId: string | null) => void
  requestLocate: (assetId: string, eventId: string) => void
}

/**
 * The app's one event sheet (spec §5 "Event sheet host"): any surface calls `openEvent`, and `EventSheetHost`
 * in AppLayout renders the sheet.
 */
export const eventSheetFocus = createFocusReturn()

export const useEventSheet = create<EventSheetState>()((set, get) => ({
  current: null,
  journeyAsset: null,
  locate: null,
  openEvent: (assetId, eventId) => {
    if (!get().current) eventSheetFocus.remember(paletteFocus)
    set({ current: { assetId, eventId } })
  },
  closeEvent: () => set({ current: null }),
  setJourneyAsset: (journeyAsset) => set({ journeyAsset }),
  requestLocate: (assetId, eventId) => set({ locate: { assetId, eventId, seq: (get().locate?.seq ?? 0) + 1 } }),
}))
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && npx vitest run src/features/journey/journey-api.test.tsx src/stores/stores.test.ts && npx tsc -b && npm run lint`
Expected: PASS (8 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 2: Journey model, hover-date interpolation, scroll helpers, flash keyframe

**Files:**
- Create: `apps/web/src/features/journey/journey-model.ts`
- Create: `apps/web/src/features/journey/hover-add.ts`
- Create: `apps/web/src/lib/scroll.ts`
- Modify: `apps/web/src/index.css` (`--animate-journey-flash` + keyframes)
- Test: `apps/web/src/features/journey/journey-model.test.ts`, `apps/web/src/features/journey/hover-add.test.ts`, `apps/web/src/lib/scroll.test.ts`

**Interfaces:**
- Consumes: `yearFraction`, `interpolateDate`, `todayIso` (`lib/dates.ts`); `CATEGORIES`, `CATEGORY_META`, `collectionMeta` (`features/journey/constants.ts`); types from `features/journey/types.ts` — existing.
- Produces:
  - `journey-model.ts`: `interface BranchModel { list: Branch[]; byId: Map<string, Branch>; trunk: Branch; multi: boolean }`; `SINGLE_TRUNK: Branch` (id `'journey'`); `branchModel(branches?: Branch[] | null): BranchModel`; `laneOf(e: { branch? }, m): string`; `spanOf(e, m): string[]`; `isDated(e)`; `byDate(a, b)`; `chronological(events): JourneyEventV3[]`; `type JourneyView = 'h' | 'v'`; `type Mine = 'starred' | 'notes'`; `interface ListFilters { cats: EventCategory[]; mine: Mine | null }`; `filterJourney(events, f: ListFilters, stars: string[])`; `journeyCounts(events, stars) → { cats: Record<EventCategory, number>; starred: number; notes: number }`; `interface Closure { id: string; date: string; title: string }`; `branchClosures(events, ended: Iterable<string>): Record<string, Closure>`; `lineage(id, m): Branch[]`; `gapLabel(days): string`; `sourceRefs(e): SourceRef[]`; `viaLabel(e): string`; `howBuilt(e, nRecords): string`; `interface SubtreeNode { label; sub?; mono?; color?; eventId?; children? }`; `subtree(e, resolve: (id) => JourneyEventV3 | undefined): SubtreeNode[]`; `subtreeSize(nodes): number`.
  - `hover-add.ts`: `interface DatedPoint { pos: number; date: string }`; `fullDate(iso): string`; `neighbours(positions: number[], pos: number): [before, after]`; `hoverDate(a: DatedPoint | null, b: DatedPoint | null, pos: number, today?: string): string`.
  - `lib/scroll.ts`: `findScroller(node): HTMLElement`, `viewportHeight(sc)`, `viewportTop(sc)`, `offsetIn(sc, el)`, `onScroll(sc, fn): () => void`, `scrollToTop(sc, top, smooth)`.
  - Tailwind utility `animate-journey-flash` (1.8 s box-shadow pulse, README §6.2).

- [ ] **Step 1: Write the failing tests**

```ts
// file: apps/web/src/features/journey/journey-model.test.ts
import {
  branchClosures,
  branchModel,
  chronological,
  filterJourney,
  gapLabel,
  howBuilt,
  journeyCounts,
  laneOf,
  lineage,
  SINGLE_TRUNK,
  sourceRefs,
  spanOf,
  subtree,
  subtreeSize,
  viaLabel,
} from './journey-model'
import type { Branch, JourneyEventV3 } from './types'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({
  id, label: id, full: `${id} full`, color: '#123456', off, status: 'Approved · US', origin: 'ai', ...extra,
})
const BRANCHES = [br('PAH', 0, { trunk: true }), br('PH-ILD', 2, { from: 'PAH' }), br('IPF', 3, { from: 'PH-ILD' }), br('PH-COPD', -5, { from: 'PAH', ended: 'Terminated' })]

let n = 0
const ev = (date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id: `e${++n}`, asset: 'trep', date, type: 'trial_start', category: 'clinical', title: `Event ${n}`, significance: 'High',
  is_milestone: false, sources: [], via: 'journey', ...extra,
})

describe('branchModel / laneOf / spanOf', () => {
  it('uses the branch docs, trunk first, and falls back to one unlabeled trunk', () => {
    const m = branchModel(BRANCHES)
    expect(m.multi).toBe(true)
    expect(m.trunk.id).toBe('PAH')
    expect(m.byId.get('IPF')?.from).toBe('PH-ILD')
    const single = branchModel([])
    expect(single).toMatchObject({ multi: false, trunk: SINGLE_TRUNK, list: [SINGLE_TRUNK] })
    expect(branchModel(undefined).multi).toBe(false)
  })

  it('puts events without a known branch on the trunk', () => {
    const m = branchModel(BRANCHES)
    expect(laneOf({ branch: 'IPF' }, m)).toBe('IPF')
    expect(laneOf({ branch: 'Gone' }, m)).toBe('PAH')
    expect(laneOf({}, m)).toBe('PAH')
    expect(laneOf({ branch: 'IPF' }, branchModel([]))).toBe('journey')
  })

  it('bridges only to other known branches', () => {
    const m = branchModel(BRANCHES)
    expect(spanOf({ branch: 'PAH', span: ['PAH', 'PH-ILD', 'X', 'PH-ILD'] }, m)).toEqual(['PH-ILD'])
    expect(spanOf({ branch: 'PAH', span: ['PH-ILD'] }, branchModel([]))).toEqual([])
  })
})

describe('chronological / filterJourney / journeyCounts', () => {
  it('drops undated events and sorts by date then id', () => {
    const a = ev('2021-03-01', { id: 'b' })
    const b = ev('2021-03-01', { id: 'a' })
    const c = ev('2002-05-21')
    const out = chronological([a, ev(''), c, b, ev('soon')])
    expect(out.map((e) => e.id)).toEqual([c.id, 'a', 'b'])
  })

  it('keeps partial dates in order', () => {
    expect(chronological([ev('2021-03-04'), ev('2021'), ev('2021-03')]).map((e) => e.date)).toEqual(['2021', '2021-03', '2021-03-04'])
  })

  it('filters by category, starred and team notes, and counts before filtering', () => {
    const note = ev('2020-01-01', { via: 'user', category: 'regulatory' })
    const star = ev('2019-01-01', { category: 'ip' })
    const plain = ev('2018-01-01')
    const all = [plain, star, note]
    expect(filterJourney(all, { cats: ['ip', 'regulatory'], mine: null }, []).map((e) => e.id)).toEqual([star.id, note.id])
    expect(filterJourney(all, { cats: [], mine: 'starred' }, [star.id])).toEqual([star])
    expect(filterJourney(all, { cats: [], mine: 'notes' }, [])).toEqual([note])
    expect(journeyCounts(all, [star.id, 'elsewhere'])).toEqual({
      cats: { regulatory: 1, clinical: 1, safety: 0, company: 0, ip: 1 },
      starred: 1,
      notes: 1,
    })
  })
})

describe('branchClosures', () => {
  it('closes an ended branch at its last stopped trial, not at later publications (PH-COPD 2022)', () => {
    const events = [
      ev('2018-05-08', { branch: 'PH-COPD', title: 'Phase 3 trial started: PERFECT' }),
      ev('2022-10-13', { branch: 'PH-COPD', type: 'trial_stopped', title: 'Phase 3 trial terminated: PERFECT' }),
      ev('2022-11-29', { branch: 'PH-COPD', type: 'trial_stopped', title: 'Phase 3 trial terminated: PERFECT OLE' }),
      ev('2025-03-18', { branch: 'PH-COPD', type: 'safety', title: 'PERFECT stopped early' }),
      ev('2004-09-01', { branch: 'CLI', type: 'publication' }),
    ]
    const out = branchClosures(events, ['PH-COPD', 'CLI', 'PPHN'])
    expect(out['PH-COPD']).toMatchObject({ date: '2022-11-29', title: 'Phase 3 trial terminated: PERFECT OLE' })
    expect(out.CLI?.date).toBe('2004-09-01')
    expect(out.PPHN).toBeUndefined()
  })
})

describe('lineage / gapLabel', () => {
  it('walks parents from the root and survives unknown parents and cycles', () => {
    const m = branchModel(BRANCHES)
    expect(lineage('IPF', m).map((b) => b.id)).toEqual(['PAH', 'PH-ILD', 'IPF'])
    expect(lineage('Nope', m)).toEqual([])
    const loop = branchModel([br('A', 0, { trunk: true, from: 'B' }), br('B', 1, { from: 'A' })])
    expect(lineage('B', loop).map((b) => b.id)).toEqual(['A', 'B'])
  })

  it('reads days up to 400, then years', () => {
    expect(gapLabel(1)).toBe('1 day')
    expect(gapLabel(78)).toBe('78 days')
    expect(gapLabel(400)).toBe('400 days')
    expect(gapLabel(1680)).toBe('4.6 years')
  })
})

describe('sources, via and how it was built', () => {
  it('merges sources and merged_sources once each', () => {
    const e = ev('2021-01-01', {
      sources: [{ collection: 'fda_records', record_key: 'a' }],
      merged_sources: [{ collection: 'fda_records', record_key: 'a' }, { collection: 'articles', record_key: 'b' }],
    })
    expect(sourceRefs(e)).toHaveLength(2)
  })

  it('labels each origin', () => {
    const one = [{ collection: 'trial_records', record_key: 'ctgov:NCT1' }]
    expect(viaLabel(ev('2021-01-01', { sources: one }))).toBe('Rule · trial_records')
    expect(viaLabel(ev('2021-01-01'))).toBe('Rule')
    expect(viaLabel(ev('2021-01-01', { via: 'ai_events', sources: one }))).toBe('AI · 1 record')
    expect(viaLabel(ev('2021-01-01', { via: 'ai_events', sources: [...one, { collection: 'articles', record_key: 'u' }] }))).toBe('AI · merged 2 records')
    expect(viaLabel(ev('2021-01-01', { via: 'finalize', sources: one }))).toBe('Rebuild · trial_records')
    const user = { tag: 'Risk' as const, by: { id: 'u1', name: 'Ana Analyst' }, created_at: '2026-10-01T10:00:00Z', mode: 'manual' as const }
    expect(viaLabel(ev('2021-01-01', { via: 'user', user }))).toBe('Added by Ana Analyst')
    expect(howBuilt(ev('2021-01-01', { via: 'ai_events' }), 3)).toBe('Extracted and consolidated by AI from 3 records.')
    expect(howBuilt(ev('2021-01-01', { type: 'approval' }), 1)).toBe('Mapped by rule (approval).')
    expect(howBuilt(ev('2021-01-01', { via: 'user', user }), 0)).toBe('Added by a team member.')
  })
})

describe('subtree', () => {
  it('lists the single record with its key facts, the indications and the linked events it can resolve', () => {
    const linked = ev('2025-09-30', { id: 'L1', title: 'FDA accepts Tyvaso sNDA', category: 'regulatory' })
    const e = ev('2021-06-01', {
      sources: [{ collection: 'trial_records', record_key: 'ctgov:NCT04708782' }],
      details: { Trial: 'NCT04708782', Phase: 'Phase 3', Enrollment: '~600', 'Primary endpoint': 'FVC', Status: 'Active' },
      indications: ['IPF'],
      links: ['L1', 'missing'],
    })
    const nodes = subtree(e, (id) => (id === 'L1' ? linked : undefined))
    expect(nodes.map((x) => x.label)).toEqual(['ctgov:NCT04708782', 'Indications', 'Linked journey events'])
    expect(nodes[0]!.children!.map((c) => `${c.sub}:${c.label}`)).toEqual(['Trial:NCT04708782', 'Phase:Phase 3', 'Enrollment:~600', 'Primary endpoint:FVC'])
    expect(nodes[2]!.children).toEqual([{ label: 'FDA accepts Tyvaso sNDA', sub: '2025-09-30', eventId: 'L1', color: '#2347d9' }])
    expect(subtreeSize(nodes)).toBe(3 + 4 + 1 + 1)
  })

  it('groups consolidated records and says when a note was added by hand', () => {
    const merged = ev('2021-01-01', { sources: [{ collection: 'articles', record_key: 'a' }, { collection: 'fda_records', record_key: 'b' }] })
    expect(subtree(merged, () => undefined)[0]).toMatchObject({ label: 'Consolidated from 2 records', children: [{ label: 'a', mono: true }, { label: 'b' }] })
    const user = { tag: 'Question' as const, by: { id: 'u1', name: 'Ana Analyst' }, created_at: '2026-10-01T10:00:00Z', mode: 'manual' as const }
    expect(subtree(ev('2021-01-01', { via: 'user', user }), () => undefined)[0]).toEqual({
      label: 'Added manually',
      children: [{ label: 'Ana Analyst', sub: '2026-10-01' }],
    })
  })
})
```

```ts
// file: apps/web/src/features/journey/hover-add.test.ts
import { yearFraction } from '@/lib/dates'
import { fullDate, hoverDate, neighbours } from './hover-add'

describe('fullDate', () => {
  it('starts partial dates at the beginning of the period', () => {
    expect(fullDate('2021')).toBe('2021-01-01')
    expect(fullDate('2021-03')).toBe('2021-03-01')
    expect(fullDate('2013-02-11')).toBe('2013-02-11')
  })
})

describe('neighbours', () => {
  it('finds the positions just before and after', () => {
    const xs = [236, 414, 592]
    expect(neighbours(xs, 100)).toEqual([-1, 0])
    expect(neighbours(xs, 414)).toEqual([1, 2])
    expect(neighbours(xs, 500)).toEqual([1, 2])
    expect(neighbours(xs, 900)).toEqual([2, 3])
    expect(neighbours([], 5)).toEqual([-1, 0])
  })
})

describe('hoverDate', () => {
  const a = { pos: 100, date: '2012-06-01' }
  const b = { pos: 300, date: '2013-12-20' }

  it('interpolates linearly in year fraction between the neighbours', () => {
    const mid = hoverDate(a, b, 200)
    const expected = (yearFraction(a.date) + yearFraction(b.date)) / 2
    expect(Math.abs(yearFraction(mid) - expected)).toBeLessThan(0.01)
  })

  it('reads the neighbour itself at its position and outside the range', () => {
    expect(hoverDate(a, b, 100)).toBe('2012-06-01')
    expect(hoverDate(a, b, 40)).toBe('2012-06-01')
    expect(hoverDate(null, b, 40)).toBe('2013-12-20')
    expect(hoverDate(a, null, 900)).toBe('2012-06-01')
    expect(hoverDate(null, null, 5, '2026-10-09')).toBe('2026-10-09')
  })

  it('always lies between the neighbouring cards, even at month ends where the 28-day clamp overshoots', () => {
    const pairs = [
      ['2013-03-31', '2013-04-02'],
      ['2013-01-30', '2013-02-02'],
      ['2019-12-31', '2020-01-01'],
      ['2021', '2021-03-15'],
      ['2005-04-27', '2005-04-27'],
      ['2002-05-21', '2028-11-01'],
    ] as const
    for (const [da, db] of pairs) {
      for (let pos = 0; pos <= 100; pos += 2.5) {
        const d = hoverDate({ pos: 0, date: da }, { pos: 100, date: db }, pos)
        expect(d >= fullDate(da) && d <= fullDate(db), `${da}..${db} @${pos} → ${d}`).toBe(true)
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })

  it('is monotonic as the pointer moves right', () => {
    let last = ''
    for (let pos = 0; pos <= 100; pos += 1) {
      const d = hoverDate({ pos: 0, date: '2004-11-23' }, { pos: 100, date: '2006-05-15' }, pos)
      expect(d >= last).toBe(true)
      last = d
    }
  })
})
```

```ts
// file: apps/web/src/lib/scroll.test.ts
import { findScroller, offsetIn, scrollToTop, viewportHeight } from './scroll'

describe('scroll helpers', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds the nearest scrolling ancestor, else the document', () => {
    const outer = document.body.appendChild(document.createElement('main'))
    outer.style.overflowY = 'auto'
    const inner = outer.appendChild(document.createElement('div')).appendChild(document.createElement('section'))
    expect(findScroller(inner)).toBe(outer)
    const loose = document.body.appendChild(document.createElement('div'))
    expect(findScroller(loose)).toBe(document.documentElement)
    expect(viewportHeight(document.documentElement)).toBe(window.innerHeight)
  })

  it('scrolls with scrollTo when there is one, else sets scrollTop, never below 0', () => {
    const el = document.body.appendChild(document.createElement('div'))
    scrollToTop(el, 120.4, true)
    expect(el.scrollTop).toBe(120)
    scrollToTop(el, -50, false)
    expect(el.scrollTop).toBe(0)
    const scrollTo = vi.fn()
    Object.assign(el, { scrollTo })
    scrollToTop(el, 300, true)
    expect(scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'smooth' })
    scrollToTop(el, 300, false)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 300, behavior: 'auto' })
  })

  it('measures an element in the scroller’s content coordinates', () => {
    const sc = document.body.appendChild(document.createElement('div'))
    const child = sc.appendChild(document.createElement('div'))
    sc.scrollTop = 40
    vi.spyOn(sc, 'getBoundingClientRect').mockReturnValue({ top: 56 } as DOMRect)
    vi.spyOn(child, 'getBoundingClientRect').mockReturnValue({ top: 156 } as DOMRect)
    expect(offsetIn(sc, child)).toBe(140)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/features/journey/journey-model.test.ts src/features/journey/hover-add.test.ts src/lib/scroll.test.ts`
Expected: FAIL — `Failed to resolve import "./journey-model"`, `"./hover-add"` and `"./scroll"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/journey/journey-model.ts
import { yearFraction } from '@/lib/dates'
import { CATEGORIES, CATEGORY_META, collectionMeta } from './constants'
import type { Branch, EventCategory, JourneyEventV3, SourceRef } from './types'

/** The asset's indication branches as lanes. Without branch docs the journey is one unlabeled trunk (DATA_CONTRACTS §B.1). */
export interface BranchModel {
  list: Branch[]
  byId: Map<string, Branch>
  trunk: Branch
  /** Real branches exist: lane labels, fork rows, branch cards and chips are shown. */
  multi: boolean
}

export const SINGLE_TRUNK: Branch = { id: 'journey', label: '', full: '', color: '#2347d9', off: 0, trunk: true, status: '', origin: 'rule' }

export function branchModel(branches: Branch[] | null | undefined): BranchModel {
  const multi = !!branches && branches.length > 0
  const list = multi ? branches : [SINGLE_TRUNK]
  const trunk = list.find((b) => b.trunk) ?? list[0]!
  return { list, byId: new Map(list.map((b) => [b.id, b])), trunk, multi }
}

/** The lane an event is drawn on: its branch when the asset has it, else the trunk. */
export function laneOf(e: Pick<JourneyEventV3, 'branch'>, m: BranchModel): string {
  return e.branch && m.byId.has(e.branch) ? e.branch : m.trunk.id
}

/** Branches a multi-indication event also covers (dotted bridge), without its own lane. */
export function spanOf(e: Pick<JourneyEventV3, 'span' | 'branch'>, m: BranchModel): string[] {
  if (!m.multi || !e.span?.length) return []
  const own = laneOf(e, m)
  return [...new Set(e.span)].filter((id) => id !== own && m.byId.has(id))
}

export const isDated = (e: Pick<JourneyEventV3, 'date'>) => Number.isFinite(yearFraction(e.date))

/** Oldest first; ties by id (the API's neighbour order). */
export const byDate = (a: Pick<JourneyEventV3, 'date' | 'id'>, b: Pick<JourneyEventV3, 'date' | 'id'>) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id)

/** Dated events, oldest first. Undated events can't be placed on a time axis. */
export function chronological(events: JourneyEventV3[]): JourneyEventV3[] {
  return events.filter(isDated).sort(byDate)
}

/** h = horizontal track (default, spec §3), v = tree. */
export type JourneyView = 'h' | 'v'

export type Mine = 'starred' | 'notes'

export interface ListFilters {
  cats: EventCategory[]
  mine: Mine | null
}

/** The events a journey view shows: selected categories (none = all), then Starred or Team notes. */
export function filterJourney(events: JourneyEventV3[], f: ListFilters, stars: string[]): JourneyEventV3[] {
  const starred = new Set(stars)
  return events.filter(
    (e) =>
      (!f.cats.length || f.cats.includes(e.category)) &&
      (f.mine !== 'starred' || starred.has(e.id)) &&
      (f.mine !== 'notes' || e.via === 'user'),
  )
}

/** Chip counts over the scope's events (before category / Starred / Team notes filters). */
export function journeyCounts(events: JourneyEventV3[], stars: string[]) {
  const starred = new Set(stars)
  const cats = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<EventCategory, number>
  let nStarred = 0
  let notes = 0
  for (const e of events) {
    if (e.category in cats) cats[e.category]++
    if (starred.has(e.id)) nStarred++
    if (e.via === 'user') notes++
  }
  return { cats, starred: nStarred, notes }
}

/** Where an ended branch closed. */
export interface Closure {
  id: string
  date: string
  title: string
}

const STOP_TYPES = new Set(['trial_stopped', 'trial_terminated', 'trial_withdrawn', 'application_withdrawn', 'withdrawal'])

/**
 * Closure of each ended branch: its latest stopped / withdrawn event, else its latest event. Pass every event of the
 * ended branches (scope=all): the key scope can miss the termination (Treprostinil PH-COPD closes in 2022 although
 * its last key event is a 2025 publication).
 */
export function branchClosures(events: JourneyEventV3[], ended: Iterable<string>): Record<string, Closure> {
  const out: Record<string, Closure> = {}
  for (const id of ended) {
    const mine = chronological(events.filter((e) => e.branch === id))
    const stops = mine.filter((e) => STOP_TYPES.has(e.type))
    const at = stops[stops.length - 1] ?? mine[mine.length - 1]
    if (at) out[id] = { id: at.id, date: at.date, title: at.title }
  }
  return out
}

/** Root-first ancestry of a branch ("PAH › PH-ILD › IPF"); stops at unknown parents and cycles. */
export function lineage(id: string, m: BranchModel): Branch[] {
  const out: Branch[] = []
  const seen = new Set<string>()
  let b = m.byId.get(id)
  while (b && !seen.has(b.id)) {
    out.unshift(b)
    seen.add(b.id)
    b = b.from ? m.byId.get(b.from) : undefined
  }
  return out
}

/** "78 days", "1 day"; over 400 days in years ("4.6 years"). */
export const gapLabel = (days: number) => (days > 400 ? `${(days / 365).toFixed(1)} years` : `${days} day${days === 1 ? '' : 's'}`)

/** Every record behind an event: its sources plus those folded in by AI consolidation, once each. */
export function sourceRefs(e: Pick<JourneyEventV3, 'sources' | 'merged_sources'>): SourceRef[] {
  const seen = new Map<string, SourceRef>()
  for (const r of [...(e.sources ?? []), ...(e.merged_sources ?? [])]) seen.set(`${r.collection}|${r.record_key}`, r)
  return [...seen.values()]
}

/** Card footer: how the event entered the journey. */
export function viaLabel(e: JourneyEventV3): string {
  const refs = sourceRefs(e)
  const first = refs[0]?.collection
  if (e.via === 'user') return e.user?.mode === 'ai' ? `You + AI · ${refs.length} sources` : `Added by ${e.user?.by.name ?? 'a team member'}`
  if (e.via === 'ai_events') return refs.length > 1 ? `AI · merged ${refs.length} records` : 'AI · 1 record'
  if (e.via === 'finalize') return first ? `Rebuild · ${first}` : 'Rebuild'
  return first ? `Rule · ${first}` : 'Rule'
}

/** Detail sheet, under the evidence: how this event was built. */
export function howBuilt(e: JourneyEventV3, nRecords: number): string {
  if (e.via === 'ai_events') return `Extracted and consolidated by AI from ${nRecords} record${nRecords === 1 ? '' : 's'}.`
  if (e.via === 'finalize') return 'Added when the journey was rebuilt with patents and the FDA calendar.'
  if (e.via === 'user') return e.user?.mode === 'ai' ? 'Found by Asset AI from your note.' : 'Added by a team member.'
  return `Mapped by rule (${e.type}).`
}

/** One node of a card's subtree (README §6.2 "Subtree"). */
export interface SubtreeNode {
  label: string
  sub?: string
  mono?: boolean
  /** Leaf dot colour (collection or category). */
  color?: string
  /** Linked journey event: the row jumps to it. */
  eventId?: string
  children?: SubtreeNode[]
}

/** Evidence → key facts, indications, linked events; `resolve` finds linked events (unknown ids are left out). */
export function subtree(e: JourneyEventV3, resolve: (id: string) => JourneyEventV3 | undefined): SubtreeNode[] {
  const out: SubtreeNode[] = []
  const refs = sourceRefs(e)
  const dot = (coll: string) => collectionMeta(coll).color
  if (!refs.length) {
    out.push({ label: 'Added manually', children: [{ label: e.user?.by.name ?? 'Team member', sub: e.user?.created_at.slice(0, 10) }] })
  } else if (refs.length > 1) {
    out.push({
      label: `Consolidated from ${refs.length} records`,
      children: refs.map((r) => ({ label: r.record_key, sub: r.collection, mono: true, color: dot(r.collection) })),
    })
  } else {
    const r = refs[0]!
    const facts = Object.entries(e.details ?? {}).slice(0, 4)
    out.push({
      label: r.record_key,
      sub: r.collection,
      mono: true,
      color: dot(r.collection),
      ...(facts.length && { children: facts.map(([k, v]) => ({ label: v, sub: k })) }),
    })
  }
  if (e.indications?.length) out.push({ label: 'Indications', children: e.indications.map((i) => ({ label: i })) })
  const linked = (e.links ?? []).map(resolve).filter((x): x is JourneyEventV3 => !!x)
  if (linked.length) {
    out.push({
      label: 'Linked journey events',
      children: linked.map((l) => ({
        label: l.title,
        sub: l.is_milestone ? `expected ${l.date.slice(0, 7)}` : l.date,
        eventId: l.id,
        color: CATEGORY_META[l.category]?.color,
      })),
    })
  }
  return out
}

/** Nodes in a subtree (the count on the "Subtree" button). */
export const subtreeSize = (nodes: SubtreeNode[]) => nodes.reduce((n, x) => n + 1 + (x.children?.length ?? 0), 0)
```

```ts
// file: apps/web/src/features/journey/hover-add.ts
import { interpolateDate, todayIso, yearFraction } from '@/lib/dates'

/** An event on a view's axis: its position (x in the horizontal track, y in the tree) and date. */
export interface DatedPoint {
  pos: number
  date: string
}

/** "2021" → "2021-01-01", "2021-03" → "2021-03-01"; a full date is unchanged. */
export function fullDate(iso: string): string {
  const [y, m = '01', d = '01'] = iso.slice(0, 10).split('-')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** Indices of the events just before and just after `pos` in ascending `positions` (-1 / length when none). */
export function neighbours(positions: number[], pos: number): [before: number, after: number] {
  let lo = 0
  let hi = positions.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (positions[mid]! > pos) hi = mid
    else lo = mid + 1
  }
  return [lo - 1, lo]
}

/**
 * Hover-to-add date (README §6.2 / §6.3): linear in year fraction between the events before (`a`) and after (`b`)
 * the pointer, then clamped to [a.date, b.date] so it always matches the neighbouring cards (the 28-day clamp of
 * `fromYearFraction` can otherwise step past them). Before the first event → its date; after the last → its date.
 */
export function hoverDate(a: DatedPoint | null, b: DatedPoint | null, pos: number, today: string = todayIso()): string {
  if (!a && !b) return today
  if (!a) return fullDate(b!.date)
  if (!b || b.pos <= a.pos || pos <= a.pos) return fullDate(a.date)
  const lo = fullDate(a.date)
  const hi = fullDate(b.date)
  const d = interpolateDate(yearFraction(a.date), yearFraction(b.date), (pos - a.pos) / (b.pos - a.pos))
  return d < lo ? lo : d > hi ? hi : d
}
```

```ts
// file: apps/web/src/lib/scroll.ts
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
```

In `apps/web/src/index.css`:

Before:
```css
    /* live dots: sidebar crawl dot, "Building" rows, collecting pills */
    --animate-blink-dot: blink-dot 1.2s ease-in-out infinite;
    /* live build (README §4 "Motion"; design_files/aj/base.css) */
    --animate-ag-in: ag-in 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
```
After:
```css
    /* live dots: sidebar crawl dot, "Building" rows, collecting pills */
    --animate-blink-dot: blink-dot 1.2s ease-in-out infinite;
    /* journey: a card a deep link or "Locate on timeline" lands on (README §6.2 "flash") */
    --animate-journey-flash: journey-flash 1.8s ease;
    /* live build (README §4 "Motion"; design_files/aj/base.css) */
    --animate-ag-in: ag-in 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
```

Before:
```css
        50% { opacity: 0.25; }
    }
    @keyframes ag-in {
        from { opacity: 0; transform: scale(0.86); }
```
After:
```css
        50% { opacity: 0.25; }
    }
    @keyframes journey-flash {
        0%, 50% { box-shadow: 0 0 0 4px rgba(35, 71, 217, 0.35), 0 16px 40px rgba(35, 71, 217, 0.15); }
        100% { box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04); }
    }
    @keyframes ag-in {
        from { opacity: 0; transform: scale(0.86); }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && npx vitest run src/features/journey/journey-model.test.ts src/features/journey/hover-add.test.ts src/lib/scroll.test.ts && npx tsc -b && npm run lint`
Expected: PASS (22 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 3: Annotations hooks: stars and comments (optimistic)

**Files:**
- Create: `apps/web/src/features/journey/annotations-api.ts`
- Test: `apps/web/src/features/journey/annotations-api.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`; `ME_KEY`, `User` (`features/auth/auth-context.tsx`); `Annotations`, `EventComment` (`features/journey/types.ts`); `toast` (sonner) — existing.
- Produces: `annotationsKey(assetId) → ['asset', assetId, 'annotations']`; `useAnnotations(assetId)` → `Annotations`; `useToggleStar(assetId)` → mutation `{ eventId: string; on: boolean }` (PUT/DELETE, optimistic, rollback + `toast.error("The star couldn't be saved.")`); `useAddComment(assetId)` → mutation `{ eventId: string; text: string }` (optimistic temp comment as the signed-in user from the `ME_KEY` cache, replaced by the saved one; rollback + `toast.error("The comment couldn't be posted.")`). Phase 5 adds the note hooks to this file.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/annotations-api.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import type { Mock } from 'vitest'
import { ME_KEY } from '@/features/auth/auth-context'
import { annotationsKey, useAddComment, useAnnotations, useToggleStar } from './annotations-api'
import type { Annotations } from './types'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const EVENT_ID = 'ai:trep:https://example.com/a/b:0'
const ENCODED = encodeURIComponent(EVENT_ID)
const BASE: Annotations = { stars: ['other'], comments: {}, notes: [] }

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
const cached = () => client.getQueryData<Annotations>(annotationsKey('trep'))

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(ME_KEY, { id: 'u1', name: 'Ana Analyst' })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(toast, 'error').mockImplementation(() => 'id')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('annotations', () => {
  it('loads the annotations of an asset', async () => {
    fetchMock.mockResolvedValue(json(200, BASE))
    const { result } = renderHook(() => useAnnotations('trep'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(BASE))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/annotations', expect.anything())
  })

  it('stars at once with the encoded event id, and unstars with DELETE', async () => {
    client.setQueryData(annotationsKey('trep'), BASE)
    let release: (r: Response) => void = () => {}
    fetchMock.mockImplementation((url) => (url.endsWith('/star') ? new Promise((r) => (release = r)) : Promise.resolve(json(200, cached()))))
    const { result } = renderHook(() => useToggleStar('trep'), { wrapper })
    act(() => result.current.mutate({ eventId: EVENT_ID, on: true }))
    await waitFor(() => expect(cached()?.stars).toEqual(['other', EVENT_ID]))
    expect(fetchMock).toHaveBeenCalledWith(`/api/assets/trep/events/${ENCODED}/star`, expect.objectContaining({ method: 'PUT' }))
    await act(async () => release(json(204)))
    fetchMock.mockResolvedValue(json(204))
    await act(() => result.current.mutateAsync({ eventId: EVENT_ID, on: false }))
    expect(cached()?.stars).toEqual(['other'])
    expect(fetchMock).toHaveBeenCalledWith(`/api/assets/trep/events/${ENCODED}/star`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('rolls the star back and says so when saving fails', async () => {
    client.setQueryData(annotationsKey('trep'), BASE)
    fetchMock.mockImplementation(async (url) => (url.endsWith('/star') ? json(500, { code: 'ERROR', message: 'boom' }) : json(200, BASE)))
    const { result } = renderHook(() => useToggleStar('trep'), { wrapper })
    await act(() => result.current.mutateAsync({ eventId: EVENT_ID, on: true }).catch(() => undefined))
    expect(cached()?.stars).toEqual(['other'])
    expect(toast.error).toHaveBeenCalledWith("The star couldn't be saved.")
  })

  it('shows a comment as you at once, then the saved one', async () => {
    client.setQueryData(annotationsKey('trep'), BASE)
    let release: (r: Response) => void = () => {}
    fetchMock.mockImplementation(() => new Promise((r) => (release = r)))
    const { result } = renderHook(() => useAddComment('trep'), { wrapper })
    act(() => result.current.mutate({ eventId: EVENT_ID, text: 'Check the label' }))
    await waitFor(() => expect(cached()?.comments[EVENT_ID]).toMatchObject([{ by: { id: 'u1', name: 'Ana Analyst' }, text: 'Check the label' }]))
    expect(fetchMock).toHaveBeenCalledWith(`/api/assets/trep/events/${ENCODED}/comments`, expect.objectContaining({ method: 'POST', body: '{"text":"Check the label"}' }))
    const saved = { id: 'c1', by: { id: 'u1', name: 'Ana Analyst' }, at: '2026-10-09T10:00:00.000Z', text: 'Check the label' }
    await act(async () => release(json(201, saved)))
    await waitFor(() => expect(cached()?.comments[EVENT_ID]).toEqual([saved]))
  })

  it('removes a comment that failed to post and says so', async () => {
    client.setQueryData(annotationsKey('trep'), BASE)
    fetchMock.mockResolvedValue(json(400, { code: 'BAD', message: 'too long' }))
    const { result } = renderHook(() => useAddComment('trep'), { wrapper })
    await act(() => result.current.mutateAsync({ eventId: EVENT_ID, text: 'x' }).catch(() => undefined))
    expect(cached()?.comments[EVENT_ID]).toBeUndefined()
    expect(toast.error).toHaveBeenCalledWith("The comment couldn't be posted.")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/annotations-api.test.tsx`
Expected: FAIL — `Failed to resolve import "./annotations-api"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/journey/annotations-api.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ME_KEY, type User } from '@/features/auth/auth-context'
import { apiFetch } from '@/lib/api'
import type { Annotations, EventComment } from './types'

const enc = encodeURIComponent
export const annotationsKey = (assetId: string) => ['asset', assetId, 'annotations'] as const

/** Stars (yours), comments and notes (the team's) on an asset's journey (DATA_CONTRACTS §B.3). */
export function useAnnotations(assetId: string) {
  return useQuery({
    queryKey: annotationsKey(assetId),
    queryFn: () => apiFetch<Annotations>(`/assets/${enc(assetId)}/annotations`),
    staleTime: 30_000,
  })
}

/** Star or unstar an event: the star flips at once and flips back with a toast if the server refuses. */
export function useToggleStar(assetId: string) {
  const qc = useQueryClient()
  const key = annotationsKey(assetId)
  return useMutation({
    mutationFn: ({ eventId, on }: { eventId: string; on: boolean }) =>
      apiFetch<void>(`/assets/${enc(assetId)}/events/${enc(eventId)}/star`, { method: on ? 'PUT' : 'DELETE' }),
    onMutate: async ({ eventId, on }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Annotations>(key)
      if (prev) {
        const stars = on ? [...new Set([...prev.stars, eventId])] : prev.stars.filter((s) => s !== eventId)
        qc.setQueryData<Annotations>(key, { ...prev, stars })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      toast.error("The star couldn't be saved.")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

/** Post a team comment: it shows at once (as you) and is removed again with a toast if the post fails. */
export function useAddComment(assetId: string) {
  const qc = useQueryClient()
  const key = annotationsKey(assetId)
  return useMutation({
    mutationFn: ({ eventId, text }: { eventId: string; text: string }) =>
      apiFetch<EventComment>(`/assets/${enc(assetId)}/events/${enc(eventId)}/comments`, { method: 'POST', body: { text } }),
    onMutate: async ({ eventId, text }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Annotations>(key)
      const me = qc.getQueryData<User | null>(ME_KEY)
      const temp: EventComment = { id: `temp:${Date.now()}`, by: { id: me?.id ?? '', name: me?.name ?? 'You' }, at: new Date().toISOString(), text }
      if (prev) qc.setQueryData<Annotations>(key, { ...prev, comments: { ...prev.comments, [eventId]: [...(prev.comments[eventId] ?? []), temp] } })
      return { prev, temp }
    },
    onSuccess: (saved, { eventId }, ctx) => {
      qc.setQueryData<Annotations>(key, (old) =>
        old && { ...old, comments: { ...old.comments, [eventId]: (old.comments[eventId] ?? []).map((c) => (c.id === ctx.temp.id ? saved : c)) } },
      )
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      toast.error("The comment couldn't be posted.")
    },
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/annotations-api.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (5 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 4: Journey filters and orientation in the URL, prefs and localStorage

**Files:**
- Create: `apps/web/src/features/journey/use-journey-filters.ts`
- Test: `apps/web/src/features/journey/use-journey-filters.test.tsx`

**Interfaces:**
- Consumes: `usePrefs`, `useSavePrefs` (`features/me/api.ts`); `JourneyScope` (Task 1); `JourneyView`, `Mine` (Task 2); `CATEGORIES` (constants).
- Produces: `VIEW_STORAGE_KEY = 'aj.orient'`; `useJourneyFilters()` → `{ view: JourneyView; scope: JourneyScope; cats: EventCategory[]; mine: Mine | null; focus: string | null; setView(v); setScope(s); toggleCat(c); setMine(m | null); clearFilters(); showEverything(); focusOn(id); clearFocus() }`. URL updates use `replace` and keep other params.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/use-journey-filters.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { Mock } from 'vitest'
import { useJourneyFilters, VIEW_STORAGE_KEY } from './use-journey-filters'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const PREFS = { journeyView: 'v', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: false } }
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>

function setup(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let router!: ReturnType<typeof createMemoryRouter>
  const wrapper = ({ children }: { children: ReactNode }) => {
    router ??= createMemoryRouter([{ path: '*', element: children }], { initialEntries: [path] })
    return (
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  }
  const hook = renderHook(() => useJourneyFilters(), { wrapper })
  return { ...hook, search: () => new URLSearchParams(router.state.location.search) }
}

beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn(async () => json(404, { code: 'NOT_FOUND', message: 'nope' }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('useJourneyFilters', () => {
  it('defaults to the horizontal view with key events and no filters', async () => {
    const { result } = setup('/assets/trep/overview')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/me/prefs', expect.anything()))
    expect(result.current).toMatchObject({ view: 'h', scope: 'key', cats: [], mine: null, focus: null })
  })

  it('reads the orientation from /me/prefs, the URL first', async () => {
    fetchMock.mockImplementation(async (url) => (url === '/api/me/prefs' ? json(200, PREFS) : json(404)))
    const { result } = setup('/assets/trep/overview')
    await waitFor(() => expect(result.current.view).toBe('v'))
    const other = setup('/assets/trep/overview?view=h')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(other.result.current.view).toBe('h')
  })

  it('falls back to localStorage when prefs are unavailable, and saves a change to prefs, storage and the URL', async () => {
    localStorage.setItem(VIEW_STORAGE_KEY, 'v')
    const { result, search } = setup('/assets/trep/overview')
    expect(result.current.view).toBe('v')
    act(() => result.current.setView('h'))
    await waitFor(() => expect(result.current.view).toBe('h'))
    expect(search().get('view')).toBe('h')
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe('h')
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/me/prefs', expect.objectContaining({ method: 'PATCH', body: '{"journeyView":"h"}' })),
    )
  })

  it('keeps scope, categories and Starred / Team notes in the URL and ignores unknown values', async () => {
    const { result, search } = setup('/assets/trep/overview?cat=ip,bogus&mine=everything&scope=weird')
    expect(result.current).toMatchObject({ scope: 'key', cats: ['ip'], mine: null })
    act(() => result.current.setScope('all'))
    act(() => result.current.toggleCat('clinical'))
    act(() => result.current.setMine('starred'))
    await waitFor(() => expect(result.current).toMatchObject({ scope: 'all', cats: ['ip', 'clinical'], mine: 'starred' }))
    expect(search().toString()).toBe('cat=ip%2Cclinical&mine=starred&scope=all')
    act(() => result.current.toggleCat('ip'))
    act(() => result.current.toggleCat('clinical'))
    act(() => result.current.setScope('key'))
    await waitFor(() => expect(search().toString()).toBe('mine=starred'))
    act(() => result.current.clearFilters())
    await waitFor(() => expect(search().toString()).toBe(''))
  })

  it('round-trips an event id with ":" and "/" through ?focus=, and shows everything without losing it', async () => {
    const id = 'ai:trep:https://example.com/a/b:0'
    const { result, search } = setup(`/assets/trep/overview?cat=ip&mine=notes&focus=${encodeURIComponent(id)}`)
    expect(result.current.focus).toBe(id)
    act(() => result.current.showEverything())
    await waitFor(() => expect(result.current).toMatchObject({ scope: 'all', cats: [], mine: null, focus: id }))
    act(() => result.current.clearFocus())
    await waitFor(() => expect(search().get('focus')).toBeNull())
    act(() => result.current.focusOn(id))
    await waitFor(() => expect(result.current.focus).toBe(id))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/use-journey-filters.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-journey-filters"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/journey/use-journey-filters.ts
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
        const next = cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/use-journey-filters.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (5 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 5: Journey chips, event dates, sheet section frame and the composer stand-in

**Files:**
- Create: `apps/web/src/features/journey/chips.tsx`
- Create: `apps/web/src/features/journey/format.ts`
- Create: `apps/web/src/features/journey/sheet/sheet-section.tsx`
- Create: `apps/web/src/features/journey/note-draft-dialog.tsx`
- Test: `apps/web/src/features/journey/chips.test.tsx`

**Interfaces:**
- Consumes: `CATEGORY_META`, `NOTE_TAGS` (constants); `formatDay`, `relativeFuture` (`lib/dates.ts`); `formatMonth` (`lib/format.ts`); shadcn `Dialog`, `Button` — existing.
- Produces:
  - `chips.tsx`: `BranchChip({ branch: { label; color }; small?; current?; className? })`, `CountdownChip({ date })`, `NoteTagChip({ tag })`, `Targets({ e; label? = true; small?; limit? })` (null without indications/product), `DetailsGrid({ details; className? })` (null when empty).
  - `format.ts`: `eventDate(e: { date; is_milestone }, { short?, day? }?)` → "May 21, 2002" / "Expected Mar 2027" / "Exp. Mar 2027" / "Expected Mar 31, 2027".
  - `sheet/sheet-section.tsx`: `SheetSection({ title; extra?; children })` — `<section aria-label={title}>` with the 11px uppercase label.
  - `note-draft-dialog.tsx`: `interface NoteDraft { date: string; branch: string; prev?: string | null; next?: string | null }`; `NoteDraftDialog({ draft: NoteDraft | null; branches: Branch[]; onClose })` — dialog "Add to the timeline" with the Where strip (`data-testid="note-where"`: date, branch dot + label, "after “…” · before “…”"). Phase 5 replaces it with `NoteComposer` (same props).

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/chips.test.tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BranchChip, CountdownChip, DetailsGrid, NoteTagChip, Targets } from './chips'
import { eventDate } from './format'
import { NoteDraftDialog } from './note-draft-dialog'
import type { Branch, JourneyEventV3 } from './types'

const EVENT: JourneyEventV3 = {
  id: 'e1', asset: 'trep', date: '2021-06-01', type: 'trial_start', category: 'clinical', title: 'Phase 3 trial started: TETON-1',
  significance: 'High', is_milestone: false, sources: [], via: 'journey', indications: ['IPF', 'PPF', 'ILD'], product: 'Tyvaso', region: 'US',
}
const CTEPH: Branch = { id: 'CTEPH', label: 'CTEPH', full: 'Chronic thromboembolic PH', color: '#0e7490', off: -1, status: 'Approved · EU', origin: 'ai' }

describe('journey chips', () => {
  it('labels branches, tags and countdowns in text, not colour alone', () => {
    render(
      <>
        <BranchChip branch={CTEPH} current />
        <NoteTagChip tag="Missed by AI" />
        <CountdownChip date="2099-01-01" />
      </>,
    )
    expect(screen.getByText('CTEPH')).toHaveStyle({ color: '#0e7490' })
    expect(screen.getByText('Missed by AI')).toBeInTheDocument()
    expect(screen.getByText(/^in \d+\.\d years$/)).toBeInTheDocument()
  })

  it('formats card dates, milestones as expected months', () => {
    expect(eventDate({ date: '2002-05-21', is_milestone: false })).toBe('May 21, 2002')
    expect(eventDate({ date: '2027-03-31', is_milestone: true })).toBe('Expected Mar 2027')
    expect(eventDate({ date: '2027-03-31', is_milestone: true }, { short: true })).toBe('Exp. Mar 2027')
    expect(eventDate({ date: '2027-03-31', is_milestone: true }, { day: true })).toBe('Expected Mar 31, 2027')
  })

  it('shows targets, limited when asked, and nothing without any', () => {
    const { rerender, container } = render(<Targets e={EVENT} />)
    expect(screen.getByText('Targets')).toBeInTheDocument()
    expect(screen.getAllByText(/^(IPF|PPF|ILD)$/)).toHaveLength(3)
    expect(screen.getByText('Tyvaso')).toBeInTheDocument()
    expect(screen.getByText('US')).toBeInTheDocument()
    rerender(<Targets e={EVENT} label={false} small limit={2} />)
    expect(screen.queryByText('ILD')).not.toBeInTheDocument()
    expect(screen.queryByText('Targets')).not.toBeInTheDocument()
    rerender(<Targets e={{ ...EVENT, indications: [], product: null }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lays out key facts with identifiers in mono and skips empty values', () => {
    render(<DetailsGrid details={{ Trial: 'NCT04708782', Phase: 'Phase 3', Empty: '' }} />)
    expect(screen.getByText('NCT04708782')).toHaveClass('font-mono')
    expect(screen.getByText('Phase 3')).not.toHaveClass('font-mono')
    expect(screen.queryByText('Empty')).not.toBeInTheDocument()
  })
})

describe('NoteDraftDialog (Phase 4 stand-in for the composer)', () => {
  it('shows where the note goes: date, branch and its neighbours, and closes', async () => {
    const onClose = vi.fn()
    render(<NoteDraftDialog draft={{ date: '2013-02-11', branch: 'CTEPH', prev: 'FREEDOM-EV started', next: 'FDA approves Orenitram' }} branches={[CTEPH]} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Add to the timeline' })
    const where = within(dialog).getByTestId('note-where')
    expect(where).toHaveTextContent('Feb 11, 2013')
    expect(where).toHaveTextContent('CTEPH')
    expect(where).toHaveTextContent('after “FREEDOM-EV started” · before “FDA approves Orenitram”')
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]!)
    expect(onClose).toHaveBeenCalled()
  })

  it('has no branch label on a single-trunk journey and nothing open without a draft', () => {
    const { rerender } = render(<NoteDraftDialog draft={{ date: '2020-01-05', branch: 'journey' }} branches={[]} onClose={() => {}} />)
    expect(screen.getByTestId('note-where').textContent).toBe('Jan 5, 2020')
    rerender(<NoteDraftDialog draft={null} branches={[]} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/chips.test.tsx`
Expected: FAIL — `Failed to resolve import "./chips"`.

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/journey/chips.tsx
import { Clock, Pill } from 'lucide-react'
import { relativeFuture } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { CATEGORY_META, NOTE_TAGS } from './constants'
import type { Branch, JourneyEventV3, NoteTag } from './types'

/** Branch chip (README §6.2 `ln-chip`): label in the branch colour, tinted fill and border, never colour alone. */
export function BranchChip({ branch, small, current, className }: { branch: Pick<Branch, 'label' | 'color'>; small?: boolean; current?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-[5px] rounded-full border px-2 font-semibold whitespace-nowrap',
        small ? 'h-5 text-[11px]' : 'h-[22px] text-[11.5px]',
        current && 'shadow-[0_0_0_2px_currentColor]',
        className,
      )}
      style={{ color: branch.color, background: `${branch.color}14`, borderColor: `${branch.color}40` }}
    >
      <i aria-hidden="true" className="size-1.5 rounded-full" style={{ background: branch.color }} />
      {branch.label}
    </span>
  )
}

/** "in 9 months" next to an expected milestone. */
export function CountdownChip({ date }: { date: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-[7px] py-px text-[11.5px] font-semibold whitespace-nowrap text-primary">
      <Clock className="size-[11px]" aria-hidden="true" />
      {relativeFuture(date)}
    </span>
  )
}

/** Team note tag in its tag colour. */
export function NoteTagChip({ tag }: { tag: NoteTag }) {
  const c = NOTE_TAGS[tag]?.color ?? '#6941c6'
  return (
    <span
      className="inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-semibold whitespace-nowrap"
      style={{ color: c, background: `color-mix(in srgb, ${c} 10%, #fff)`, borderColor: `color-mix(in srgb, ${c} 30%, #fff)` }}
    >
      {tag}
    </span>
  )
}

/** Indication pills (category soft colour), product pill and region tag; nothing when the event has none. */
export function Targets({ e, label = true, small, limit }: { e: JourneyEventV3; label?: boolean; small?: boolean; limit?: number }) {
  const meta = CATEGORY_META[e.category] ?? CATEGORY_META.regulatory
  const inds = (e.indications ?? []).slice(0, limit)
  if (!inds.length && !e.product) return null
  const pill = cn('inline-flex items-center gap-[5px] rounded-full whitespace-nowrap', small ? 'h-5 px-[7px] text-[11px]' : 'h-6 px-[9px] text-[12px]')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {label && <span className="mr-0.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Targets</span>}
      {inds.map((i) => (
        <span key={i} className={cn(pill, 'font-semibold')} style={{ background: meta.soft, color: meta.color }}>
          {i}
        </span>
      ))}
      {e.product && (
        <span className={cn(pill, 'border bg-card font-medium text-secondary-foreground')}>
          {!small && <Pill className="size-[11px]" aria-hidden="true" />}
          {e.product}
        </span>
      )}
      {label && e.region && <span className="rounded-[5px] bg-muted px-1.5 py-px font-mono text-[11px] text-secondary-foreground">{e.region}</span>}
    </div>
  )
}

/** Identifiers read better in mono (README §6.2 details grid). */
const MONO = /^(NCT|NDA|ANDA|BLA|US ?\d|US |PMID|EMEA|EP\d|WO\d)/

/** Key facts grid (auto-fill 140px cells, 1px hairlines). */
export function DetailsGrid({ details, className }: { details: Record<string, string> | null | undefined; className?: string }) {
  const rows = Object.entries(details ?? {}).filter(([, v]) => v !== null && v !== undefined && String(v) !== '')
  if (!rows.length) return null
  return (
    <dl className={cn('grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-px overflow-hidden rounded-[10px] border border-hair bg-hair', className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0 bg-card px-2.5 py-[7px]">
          <dt className="text-[11px] text-muted-foreground">{k}</dt>
          <dd className={cn('mt-0.5 text-[12.5px] font-medium [overflow-wrap:anywhere]', MONO.test(String(v)) && 'font-mono')}>{String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}
```

```ts
// file: apps/web/src/features/journey/format.ts
import { formatDay } from '@/lib/dates'
import { formatMonth } from '@/lib/format'
import type { JourneyEventV3 } from './types'

/** Card / sheet date: "May 21, 2002"; milestones read "Expected Mar 2027" (`short`: "Exp. Mar 2027"). */
export function eventDate(e: Pick<JourneyEventV3, 'date' | 'is_milestone'>, { short = false, day = false } = {}): string {
  if (!e.is_milestone) return formatDay(e.date)
  return `${short ? 'Exp.' : 'Expected'} ${day ? formatDay(e.date) : formatMonth(e.date)}`
}
```

```tsx
// file: apps/web/src/features/journey/sheet/sheet-section.tsx
import type { ReactNode } from 'react'

/** A titled block of the event sheet: 11px uppercase label, 20px above. */
export function SheetSection({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-5">
      <h3 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {title}
        {extra}
      </h3>
      {children}
    </section>
  )
}
```

```tsx
// file: apps/web/src/features/journey/note-draft-dialog.tsx
import { CalendarDays, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDay } from '@/lib/dates'
import type { Branch } from './types'

/** Where a note goes: hover-to-add and "Add to timeline" fill it (README §6.5 "Where strip"). */
export interface NoteDraft {
  /** YYYY-MM-DD */
  date: string
  branch: string
  /** Titles of the events just before / after the position. */
  prev?: string | null
  next?: string | null
}

/**
 * Phase 4 stand-in for the note composer: shows where the note would go. Phase 5 replaces this component with
 * NoteComposer (same `draft` / `branches` / `onClose` props).
 */
export function NoteDraftDialog({ draft, branches, onClose }: { draft: NoteDraft | null; branches: Branch[]; onClose: () => void }) {
  const branch = draft ? branches.find((b) => b.id === draft.branch) : undefined
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 shadow-dialog sm:max-w-[560px]">
        <DialogHeader className="flex-row items-center gap-3 border-b border-hair px-4 py-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-soft text-violet">
            <Flag className="size-4" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="text-[15px] font-semibold">Add to the timeline</DialogTitle>
            <DialogDescription className="text-[12.5px] text-text-secondary">Team notes arrive in the next update. Yours will be placed here:</DialogDescription>
          </div>
        </DialogHeader>
        {draft && (
          <div data-testid="note-where" className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 bg-background px-4 py-2.5 text-[12.5px] text-text-secondary">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            <b className="text-[13.5px] font-semibold text-foreground">{formatDay(draft.date)}</b>
            {branch?.label && (
              <span className="inline-flex items-center gap-[5px] font-semibold" style={{ color: branch.color }}>
                <i aria-hidden="true" className="size-[7px] rounded-full" style={{ background: branch.color }} />
                {branch.label}
              </span>
            )}
            {(draft.prev || draft.next) && (
              <span className="basis-full text-[12px] text-muted-foreground">
                {draft.prev && <>after “{draft.prev}”</>}
                {draft.prev && draft.next && ' · '}
                {draft.next && <>before “{draft.next}”</>}
              </span>
            )}
          </div>
        )}
        <DialogFooter className="m-0 border-hair bg-card px-4 py-3">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/chips.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (6 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 6: Competitor rows and live-build "Just added" rows open the event sheet

**Files:**
- Modify: `apps/web/src/features/assets/components/competitors/competitive-signals.tsx` (Replace)
- Modify: `apps/web/src/features/assets/components/competitors/competitor-milestones.tsx`
- Modify: `apps/web/src/features/assets/components/competitors/utils.ts` (drop the now-unused `sourceTarget`)
- Modify: `apps/web/src/features/assets/pages/competitors-tab.test.tsx`
- Modify: `apps/web/src/features/journey/live-build/just-added.tsx` (Phase 3)
- Test: `apps/web/src/features/journey/live-build/just-added.test.tsx`

**Interfaces:**
- Consumes: `useEventSheet().openEvent(assetId, eventId)` (Phase 2 store) — existing. Competitor signal/milestone `id` is the journey event `_id` and `assetId` the competitor asset (`competitors.service.ts`).
- Produces: `CompetitiveSignals`, `CompetitorMilestones` and Phase 3's `JustAdded` keep their props; each row opens the event sheet (rows without source records are no longer disabled). `sourceTarget` is removed from `competitors/utils.ts`.

- [ ] **Step 1: Write the failing tests**

```tsx
// file: apps/web/src/features/journey/live-build/just-added.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { JourneyEventV3 } from '../types'
import { JustAdded } from './just-added'

const ID = 'ai:trep:https://example.com/a/b:0'
const EVENT: JourneyEventV3 = { id: ID, asset: 'trep', date: '2026-10-09', type: 'approval', category: 'regulatory', title: 'FDA approves Tyvaso for IPF', significance: 'High', is_milestone: false, sources: [], via: 'ai_events' }

describe('JustAdded', () => {
  beforeEach(() => useEventSheet.setState({ current: null }))
  it('opens a just-added event in the event sheet', async () => {
    render(<JustAdded latest={[EVENT]} total={1} ended={false} />)
    await userEvent.click(screen.getByRole('button', { name: /FDA approves Tyvaso for IPF/ }))
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: ID })
  })
})
```

In `apps/web/src/features/assets/pages/competitors-tab.test.tsx`:

Before:
```tsx
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import type { AssetDetail } from '../api'
import type { CompetitorMilestone, CompetitorsOverview, LandscapeRow } from '../competitors-api'
```
After:
```tsx
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { AssetDetail } from '../api'
import type { CompetitorMilestone, CompetitorsOverview, LandscapeRow } from '../competitors-api'
```

Before:
```tsx
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
```
After:
```tsx
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  useEventSheet.setState({ current: null })
})
afterEach(() => vi.unstubAllGlobals())
```

Before:
```tsx
  })

  it('opens a signal’s source record under the competitor asset', async () => {
    fetchMock.mockImplementation(async (url) =>
      url.includes('/record/') ? json(200, { key: 'BLA761363', title: 'Winrevair BLA' }) : json(200, OVERVIEW),
    )
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /FDA approves Winrevair/ }))
    await screen.findByText('Winrevair BLA')
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/sotatercept/record/regulatory?key=BLA761363', expect.anything())
  })
```
After:
```tsx
  })

  it('opens a signal in the event sheet under the competitor asset', async () => {
    fetchMock.mockResolvedValue(json(200, OVERVIEW))
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /FDA approves Winrevair/ }))
    expect(useEventSheet.getState().current).toEqual({ assetId: 'sotatercept', eventId: 's1' })
  })

  it('opens a milestone row in the event sheet, by click or Enter', async () => {
    fetchMock.mockResolvedValue(json(200, OVERVIEW))
    renderTab()
    const row = (await screen.findByText('ZENITH top-line results')).closest('tr')!
    await userEvent.click(row)
    expect(useEventSheet.getState().current).toEqual({ assetId: 'sotatercept', eventId: 'm2' })
    useEventSheet.setState({ current: null })
    row.focus()
    await userEvent.keyboard('{Enter}')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'sotatercept', eventId: 'm2' })
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/just-added.test.tsx src/features/assets/pages/competitors-tab.test.tsx`
Expected: FAIL — just-added.test.tsx: `Unable to find role="button" and name /FDA approves Tyvaso for IPF/` (the rows are not clickable); competitors-tab.test.tsx: the same for the signal and milestone row tests.

- [ ] **Step 3: Implement**

**Replace** the file:

```tsx
// file: apps/web/src/features/assets/components/competitors/competitive-signals.tsx
import { formatDate } from '@/lib/format'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { CompetitorSignal } from '../../competitors-api'
import { CategoryIcon, SignificanceBadge } from '../badges'
import { EmptyState, Panel } from '../panel'
import { humanize } from './utils'

/** Competitors' latest high and medium significance events; each opens the event sheet under the competitor asset. */
export function CompetitiveSignals({ signals }: { signals: CompetitorSignal[] }) {
  const openEvent = useEventSheet((s) => s.openEvent)

  return (
    <Panel title="Competitive signals" description="Latest high and medium significance moves from tracked competitors">
      {signals.length === 0 ? (
        <EmptyState title="No competitor signals yet">Signals appear as competitors' journeys are built.</EmptyState>
      ) : (
        <ol className="divide-y divide-[#eef0f3]">
          {signals.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => openEvent(s.assetId, s.id)}
                className="grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 px-5 py-3 text-left hover:bg-accent/60"
              >
                <CategoryIcon category={s.category} className="size-9 rounded-[10px]" />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium">{s.title}</p>
                  <p className="mt-0.5 text-[12.5px] text-text-secondary">
                    {humanize(s.type)} · {s.assetName}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="font-mono text-[12px] whitespace-nowrap text-text-secondary">{formatDate(s.date)}</span>
                  <SignificanceBadge value={s.significance} />
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
```

In `apps/web/src/features/assets/components/competitors/competitor-milestones.tsx`:

Before:
```tsx
import { formatMonth, formatPhase } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CompetitorMilestone } from '../../competitors-api'
import { SignificanceBadge } from '../badges'
import { EmptyState, Panel } from '../panel'
import { Pager } from '../pager'
import { RecordSheet } from '../record-sheet'
import { AssetAvatar } from './asset-avatar'
import { humanize, MILESTONE_GROUPS, milestoneGroup, sourceTarget, type MilestoneGroup } from './utils'

const PAGE_SIZE = 10
```
After:
```tsx
import { formatMonth, formatPhase } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { CompetitorMilestone } from '../../competitors-api'
import { SignificanceBadge } from '../badges'
import { EmptyState, Panel } from '../panel'
import { Pager } from '../pager'
import { AssetAvatar } from './asset-avatar'
import { humanize, MILESTONE_GROUPS, milestoneGroup, type MilestoneGroup } from './utils'

const PAGE_SIZE = 10
```

Before:
```tsx
}

/** Competitors' forward-looking milestones, filterable by kind, each opening its source record. */
export function CompetitorMilestones({ milestones }: { milestones: CompetitorMilestone[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<ReturnType<typeof sourceTarget>>(null)

  const counts = new Map<MilestoneGroup, number>()
```
After:
```tsx
}

/** Competitors' forward-looking milestones, filterable by kind, each opening the event sheet. */
export function CompetitorMilestones({ milestones }: { milestones: CompetitorMilestone[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const openEvent = useEventSheet((s) => s.openEvent)

  const counts = new Map<MilestoneGroup, number>()
```

Before:
```tsx
              {pageItems.map((m) => {
                const group = milestoneGroup(m)
                const target = sourceTarget(m.assetId, m.sources)
                return (
                  <TableRow
                    key={m.id}
                    tabIndex={target ? 0 : undefined}
                    onClick={() => target && setOpen(target)}
                    onKeyDown={(e) => e.key === 'Enter' && target && setOpen(target)}
                    className={cn('border-[#eef0f3]', target && 'cursor-pointer')}
                  >
                    <TableCell className="py-2.5 pl-5 font-mono text-[12.5px] text-secondary-foreground">{formatMonth(m.date)}</TableCell>
```
After:
```tsx
              {pageItems.map((m) => {
                const group = milestoneGroup(m)
                return (
                  <TableRow
                    key={m.id}
                    tabIndex={0}
                    onClick={() => openEvent(m.assetId, m.id)}
                    onKeyDown={(e) => e.key === 'Enter' && openEvent(m.assetId, m.id)}
                    className="cursor-pointer border-[#eef0f3]"
                  >
                    <TableCell className="py-2.5 pl-5 font-mono text-[12.5px] text-secondary-foreground">{formatMonth(m.date)}</TableCell>
```

Before:
```tsx
        </>
      )}
      {open && <RecordSheet assetId={open.assetId} tab={open.tab} recordKey={open.key} onClose={() => setOpen(null)} />}
    </Panel>
  )
```
After:
```tsx
        </>
      )}
    </Panel>
  )
```

In `apps/web/src/features/assets/components/competitors/utils.ts`:

Before:
```ts
import type { RecordTab } from '../../api'
import type { CompetitorMilestone, EventSource } from '../../competitors-api'
import { TAB_FOR_COLLECTION } from '../journey-timeline'

/** "Pulmonary arterial hypertension (PAH)" → "PAH"; names without an abbreviation stay as they are. */
```
After:
```ts
import type { CompetitorMilestone } from '../../competitors-api'

/** "Pulmonary arterial hypertension (PAH)" → "PAH"; names without an abbreviation stay as they are. */
```

Before:
```ts
}

/** Where an event's first source record opens: the record lives under the event's own asset. */
export function sourceTarget(assetId: string, sources: EventSource[]): { assetId: string; tab: RecordTab; key: string } | null {
  const source = sources[0]
  const tab = source && TAB_FOR_COLLECTION[source.collection]
  return source && tab ? { assetId, tab, key: source.record_key } : null
}

export type MilestoneGroup = 'readout' | 'regulatory' | 'patent' | 'other'
```
After:
```ts
}

export type MilestoneGroup = 'readout' | 'regulatory' | 'patent' | 'other'
```

In `apps/web/src/features/journey/live-build/just-added.tsx`:

Before:
```tsx
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { JourneyEventV3 } from '../types'
import { viaLabel } from './build-model'
```
After:
```tsx
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { JourneyEventV3 } from '../types'
import { viaLabel } from './build-model'
```

Before:
```tsx
/**
 * "Just added" under the forming timeline: the five newest events the crawl announced (the crawler announces new
 * High-significance events), newest first.
 */
export function JustAdded({ latest, total, ended }: { latest: JourneyEventV3[]; total: number; ended: boolean }) {
  return (
    <div className="border-t border-hair px-4 pt-3 pb-3.5">
```
After:
```tsx
/**
 * "Just added" under the forming timeline: the five newest events the crawl announced (the crawler announces new
 * High-significance events), newest first; each opens the event sheet.
 */
export function JustAdded({ latest, total, ended }: { latest: JourneyEventV3[]; total: number; ended: boolean }) {
  const openEvent = useEventSheet((s) => s.openEvent)
  return (
    <div className="border-t border-hair px-4 pt-3 pb-3.5">
```

Before:
```tsx
        <ul aria-label="Just added">
          {latest.slice(0, 5).map((e) => (
            <li key={e.id} className="flex animate-row-in items-center gap-2.5 overflow-hidden border-b border-hair py-[7px] last:border-b-0">
              <CategoryIcon category={e.category} className="size-[26px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{e.title}</div>
                <div className="mt-px flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="font-mono">{formatDay(e.date)}</span>
                  <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', e.via === 'ai_events' && 'text-violet')}>
                    {e.via === 'ai_events' && <Sparkles aria-hidden="true" className="size-[11px]" />}
                    {viaLabel(e)}
                  </span>
                </div>
              </div>
              <SignificanceBadge value={e.significance} />
            </li>
          ))}
```
After:
```tsx
        <ul aria-label="Just added">
          {latest.slice(0, 5).map((e) => (
            <li key={e.id} className="animate-row-in overflow-hidden border-b border-hair last:border-b-0">
              <button type="button" onClick={() => openEvent(e.asset, e.id)} className="flex w-full items-center gap-2.5 py-[7px] text-left hover:bg-background">
                <CategoryIcon category={e.category} className="size-[26px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{e.title}</div>
                  <div className="mt-px flex items-center gap-2 text-[12px] text-muted-foreground">
                    <span className="font-mono">{formatDay(e.date)}</span>
                    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', e.via === 'ai_events' && 'text-violet')}>
                      {e.via === 'ai_events' && <Sparkles aria-hidden="true" className="size-[11px]" />}
                      {viaLabel(e)}
                    </span>
                  </div>
                </div>
                <SignificanceBadge value={e.significance} />
              </button>
            </li>
          ))}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/just-added.test.tsx src/features/assets/pages/competitors-tab.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (9 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 7: Chat timeline card opens the event sheet

**Files:**
- Modify: `apps/web/src/features/chat/components/cards/timeline-card.tsx` (Replace)
- Modify: `apps/web/src/features/chat/components/cards/chat-card.tsx`
- Modify: `apps/web/src/features/chat/components/assistant-message.tsx`
- Modify: `apps/web/src/features/chat/components/streaming-turn.tsx`
- Modify: `apps/web/src/features/chat/components/chat-thread.tsx`
- Test: `apps/web/src/features/chat/components/cards/timeline-card.test.tsx`

**Interfaces:**
- Consumes: `useEventSheet().openEvent` — existing.
- Produces: `TimelineCard({ card })` (the `onOpenRecord` prop is gone; every event opens the sheet — README §5.6 "citations open the Event detail sheet when the citation is a journey event"). `ChatCard` and `StreamingTurn` drop their now-unused `onOpenRecord` props; `AssistantMessage` keeps its own (record citations still open `RecordSheet`).

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/chat/components/cards/timeline-card.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventSheet } from '@/stores/event-sheet-store'
import { TimelineCard } from './timeline-card'

const ID = 'ai:trep:https://example.com/a/b:0'

describe('TimelineCard', () => {
  beforeEach(() => useEventSheet.setState({ current: null }))

  it('opens each journey event in the event sheet, including events without a source record', async () => {
    render(
      <TimelineCard
        card={{
          type: 'timeline',
          title: 'Treprostinil · key events',
          assetId: 'trep',
          events: [
            { id: ID, assetId: 'trep', assetName: 'Treprostinil', date: '2021-03-31', title: 'Tyvaso approved for PH-ILD', category: 'regulatory', significance: 'High', is_milestone: false, sources: [] },
          ],
        }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Tyvaso approved for PH-ILD/ }))
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: ID })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/chat/components/cards/timeline-card.test.tsx`
Expected: FAIL — `expected null to deeply equal { assetId: 'trep', eventId: 'ai:trep:https://example.com/a/b:0' }` (the event without sources is a disabled button).

- [ ] **Step 3: Implement**

**Replace** the file:

```tsx
// file: apps/web/src/features/chat/components/cards/timeline-card.tsx
import { SignificanceBadge, CATEGORY_META } from '@/features/assets/components/badges'
import { formatDate } from '@/lib/format'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { Card } from '../../api'

type TimelineCardData = Extract<Card, { type: 'timeline' }>

/** Compact dated list of journey events; each opens the event detail sheet. */
export function TimelineCard({ card }: { card: TimelineCardData }) {
  const openEvent = useEventSheet((s) => s.openEvent)
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <p className="border-b border-[#eef0f3] bg-[#f9fafb] px-3 py-2 text-[12.5px] font-semibold">{card.title}</p>
      <ul className="divide-y divide-[#eef0f3]">
        {card.events.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => openEvent(e.assetId, e.id)}
              className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-accent/60"
            >
              <span className="w-[76px] shrink-0 font-mono text-xs leading-5 text-muted-foreground">{formatDate(e.date)}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 font-medium text-foreground">{e.title}</span>
                <span className="block text-[11.5px] text-muted-foreground">
                  {[CATEGORY_META[e.category]?.label ?? e.category, e.assetName, e.is_milestone && 'Upcoming'].filter(Boolean).join(' · ')}
                </span>
              </span>
              <SignificanceBadge value={e.significance} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

In `apps/web/src/features/chat/components/cards/chat-card.tsx`:

Before:
```tsx
import type { Card, OpenRecord } from '../../api'
import { ComparisonCard } from './comparison-card'
import { IdentityCard } from './identity-card'
```
After:
```tsx
import type { Card } from '../../api'
import { ComparisonCard } from './comparison-card'
import { IdentityCard } from './identity-card'
```

Before:
```tsx
  sessionId,
  startedAssets,
  onOpenRecord,
}: {
  card: Card
```
After:
```tsx
  sessionId,
  startedAssets,
}: {
  card: Card
```

Before:
```tsx
  /** Assets with a job card in this chat (their identity card is done). */
  startedAssets: ReadonlySet<string>
  onOpenRecord: (r: OpenRecord) => void
}) {
  switch (card.type) {
```
After:
```tsx
  /** Assets with a job card in this chat (their identity card is done). */
  startedAssets: ReadonlySet<string>
}) {
  switch (card.type) {
```

Before:
```tsx
      return <ComparisonCard card={card} />
    case 'timeline':
      return <TimelineCard card={card} onOpenRecord={onOpenRecord} />
    default:
      return null
```
After:
```tsx
      return <ComparisonCard card={card} />
    case 'timeline':
      return <TimelineCard card={card} />
    default:
      return null
```

In `apps/web/src/features/chat/components/assistant-message.tsx`:

Before:
```tsx
        {message.content && <ChatMarkdown content={message.content} citations={message.citations} onCite={openCitation} />}
        {message.cards.map((card, i) => (
          <ChatCard key={i} card={card} sessionId={sessionId} startedAssets={startedAssets} onOpenRecord={onOpenRecord} />
        ))}
        {message.citations.length > 0 && <SourcesList citations={message.citations} onOpen={openCitation} />}
```
After:
```tsx
        {message.content && <ChatMarkdown content={message.content} citations={message.citations} onCite={openCitation} />}
        {message.cards.map((card, i) => (
          <ChatCard key={i} card={card} sessionId={sessionId} startedAssets={startedAssets} />
        ))}
        {message.citations.length > 0 && <SourcesList citations={message.citations} onOpen={openCitation} />}
```

In `apps/web/src/features/chat/components/streaming-turn.tsx`:

Before:
```tsx
import { Loader2 } from 'lucide-react'
import type { OpenRecord } from '../api'
import type { Turn } from '../turn-store'
import { AssistantMark } from './assistant-mark'
```
After:
```tsx
import { Loader2 } from 'lucide-react'
import type { Turn } from '../turn-store'
import { AssistantMark } from './assistant-mark'
```

Before:
```tsx
  sessionId,
  startedAssets,
  onOpenRecord,
  onRetry,
}: {
```
After:
```tsx
  sessionId,
  startedAssets,
  onRetry,
}: {
```

Before:
```tsx
  sessionId: string
  startedAssets: ReadonlySet<string>
  onOpenRecord: (r: OpenRecord) => void
  onRetry: () => void
}) {
```
After:
```tsx
  sessionId: string
  startedAssets: ReadonlySet<string>
  onRetry: () => void
}) {
```

Before:
```tsx
          {turn.text && <ChatMarkdown content={turn.text} citations={NO_CITATIONS} onCite={noop} streaming={streaming} />}
          {turn.cards.map((card, i) => (
            <ChatCard key={i} card={card} sessionId={sessionId} startedAssets={startedAssets} onOpenRecord={onOpenRecord} />
          ))}
          {turn.status !== 'streaming' && <TurnStatus status={turn.status} error={turn.error} onRetry={onRetry} />}
```
After:
```tsx
          {turn.text && <ChatMarkdown content={turn.text} citations={NO_CITATIONS} onCite={noop} streaming={streaming} />}
          {turn.cards.map((card, i) => (
            <ChatCard key={i} card={card} sessionId={sessionId} startedAssets={startedAssets} />
          ))}
          {turn.status !== 'streaming' && <TurnStatus status={turn.status} error={turn.error} onRetry={onRetry} />}
```

In `apps/web/src/features/chat/components/chat-thread.tsx`:

Before:
```tsx
          sessionId={sessionId}
          startedAssets={startedAssets}
          onOpenRecord={setRecord}
          onRetry={() => onRetry(turn.userText)}
        />
```
After:
```tsx
          sessionId={sessionId}
          startedAssets={startedAssets}
          onRetry={() => onRetry(turn.userText)}
        />
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/chat/components/cards/timeline-card.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (1 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 8: Pinned analytics on the Overview (pulled forward from Phase 6)

**Files:**
- Create: `apps/web/src/features/analytics/api.ts`
- Create: `apps/web/src/features/analytics/templates.tsx`
- Create: `apps/web/src/features/analytics/overview-analytics.tsx`
- Test: `apps/web/src/features/analytics/overview-analytics.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`; `AnalyticsPin`, `EventCategory`, `Significance` (`features/journey/types.ts`); `CATEGORY_META`, `PHASE_COLORS`, `SIGNIFICANCE_COLORS`, `STAGES` (constants); Phase 0 charts `ChartCard`, `ChartGrid`, `StackBars`, `VBars`, `HBars`, `Donut`; `useEventSheet().openEvent`; `Button`, `Skeleton`, `toast` — existing. Routes: `GET /api/assets/:id/analytics` (blocks `pipeline`, `activityByYear`, `trials`, `significance`, `stats.nextCatalyst` are read here), `GET /api/assets/:id/analytics/pins` → `{ items: AnalyticsPin[] | null }` (`null` = never saved), `PUT /api/assets/:id/analytics/pins` `{ items }` (≤ 24; key ≤ 40 chars).
- Produces:
  - `features/analytics/api.ts`: `PipelineRow`, `TrialRow`, `AnalyticsBlocks` (the blocks above; the rest are Phase 6's); `useAssetAnalytics(assetId)` (key `['asset', id, 'analytics']`); `useAnalyticsPins(assetId)` (key `['asset', id, 'analytics', 'pins']`); `useSavePins(assetId)` → mutation `AnalyticsPin[]` (optimistic; rollback + `toast.error("The pinned analytics couldn't be saved.")`).
  - `features/analytics/templates.tsx`: `interface OverviewTemplate { title; description?; span: 1 | 2; available(b); render(b, { openEvent }) }`; `TEMPLATES` with `pipeline` ("Development pipeline" / "Furthest stage per indication", span 2; bar to `(stage + .55)/5`, ended = hatched grey "· terminated"), `activity` ("Journey activity by year" / "Events per year by category", span 2), `milestones` ("Next milestones" / "Expected readouts, decisions and expiries"; rows open the event sheet), `trialsPhase` ("Trials by phase"), `enrol` ("Enrolment by indication"), `sig` ("Significance mix"); `defaultPins(b)` (trials → `pipeline, milestones, activity, trialsPhase, enrol`; else `activity, milestones, sig`); `nextMilestones(b)`. Phase 6 adds the rest of the library (`OV_TEMPLATES`), custom specs and the Analytics tab.
  - `features/analytics/overview-analytics.tsx`: `OverviewAnalytics({ asset: { id, name } })` — `<section aria-label="Pinned analytics">`: "Analytics" + "Pinned for {name}. Add your own from indexed data, or ask Asset AI to build one." + **Reset** (disabled while the defaults show); 4-column `ChartGrid` of the pinned cards (`ChartCard` with a "Remove {title}" × button; unavailable/unknown/custom pins hidden, kept in the saved list); the dashed **Add analytics** tile last, `aria-disabled`, reading "Coming in the next update" (the dialog is Phase 6); loading skeletons; on error "Analytics aren't available for this asset yet." (cards degrade, never erroring).

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/analytics/overview-analytics.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { AnalyticsBlocks } from './api'
import { OverviewAnalytics } from './overview-analytics'
import { defaultPins, nextMilestones } from './templates'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const NEXT = { id: 'rule:expected_readout:ctgov:NCT05943535', title: 'TETON-PPF readout', date: '2027-11-01' }
const BLOCKS: AnalyticsBlocks = {
  pipeline: [
    { id: 'PAH', label: 'PAH', full: 'Pulmonary arterial hypertension', color: '#2347d9', ended: null, stage: 4, n: 70, next: null, since: '1998-10-01' },
    { id: 'PPF', label: 'PPF', full: 'Progressive pulmonary fibrosis', color: '#0e7490', ended: null, stage: 2, n: 8, next: NEXT, since: '2023-10-30' },
    { id: 'PH-COPD', label: 'PH-COPD', full: 'PH-COPD', color: '#b54708', ended: 'Terminated', stage: 2, n: 3, next: null, since: '2018-05-08' },
  ],
  activityByYear: { cols: [2020, 2021], series: [{ k: 'regulatory', l: 'Regulatory', vals: [2, 3] }, { k: 'clinical', l: 'Clinical', vals: [1, 4] }] },
  trials: [
    { nct: 'NCT1', name: 'TETON-1', title: 't', phase: 'Phase 3', status: 'COMPLETED', start: '2021-06-01', pcd: '2025-01-01', enrollment: 597, indication: 'IPF', company: true, active: false },
    { nct: 'NCT2', name: 'TETON-PPF', title: 't', phase: 'Phase 3', status: 'RECRUITING', start: '2023-10-30', pcd: '2027-11-01', enrollment: 700, indication: 'PPF', company: true, active: true },
  ],
  significance: { High: 10, Medium: 20, Low: 30 },
  stats: { nextCatalyst: { id: 'cat', title: 'IPF PDUFA date', date: '2027-04-30' } },
}

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
function setup(pins: unknown = { items: null }, blocks: AnalyticsBlocks = BLOCKS) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assets/trep/analytics') return json(200, blocks)
    if (url === '/api/assets/trep/analytics/pins') return init?.method === 'PUT' ? json(200, JSON.parse(String(init.body))) : json(200, pins)
    return json(404, { code: 'NOT_FOUND', message: url })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OverviewAnalytics asset={{ id: 'trep', name: 'Treprostinil' }} />
    </QueryClientProvider>,
  )
}

beforeEach(() => useEventSheet.setState({ current: null }))
afterEach(() => vi.unstubAllGlobals())

describe('pinned analytics templates', () => {
  it('pins pipeline, milestones, activity, phase and enrolment with trial data, else activity, milestones, significance', () => {
    expect(defaultPins(BLOCKS)).toEqual(['pipeline', 'milestones', 'activity', 'trialsPhase', 'enrol'])
    expect(defaultPins({ ...BLOCKS, trials: [] })).toEqual(['activity', 'milestones', 'sig'])
  })
  it('lists each branch’s next milestone and the next catalyst, soonest first', () => {
    expect(nextMilestones(BLOCKS).map((m) => m.title)).toEqual(['IPF PDUFA date', 'TETON-PPF readout'])
  })
})

describe('OverviewAnalytics', () => {
  it('shows the default pins for {asset} with the add tile as coming next', async () => {
    setup()
    const section = screen.getByRole('region', { name: 'Pinned analytics' })
    expect(section).toHaveTextContent('Pinned for Treprostinil. Add your own from indexed data, or ask Asset AI to build one.')
    expect(await within(section).findByRole('region', { name: 'Development pipeline' })).toHaveTextContent('· terminated')
    for (const t of ['Next milestones', 'Journey activity by year', 'Trials by phase', 'Enrolment by indication']) expect(within(section).getByRole('region', { name: t })).toBeInTheDocument()
    expect(within(section).getByText('Add analytics').closest('[aria-disabled]')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('removes a card (saved per user) and resets to the defaults', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Trials by phase' }))
    expect(screen.queryByRole('region', { name: 'Trials by phase' })).not.toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/analytics/pins', expect.objectContaining({ method: 'PUT', body: '{"items":[{"key":"pipeline"},{"key":"milestones"},{"key":"activity"},{"key":"enrol"}]}' })))
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(await screen.findByRole('region', { name: 'Trials by phase' })).toBeInTheDocument()
  })

  it('renders saved pins, hides cards without data, and opens a milestone in the event sheet', async () => {
    setup({ items: [{ key: 'milestones' }, { key: 'sig' }, { key: 'trialsPhase' }, { key: 'unknown' }] }, { ...BLOCKS, trials: [] })
    await userEvent.click(await screen.findByRole('button', { name: /TETON-PPF readout/ }))
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: NEXT.id })
    expect(screen.getByRole('region', { name: 'Significance mix' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Trials by phase' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/analytics/overview-analytics.test.tsx`
Expected: FAIL — `Failed to resolve import "./overview-analytics"` and `"./templates"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/analytics/api.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AnalyticsPin, EventCategory, Significance } from '@/features/journey/types'
import { apiFetch } from '@/lib/api'

/** One indication programme (Analytics "Development pipeline"); stage 0–4 = Phase 1 … Approved. */
export interface PipelineRow {
  id: string
  label: string
  full: string
  color: string | null
  ended: string | null
  stage: number
  n: number
  next: { id: string; title: string; date: string } | null
  since: string | null
}

export interface TrialRow {
  nct: string
  name: string
  title: string
  phase: string
  status: string
  start: string
  pcd: string
  enrollment: number | null
  indication: string
  company: boolean
  active: boolean
}

/** GET /assets/:id/analytics (DATA_CONTRACTS §B.4): the blocks the Overview pins read. Other blocks are Phase 6's. */
export interface AnalyticsBlocks {
  pipeline: PipelineRow[]
  activityByYear: { cols: number[]; series: { k: EventCategory; l: string; vals: number[] }[] }
  trials: TrialRow[]
  significance: Record<Significance, number>
  stats: { nextCatalyst: { id: string; title: string; date: string } | null } & Record<string, unknown>
}

const enc = encodeURIComponent
const pinsKey = (assetId: string) => ['asset', assetId, 'analytics', 'pins'] as const

export function useAssetAnalytics(assetId: string) {
  return useQuery({
    queryKey: ['asset', assetId, 'analytics'],
    queryFn: () => apiFetch<AnalyticsBlocks>(`/assets/${enc(assetId)}/analytics`),
    staleTime: 60_000,
  })
}

/** The user's pins for an asset; `items: null` until they change them (the Overview shows the defaults). */
export function useAnalyticsPins(assetId: string) {
  return useQuery({
    queryKey: pinsKey(assetId),
    queryFn: () => apiFetch<{ items: AnalyticsPin[] | null }>(`/assets/${enc(assetId)}/analytics/pins`),
    staleTime: 60_000,
  })
}

/** Save the pins (PUT, up to 24): applied at once, rolled back with a toast if the server refuses. */
export function useSavePins(assetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: AnalyticsPin[]) => apiFetch<{ items: AnalyticsPin[] }>(`/assets/${enc(assetId)}/analytics/pins`, { method: 'PUT', body: { items } }),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: pinsKey(assetId) })
      const prev = qc.getQueryData<{ items: AnalyticsPin[] | null }>(pinsKey(assetId))
      qc.setQueryData(pinsKey(assetId), { items })
      return { prev }
    },
    onError: (_err, _items, ctx) => {
      qc.setQueryData(pinsKey(assetId), ctx?.prev ?? { items: null })
      toast.error("The pinned analytics couldn't be saved.")
    },
  })
}
```

```tsx
// file: apps/web/src/features/analytics/templates.tsx
import type { ReactNode } from 'react'
import { Donut } from '@/components/charts/donut'
import { HBars } from '@/components/charts/h-bars'
import { StackBars } from '@/components/charts/stack-bars'
import { VBars } from '@/components/charts/v-bars'
import { CATEGORY_META, PHASE_COLORS, SIGNIFICANCE_COLORS, STAGES } from '@/features/journey/constants'
import { formatDay, relativeFuture } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { AnalyticsBlocks } from './api'

export interface OverviewTemplate {
  title: string
  description?: string
  span: 1 | 2
  /** Hidden (not erroring) when the asset lacks the data. */
  available: (b: AnalyticsBlocks) => boolean
  render: (b: AnalyticsBlocks, ctx: { openEvent: (id: string) => void }) => ReactNode
}

/** Default pins (README §7.3): with trial data → pipeline, next milestones, activity, trials by phase, enrolment. */
export const defaultPins = (b: AnalyticsBlocks): string[] =>
  b.trials.length ? ['pipeline', 'milestones', 'activity', 'trialsPhase', 'enrol'] : ['activity', 'milestones', 'sig']

/** Upcoming milestones from the blocks: each branch's next milestone and the next catalyst, soonest first. */
export function nextMilestones(b: AnalyticsBlocks) {
  const all = [...b.pipeline.flatMap((p) => (p.next ? [{ ...p.next, branch: p.label }] : [])), ...(b.stats.nextCatalyst ? [{ ...b.stats.nextCatalyst, branch: '' }] : [])]
  const seen = new Set<string>()
  return all.filter((m) => !seen.has(m.id) && !!seen.add(m.id)).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 5)
}

/** Overview templates from `design_files/pe/overview-analytics.jsx` (`OV_TEMPLATES`); Phase 6 adds the rest of the library. */
export const TEMPLATES: Record<string, OverviewTemplate> = {
  pipeline: {
    title: 'Development pipeline',
    description: 'Furthest stage per indication',
    span: 2,
    available: (b) => b.pipeline.length > 0,
    render: (b) => (
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 text-[10.5px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          <span />
          <span className="grid grid-cols-5">{STAGES.map((s) => <span key={s}>{s}</span>)}</span>
        </div>
        {b.pipeline.map((p) => (
          <div key={p.id} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <i aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: p.color ?? '#98a2b3' }} />
              <b className="truncate font-semibold">{p.label}</b>
            </span>
            <span className="relative h-3.5 rounded bg-muted">
              <span
                className={cn('absolute inset-y-0 left-0 rounded', p.ended && 'bg-[repeating-linear-gradient(45deg,#d0d5dd,#d0d5dd_4px,#eef0f3_4px,#eef0f3_8px)]')}
                style={{ width: `${(Math.min(4, Math.max(0, p.stage)) + 0.55) * 20}%`, ...(p.ended ? {} : { background: p.color ?? '#2347d9' }) }}
              />
              {p.ended && <span className="absolute top-1/2 right-1 -translate-y-1/2 text-[10.5px] text-muted-foreground">· terminated</span>}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  activity: {
    title: 'Journey activity by year',
    description: 'Events per year by category',
    span: 2,
    available: (b) => b.activityByYear.cols.length > 0,
    render: (b) => (
      <StackBars
        cols={b.activityByYear.cols}
        every={b.activityByYear.cols.length > 24 ? 4 : 2}
        series={b.activityByYear.series.map((s) => ({ ...s, c: CATEGORY_META[s.k]?.color ?? '#98a2b3' }))}
      />
    ),
  },
  milestones: {
    title: 'Next milestones',
    description: 'Expected readouts, decisions and expiries',
    span: 1,
    available: (b) => nextMilestones(b).length > 0,
    render: (b, { openEvent }) => (
      <ul className="flex flex-col">
        {nextMilestones(b).map((m) => (
          <li key={m.id} className="border-b border-hair last:border-b-0">
            <button type="button" onClick={() => openEvent(m.id)} className="flex w-full items-center gap-2.5 py-[7px] text-left hover:bg-background">
              <span className="flex w-10 shrink-0 flex-col items-center rounded-lg border py-0.5 leading-tight">
                <b className="text-[10.5px] text-primary uppercase">{formatDay(m.date).slice(0, 3)}</b>
                <span className="font-mono text-[11px]">{m.date.slice(0, 4)}</span>
              </span>
              <span className="flex min-w-0 flex-col text-[12.5px] font-medium">
                <span className="truncate">{m.title}</span>
                <em className="text-[11.5px] font-semibold text-primary not-italic">
                  {[m.branch, relativeFuture(m.date)].filter(Boolean).join(' · ')}
                </em>
              </span>
            </button>
          </li>
        ))}
      </ul>
    ),
  },
  trialsPhase: {
    title: 'Trials by phase',
    span: 1,
    available: (b) => b.trials.length > 0,
    render: (b) => <VBars h={110} data={['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'].map((l) => ({ l, v: b.trials.filter((t) => t.phase === l).length, c: PHASE_COLORS[l] }))} />,
  },
  enrol: {
    title: 'Enrolment by indication',
    span: 1,
    available: (b) => b.trials.some((t) => (t.enrollment ?? 0) > 0),
    render: (b) => {
      const by = new Map<string, number>()
      for (const t of b.trials) if (t.enrollment) by.set(t.indication || 'Other', (by.get(t.indication || 'Other') ?? 0) + t.enrollment)
      return <HBars data={[...by].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([l, v]) => ({ l, v }))} />
    },
  },
  sig: {
    title: 'Significance mix',
    span: 1,
    available: (b) => Object.values(b.significance).some((n) => n > 0),
    render: (b) => <Donut size={120} data={(['High', 'Medium', 'Low'] as const).map((s) => ({ l: s, v: b.significance[s] ?? 0, c: SIGNIFICANCE_COLORS[s] }))} />,
  },
}
```

```tsx
// file: apps/web/src/features/analytics/overview-analytics.tsx
import { Plus, RotateCcw, X } from 'lucide-react'
import { ChartCard, ChartGrid } from '@/components/charts/chart-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { AssetDetail } from '@/features/assets/api'
import type { AnalyticsPin } from '@/features/journey/types'
import { useEventSheet } from '@/stores/event-sheet-store'
import { useAnalyticsPins, useAssetAnalytics, useSavePins } from './api'
import { defaultPins, TEMPLATES } from './templates'

/**
 * Overview "Analytics · Pinned for {asset}" (README §7.3, SCREENS 6): the user's pinned template cards built from the
 * asset's analytics blocks, each removable, with Reset. The "Add analytics" dialog is Phase 6; its tile shows as
 * coming next. Custom (AI-built) pins are kept in the saved list and rendered from Phase 6 on.
 */
export function OverviewAnalytics({ asset }: { asset: Pick<AssetDetail, 'id' | 'name'> }) {
  const blocks = useAssetAnalytics(asset.id)
  const pins = useAnalyticsPins(asset.id)
  const save = useSavePins(asset.id)
  const openEvent = useEventSheet((s) => s.openEvent)
  const b = blocks.data
  const defaults: AnalyticsPin[] = b ? defaultPins(b).map((key) => ({ key })) : []
  const items = pins.data?.items ?? defaults
  const cards = b ? items.flatMap((p) => (p.key && TEMPLATES[p.key]?.available(b) ? [{ key: p.key, t: TEMPLATES[p.key]! }] : [])) : []

  return (
    <section aria-label="Pinned analytics" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">Analytics</h3>
          <p className="text-text-secondary">Pinned for {asset.name}. Add your own from indexed data, or ask Asset AI to build one.</p>
        </div>
        <Button variant="outline" size="sm" className="h-8" disabled={!b || pins.data?.items == null} onClick={() => save.mutate(defaults)}>
          <RotateCcw /> Reset
        </Button>
      </div>
      {blocks.isPending && (
        <ChartGrid>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[220px] rounded-[14px]" />
          ))}
        </ChartGrid>
      )}
      {blocks.isError && <p className="text-muted-foreground">Analytics aren't available for this asset yet.</p>}
      {b && (
        <ChartGrid>
          {cards.map(({ key, t }) => (
            <ChartCard
              key={key}
              title={t.title}
              description={t.description}
              span={t.span}
              actions={
                <Button variant="ghost" size="icon-xs" aria-label={`Remove ${t.title}`} onClick={() => save.mutate(items.filter((p) => p.key !== key))}>
                  <X />
                </Button>
              }
            >
              {t.render(b, { openEvent: (id) => openEvent(asset.id, id) })}
            </ChartCard>
          ))}
          <div aria-disabled="true" className="flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-[14px] border-[1.5px] border-dashed text-center text-muted-foreground">
            <Plus className="size-[18px]" aria-hidden="true" />
            <b className="font-semibold text-text-secondary">Add analytics</b>
            <span className="text-[12px]">Coming in the next update</span>
          </div>
        </ChartGrid>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/analytics/overview-analytics.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (5 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 9: Overview composition: KPI strip → pinned analytics → journey slot

**Files:**
- Modify: `apps/web/src/features/assets/pages/tabs.tsx` (the `journey` element of `OverviewTab`, below Phase 3's LiveBuild seam)
- Delete: `apps/web/src/features/assets/components/milestones.tsx` (its "Upcoming milestones" panel leaves the Overview; the "Next milestones" pin replaces it)
- Test: `apps/web/src/features/assets/pages/overview-layout.test.tsx`

**Interfaces:**
- Consumes: `OverviewAnalytics` (Task 8); the existing `KpiStrip` (labels already match SCREENS 6: Approved in · Active trials · Upcoming milestones · Journey events · Company releases) and, until Task 20, the v2 `JourneyTimeline`.
- Produces: `OverviewTab`'s ready content = KPI strip → `<OverviewAnalytics asset={asset} />` → journey slot (`<JourneyTimeline assetId={asset.id} />` full width here; Task 20 swaps in `JourneySection`). The old right column (Upcoming milestones "Show all" list and the FAERS adverse-event chart) leaves the Overview; `AdverseEventsChart` stays where else it is used. Phase 3's early `LiveBuild` return is untouched.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/assets/pages/overview-layout.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import type { AssetDetail } from '../api'
import { OverviewTab } from './tabs'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET = {
  id: 'trep', name: 'Treprostinil', aliases: [], company: { name: 'United Therapeutics' }, tags: {}, kind: 'primary', status: 'ready', updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 4, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 105 },
  latestEvent: null, competitorOf: [], kpis: { approvalRegions: ['US', 'EU'], activeTrials: 9, activePhase3: 3, upcomingMilestones: 5 }, competitors: [], suggestedQuestions: [],
} as AssetDetail

afterEach(() => vi.unstubAllGlobals())

describe('Overview layout (README §5.4: KPI strip → pinned analytics → journey)', () => {
  it('stacks the KPI strip, the pinned analytics and the journey in that order', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(404, { code: 'NOT_FOUND', message: url })))
    const router = createMemoryRouter([{ path: '/assets/:assetId', element: <Outlet context={ASSET} />, children: [{ path: 'overview', element: <OverviewTab /> }] }], {
      initialEntries: ['/assets/trep/overview'],
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    const kpis = screen.getByRole('region', { name: 'Key metrics' })
    expect(kpis).toHaveTextContent('Approved inUS, EU')
    const analytics = screen.getByRole('region', { name: 'Pinned analytics' })
    const journey = screen.getByRole('heading', { name: 'Journey' })
    expect(kpis.compareDocumentPosition(analytics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(analytics.compareDocumentPosition(journey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Upcoming milestones', { selector: 'h3' })).not.toBeInTheDocument()
    expect(await screen.findByText("Analytics aren't available for this asset yet.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/assets/pages/overview-layout.test.tsx`
Expected: FAIL — `Unable to find role="region" and name "Pinned analytics"`.

- [ ] **Step 3: Implement**

In `apps/web/src/features/assets/pages/tabs.tsx`:

Before:
```tsx
import { Chip } from '../components/badges'
import { JourneyTimeline } from '../components/journey-timeline'
import { UpcomingMilestones } from '../components/milestones'
import { EmptyState, KpiStrip, Panel } from '../components/panel'
import { recordTitle } from '../components/record-sheet'
```
After:
```tsx
import { Chip } from '../components/badges'
import { JourneyTimeline } from '../components/journey-timeline'
import { OverviewAnalytics } from '@/features/analytics/overview-analytics'
import { EmptyState, KpiStrip, Panel } from '../components/panel'
import { recordTitle } from '../components/record-sheet'
```

Before:
```tsx
        ]}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <JourneyTimeline assetId={asset.id} />
        <div className="flex flex-col gap-5">
          <UpcomingMilestones assetId={asset.id} />
          <AdverseEventsChart assetId={asset.id} />
        </div>
      </div>
    </div>
  )
```
After:
```tsx
        ]}
      />
      <OverviewAnalytics asset={asset} />
      <JourneyTimeline assetId={asset.id} />
    </div>
  )
```

Delete `apps/web/src/features/assets/components/milestones.tsx` (`git rm`; `tabs.tsx` was its only user).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/assets/pages/overview-layout.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (1 tests); `tsc` silent; oxlint reports no errors and no new warnings.
Also run `cd apps/web && npx vitest run src/features/assets/pages/overview-tab.test.tsx` (Phase 3): PASS.


---

### Task 10: Horizontal track geometry and the shared view contract

**Files:**
- Create: `apps/web/src/features/journey/track-layout.ts`
- Create: `apps/web/src/features/journey/view-types.ts`
- Test: `apps/web/src/features/journey/track-layout.test.ts`

**Interfaces:**
- Consumes: `yearFraction` (`lib/dates.ts`); `hoverDate`, `neighbours` (Task 2); `BranchModel`, `Closure` (Task 2); `NoteDraft` (Task 5).
- Produces:
  - `track-layout.ts`: `HZ = { COL: 178, CW: 304, PADL: 236, ROW: 34, CA: 196, RUL: 30 }`; `interface TrackLane { id; label; color; trunk; ended; x1; x2; capX: number | null; tailX: number | null; y; py: number | null; first }`; `interface TrackLayout { rows; H; top0; bandTop; bandBot; xs; TW; maxP; todayX; lanes; years; bgYears; rowY(id) }`; `xForDate(date, list, xs)`; `trackLayout({ list, branches, laneOf, vw, vh, closures, today }): TrackLayout`; `trackWindow(p, vw, n, overscan = 3): [first, last]`; `trackActive(p, vw, n)`; `trackSeen(p, vw, n)`; `trackOffsetFor(layout, i, vw)`; `interface TrackHover { x; ly; lane; date; prev; next }`; `trackHoverAt(layout, list, x, y, today?): TrackHover | null`.
  - `view-types.ts`: `interface JourneyViewHandle { jump(id: string): boolean }`; `interface JourneyViewProps { assetId; list; model; closures; stars; comments: Record<string, unknown[]>; focusBranch; onOpen(id); onAdd(draft: NoteDraft); onActive(index); ref?: Ref<JourneyViewHandle> }` — implemented by Tasks 17 and 18, used by Task 19.

- [ ] **Step 1: Write the failing test**

```ts
// file: apps/web/src/features/journey/track-layout.test.ts
import { yearFraction } from '@/lib/dates'
import { HZ, trackActive, trackHoverAt, trackLayout, trackOffsetFor, trackSeen, trackWindow, xForDate } from './track-layout'
import type { Branch, JourneyEventV3 } from './types'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({
  id, label: id, full: id, color: '#2347d9', off, status: 'Approved · US', origin: 'ai', ...extra,
})
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'trial_start', category: 'clinical', title: id, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const BRANCHES = [
  br('PAH', 0, { trunk: true }),
  br('PH-ILD', 2, { from: 'PAH' }),
  br('IPF', 3, { from: 'PH-ILD' }),
  br('CTEPH', -1, { from: 'PAH' }),
  br('PH-COPD', -5, { from: 'PAH', ended: 'Terminated' }),
  br('SSc', 1, { from: 'PAH' }),
]
// Key-scope Treprostinil shape: PH-COPD's key events run to 2025 but the programme closed in Nov 2022.
const LIST = [
  ev('a', '2002-05-21', 'PAH'),
  ev('b', '2017-02-01', 'PH-ILD'),
  ev('c', '2018-05-08', 'PH-COPD'),
  ev('d', '2020-04-03', 'CTEPH'),
  ev('e', '2021-06-01', 'IPF'),
  ev('f', '2022-01-10', 'PAH'),
  ev('g', '2023-05-22', 'PH-ILD'),
  ev('h', '2024-06-06', 'PH-COPD'),
  ev('i', '2025-03-18', 'PH-COPD'),
  ev('j', '2027-04-30', 'IPF', { is_milestone: true }),
]
const laneOf = (e: JourneyEventV3) => e.branch!
const layout = (over: Partial<Parameters<typeof trackLayout>[0]> = {}) =>
  trackLayout({ list: LIST, branches: BRANCHES, laneOf, vw: 1200, vh: 900, closures: { 'PH-COPD': { id: 'stop', date: '2022-11-29' } }, today: '2026-10-09', ...over })

describe('trackLayout', () => {
  it('uses the design constants and centres the band vertically', () => {
    const L = layout()
    expect(L.xs.slice(0, 3)).toEqual([236, 414, 592])
    expect(L.H).toBe(HZ.RUL + HZ.CA + 14 + 6 * HZ.ROW + 14 + HZ.CA)
    expect(L.top0).toBe((900 - L.H) / 2)
    expect(L.bandTop).toBe(L.top0 + 30 + 196 + 14)
    expect(L.TW).toBe(236 + 9 * 178 + 152 + 140)
    expect(L.maxP).toBe(L.TW - 1200)
  })

  it('orders rows by offset (closed and partner branches above the trunk)', () => {
    const L = layout()
    expect(L.rows.map((r) => r.id)).toEqual(['PH-COPD', 'CTEPH', 'PAH', 'SSc', 'PH-ILD', 'IPF'])
    expect(L.rowY('PAH')).toBe(L.bandTop + 2 * 34 + 17)
  })

  it('starts the trunk at PADL − 110, a branch 74px before its first event, forking from its parent row', () => {
    const L = layout()
    const lane = (id: string) => L.lanes.find((l) => l.id === id)!
    expect(lane('PAH')).toMatchObject({ x1: 126, x2: L.TW - 70, py: null })
    expect(lane('PH-ILD')).toMatchObject({ x1: 414 - 74, py: L.rowY('PAH') })
    expect(lane('IPF').py).toBe(L.rowY('PH-ILD'))
    expect(L.lanes.some((l) => l.id === 'SSc')).toBe(false)
  })

  it('caps PH-COPD at its 2022 closure between the 2022 and 2023 columns, with a dotted tail to its later events', () => {
    const L = layout()
    const copd = L.lanes.find((l) => l.id === 'PH-COPD')!
    const x2022 = L.xs[5]!
    const x2023 = L.xs[6]!
    expect(copd.ended).toBe(true)
    expect(copd.capX!).toBeGreaterThan(x2022)
    expect(copd.capX!).toBeLessThan(x2023)
    const t = (yearFraction('2022-11-29') - yearFraction('2022-01-10')) / (yearFraction('2023-05-22') - yearFraction('2022-01-10'))
    expect(copd.capX!).toBeCloseTo(x2022 + t * 178, 6)
    expect(copd.x2).toBe(copd.capX)
    expect(copd.tailX).toBe(L.xs[8])
  })

  it('caps right after the closing event when it is on the track, and after the last event without a closure', () => {
    const withStop = [...LIST.slice(0, 6), ev('stop', '2022-11-29', 'PH-COPD', { type: 'trial_stopped' }), ...LIST.slice(6)]
    const L = layout({ list: withStop })
    expect(L.lanes.find((l) => l.id === 'PH-COPD')!.capX).toBe(L.xs[6]! + 26)
    const M = layout({ closures: {} })
    expect(M.lanes.find((l) => l.id === 'PH-COPD')).toMatchObject({ capX: M.xs[8]! + 26, tailX: null })
  })

  it('puts Today between the last past event and the first future one', () => {
    const L = layout()
    expect(L.todayX).toBe((L.xs[8]! + L.xs[9]!) / 2)
    expect(layout({ today: '1999-01-01' }).todayX).toBe(236 - 60)
    expect(layout({ today: '2030-01-01' }).todayX).toBe(L.xs[9]! + 70)
  })

  it('places one ruler year per year and parallax numerals at least 520px apart', () => {
    const L = layout()
    expect(L.years.map((y) => y.y)).toEqual(['2002', '2017', '2018', '2020', '2021', '2022', '2023', '2024', '2025', '2027'])
    for (let i = 1; i < L.bgYears.length; i++) expect(L.bgYears[i]!.bx - L.bgYears[i - 1]!.bx).toBeGreaterThanOrEqual(520)
  })

  it('draws a single unlabeled trunk for an asset without branches and copes with no events', () => {
    const single = trackLayout({ list: LIST, branches: [br('journey', 0, { trunk: true, label: '' })], laneOf: () => 'journey', vw: 1000, vh: 700, closures: {}, today: '2026-10-09' })
    expect(single.lanes).toHaveLength(1)
    const empty = trackLayout({ list: [], branches: BRANCHES, laneOf, vw: 1000, vh: 700, closures: {}, today: '2026-10-09' })
    expect(empty).toMatchObject({ xs: [], maxP: 0, years: [] })
    expect(xForDate('2020-01-01', [], [])).toBe(236)
  })
})

describe('track windowing and scroll position', () => {
  it('renders only the cards near the viewport, even for 1,270 events', () => {
    const n = 1270
    const [first, last] = trackWindow(100_000, 1200, n)
    expect(last - first).toBeLessThan(20)
    expect(HZ.PADL + first * HZ.COL + HZ.CW / 2).toBeLessThan(100_000)
    expect(HZ.PADL + last * HZ.COL - HZ.CW / 2).toBeGreaterThan(101_200)
    expect(trackWindow(0, 1200, 5)).toEqual([0, 4])
    expect(trackWindow(0, 1200, 0)).toEqual([0, -1])
  })

  it('finds the active card at the middle, the revealed ones, and the offset that centres a card', () => {
    expect(trackActive(0, 1200, 10)).toBe(Math.round((600 - 236) / 178))
    expect(trackActive(99_999, 1200, 10)).toBe(9)
    expect(trackSeen(0, 1200, 10)).toBe(Math.floor((1160 - 236) / 178))
    const L = layout()
    expect(trackOffsetFor(L, 0, 1200)).toBe(0)
    expect(trackOffsetFor(L, 9, 1200)).toBe(L.maxP)
    expect(trackOffsetFor(L, 5, 1200)).toBe(L.xs[5]! - 600)
  })
})

describe('trackHoverAt', () => {
  it('reads the row under the pointer and a date between the neighbouring cards', () => {
    const L = layout()
    const x = (L.xs[3]! + L.xs[4]!) / 2
    const h = trackHoverAt(L, LIST, x, L.rowY('CTEPH'), '2026-10-09')!
    expect(h.lane).toBe('CTEPH')
    expect(h.ly).toBe(L.rowY('CTEPH'))
    expect(h.prev?.id).toBe('d')
    expect(h.next?.id).toBe('e')
    expect(h.date > '2020-04-03' && h.date < '2021-06-01').toBe(true)
  })

  it('is null outside the band and clamps to the first and last events at the ends', () => {
    const L = layout()
    expect(trackHoverAt(L, LIST, 500, L.bandTop - 20)).toBeNull()
    expect(trackHoverAt(L, LIST, 10, L.rowY('PAH'))!.date).toBe('2002-05-21')
    expect(trackHoverAt(L, LIST, L.TW, L.rowY('PAH'))!.date).toBe('2027-04-30')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/track-layout.test.ts`
Expected: FAIL — `Failed to resolve import "./track-layout"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/journey/track-layout.ts
import { yearFraction } from '@/lib/dates'
import { hoverDate, neighbours } from './hover-add'
import type { Branch, JourneyEventV3 } from './types'

/**
 * Horizontal track geometry (README §6.3, ported from aj/horizontal.jsx): one 178px column per event, 304px cards,
 * 236px left pad, 34px branch rows, 196px card areas above and below the rows, 30px year ruler.
 */
export const HZ = { COL: 178, CW: 304, PADL: 236, ROW: 34, CA: 196, RUL: 30 } as const

export interface TrackLane {
  id: string
  label: string
  color: string
  trunk: boolean
  ended: boolean
  /** Lane start; the trunk starts at PADL − 110, a branch 74px before its first event. */
  x1: number
  /** End of the solid/dashed lane: near the track end, or the ⊗ cap of an ended branch. */
  x2: number
  capX: number | null
  /** An ended branch's events after its closure (late publications) hang on a dotted tail up to here. */
  tailX: number | null
  y: number
  /** Parent row of the fork curve; null on the trunk. */
  py: number | null
  first: JourneyEventV3 | null
}

export interface TrackLayout {
  /** Branch rows, sorted by `off` (negative above the trunk). */
  rows: Branch[]
  H: number
  top0: number
  bandTop: number
  bandBot: number
  xs: number[]
  TW: number
  maxP: number
  todayX: number
  lanes: TrackLane[]
  years: { y: string; x: number }[]
  /** Parallax numerals (0.55×), at least 520px apart. */
  bgYears: { y: string; bx: number }[]
  rowY: (id: string) => number
}

export interface TrackInput {
  /** Chronological, filtered events. */
  list: JourneyEventV3[]
  branches: Branch[]
  laneOf: (e: JourneyEventV3) => string
  /** Pinned viewport width and height. */
  vw: number
  vh: number
  /** Closure of each ended branch (journey-model `branchClosures`). */
  closures: Record<string, { id: string; date: string }>
  today: string
}

/** x of a date between the event columns (interpolated in year fraction); before the first −60px, after the last +70px. */
export function xForDate(date: string, list: Pick<JourneyEventV3, 'date'>[], xs: number[]): number {
  const n = list.length
  if (!n) return HZ.PADL
  const fs = list.map((e) => yearFraction(e.date))
  const f = yearFraction(date)
  const [a, b] = neighbours(fs, f)
  if (a < 0) return xs[0]! - 60
  if (b >= n) return xs[n - 1]! + 70
  const t = fs[b]! > fs[a]! ? (f - fs[a]!) / (fs[b]! - fs[a]!) : 0.5
  return xs[a]! + t * (xs[b]! - xs[a]!)
}

export function trackLayout({ list, branches, laneOf, vw, vh, closures, today }: TrackInput): TrackLayout {
  const rows = [...branches].sort((a, b) => a.off - b.off)
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]))
  const trunkId = (rows.find((r) => r.trunk) ?? rows[0])?.id
  const nR = rows.length
  const H = HZ.RUL + HZ.CA + 14 + nR * HZ.ROW + 14 + HZ.CA
  const top0 = Math.max(0, (vh - H) / 2)
  const bandTop = top0 + HZ.RUL + HZ.CA + 14
  const bandBot = bandTop + nR * HZ.ROW
  const rowY = (id: string) => bandTop + (rowIndex.get(id) ?? 0) * HZ.ROW + HZ.ROW / 2

  const n = list.length
  const xs = list.map((_, i) => HZ.PADL + i * HZ.COL)
  const TW = (n ? xs[n - 1]! : HZ.PADL) + HZ.CW / 2 + 140
  const maxP = Math.max(0, TW - vw)
  const fs = list.map((e) => yearFraction(e.date))
  const [ta, tb] = neighbours(fs, yearFraction(today))
  const todayX = !n ? HZ.PADL : ta < 0 ? xs[0]! - 60 : tb >= n ? xs[n - 1]! + 70 : (xs[ta]! + xs[tb]!) / 2

  const lanesOf = rows.map((l) => list.flatMap((e, i) => (laneOf(e) === l.id ? [i] : [])))
  const lanes = rows.flatMap((l, r): TrackLane[] => {
    const idx = lanesOf[r]!
    if (!idx.length && !l.trunk) return []
    const x1 = l.trunk ? HZ.PADL - 110 : xs[idx[0]!]! - 74
    const parent = l.trunk ? null : l.from && rowIndex.has(l.from) ? l.from : trunkId
    const ended = !!l.ended && idx.length > 0
    let x2 = TW - 70
    let capX: number | null = null
    let tailX: number | null = null
    if (ended) {
      const lastX = xs[idx[idx.length - 1]!]!
      const closure = closures[l.id]
      const at = closure ? list.findIndex((e) => e.id === closure.id) : -1
      capX = Math.max(x1 + 20, at >= 0 ? xs[at]! + 26 : closure ? xForDate(closure.date, list, xs) : lastX + 26)
      tailX = lastX > capX ? lastX : null
      x2 = capX
    }
    return [
      {
        id: l.id, label: l.label, color: l.color, trunk: !!l.trunk, ended, x1, x2, capX, tailX,
        y: rowY(l.id), py: parent ? rowY(parent) : null, first: idx.length ? list[idx[0]!]! : null,
      },
    ]
  })

  const years: { y: string; x: number }[] = []
  list.forEach((e, i) => {
    const y = e.date.slice(0, 4)
    if (years[years.length - 1]?.y !== y) years.push({ y, x: xs[i]! })
  })
  const bgYears: { y: string; bx: number }[] = []
  for (const y of years) {
    const bx = y.x * 0.55
    if (!bgYears.length || bx - bgYears[bgYears.length - 1]!.bx >= 520) bgYears.push({ y: y.y, bx })
  }
  return { rows, H, top0, bandTop, bandBot, xs, TW, maxP, todayX, lanes, years, bgYears, rowY }
}

/** Which cards to render at scroll offset `p` (windowing for 1,000+ event journeys): [first, last], inclusive. */
export function trackWindow(p: number, vw: number, n: number, overscan = 3): [number, number] {
  if (!n) return [0, -1]
  const first = Math.ceil((p - HZ.CW / 2 - HZ.PADL) / HZ.COL) - overscan
  const last = Math.floor((p + vw + HZ.CW / 2 - HZ.PADL) / HZ.COL) + overscan
  return [Math.min(n - 1, Math.max(0, first)), Math.min(n - 1, Math.max(0, last))]
}

/** The event nearest the middle of the viewport (HUD, active card). */
export const trackActive = (p: number, vw: number, n: number) => (n ? Math.min(n - 1, Math.max(0, Math.round((p + vw / 2 - HZ.PADL) / HZ.COL))) : 0)

/** The last card revealed: cards reveal once `x − p < vw − 40`, and stay revealed. */
export const trackSeen = (p: number, vw: number, n: number) => Math.min(n - 1, Math.floor((p + vw - 40 - HZ.PADL) / HZ.COL))

/** Scroll offset that centres event `i`. */
export const trackOffsetFor = (layout: Pick<TrackLayout, 'xs' | 'maxP'>, i: number, vw: number) =>
  Math.min(layout.maxP, Math.max(0, (layout.xs[i] ?? 0) - vw / 2))

export interface TrackHover {
  x: number
  ly: number
  lane: string
  date: string
  prev: JourneyEventV3 | null
  next: JourneyEventV3 | null
}

/**
 * Hover band → row and date. `x`/`y` are relative to the track's SVG, which lives inside the translated track: they
 * are already track coordinates (never add the scroll offset, README §6.3).
 */
export function trackHoverAt(layout: TrackLayout, list: JourneyEventV3[], x: number, y: number, today?: string): TrackHover | null {
  const { rows, bandTop, bandBot, xs, rowY } = layout
  if (!rows.length || y < bandTop - 6 || y > bandBot + 6) return null
  const row = rows[Math.min(rows.length - 1, Math.max(0, Math.floor((y - bandTop) / HZ.ROW)))]!
  const [a, b] = neighbours(xs, x)
  const prev = a >= 0 ? list[a]! : null
  const next = b < list.length ? list[b]! : null
  const date = hoverDate(prev && { pos: xs[a]!, date: prev.date }, next && { pos: xs[b]!, date: next.date }, x, today)
  return { x, ly: rowY(row.id), lane: row.id, date, prev, next }
}
```

```ts
// file: apps/web/src/features/journey/view-types.ts
import type { Ref } from 'react'
import type { BranchModel, Closure } from './journey-model'
import type { NoteDraft } from './note-draft-dialog'
import type { JourneyEventV3 } from './types'

/** What JourneySection can ask a view (horizontal track or tree) to do. */
export interface JourneyViewHandle {
  /** Scroll to the event and flash its card; false when the view doesn't show it. */
  jump: (id: string) => boolean
}

/** Props shared by both journey views. */
export interface JourneyViewProps {
  assetId: string
  /** Chronological, filtered events. */
  list: JourneyEventV3[]
  model: BranchModel
  closures: Record<string, Closure>
  stars: string[]
  comments: Record<string, unknown[]>
  focusBranch: string | null
  onOpen: (id: string) => void
  onAdd: (draft: NoteDraft) => void
  onActive: (index: number) => void
  ref?: Ref<JourneyViewHandle>
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/track-layout.test.ts && npx tsc -b && npm run lint`
Expected: PASS (12 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 11: Tree rows and geometry (pure)

**Files:**
- Create: `apps/web/src/features/journey/tree/tree-rows.ts`
- Create: `apps/web/src/features/journey/tree/tree-geometry.ts`
- Test: `apps/web/src/features/journey/tree/tree-geometry.test.ts`

**Interfaces:**
- Consumes: `laneOf`, `spanOf`, `BranchModel`, `Closure` (Task 2); `hoverDate`, `neighbours` (Task 2); `NOTE_TAGS` (constants).
- Produces:
  - `tree-rows.ts`: `type Side = 'l' | 'r'`; `type TreeRow` (kinds `root`, `year {year, n}`, `today`, `fork {branch, side, n}`, `event {e, i, side, lane}`, `end {branch, side, closure}`, `finish {milestones}`; `key` = `root` / `y{yyyy}` / `today` / `f{branch}` / event id / `x{branch}` / `finish`); `branchSide(b)`; `treeRows(list, model, closures, today): TreeRow[]`.
  - `tree-geometry.ts`: `TREE = { GAP_W: 40, GAP_N: 16, NARROW: 980, PAD_TOP: 28, PAD_BOTTOM: 40, ITEM_PAD: 14, NODE_DY: 34 }`; `treeGutters(model) → { mn, mx, gl, gr, nw }`; `estimateRowHeight(row)`; `rowTops(heights) → { tops, H }`; `treeWindow(tops, heights, from, to): [first, last]`; `interface TreeNode { k; i; y; lane; x; x2; up; hi; note; span: number[] }`; `interface TreeLane { id; label; color; trunk; x; px: number | null; fy; y1; y2; fx2; ended; tailY: number | null }`; `interface TreeGeometry { W; H; tx; gap; narrow; cardW; nodes; lanes; yToday: number | null; yEnd; xMin; xMax }`; `treeGeometry({ W, rows, tops, heights, H, model, spanOf }): TreeGeometry`; `treeActiveAt(nodes, probeY): number`; `interface TreeHover { y; lx; lane; color; label; date; prev; next }`; `treeHoverAt(geo, byId, x, y, today?): TreeHover | null`.

- [ ] **Step 1: Write the failing test**

```ts
// file: apps/web/src/features/journey/tree/tree-geometry.test.ts
import { yearFraction } from '@/lib/dates'
import { branchModel, spanOf } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'
import { estimateRowHeight, rowTops, TREE, treeActiveAt, treeGeometry, treeGutters, treeHoverAt, treeWindow } from './tree-geometry'
import { treeRows, type TreeRow } from './tree-rows'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({
  id, label: id, full: `${id} full`, color: '#0b7a6f', off, status: 'Approved · US', origin: 'ai', ...extra,
})
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'trial_start', category: 'clinical', title: `T ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const MODEL = branchModel([
  br('PAH', 0, { trunk: true, color: '#2347d9' }),
  br('PH-ILD', 2, { from: 'PAH' }),
  br('IPF', 3, { from: 'PH-ILD' }),
  br('CTEPH', -1, { from: 'PAH' }),
  br('PH-COPD', -5, { from: 'PAH', ended: 'Terminated' }),
])
const LIST = [
  ev('a', '2002-05-21', 'PAH'),
  ev('b', '2004-11-23', 'PAH'),
  ev('c', '2017-02-01', 'PH-ILD'),
  ev('d', '2018-05-08', 'PH-COPD'),
  ev('e', '2021-06-01', 'IPF', { span: ['PH-ILD'] }),
  ev('f', '2022-01-10', 'PAH'),
  ev('g', '2023-05-22', 'PH-ILD'),
  ev('h', '2024-06-06', 'PH-COPD', { significance: 'Medium' }),
  ev('i', '2027-04-30', 'IPF', { is_milestone: true }),
]
const CLOSURES = { 'PH-COPD': { id: 'stop', date: '2022-11-29', title: 'Phase 3 trial terminated: PERFECT OLE' } }
const keys = (rows: TreeRow[]) => rows.map((r) => r.key)

function geometry(W: number, rows = treeRows(LIST, MODEL, CLOSURES, '2026-10-09')) {
  const heights = rows.map(estimateRowHeight)
  const { tops, H } = rowTops(heights)
  return { rows, tops, heights, geo: treeGeometry({ W, rows, tops, heights, H, model: MODEL, spanOf: (e) => spanOf(e, MODEL) }) }
}

describe('treeRows', () => {
  it('orders root, years, forks before a branch’s first event, the closure, Today and the end', () => {
    const rows = treeRows(LIST, MODEL, CLOSURES, '2026-10-09')
    expect(keys(rows)).toEqual([
      'root', 'y2002', 'a', 'y2004', 'b', 'y2017', 'fPH-ILD', 'c', 'y2018', 'fPH-COPD', 'd', 'y2021', 'fIPF', 'e', 'y2022', 'f',
      'xPH-COPD', 'y2023', 'g', 'y2024', 'h', 'today', 'y2027', 'i', 'finish',
    ])
    expect(rows.find((r) => r.key === 'xPH-COPD')).toMatchObject({ closure: { date: '2022-11-29', title: 'Phase 3 trial terminated: PERFECT OLE' }, side: 'l' })
    expect(rows.find((r) => r.key === 'fPH-ILD')).toMatchObject({ n: 2, side: 'r' })
    expect(rows.at(-1)).toMatchObject({ kind: 'finish', milestones: true })
  })

  it('alternates trunk events right / left and keeps branch events on their side', () => {
    const sides = treeRows(LIST, MODEL, CLOSURES, '2026-10-09').flatMap((r) => (r.kind === 'event' ? [`${r.key}:${r.side}`] : []))
    expect(sides).toEqual(['a:r', 'b:l', 'c:r', 'd:l', 'e:r', 'f:r', 'g:r', 'h:l', 'i:r'])
  })

  it('closes after the branch’s last event when the closure is unknown, and has no forks on a single trunk', () => {
    expect(keys(treeRows(LIST, MODEL, {}, '2026-10-09'))).toContain('xPH-COPD')
    const k = keys(treeRows(LIST, MODEL, {}, '2026-10-09'))
    expect(k.indexOf('xPH-COPD')).toBe(k.indexOf('h') + 1)
    const single = treeRows(LIST, branchModel([]), {}, '2030-01-01')
    expect(single.some((r) => r.kind === 'fork' || r.kind === 'end' || r.kind === 'today')).toBe(false)
  })
})

describe('treeGeometry', () => {
  it('sizes the gutters from the branch offsets and centres the trunk between them', () => {
    expect(treeGutters(MODEL)).toEqual({ mn: -5, mx: 3, gl: 230, gr: 150, nw: 14 + 8 * 16 + 26 })
    const { geo } = geometry(1300)
    expect(geo.narrow).toBe(false)
    expect(geo.gap).toBe(40)
    expect(geo.tx).toBe(Math.round((1300 + 230 - 150) / 2))
    expect(geo.cardW).toBe((1300 - 380) / 2 - 8)
    const x = (id: string) => geo.lanes.find((l) => l.id === id)!.x
    expect(x('IPF')).toBe(geo.tx + 120)
    expect(x('PH-COPD')).toBe(geo.tx - 200)
    expect(geo.xMin).toBe(geo.tx - 200)
    expect(geo.xMax).toBe(geo.tx + 120)
  })

  it('switches to the narrow layout below a 980px flow: trunk near the left edge, every card on the right', () => {
    const { geo } = geometry(979)
    expect(geo.narrow).toBe(true)
    expect(geo.gap).toBe(16)
    expect(geo.tx).toBe(14 + 5 * 16)
    expect(geo.cardW).toBe(979 - (14 + 8 * 16 + 26))
    expect(new Set(geo.nodes.map((n) => n.x2))).toEqual(new Set([979 - geo.cardW]))
    expect(geometry(980).geo.narrow).toBe(false)
  })

  it('puts nodes 48px below the card row top and connects them to the facing card edge', () => {
    const { rows, tops, geo } = geometry(1300)
    const i = rows.findIndex((r) => r.key === 'b')
    const node = geo.nodes.find((n) => n.k === 'b')!
    expect(node.y).toBe(tops[i]! + TREE.ITEM_PAD + TREE.NODE_DY)
    expect(node.x2).toBe(geo.cardW)
    expect(geo.nodes.find((n) => n.k === 'a')!.x2).toBe(1300 - geo.cardW)
    expect(geo.nodes.find((n) => n.k === 'e')!.span).toEqual([geo.tx + 80])
    expect(geo.nodes.find((n) => n.k === 'i')!.up).toBe(true)
  })

  it('forks a branch at its fork row from its parent lane, falling back to the trunk', () => {
    const { rows, tops, heights, geo } = geometry(1300)
    const f = rows.findIndex((r) => r.key === 'fIPF')
    const ipf = geo.lanes.find((l) => l.id === 'IPF')!
    expect(ipf.fy).toBe(tops[f]! + heights[f]! / 2)
    expect(ipf.px).toBe(geo.lanes.find((l) => l.id === 'PH-ILD')!.x)
    expect(ipf.fx2).toBe(1300 - geo.cardW)
    const orphan = branchModel([br('PAH', 0, { trunk: true }), br('X', 1, { from: 'Nope' })])
    const rows2 = treeRows([ev('a', '2002-01-01', 'PAH'), ev('x', '2010-01-01', 'X')], orphan, {}, '2026-10-09')
    const h2 = rows2.map(estimateRowHeight)
    const { tops: t2, H } = rowTops(h2)
    const g2 = treeGeometry({ W: 1300, rows: rows2, tops: t2, heights: h2, H, model: orphan, spanOf: () => [] })
    expect(g2.lanes.find((l) => l.id === 'X')!.px).toBe(g2.tx)
  })

  it('caps an ended branch at its closure row with a dotted tail to later events; active branches reach Today', () => {
    const { rows, tops, heights, geo } = geometry(1300)
    const end = rows.findIndex((r) => r.key === 'xPH-COPD')
    const copd = geo.lanes.find((l) => l.id === 'PH-COPD')!
    expect(copd).toMatchObject({ ended: true, y2: tops[end]! + heights[end]! / 2 })
    expect(copd.tailY).toBe(geo.nodes.find((n) => n.k === 'h')!.y)
    const ild = geo.lanes.find((l) => l.id === 'PH-ILD')!
    expect(ild.y2).toBe(geo.yToday)
    expect(geo.lanes.find((l) => l.id === 'IPF')!.y2).toBe(geo.nodes.find((n) => n.k === 'i')!.y)
    expect(geo.lanes.find((l) => l.trunk)!.y2).toBe(geo.yEnd)
  })
})

describe('tree windowing, active row and hover', () => {
  it('renders only rows near the viewport', () => {
    const heights = Array.from({ length: 2000 }, () => 100)
    const { tops } = rowTops(heights)
    expect(treeWindow(tops, heights, 50_000, 51_000)).toEqual([499, 509])
    expect(treeWindow(tops, heights, -500, 10)).toEqual([0, 0])
    expect(treeWindow([], [], 0, 10)).toEqual([0, -1])
  })

  it('finds the event nearest the probe', () => {
    const { geo } = geometry(1300)
    const b = geo.nodes.find((n) => n.k === 'b')!
    expect(treeActiveAt(geo.nodes, b.y + 3)).toBe(1)
    expect(treeActiveAt(geo.nodes, -100)).toBe(0)
    expect(treeActiveAt(geo.nodes, 1e9)).toBe(8)
  })

  it('hovers the nearest started lane with a date between the nodes above and below', () => {
    const { geo } = geometry(1300)
    const byId = new Map(LIST.map((e) => [e.id, e]))
    const a = geo.nodes.find((n) => n.k === 'a')!
    const b = geo.nodes.find((n) => n.k === 'b')!
    const h = treeHoverAt(geo, byId, geo.tx + 3, (a.y + b.y) / 2, '2026-10-09')!
    expect(h).toMatchObject({ lane: 'PAH', lx: geo.tx, prev: LIST[0], next: LIST[1] })
    const mid = (yearFraction('2002-05-21') + yearFraction('2004-11-23')) / 2
    expect(Math.abs(yearFraction(h.date) - mid)).toBeLessThan(0.05)
    // PH-COPD has not forked yet in 2004: the pointer over its lane x snaps to the trunk.
    expect(treeHoverAt(geo, byId, geo.tx - 200, (a.y + b.y) / 2)!.lane).toBe('PAH')
    const d = geo.nodes.find((n) => n.k === 'd')!
    expect(treeHoverAt(geo, byId, geo.tx - 199, d.y + 10)!.lane).toBe('PH-COPD')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/tree/tree-geometry.test.ts`
Expected: FAIL — `Failed to resolve import "./tree-geometry"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/journey/tree/tree-rows.ts
import { laneOf, type BranchModel, type Closure } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'

export type Side = 'l' | 'r'

/** The tree's rows in date order (README §6.2 "Rows"). */
export type TreeRow =
  | { kind: 'root'; key: 'root' }
  | { kind: 'year'; key: string; year: string; n: number }
  | { kind: 'today'; key: 'today' }
  | { kind: 'fork'; key: string; branch: Branch; side: Side; n: number }
  | { kind: 'event'; key: string; e: JourneyEventV3; i: number; side: Side; lane: string }
  | { kind: 'end'; key: string; branch: Branch; side: Side; closure: Closure }
  | { kind: 'finish'; key: 'finish'; milestones: boolean }

/** Left of the trunk for negative offsets, right otherwise. */
export const branchSide = (b: Pick<Branch, 'off'>): Side => (b.off < 0 ? 'l' : 'r')

/**
 * Root, then per event: Today (before the first event after today), a year marker, a "New branch" fork row before a
 * branch's first event, the event; a "Branch closed" row once an ended branch's closure date has passed (or after
 * its last event when the closure is unknown); then the end marker. Trunk events alternate sides.
 */
export function treeRows(list: JourneyEventV3[], model: BranchModel, closures: Record<string, Closure>, today: string): TreeRow[] {
  const out: TreeRow[] = [{ kind: 'root', key: 'root' }]
  const lanes = list.map((e) => laneOf(e, model))
  const count = new Map<string, number>()
  const last = new Map<string, JourneyEventV3>()
  const perYear = new Map<string, number>()
  list.forEach((e, i) => {
    count.set(lanes[i]!, (count.get(lanes[i]!) ?? 0) + 1)
    last.set(lanes[i]!, e)
    perYear.set(e.date.slice(0, 4), (perYear.get(e.date.slice(0, 4)) ?? 0) + 1)
  })
  const ends = new Map<string, Closure>()
  if (model.multi) {
    for (const b of model.list) {
      const fallback = last.get(b.id)
      if (b.ended && fallback) ends.set(b.id, closures[b.id] ?? { id: fallback.id, date: fallback.date, title: fallback.title })
    }
  }
  const forked = new Set<string>()
  const closed = new Set<string>()
  const flushEnds = (before: string | null) => {
    for (const [id, c] of ends) {
      if (closed.has(id) || !forked.has(id) || (before !== null && c.date >= before)) continue
      closed.add(id)
      const branch = model.byId.get(id)!
      out.push({ kind: 'end', key: `x${id}`, branch, side: branchSide(branch), closure: c })
    }
  }

  let year: string | null = null
  let todayShown = false
  let trunkTurn = 0
  list.forEach((e, i) => {
    const lane = lanes[i]!
    const b = model.byId.get(lane)!
    flushEnds(e.date)
    if (!todayShown && e.date > today) {
      out.push({ kind: 'today', key: 'today' })
      todayShown = true
    }
    const y = e.date.slice(0, 4)
    if (y !== year) {
      out.push({ kind: 'year', key: `y${y}`, year: y, n: perYear.get(y)! })
      year = y
    }
    if (model.multi && !b.trunk && !forked.has(lane)) {
      forked.add(lane)
      out.push({ kind: 'fork', key: `f${lane}`, branch: b, side: branchSide(b), n: count.get(lane)! })
    }
    const side: Side = b.off < 0 ? 'l' : b.off > 0 ? 'r' : trunkTurn++ % 2 ? 'l' : 'r'
    out.push({ kind: 'event', key: e.id, e, i, side, lane })
  })
  flushEnds(null)
  out.push({ kind: 'finish', key: 'finish', milestones: list.some((e) => e.is_milestone) })
  return out
}
```

```ts
// file: apps/web/src/features/journey/tree/tree-geometry.ts
import { hoverDate, neighbours } from '../hover-add'
import type { BranchModel } from '../journey-model'
import { NOTE_TAGS } from '../constants'
import type { JourneyEventV3 } from '../types'
import type { TreeRow } from './tree-rows'

/**
 * Tree constants (README §6.2, aj/story.jsx): lane gap 40px wide / 16px narrow, narrow below a 980px flow, 28px flow
 * padding on top and 40px below, 14px item padding, node 34px below the card top.
 */
export const TREE = { GAP_W: 40, GAP_N: 16, NARROW: 980, PAD_TOP: 28, PAD_BOTTOM: 40, ITEM_PAD: 14, NODE_DY: 34 } as const

/** Gutters around the trunk sized by the branch offsets: left `gl`, right `gr`; `nw` = narrow lane strip. */
export function treeGutters(model: Pick<BranchModel, 'list'>) {
  const offs = model.list.map((b) => b.off)
  const mn = Math.min(0, ...offs)
  const mx = Math.max(0, ...offs)
  return { mn, mx, gl: -mn * TREE.GAP_W + 30, gr: mx * TREE.GAP_W + 30, nw: 14 + (mx - mn) * TREE.GAP_N + 26 }
}

/** Row height before it is measured (rendered rows replace it with their real height). */
export function estimateRowHeight(row: TreeRow): number {
  switch (row.kind) {
    case 'root':
      return 42
    case 'year':
      return 98
    case 'today':
      return 80
    case 'fork':
      return 82
    case 'end':
      return 74
    case 'finish':
      return 72
    case 'event':
      return (row.e.significance === 'High' ? 320 : row.e.significance === 'Medium' ? 260 : 96) + (row.e.user ? 26 : 0)
  }
}

/** Row tops from heights (flow padding included) and the flow height. */
export function rowTops(heights: number[]): { tops: number[]; H: number } {
  const tops: number[] = []
  let y = TREE.PAD_TOP
  for (const h of heights) {
    tops.push(y)
    y += h
  }
  return { tops, H: y + TREE.PAD_BOTTOM }
}

/** First and last row intersecting [from, to] (inclusive; [0, −1] when there are no rows). */
export function treeWindow(tops: number[], heights: number[], from: number, to: number): [number, number] {
  if (!tops.length) return [0, -1]
  const bottoms = tops.map((t, i) => t + heights[i]!)
  const first = Math.min(tops.length - 1, neighbours(bottoms, from)[1])
  const last = Math.max(first, neighbours(tops, to)[0])
  return [first, Math.min(tops.length - 1, last)]
}

export interface TreeNode {
  /** Event id. */
  k: string
  /** Index in the view's list. */
  i: number
  y: number
  lane: string
  x: number
  /** Card edge the connector runs to. */
  x2: number
  up: boolean
  hi: boolean
  /** Note tag colour (white node with a tag-colour stroke). */
  note: string | null
  /** x of the other branches a multi-indication event covers. */
  span: number[]
}

export interface TreeLane {
  id: string
  label: string
  color: string
  trunk: boolean
  x: number
  /** Parent lane x (fork curve); null on the trunk. */
  px: number | null
  /** Fork row centre. */
  fy: number
  y1: number
  /** End of the solid/dashed lane (the ⊗ cap of an ended branch). */
  y2: number
  /** End of the "New branch" connector at the fork card. */
  fx2: number
  ended: boolean
  /** Dotted follow-up after the closure, down to the branch's last event. */
  tailY: number | null
}

export interface TreeGeometry {
  W: number
  H: number
  tx: number
  gap: number
  narrow: boolean
  cardW: number
  nodes: TreeNode[]
  lanes: TreeLane[]
  yToday: number | null
  yEnd: number
  xMin: number
  xMax: number
}

export interface TreeGeometryInput {
  /** Flow width. */
  W: number
  rows: TreeRow[]
  tops: number[]
  heights: number[]
  H: number
  model: BranchModel
  /** Other branches covered by an event (journey-model `spanOf`). */
  spanOf: (e: JourneyEventV3) => string[]
}

/** Lanes, nodes and connectors computed from the row layout (no DOM reads), so off-screen rows have geometry too. */
export function treeGeometry({ W, rows, tops, heights, H, model, spanOf }: TreeGeometryInput): TreeGeometry {
  const narrow = W < TREE.NARROW
  const gap = narrow ? TREE.GAP_N : TREE.GAP_W
  const { mn, gl, gr, nw } = treeGutters(model)
  const tx = narrow ? 14 + -mn * TREE.GAP_N : Math.round((W + gl - gr) / 2)
  const cardW = narrow ? W - nw : (W - (gl + gr)) / 2 - 8
  const laneX = (id: string) => tx + (model.byId.get(id)?.off ?? 0) * gap
  /** The card edge facing the lanes: a right-hand card's left edge, a left-hand card's right edge. */
  const edge = (side: 'l' | 'r') => (narrow || side === 'r' ? W - cardW : cardW)
  const mid = (i: number) => tops[i]! + heights[i]! / 2

  const nodes: TreeNode[] = []
  const forkAt = new Map<string, number>()
  const endAt = new Map<string, number>()
  let yToday: number | null = null
  let yRoot = TREE.PAD_TOP + 15
  let yEnd = H - TREE.PAD_BOTTOM
  rows.forEach((r, i) => {
    if (r.kind === 'event') {
      nodes.push({
        k: r.e.id,
        i: r.i,
        y: tops[i]! + TREE.ITEM_PAD + TREE.NODE_DY,
        lane: r.lane,
        x: laneX(r.lane),
        x2: edge(r.side),
        up: r.e.is_milestone,
        hi: r.e.significance === 'High',
        note: r.e.user ? (NOTE_TAGS[r.e.user.tag]?.color ?? '#6941c6') : null,
        span: spanOf(r.e).map(laneX),
      })
    } else if (r.kind === 'fork') forkAt.set(r.branch.id, i)
    else if (r.kind === 'end') endAt.set(r.branch.id, i)
    else if (r.kind === 'today') yToday = mid(i)
    else if (r.kind === 'root') yRoot = tops[i]! + 15
    else if (r.kind === 'finish') yEnd = tops[i]! + 14
  })

  const lanes: TreeLane[] = []
  const started = new Map<string, number>()
  const trunk = model.trunk
  lanes.push({ id: trunk.id, label: trunk.label, color: trunk.color, trunk: true, x: laneX(trunk.id), px: null, fy: yRoot, y1: yRoot, y2: yEnd, fx2: laneX(trunk.id), ended: false, tailY: null })
  started.set(trunk.id, yRoot)
  for (const b of model.list) {
    const f = forkAt.get(b.id)
    if (b.id === trunk.id || f === undefined) continue
    const fy = mid(f)
    const parent = b.from && (started.get(b.from) ?? Infinity) < fy ? b.from : trunk.id
    const mine = nodes.filter((n) => n.lane === b.id)
    const last = mine[mine.length - 1]
    const end = endAt.get(b.id)
    let y2: number
    let tailY: number | null = null
    if (end !== undefined) {
      y2 = mid(end)
      tailY = last && last.y > y2 ? last.y : null
    } else {
      const lastY = last ? last.y : fy
      y2 = Math.max(lastY, yToday !== null && !last?.up ? Math.min(yToday, yEnd) : lastY)
    }
    const fork = rows[f] as Extract<TreeRow, { kind: 'fork' }>
    lanes.push({
      id: b.id, label: b.label, color: b.color, trunk: false, x: laneX(b.id), px: laneX(parent), fy, y1: fy, y2,
      fx2: edge(fork.side), ended: end !== undefined, tailY,
    })
    started.set(b.id, fy)
  }
  const xs = lanes.map((l) => l.x)
  return { W, H, tx, gap, narrow, cardW, nodes, lanes, yToday, yEnd, xMin: Math.min(...xs), xMax: Math.max(...xs) }
}

/** The event row nearest the scroll probe (HUD, active card): index into the view's list. */
export function treeActiveAt(nodes: TreeNode[], probeY: number): number {
  if (!nodes.length) return 0
  const [a, b] = neighbours(nodes.map((n) => n.y), probeY)
  const pick = a < 0 ? b : b >= nodes.length ? a : probeY - nodes[a]!.y <= nodes[b]!.y - probeY ? a : b
  return nodes[pick]!.i
}

export interface TreeHover {
  y: number
  lx: number
  lane: string
  color: string
  label: string
  date: string
  prev: JourneyEventV3 | null
  next: JourneyEventV3 | null
}

/**
 * Gutter hover-to-add (README §6.2): the nearest started lane at this height, and a date interpolated between the
 * event nodes above and below (`x`, `y` relative to the flow).
 */
export function treeHoverAt(geo: TreeGeometry, byId: Map<string, JourneyEventV3>, x: number, y: number, today?: string): TreeHover | null {
  const live = geo.lanes.filter((l) => y >= (l.px !== null ? l.fy : l.y1) && y <= (l.tailY ?? l.y2) + 20)
  const pool = live.length ? live : geo.lanes.filter((l) => l.trunk)
  const lane = pool.reduce<(typeof pool)[number] | null>((best, l) => (!best || Math.abs(l.x - x) < Math.abs(best.x - x) ? l : best), null)
  if (!lane) return null
  const [a, b] = neighbours(geo.nodes.map((n) => n.y), y)
  const A = a >= 0 ? (byId.get(geo.nodes[a]!.k) ?? null) : null
  const B = b < geo.nodes.length ? (byId.get(geo.nodes[b]!.k) ?? null) : null
  const date = hoverDate(A && { pos: geo.nodes[a]!.y, date: A.date }, B && { pos: geo.nodes[b]!.y, date: B.date }, y, today)
  return { y, lx: lane.x, lane: lane.id, color: lane.color, label: lane.label, date, prev: A, next: B }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/tree/tree-geometry.test.ts && npx tsc -b && npm run lint`
Expected: PASS (11 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 12: Sheet sections: position strip, branch lineage, trial/patent terms, regulatory path

**Files:**
- Create: `apps/web/src/features/journey/sheet/position-strip.tsx`
- Create: `apps/web/src/features/journey/sheet/branch-lineage.tsx`
- Create: `apps/web/src/features/journey/sheet/record-terms.tsx`
- Create: `apps/web/src/features/journey/sheet/regulatory-path.tsx`
- Test: `apps/web/src/features/journey/sheet/sheet-sections.test.tsx`

**Interfaces:**
- Consumes: `EventDetail`, `EventRecord` (Task 1); `byDate`, `gapLabel`, `laneOf`, `lineage`, `BranchModel` (Task 2); `BranchChip` (Task 5); `SheetSection` (Task 5); `TermBar` (`components/charts/term-bar.tsx`), `useRecords` (`features/assets/api.ts`), `useElementWidth`, `formatDay`, `daysBetween`, `formatPhase`, `formatStatus` — existing.
- Produces: `PositionStrip({ event, pool, onPick(id), today? })` (null below two dated events; "#k of n"; current `[data-current]` r7 + halo; dots `[data-event]`); `BranchLineage({ event, model, stats })` (null without branches); `RecordTerms({ records, color })` (sections "Trial · {acronym|nct}" and "Patent term · {publication}"); `RegulatoryPath({ assetId, records, product? })` (same-application regulatory records, oldest first, this event's `aria-current="step"`; hidden below two steps or without an FDA/EMA record with an application number).

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/sheet/sheet-sections.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EventRecord } from '../api'
import { branchModel } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'
import { BranchLineage } from './branch-lineage'
import { PositionStrip } from './position-strip'
import { RecordTerms } from './record-terms'
import { RegulatoryPath } from './regulatory-path'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ev = (id: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, type: 'approval', category: 'regulatory', title: `T ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: `${id} full`, color: '#0b7a6f', off, status: 'Approved · US', origin: 'ai', ...extra })
const rec = (extra: Partial<EventRecord>): EventRecord => ({ collection: 'fda_records', key: 'k', tab: 'regulatory', title: 't', date: '', url: null, record_type: null, source: null, ...extra })

describe('PositionStrip', () => {
  it('marks the event among the pool, counts its position and opens a dot', async () => {
    const onPick = vi.fn()
    const pool = [ev('a', '2002-05-21'), ev('b', '2017-02-01'), ev('c', '2028-01-01', { is_milestone: true })]
    const { container } = render(<PositionStrip event={pool[1]!} pool={pool} onPick={onPick} today="2026-10-09" />)
    expect(screen.getByText('#2 of 3')).toBeInTheDocument()
    expect(container.querySelector('[data-current]')).toHaveAttribute('r', '7')
    expect(container.innerHTML).not.toMatch(/NaN/)
    await userEvent.click(container.querySelector('[data-event="c"]')!)
    expect(onPick).toHaveBeenCalledWith('c')
  })

  it('adds the event when the pool does not have it and draws nothing for a lone event', () => {
    const { rerender } = render(<PositionStrip event={ev('x', '2010-01-01')} pool={[ev('a', '2002-05-21')]} onPick={() => {}} />)
    expect(screen.getByText('#2 of 2')).toBeInTheDocument()
    rerender(<PositionStrip event={ev('x', '2010-01-01')} pool={[]} onPick={() => {}} />)
    expect(screen.queryByText(/of/)).not.toBeInTheDocument()
  })
})

describe('BranchLineage', () => {
  const model = branchModel([br('PAH', 0, { trunk: true, color: '#2347d9' }), br('PH-ILD', 2, { from: 'PAH', full: 'PH due to interstitial lung disease' })])
  it('chains the branch from the trunk and says where the event sits on it', () => {
    render(
      <BranchLineage
        event={ev('e', '2021-03-31', { branch: 'PH-ILD' })}
        model={model}
        stats={{ index: 5, total: 8, prevSameBranch: { id: 'p', title: 'INCREASE results published in NEJM', date: '2021-01-12' } }}
      />,
    )
    expect(screen.getByText('PAH')).toBeInTheDocument()
    expect(screen.getByText('PH-ILD')).toHaveClass('shadow-[0_0_0_2px_currentColor]')
    expect(screen.getByText(/^PH due to interstitial lung disease · Approved · US\. Event 5 of 8 on this branch, 78 days after “INCREASE results published in NEJM”\.$/)).toBeInTheDocument()
  })

  it('shows nothing for a journey without branches', () => {
    const { container } = render(<BranchLineage event={ev('e', '2021-03-31')} model={branchModel([])} stats={{ index: 1, total: 1, prevSameBranch: null }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('RecordTerms', () => {
  it('draws the trial term with phase and enrolment, and the patent term with its status', () => {
    render(
      <RecordTerms
        color="#0b7a6f"
        records={[
          rec({ collection: 'trial_records', tab: 'clinical', title: 'TETON-2 study', acronym: 'TETON-2', nct_id: 'NCT05255991', start_date: '2022-10-04', primary_completion_date: '2025-06-30', phases: ['PHASE3'], enrollment: 597, overall_status: 'COMPLETED', lead_sponsor: 'United Therapeutics' }),
          rec({ collection: 'patent_records', tab: 'patents', title: 'Prodrugs of treprostinil', publication_number: 'US11793780B2', grant_date: '2023-10-24', expiry_date: '2042-04-22', legal_status: 'Active', assignees: ['Mannkind Corp', 'United Therapeutics Corp'] }),
        ]}
      />,
    )
    const trial = screen.getByRole('region', { name: 'Trial · TETON-2' })
    expect(within(trial).getByText('Phase 3 · n=597')).toBeInTheDocument()
    expect(within(trial).getByText('TETON-2 study · Completed · United Therapeutics')).toBeInTheDocument()
    const patent = screen.getByRole('region', { name: 'Patent term · US11793780B2' })
    expect(within(patent).getByText('Active')).toBeInTheDocument()
    expect(within(patent).getByText('2042-04-22')).toBeInTheDocument()
  })
})

describe('RegulatoryPath', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('lists every record of the application in date order with this event’s highlighted', async () => {
    const fetchMock = vi.fn(async () =>
      json(200, {
        items: [
          { key: 's17', application_number: 'NDA022387', date: '2021-03-31', submission_type: 'SUPPL', submission_number: '17', submission_class: 'Efficacy', submission_status: 'AP' },
          { key: 'orig', application_number: 'NDA022387', date: '2009-07-30', submission_type: 'ORIG', submission_number: '1', submission_status: 'AP' },
          { key: 'other', application_number: 'NDA022387X', date: '2010-01-01' },
        ],
        total: 3, page: 1, pageSize: 100,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RegulatoryPath assetId="trep" product="Tyvaso" records={[rec({ key: 's17', application_number: 'NDA022387' })]} />
      </QueryClientProvider>,
    )
    const path = await screen.findByRole('region', { name: 'Regulatory path · Tyvaso' })
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/records/regulatory?q=NDA022387&pageSize=100', expect.anything())
    const steps = within(path).getAllByRole('listitem')
    expect(steps.map((s) => s.textContent)).toEqual(['Jul 30, 2009OriginalApproved', 'Mar 31, 2021Supplement 17 · EfficacyApproved'])
    expect(steps[1]).toHaveAttribute('aria-current', 'step')
  })

  it('stays away when the event has no regulatory record', () => {
    const { container } = render(<RegulatoryPath assetId="trep" records={[rec({ collection: 'articles', tab: 'news' })]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/sheet/sheet-sections.test.tsx`
Expected: FAIL — `Failed to resolve import "./branch-lineage"` (and the other three).

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/journey/sheet/position-strip.tsx
import { useRef } from 'react'
import { todayIso, yearFraction } from '@/lib/dates'
import { useElementWidth } from '@/lib/use-element-width'
import { CATEGORY_META } from '../constants'
import { byDate } from '../journey-model'
import type { JourneyEventV3 } from '../types'

const PAD = 10
const H = 46
const MID = 20

/**
 * "Position in the journey" (README §6.4): every event of the pool on one line, the current one r7 with a halo;
 * a dot opens that event. The SVG is decorative for assistive tech: the footer's previous / next buttons do the same.
 */
export function PositionStrip({ event, pool, onPick, today = todayIso() }: { event: JourneyEventV3; pool: JourneyEventV3[]; onPick: (id: string) => void; today?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const W = Math.max(useElementWidth(ref), 260)
  const all = (pool.some((e) => e.id === event.id) ? pool : [...pool, event]).filter((e) => Number.isFinite(yearFraction(e.date))).sort(byDate)
  if (all.length < 2) return null
  const fs = all.map((e) => yearFraction(e.date))
  const y0 = Math.min(...fs) - 0.3
  const y1 = Math.max(...fs) + 0.3
  const x = (d: string) => PAD + ((yearFraction(d) - y0) / (y1 - y0)) * (W - PAD * 2)
  const index = all.findIndex((e) => e.id === event.id)
  const colour = (e: JourneyEventV3) => CATEGORY_META[e.category]?.color ?? '#98a2b3'
  const tf = yearFraction(today)
  return (
    <div ref={ref} className="relative">
      <span className="absolute -top-5 right-0 font-mono text-[11px] text-muted-foreground">
        #{index + 1} of {all.length}
      </span>
      <svg width={W} height={H} aria-hidden="true" className="block">
        <line x1={PAD} x2={W - PAD} y1={MID} y2={MID} stroke="#e4e7ec" strokeWidth={2} />
        {tf >= fs[0]! && tf <= y1 && <line x1={x(today)} x2={x(today)} y1={8} y2={32} stroke="#101828" strokeDasharray="2 2" />}
        {all.map((e) =>
          e.id === event.id ? null : (
            <circle
              key={e.id}
              data-event={e.id}
              cx={x(e.date)}
              cy={MID}
              r={e.significance === 'High' ? 4.5 : 3.2}
              fill={e.is_milestone ? '#fff' : colour(e)}
              stroke={colour(e)}
              strokeWidth={1.2}
              opacity={0.55}
              className="cursor-pointer"
              onClick={() => onPick(e.id)}
            >
              <title>{e.title}</title>
            </circle>
          ),
        )}
        <circle data-current cx={x(event.date)} cy={MID} r={7} fill={colour(event)} stroke="#fff" strokeWidth={2.5} />
        <circle cx={x(event.date)} cy={MID} r={11} fill="none" stroke={colour(event)} strokeOpacity={0.35} strokeWidth={2} />
        <text x={PAD} y={44} className="fill-muted-foreground font-mono text-[10.5px]">
          {all[0]!.date.slice(0, 4)}
        </text>
        <text x={W - PAD} y={44} textAnchor="end" className="fill-muted-foreground font-mono text-[10.5px]">
          {all[all.length - 1]!.date.slice(0, 4)}
        </text>
      </svg>
    </div>
  )
}
```

```tsx
// file: apps/web/src/features/journey/sheet/branch-lineage.tsx
import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { daysBetween } from '@/lib/dates'
import type { EventDetail } from '../api'
import { BranchChip } from '../chips'
import { gapLabel, laneOf, lineage, type BranchModel } from '../journey-model'
import type { JourneyEventV3 } from '../types'

/** "PAH › PH-ILD › IPF" and where the event sits on its branch (README §6.4 "Branch"). Nothing without branches. */
export function BranchLineage({ event, model, stats }: { event: JourneyEventV3; model: BranchModel; stats: EventDetail['branchStats'] }) {
  if (!model.multi) return null
  const lane = model.byId.get(laneOf(event, model))!
  const chain = lineage(lane.id, model)
  const prev = stats.prevSameBranch
  const gap = prev ? `, ${gapLabel(Math.abs(daysBetween(prev.date, event.date)))} after “${prev.title}”` : ''
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {chain.map((b, i) => (
          <Fragment key={b.id}>
            {i > 0 && <ChevronRight className="size-3 text-muted-foreground" aria-hidden="true" />}
            <BranchChip branch={b} current={b.id === lane.id} />
          </Fragment>
        ))}
      </div>
      <p className="mt-2 text-[12.5px] leading-normal text-text-secondary">
        {[lane.full, lane.status].filter(Boolean).join(' · ')}.{stats.index > 0 && ` Event ${stats.index} of ${stats.total} on this branch${gap}.`}
      </p>
    </>
  )
}
```

```tsx
// file: apps/web/src/features/journey/sheet/record-terms.tsx
import { TermBar } from '@/components/charts/term-bar'
import { formatPhase, formatStatus } from '@/lib/format'
import type { EventRecord } from '../api'
import { SheetSection } from './sheet-section'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Trial term (start → primary completion) and patent term (grant → expiry) from the event's own records (README §6.4). */
export function RecordTerms({ records, color }: { records: EventRecord[]; color: string }) {
  const trial = records.find((r) => r.collection === 'trial_records')
  const patent = records.find((r) => r.collection === 'patent_records')
  const trialStart = trial ? str(trial.start_date) || str(trial.date) : ''
  const trialEnd = trial ? str(trial.primary_completion_date) || str(trial.completion_date) : ''
  return (
    <>
      {trial && (trialStart || trialEnd) && (
        <SheetSection title={`Trial · ${str(trial.acronym) || str(trial.nct_id) || trial.title}`}>
          <TermBar
            start={trialStart}
            end={trialEnd}
            color={color}
            label={[Array.isArray(trial.phases) && trial.phases.length ? formatPhase(String(trial.phases[0])) : '', trial.enrollment != null ? `n=${trial.enrollment}` : '']
              .filter(Boolean)
              .join(' · ')}
          />
          <p className="mt-2 text-[12.5px] leading-normal text-text-secondary">
            {[trial.title, trial.overall_status ? formatStatus(str(trial.overall_status)) : '', str(trial.lead_sponsor)].filter(Boolean).join(' · ')}
          </p>
        </SheetSection>
      )}
      {patent && (str(patent.grant_date) || str(patent.expiry_date)) && (
        <SheetSection title={`Patent term · ${str(patent.publication_number) || patent.key}`}>
          <TermBar start={str(patent.grant_date)} end={str(patent.expiry_date)} label={str(patent.legal_status) || 'Patent'} color={color} />
          <p className="mt-2 text-[12.5px] leading-normal text-text-secondary">
            {[patent.title, Array.isArray(patent.assignees) ? (patent.assignees as string[]).join(', ') : ''].filter(Boolean).join(' · ')}
          </p>
        </SheetSection>
      )}
    </>
  )
}
```

```tsx
// file: apps/web/src/features/journey/sheet/regulatory-path.tsx
import { useRecords, type SourceRecord } from '@/features/assets/api'
import { formatDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { EventRecord } from '../api'
import { SheetSection } from './sheet-section'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const STATUS: Record<string, string> = { AP: 'Approved', TA: 'Tentative approval' }

function step(r: SourceRecord): string {
  const type = str(r.submission_type)
  const kind = type === 'ORIG' ? 'Original' : type === 'SUPPL' ? `Supplement ${str(r.submission_number) || String(r.submission_number ?? '')}`.trim() : str(r.record_type).replace(/_/g, ' ')
  return [kind, str(r.submission_class)].filter(Boolean).join(' · ')
}

function statusTone(s: string) {
  if (/approv|authoris|positive/i.test(s)) return 'bg-success-soft text-success'
  if (/review|expected|ongoing|pending/i.test(s)) return 'bg-primary-soft text-primary'
  if (/complete response|refus|withdraw/i.test(s)) return 'bg-danger-soft text-destructive'
  return 'bg-muted text-secondary-foreground'
}

/**
 * Every regulatory record of the same application (NDA / BLA), oldest first, this event's highlighted (README §6.4
 * "Regulatory path"). Reads the Regulatory tab's records filtered by application number; hidden below two steps.
 */
export function RegulatoryPath({ assetId, records, product }: { assetId: string; records: EventRecord[]; product?: string | null }) {
  const anchor = records.find((r) => (r.collection === 'fda_records' || r.collection === 'ema_records') && str(r.application_number))
  if (!anchor) return null
  return <PathFor assetId={assetId} application={str(anchor.application_number)} current={anchor.key} product={product} />
}

function PathFor({ assetId, application, current, product }: { assetId: string; application: string; current: string; product?: string | null }) {
  const records = useRecords(assetId, 'regulatory', { q: application, pageSize: 100 })
  const steps = (records.data?.items ?? []).filter((r) => r.application_number === application).sort((a, b) => str(a.date).localeCompare(str(b.date)))
  if (steps.length < 2) return null
  return (
    <SheetSection title={`Regulatory path · ${product || application}`}>
      <ol className="ml-1.5 border-l-2 border-hair">
        {steps.map((r) => {
          const status = STATUS[str(r.submission_status)] ?? str(r.submission_status)
          const here = r.key === current
          return (
            <li
              key={r.key}
              aria-current={here ? 'step' : undefined}
              className={cn(
                'relative flex items-center gap-2.5 py-1.5 pl-3.5 text-[12.5px] text-secondary-foreground',
                "before:absolute before:top-1/2 before:-left-[6px] before:-mt-[5px] before:size-2.5 before:rounded-full before:border-2 before:border-[#d0d5dd] before:bg-card before:content-['']",
                here && 'font-semibold text-foreground before:border-primary before:bg-primary',
              )}
            >
              <span className="min-w-[86px] font-mono text-[11.5px] font-normal text-muted-foreground">{formatDay(str(r.date))}</span>
              <span className="min-w-0 flex-1">{step(r)}</span>
              {status && <span className={cn('rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap', statusTone(status))}>{status}</span>}
            </li>
          )
        })}
      </ol>
    </SheetSection>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/sheet/sheet-sections.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (7 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 13: Sheet sections: evidence and comments

**Files:**
- Create: `apps/web/src/features/journey/sheet/evidence.tsx`
- Create: `apps/web/src/features/journey/sheet/comments.tsx`
- Test: `apps/web/src/features/journey/sheet/evidence-comments.test.tsx`

**Interfaces:**
- Consumes: `EventRecord` (Task 1); `howBuilt` (Task 2); `useAnnotations`, `useAddComment`, `annotationsKey` (Task 3); `SheetSection` (Task 5); `MiniDonut` (`components/charts/mini-donut.tsx`), `collectionMeta`, `Button`, `formatDay` — existing.
- Produces: `Evidence({ event, records, onOpenRecord({ tab, key }) })` — donut by collection (`role="img"` "{n} records"), source rows ("Open {title}" button for tab records, link for pages), "how it was built" line; `Comments({ assetId, eventId })` — list (initials, name, date, text) + textarea "Add a comment" (Enter sends, Shift+Enter breaks, IME-safe, max 2,000) + "Comment".

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/sheet/evidence-comments.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { annotationsKey } from '../annotations-api'
import type { EventRecord } from '../api'
import type { JourneyEventV3 } from '../types'
import { Comments } from './comments'
import { Evidence } from './evidence'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const EVENT: JourneyEventV3 = { id: 'e1', asset: 'trep', date: '2021-03-31', type: 'approval', category: 'regulatory', title: 'Tyvaso approved', significance: 'High', is_milestone: false, sources: [], via: 'ai_events' }
const rec = (extra: Partial<EventRecord>): EventRecord => ({ collection: 'fda_records', key: 'k', tab: 'regulatory', title: 't', date: '', url: null, record_type: null, source: null, ...extra })

describe('Evidence', () => {
  it('charts the records by collection, opens tab records in the record sheet and pages in a new tab', async () => {
    const onOpen = vi.fn()
    render(
      <Evidence
        event={EVENT}
        onOpenRecord={onOpen}
        records={[rec({ key: 'a', title: 'FDA letter', date: '2021-03-31' }), rec({ collection: 'web_records', key: 'w', tab: null, title: 'Web page', url: 'https://example.com/w' })]}
      />,
    )
    expect(screen.getByRole('img', { name: '2 records' })).toBeInTheDocument()
    expect(screen.getByText('FDA · Mar 31, 2021')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open FDA letter' }))
    expect(onOpen).toHaveBeenCalledWith({ tab: 'regulatory', key: 'a' })
    expect(screen.getByRole('link', { name: 'Open Web page' })).toHaveAttribute('href', 'https://example.com/w')
    expect(screen.getByText('Extracted and consolidated by AI from 2 records.')).toBeInTheDocument()
  })

  it('explains a hand-made note without records', () => {
    const user = { tag: 'Risk' as const, by: { id: 'u1', name: 'Ana Analyst' }, created_at: '2026-10-01T10:00:00Z', mode: 'manual' as const }
    render(<Evidence event={{ ...EVENT, via: 'user', user }} records={[]} onOpenRecord={() => {}} />)
    expect(screen.getByText('Added manually by Ana Analyst; no source records yet. It will be re-checked on the next refresh.')).toBeInTheDocument()
  })
})

describe('Comments', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('lists the team’s comments and sends a new one with Enter (Shift+Enter breaks the line)', async () => {
    const fetchMock = vi.fn(async () => json(201, { id: 'c2', by: { id: 'u1', name: 'Ana Analyst' }, at: '2026-10-09T10:00:00.000Z', text: 'Line one\nline two' }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(annotationsKey('trep'), {
      stars: [], notes: [], comments: { e1: [{ id: 'c1', by: { id: 'u2', name: 'Bo Chen' }, at: '2026-10-08T09:00:00.000Z', text: 'Watch the label' }] },
    })
    render(
      <QueryClientProvider client={client}>
        <Comments assetId="trep" eventId="e1" />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('region', { name: 'Comments' })).toHaveTextContent('Comments · 1')
    expect(screen.getByText('BC')).toBeInTheDocument()
    expect(screen.getByText('· Oct 8, 2026', { exact: false })).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: 'Add a comment' })
    await userEvent.type(box, 'Line one{Shift>}{Enter}{/Shift}line two{Enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/events/e1/comments', expect.objectContaining({ body: '{"text":"Line one\\nline two"}' })))
    expect(box).toHaveValue('')
    expect(await screen.findByText(/Line one/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/sheet/evidence-comments.test.tsx`
Expected: FAIL — `Failed to resolve import "./comments"` and `"./evidence"`.

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/journey/sheet/evidence.tsx
import { ArrowUpRight } from 'lucide-react'
import { MiniDonut } from '@/components/charts/mini-donut'
import { Button } from '@/components/ui/button'
import type { RecordTab } from '@/features/assets/api'
import { formatDay } from '@/lib/dates'
import type { EventRecord } from '../api'
import { collectionMeta } from '../constants'
import { howBuilt } from '../journey-model'
import type { JourneyEventV3 } from '../types'
import { SheetSection } from './sheet-section'

const NOTE = 'mt-2 text-[12.5px] leading-normal text-text-secondary'

/** Evidence donut by collection + source list ("Open" → record sheet or the page) + how the event was built (README §6.4). */
export function Evidence({ event, records, onOpenRecord }: { event: JourneyEventV3; records: EventRecord[]; onOpenRecord: (r: { tab: RecordTab; key: string }) => void }) {
  const byColl = new Map<string, number>()
  for (const r of records) byColl.set(r.collection, (byColl.get(r.collection) ?? 0) + 1)
  const slices = [...byColl].map(([c, v]) => ({ l: collectionMeta(c).label, v, c: collectionMeta(c).color }))
  return (
    <SheetSection title="Evidence">
      {records.length ? (
        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
          <MiniDonut data={slices} />
          <ul className="divide-y divide-hair overflow-hidden rounded-xl border">
            {records.map((r) => {
              const meta = collectionMeta(r.collection)
              return (
                <li key={`${r.collection}|${r.key}`} className="flex items-center gap-2.5 px-3 py-2.5">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium">{r.title}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {meta.label}
                      {r.date && ` · ${formatDay(r.date)}`}
                    </p>
                  </div>
                  {r.tab ? (
                    <Button variant="ghost" size="sm" aria-label={`Open ${r.title}`} onClick={() => onOpenRecord({ tab: r.tab as RecordTab, key: r.key })}>
                      Open
                    </Button>
                  ) : (
                    r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Open ${r.title}`} className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                        Open <ArrowUpRight className="size-3" />
                      </a>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className={NOTE}>
          {event.via === 'user'
            ? `Added manually by ${event.user?.by.name ?? 'a team member'}; no source records yet. It will be re-checked on the next refresh.`
            : 'No source records could be found for this event.'}
        </p>
      )}
      <p className={NOTE}>{howBuilt(event, records.length)}</p>
    </SheetSection>
  )
}
```

```tsx
// file: apps/web/src/features/journey/sheet/comments.tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatDay } from '@/lib/dates'
import { useAddComment, useAnnotations } from '../annotations-api'
import { SheetSection } from './sheet-section'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

/** Team comments on an event; Enter sends, Shift+Enter breaks the line (README §6.4, §9). */
export function Comments({ assetId, eventId }: { assetId: string; eventId: string }) {
  const comments = useAnnotations(assetId).data?.comments[eventId] ?? []
  const add = useAddComment(assetId)
  const [text, setText] = useState('')
  const send = () => {
    const t = text.trim()
    if (!t) return
    add.mutate({ eventId, text: t })
    setText('')
  }
  return (
    <SheetSection title="Comments" extra={comments.length > 0 && <span className="font-mono tracking-normal normal-case"> · {comments.length}</span>}>
      <ul>
        {comments.map((c) => (
          <li key={c.id} className="flex gap-2.5 border-b border-hair py-2">
            <span aria-hidden="true" className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary">
              {initials(c.by.name)}
            </span>
            <div className="min-w-0">
              <b className="font-semibold">{c.by.name}</b>
              <span className="text-muted-foreground"> · {formatDay(c.at.slice(0, 10))}</span>
              <p className="mt-0.5 whitespace-pre-wrap text-secondary-foreground">{c.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-end gap-2">
        <textarea
          rows={2}
          maxLength={2000}
          value={text}
          aria-label="Add a comment"
          placeholder="Add a comment for your team…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          className="min-h-[52px] flex-1 resize-y rounded-lg border px-2.5 py-2 outline-none focus:border-primary focus:shadow-focus"
        />
        <Button size="sm" disabled={!text.trim()} onClick={send}>
          Comment
        </Button>
      </div>
    </SheetSection>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/sheet/evidence-comments.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (3 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 14: Journey header: actions, branch cards and filter chips

**Files:**
- Create: `apps/web/src/features/journey/journey-header.tsx`
- Modify: `apps/web/src/features/assets/components/segmented.tsx` (Replace: optional option icons)
- Test: `apps/web/src/features/journey/journey-header.test.tsx`

**Interfaces:**
- Consumes: `JourneyScope` (Task 1); `laneOf`, `BranchModel`, `JourneyView`, `Mine` (Task 2); `CATEGORIES`, `CATEGORY_META`; `Button`; lucide `Activity`, `Columns2`, `Rows2`, `Plus`, `Star`, `Flag`.
- Produces: `interface JourneyHeaderProps { model; list; undated; counts; view; scope; cats; mine; focusBranch; onView; onScope; onToggleCat; onMine; onFocusBranch; onClear; onAdd }`; `JourneyHeader(props)` — `<section aria-label="Journey">`; "How this journey was built" links to `?build=1` (Phase 3's live build); branch cards are `aria-pressed` buttons (disabled without events); chips in `role="group" aria-label="Filter the journey"`. `Segmented` options accept `icon?: LucideIcon` (existing callers unchanged).

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/journey-header.test.tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { JourneyHeader, type JourneyHeaderProps } from './journey-header'
import { branchModel, journeyCounts } from './journey-model'
import type { Branch, JourneyEventV3 } from './types'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: `${id} full`, color: '#0b7a6f', off, status: 'Approved · US', origin: 'ai', ...extra })
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'approval', category: 'regulatory', title: id, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const MODEL = branchModel([br('PAH', 0, { trunk: true }), br('PH-ILD', 1, { from: 'PAH' }), br('PH-COPD', -1, { from: 'PAH', ended: 'Terminated', status: 'Closed · PERFECT terminated' }), br('SSc', 2, { from: 'PAH' })])
const LIST = [ev('a', '2002-05-21', 'PAH'), ev('b', '2017-02-01', 'PH-ILD', { category: 'clinical' }), ev('c', '2018-05-08', 'PH-COPD', { via: 'user' }), ev('d', '2028-01-01', 'PH-ILD')]

function setup(over: Partial<JourneyHeaderProps> = {}) {
  const props: JourneyHeaderProps = {
    model: MODEL, list: LIST, undated: 0, counts: journeyCounts(LIST, ['a']), view: 'h', scope: 'key', cats: [], mine: null, focusBranch: null,
    onView: vi.fn(), onScope: vi.fn(), onToggleCat: vi.fn(), onMine: vi.fn(), onFocusBranch: vi.fn(), onClear: vi.fn(), onAdd: vi.fn(), ...over,
  }
  const router = createMemoryRouter([{ path: '*', element: <JourneyHeader {...props} /> }], { initialEntries: ['/assets/trep/overview'] })
  render(<RouterProvider router={router} />)
  return { props, router }
}

describe('JourneyHeader', () => {
  it('summarises the journey and links to how it was built', () => {
    const { router } = setup({ undated: 2 })
    expect(screen.getByText(/^4 events, 2002–2028 · 3 indication branches\. Each new indication forks off/)).toHaveTextContent('2 undated events are not placed on the timeline.')
    expect(screen.getByRole('link', { name: 'How this journey was built' })).toHaveAttribute('href', '/assets/trep/overview?build=1')
    expect(router.state.location.pathname).toBe('/assets/trep/overview')
  })

  it('shows a card per branch with its parent, count, status and first year; empty branches are disabled', async () => {
    const { props } = setup()
    const copd = screen.getByRole('button', { name: /PH-COPD/ })
    expect(copd).toHaveTextContent('PH-COPDfrom PAH1PH-COPD fullClosed · PERFECT terminated · since 2018')
    expect(within(copd).getByText(/Closed/)).toHaveClass('text-warning')
    expect(screen.getByRole('button', { name: /^PAH/ })).toHaveTextContent('Trunk')
    expect(screen.getByRole('button', { name: /SSc/ })).toBeDisabled()
    await userEvent.click(copd)
    expect(props.onFocusBranch).toHaveBeenCalledWith('PH-COPD')
  })

  it('switches orientation and scope, filters by category / starred / team notes, and clears', async () => {
    const { props } = setup({ cats: ['clinical'] })
    await userEvent.click(screen.getByRole('button', { name: 'Tree' }))
    expect(props.onView).toHaveBeenCalledWith('v')
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(props.onScope).toHaveBeenCalledWith('all')
    const filters = within(screen.getByRole('group', { name: 'Filter the journey' }))
    expect(filters.getByRole('button', { name: /Clinical/ })).toHaveAttribute('aria-pressed', 'true')
    expect(filters.getByRole('button', { name: /Regulatory/ })).toHaveTextContent('Regulatory3')
    await userEvent.click(filters.getByRole('button', { name: /Patents/ }))
    expect(props.onToggleCat).toHaveBeenCalledWith('ip')
    expect(filters.getByRole('button', { name: /Starred/ })).toHaveTextContent('Starred1')
    await userEvent.click(filters.getByRole('button', { name: /Team notes/ }))
    expect(props.onMine).toHaveBeenCalledWith('notes')
    await userEvent.click(filters.getByRole('button', { name: 'Clear' }))
    expect(props.onClear).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Add to timeline' }))
    expect(props.onAdd).toHaveBeenCalled()
  })

  it('has no branch cards or branch count on a single-trunk journey', () => {
    setup({ model: branchModel([]) })
    expect(screen.getByText(/^4 events, 2002–2028\. Open a card’s subtree/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Trunk/ })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/journey-header.test.tsx`
Expected: FAIL — `Failed to resolve import "./journey-header"`.

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/journey/journey-header.tsx
import { Activity, Columns2, Flag, Plus, Rows2, Star } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/features/assets/components/segmented'
import { cn } from '@/lib/utils'
import type { JourneyScope } from './api'
import { CATEGORIES, CATEGORY_META } from './constants'
import { laneOf, type BranchModel, type JourneyView, type Mine } from './journey-model'
import type { EventCategory, JourneyEventV3 } from './types'

const CHIP = 'inline-flex h-7 items-center gap-1.5 rounded-lg border bg-card px-2.5 font-medium text-text-secondary hover:bg-accent'
const CHIP_ON = 'border-primary bg-primary-soft text-primary hover:bg-primary-soft'

export interface JourneyHeaderProps {
  model: BranchModel
  /** The events the view shows (after filters). */
  list: JourneyEventV3[]
  undated: number
  counts: { cats: Record<EventCategory, number>; starred: number; notes: number }
  view: JourneyView
  scope: JourneyScope
  cats: EventCategory[]
  mine: Mine | null
  focusBranch: string | null
  onView: (v: JourneyView) => void
  onScope: (s: JourneyScope) => void
  onToggleCat: (c: EventCategory) => void
  onMine: (m: Mine | null) => void
  onFocusBranch: (id: string | null) => void
  onClear: () => void
  onAdd: () => void
}

/** Journey header card (README §6.2 "Header", SCREENS 7): title, counts, actions, branch cards and filter chips. */
export function JourneyHeader(p: JourneyHeaderProps) {
  const { model, list } = p
  const span = list.length ? `${list[0]!.date.slice(0, 4)}–${list[list.length - 1]!.date.slice(0, 4)}` : ''
  const perLane = new Map<string, JourneyEventV3[]>()
  for (const e of list) perLane.set(laneOf(e, model), [...(perLane.get(laneOf(e, model)) ?? []), e])
  const laneCount = model.list.filter((b) => perLane.has(b.id)).length
  return (
    <section aria-label="Journey" className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-[14px] border bg-card px-5 py-[18px] shadow-panel">
      <div className="min-w-0 flex-[1_1_360px]">
        <h3 className="text-[15px] leading-5 font-semibold">Journey</h3>
        <p className="mt-0.5 text-text-secondary">
          {list.length} event{list.length === 1 ? '' : 's'}
          {span && `, ${span}`}
          {model.multi && ` · ${laneCount} indication branch${laneCount === 1 ? '' : 'es'}`}.{' '}
          {model.multi ? 'Each new indication forks off the programme that led to it; select a branch to focus it.' : 'Open a card’s subtree for its evidence and linked events.'}
          {p.undated > 0 && ` ${p.undated} undated event${p.undated === 1 ? ' is' : 's are'} not placed on the timeline.`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="h-8">
          <Link to="?build=1">
            <Activity /> How this journey was built
          </Link>
        </Button>
        <Segmented
          label="Orientation"
          value={p.view}
          onChange={p.onView}
          options={[
            { value: 'v', label: 'Tree', icon: Rows2 },
            { value: 'h', label: 'Horizontal', icon: Columns2 },
          ]}
        />
        <Segmented label="Events shown" value={p.scope} onChange={p.onScope} options={[{ value: 'key', label: 'Key events' }, { value: 'all', label: 'All' }]} />
        <Button size="sm" className="h-8" onClick={p.onAdd}>
          <Plus /> Add to timeline
        </Button>
      </div>
      {model.multi && (
        <div className="grid basis-full grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
          {model.list.map((b) => {
            const mine = perLane.get(b.id) ?? []
            const on = p.focusBranch === b.id
            const parent = b.from ? model.byId.get(b.from)?.label : undefined
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={on}
                disabled={!mine.length}
                onClick={() => p.onFocusBranch(on ? null : b.id)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-xl border bg-card px-3 py-2.5 text-left transition-[border-color,box-shadow,opacity] hover:border-[var(--lc)]',
                  on && 'border-[var(--lc)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--lc)_16%,transparent)]',
                  p.focusBranch && !on && 'opacity-50',
                  !mine.length && 'cursor-default opacity-40 hover:border-border',
                )}
                style={{ '--lc': b.color } as CSSProperties}
              >
                <span className="flex items-center gap-1.5">
                  <i aria-hidden="true" className="size-2 rounded-full" style={{ background: b.color }} />
                  <b className="font-[650]" style={{ color: b.color }}>
                    {b.label}
                  </b>
                  <span className="text-[11px] text-muted-foreground">{b.trunk ? 'Trunk' : parent ? `from ${parent}` : ''}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">{mine.length}</span>
                </span>
                <span className="text-[12px] text-secondary-foreground">{b.full}</span>
                <span className={cn('text-[11.5px] text-muted-foreground', b.ended && 'text-warning')}>
                  {b.status}
                  {mine[0] && ` · since ${mine[0].date.slice(0, 4)}`}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div role="group" aria-label="Filter the journey" className="flex basis-full flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" aria-pressed={p.cats.includes(c)} onClick={() => p.onToggleCat(c)} className={cn(CHIP, p.cats.includes(c) && CHIP_ON)}>
            <i aria-hidden="true" className="size-[7px] rounded-full" style={{ background: CATEGORY_META[c].color }} />
            {CATEGORY_META[c].label}
            <span className="font-mono text-[11px] text-muted-foreground">{p.counts.cats[c]}</span>
          </button>
        ))}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
        <button type="button" aria-pressed={p.mine === 'starred'} onClick={() => p.onMine(p.mine === 'starred' ? null : 'starred')} className={cn(CHIP, p.mine === 'starred' && CHIP_ON)}>
          <Star className="size-3" aria-hidden="true" />
          Starred
          <span className="font-mono text-[11px] text-muted-foreground">{p.counts.starred}</span>
        </button>
        <button type="button" aria-pressed={p.mine === 'notes'} onClick={() => p.onMine(p.mine === 'notes' ? null : 'notes')} className={cn(CHIP, p.mine === 'notes' && CHIP_ON)}>
          <Flag className="size-3" aria-hidden="true" />
          Team notes
          <span className="font-mono text-[11px] text-muted-foreground">{p.counts.notes}</span>
        </button>
        {(p.cats.length > 0 || p.focusBranch || p.mine) && (
          <button type="button" onClick={p.onClear} className="font-medium text-primary hover:underline">
            Clear
          </button>
        )}
      </div>
    </section>
  )
}
```

**Replace** the file:

```tsx
// file: apps/web/src/features/assets/components/segmented.tsx
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Two-to-four way toggle (the redesign's "Landscape / Timeline" switch); options may carry an icon. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; icon?: LucideIcon }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-[10px] bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-7 items-center gap-[5px] rounded-lg px-3 font-medium text-text-secondary transition-colors',
            o.value === value && 'bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)]',
          )}
        >
          {o.icon && <o.icon className="size-[13px]" aria-hidden="true" />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/journey-header.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (4 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 15: Tree card with subtree

**Files:**
- Create: `apps/web/src/features/journey/tree/tree-card.tsx`
- Test: `apps/web/src/features/journey/tree/tree-card.test.tsx`

**Interfaces:**
- Consumes: `useJourneyEvents` (Task 1, lazily for linked events outside the view); `subtree`, `subtreeSize`, `viaLabel`, `SubtreeNode` (Task 2); `BranchChip`, `CountdownChip`, `DetailsGrid`, `Targets`, `eventDate` (Task 5); `CategoryIcon`, `SignificanceBadge`, `CATEGORY_META`, `NOTE_TAGS` — existing.
- Produces: `interface TreeCardProps { assetId; e; lane: Branch | null; open; onToggle; starred; nComments; onStar; onOpen; onJump(id); resolve(id); className? }`; `TreeCard(props)` — meta, title button (→ `onOpen`), summary, Targets, details, "Why it matters", footer (via label, star `aria-pressed` "Mark as important", "Comments (n)", "Subtree n"/"Hide subtree" `aria-expanded`, "Details →"), subtree `<ul aria-label="Subtree">` with elbow connectors; linked-event rows call `onJump`.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/tree/tree-card.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { Branch, JourneyEventV3 } from '../types'
import { TreeCard, type TreeCardProps } from './tree-card'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const IPF: Branch = { id: 'IPF', label: 'IPF', full: 'Idiopathic pulmonary fibrosis', color: '#6941c6', off: 3, status: 'Phase 3', origin: 'ai' }
const LINKED: JourneyEventV3 = { id: 'rule:fda:x/1', asset: 'trep', date: '2025-09-30', type: 'regulatory_submission', category: 'regulatory', title: 'FDA accepts Tyvaso sNDA for IPF', significance: 'High', is_milestone: false, sources: [], via: 'journey' }
const NONKEY: JourneyEventV3 = { ...LINKED, id: 'rule:trial_completion:ctgov:NCT04708782', title: 'TETON-1 completed', date: '2025-01-01' }
const E: JourneyEventV3 = {
  id: 'rule:trial_start:ctgov:NCT04708782', asset: 'trep', date: '2021-06-01', type: 'trial_start', category: 'clinical', title: 'Phase 3 trial started: TETON-1',
  summary: 'Inhaled treprostinil in IPF.', significance: 'High', is_milestone: false, via: 'journey', branch: 'IPF',
  sources: [{ collection: 'trial_records', record_key: 'ctgov:NCT04708782' }],
  indications: ['IPF'], product: 'Tyvaso', details: { Trial: 'NCT04708782', Phase: 'Phase 3', Enrollment: '~600 (target)', 'Primary endpoint': 'Change in FVC at week 52', Status: 'Active' },
  impact: 'Moves treprostinil from vascular to fibrotic lung disease.', links: [LINKED.id, NONKEY.id],
}

function Harness(over: Partial<TreeCardProps>) {
  const [open, setOpen] = useState(false)
  return (
    <TreeCard
      assetId="trep" e={E} lane={IPF} open={open} onToggle={() => setOpen(!open)} starred={false} nComments={2}
      onStar={vi.fn()} onOpen={vi.fn()} onJump={vi.fn()} resolve={(id) => (id === LINKED.id ? LINKED : undefined)} {...over}
    />
  )
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => json(200, { events: [E, LINKED, NONKEY], total: 3 }))))
afterEach(() => vi.unstubAllGlobals())
const renderCard = (over: Partial<TreeCardProps> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness {...over} />
    </QueryClientProvider>,
  )

describe('TreeCard', () => {
  it('shows category, branch, date, significance, targets, details, why it matters and how it was built', () => {
    renderCard()
    expect(screen.getByText('Clinical')).toBeInTheDocument()
    expect(screen.getByText('trial start')).toBeInTheDocument()
    expect(screen.getAllByText('IPF')).toHaveLength(2)
    expect(screen.getByText('Jun 1, 2021')).toBeInTheDocument()
    expect(screen.getByText('Tyvaso')).toBeInTheDocument()
    expect(screen.getByText('Change in FVC at week 52')).toBeInTheDocument()
    expect(screen.getByText('Moves treprostinil from vascular to fibrotic lung disease.')).toBeInTheDocument()
    expect(screen.getByText('Rule · trial_records')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Comments (2)' })).toHaveTextContent('2')
  })

  it('stars, opens details from the title, comments and Details', async () => {
    const onStar = vi.fn()
    const onOpen = vi.fn()
    renderCard({ onStar, onOpen, starred: true })
    await userEvent.click(screen.getByRole('button', { name: 'Mark as important' }))
    expect(onStar).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Mark as important' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Phase 3 trial started: TETON-1' }))
    await userEvent.click(screen.getByRole('button', { name: /Details/ }))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('opens the subtree with the record, its facts, the indications and every linked event, and jumps to one', async () => {
    const onJump = vi.fn()
    renderCard({ onJump })
    await userEvent.click(screen.getByRole('button', { name: /Subtree/ }))
    const tree = screen.getByRole('list', { name: 'Subtree' })
    expect(within(tree).getByText('ctgov:NCT04708782')).toBeInTheDocument()
    expect(within(tree).getByText('Primary endpoint')).toBeInTheDocument()
    expect(within(tree).getByText('Indications')).toBeInTheDocument()
    // The non-key linked event is looked up in "All" once the subtree opens.
    expect(await within(tree).findByText('TETON-1 completed')).toBeInTheDocument()
    await userEvent.click(within(tree).getByRole('button', { name: /FDA accepts Tyvaso sNDA for IPF/ }))
    expect(onJump).toHaveBeenCalledWith(LINKED.id)
    expect(screen.getByRole('button', { name: /Hide subtree/ })).toHaveAttribute('aria-expanded', 'true')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/tree/tree-card.test.tsx`
Expected: FAIL — `Failed to resolve import "./tree-card"`.

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/journey/tree/tree-card.tsx
import { ArrowRight, ChevronRight, Flag, List, MessageCircle, Sparkles, Star } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { cn } from '@/lib/utils'
import { useJourneyEvents } from '../api'
import { BranchChip, CountdownChip, DetailsGrid, Targets } from '../chips'
import { eventDate } from '../format'
import { CATEGORY_META, NOTE_TAGS } from '../constants'
import { subtree, subtreeSize, viaLabel, type SubtreeNode } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'

export interface TreeCardProps {
  assetId: string
  e: JourneyEventV3
  /** Branch chip; null on a single-trunk journey. */
  lane: Branch | null
  open: boolean
  onToggle: () => void
  starred: boolean
  nComments: number
  onStar: () => void
  /** Open the event sheet. */
  onOpen: () => void
  /** Jump to a linked event (scroll, flash, open). */
  onJump: (id: string) => void
  /** Events of the current view by id. */
  resolve: (id: string) => JourneyEventV3 | undefined
  className?: string
}

const TITLE = { High: 'text-[21px]', Medium: 'text-[18px]', Low: 'mt-2 text-[14.5px] font-semibold' } as const
const PAD = { High: 'px-6 py-[22px]', Medium: 'px-5 py-[18px]', Low: 'px-4 py-3' } as const

/** Tree event card (README §6.2 "Card", SCREENS 10). */
export function TreeCard({ assetId, e, lane, open, onToggle, starred, nComments, onStar, onOpen, onJump, resolve, className }: TreeCardProps) {
  const meta = CATEGORY_META[e.category] ?? CATEGORY_META.regulatory
  const nodes = subtree(e, resolve)
  const tag = e.user ? (NOTE_TAGS[e.user.tag]?.color ?? '#6941c6') : null
  const low = e.significance === 'Low'
  return (
    <div
      className={cn(
        'rounded-2xl border bg-card shadow-panel transition-[box-shadow,border-color] duration-300',
        PAD[e.significance],
        e.is_milestone && 'border-dashed bg-[#fcfcfd]',
        tag && 'border-solid border-[var(--tc)] bg-[linear-gradient(color-mix(in_srgb,var(--tc)_5%,#fff),#fff_70px)]',
        starred && 'shadow-[inset_0_0_0_2px_#fdb022,0_1px_2px_rgba(16,24,40,0.04)]',
        className,
      )}
      style={tag ? ({ '--tc': tag } as CSSProperties) : undefined}
    >
      {e.user && (
        <div className="-mt-1 mb-2.5 flex items-center gap-1.5 text-[12px]" style={{ color: tag! }}>
          <Flag className="size-3" aria-hidden="true" />
          <b className="font-semibold">{e.user.tag}</b>
          <span className="text-muted-foreground">
            {e.user.mode === 'ai' ? 'Found by Asset AI from' : 'Added by'} {e.user.by.name}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <CategoryIcon category={e.category} />
        <span className="flex flex-col leading-tight">
          <b className="text-[12.5px]" style={{ color: meta.color }}>
            {meta.label}
          </b>
          <span className="text-[11.5px] text-muted-foreground capitalize">{e.type.replace(/_/g, ' ')}</span>
        </span>
        {lane?.label && <BranchChip branch={lane} />}
        <span className="flex-1" />
        <span className="font-mono text-[12px] text-text-secondary">{eventDate(e)}</span>
        {e.is_milestone && <CountdownChip date={e.date} />}
        <SignificanceBadge value={e.significance} />
      </div>
      <h3 className={cn('mt-3 leading-tight font-[650] tracking-[-0.015em] text-balance', TITLE[e.significance])}>
        <button type="button" onClick={onOpen} className="text-left text-balance hover:text-primary">
          {e.title}
        </button>
      </h3>
      {e.summary && <p className="mt-1.5 leading-[1.55] text-pretty text-text-secondary">{e.summary}</p>}
      <div className="mt-3 empty:hidden">
        <Targets e={e} />
      </div>
      {!low && <DetailsGrid details={e.details} className="mt-3" />}
      {!low && e.impact && (
        <p className="mt-2.5 leading-normal text-secondary-foreground">
          <b className="font-semibold text-foreground">Why it matters · </b>
          {e.impact}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hair pt-2.5">
        <span className={cn('inline-flex items-center gap-1 text-[11.5px] whitespace-nowrap text-muted-foreground', e.via === 'ai_events' && 'text-violet')}>
          {e.via === 'ai_events' && <Sparkles className="size-[11px]" aria-hidden="true" />}
          {viaLabel(e)}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={starred}
          aria-label="Mark as important"
          title="Mark as important"
          onClick={onStar}
          className={cn('inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground', starred && 'text-star-stroke')}
        >
          <Star className={cn('size-3.5', starred && 'fill-star')} />
        </button>
        <button type="button" aria-label={`Comments (${nComments})`} title="Comments" onClick={onOpen} className="inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-lg px-1.5 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
          <MessageCircle className="size-3.5" />
          {nComments > 0 && <span className="font-mono">{nComments}</span>}
        </button>
        {nodes.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className={cn('inline-flex h-7 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[12.5px] font-medium text-secondary-foreground hover:bg-accent', open && 'border-primary bg-primary-soft text-primary hover:bg-primary-soft')}
          >
            <List className="size-[13px]" aria-hidden="true" />
            {open ? 'Hide subtree' : 'Subtree'}
            <span className="font-mono text-[11px] text-muted-foreground">{subtreeSize(nodes)}</span>
          </button>
        )}
        <button type="button" onClick={onOpen} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#c7d1f4] bg-card px-2.5 text-[12.5px] font-medium text-primary hover:bg-primary-soft">
          Details <ArrowRight className="size-3" />
        </button>
      </div>
      {open && <Subtree assetId={assetId} e={e} resolve={resolve} onJump={onJump} />}
    </div>
  )
}

/** Opened subtree; linked events the current view doesn't hold are looked up in "All" (loaded only when needed). */
function Subtree({ assetId, e, resolve, onJump }: { assetId: string; e: JourneyEventV3; resolve: (id: string) => JourneyEventV3 | undefined; onJump: (id: string) => void }) {
  const missing = (e.links ?? []).some((id) => !resolve(id))
  const all = useJourneyEvents(assetId, 'all', { enabled: missing }).data?.events
  const allById = new Map((all ?? []).map((x) => [x.id, x]))
  const nodes = subtree(e, (id) => resolve(id) ?? allById.get(id))
  return (
    <ul aria-label="Subtree" className="mt-3 animate-fade-up rounded-xl border border-hair bg-background py-2 pr-2 pl-1">
      {nodes.map((n, i) => (
        <SubtreeItem key={i} node={n} depth={0} onJump={onJump} />
      ))}
    </ul>
  )
}

const ELBOW =
  "relative pl-4 before:absolute before:top-0 before:left-0 before:h-[15px] before:w-3 before:rounded-bl-[7px] before:border-b-[1.5px] before:border-l-[1.5px] before:border-[#d0d5dd] before:content-[''] [&:not(:last-child)]:after:absolute [&:not(:last-child)]:after:top-[15px] [&:not(:last-child)]:after:bottom-0 [&:not(:last-child)]:after:left-0 [&:not(:last-child)]:after:border-l-[1.5px] [&:not(:last-child)]:after:border-[#d0d5dd] [&:not(:last-child)]:after:content-['']"

function SubtreeItem({ node, depth, onJump }: { node: SubtreeNode; depth: number; onJump: (id: string) => void }) {
  const [open, setOpen] = useState(depth < 1)
  const kids = node.children?.length ? node.children : null
  return (
    <li className={cn('animate-fade-up', depth > 0 && ELBOW)}>
      <button
        type="button"
        aria-expanded={kids ? open : undefined}
        onClick={() => (kids ? setOpen(!open) : node.eventId && onJump(node.eventId))}
        className={cn('group flex w-full min-w-0 items-center gap-[7px] rounded-md px-1.5 py-1 text-left text-[12.5px] text-secondary-foreground hover:bg-card', !kids && !node.eventId && 'cursor-default')}
      >
        {kids ? (
          <span className="flex size-4 shrink-0 items-center justify-center rounded border bg-card text-text-secondary">
            <ChevronRight className={cn('size-[11px] transition-transform', open && 'rotate-90')} aria-hidden="true" />
          </span>
        ) : (
          <span aria-hidden="true" className="mx-1 size-[7px] shrink-0 rounded-full bg-faint" style={node.color ? { background: node.color } : undefined} />
        )}
        <span className={cn('min-w-0 truncate text-foreground', node.mono && 'font-mono text-[11.5px]', node.eventId && 'group-hover:text-primary')}>{node.label}</span>
        {node.sub && <span className="text-[11.5px] whitespace-nowrap text-muted-foreground">{node.sub}</span>}
        {kids && <span className="ml-auto rounded border border-hair bg-card px-1 font-mono text-[10.5px] text-muted-foreground">{kids.length}</span>}
        {node.eventId && <ArrowRight className="ml-auto size-3 shrink-0 text-primary" aria-hidden="true" />}
      </button>
      {kids && open && (
        <ul className="ml-3.5">
          {kids.map((c, i) => (
            <SubtreeItem key={i} node={c} depth={depth + 1} onJump={onJump} />
          ))}
        </ul>
      )}
    </li>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/tree/tree-card.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (3 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 16: Event detail sheet replaces the Phase 2 stub

**Files:**
- Create: `apps/web/src/features/journey/event-detail-sheet.tsx`
- Modify: `apps/web/src/features/journey/event-sheet-host.tsx` (Replace)
- Delete: `apps/web/src/features/journey/event-sheet-stub.tsx`
- Modify: `apps/web/src/features/journey/event-sheet-host.test.tsx` (Replace)

**Interfaces:**
- Consumes: `useEvent`, `useBranches`, `useJourneyEvents`, `EventDetail` (Task 1); `useEventSheet` (`openEvent`, `requestLocate`, `journeyAsset`), `eventSheetFocus` (Task 1 / Phase 2); `branchModel`, `chronological`, `laneOf` (Task 2); `useAnnotations`, `useToggleStar` (Task 3); chips, `eventDate`, `SheetSection` (Task 5); `PositionStrip`, `BranchLineage`, `RecordTerms`, `RegulatoryPath` (Task 12); `Evidence`, `Comments` (Task 13); `RecordSheet`, `CategoryIcon`, `SignificanceBadge`, shadcn `Sheet` — existing.
- Produces: `EventDetailSheet({ current: OpenEvent | null; onClose })` — 560px sheet named by the event title ("Loading…" while pending, "Event unavailable" on error); keeps the last event during the exit animation; header (category, branch chip, note tag, star, Close); body in README §6.4 order; footer prev/next from `neighbors`; ←/→ on the sheet (ignored with modifiers or inside fields); Esc inside a field leaves the field. "Locate on timeline" when `journeyAsset === assetId` (→ `requestLocate` + close), else "Show on the journey timeline" (→ close + `/assets/:id/overview?focus=<encoded id>`). Navigation (prev/next, strip dots, linked events) = `openEvent` (+ `requestLocate` when the journey is on screen). A record opened from one event closes when another event is shown. `EventSheetHost()` renders it.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/event-sheet-host.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { EventDetail } from './api'
import { EventSheetHost } from './event-sheet-host'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const EVENT_ID = 'ai:trep:https://example.com/a/b:0'
const ENCODED = encodeURIComponent(EVENT_ID)

const DETAIL: EventDetail = {
  event: {
    id: EVENT_ID,
    asset: 'trep',
    date: '2021-03-31',
    type: 'approval',
    category: 'regulatory',
    title: 'Tyvaso approved for PH-ILD',
    summary: 'FDA approved inhaled treprostinil for pulmonary hypertension with interstitial lung disease.',
    significance: 'High',
    is_milestone: false,
    sources: [],
    via: 'ai_events',
    branch: 'PH-ILD',
    impact: 'First approved therapy for PH-ILD.',
  },
  records: [
    { collection: 'company_records', key: 'pr:1', tab: 'company-ir', title: 'UT announces FDA approval', date: '2021-03-31', url: 'https://ut.example/pr', record_type: 'press_release', source: null },
    { collection: 'web_records', key: 'w1', tab: null, title: 'Web page', date: '', url: 'https://example.com/w1', record_type: null, source: null },
  ],
  neighbors: { prev: null, next: { id: 'next:1', title: 'TETON-1 started', date: '2021-06-01' } },
  branchStats: { index: 1, total: 1, prevSameBranch: null },
}
const NEXT: EventDetail = {
  ...DETAIL,
  event: { ...DETAIL.event, id: 'next:1', title: 'TETON-1 started', date: '2021-06-01' },
  records: [],
  neighbors: { prev: { id: EVENT_ID, title: DETAIL.event.title, date: DETAIL.event.date }, next: null },
}

function renderHost() {
  const router = createMemoryRouter([{ path: '*', element: <EventSheetHost /> }], { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

function serve(detail: EventDetail | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === `/api/assets/trep/events/${ENCODED}`) return detail ? json(200, detail) : json(404, { code: 'EVENT_NOT_FOUND', message: 'Event not found' })
      if (url === '/api/assets/trep/events/next%3A1') return json(200, NEXT)
      if (url === '/api/assets/trep/branches') return json(200, [{ id: 'PAH', label: 'PAH', full: 'Pulmonary arterial hypertension', color: '#2347d9', off: 0, trunk: true, status: 'Approved · US', origin: 'ai' }, { id: 'PH-ILD', label: 'PH-ILD', full: 'PH due to ILD', color: '#0b7a6f', off: 1, from: 'PAH', status: 'Approved · US', origin: 'ai' }])
      if (url === '/api/assets/trep/annotations') return json(200, { stars: [], comments: {}, notes: [] })
      if (url === '/api/assets/trep/record/company-ir?key=pr%3A1') return json(200, { key: 'pr:1', title: 'UT announces FDA approval of Tyvaso', date: '2021-03-31' })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
}

beforeEach(() => useEventSheet.setState({ current: null, journeyAsset: null, locate: null }))
afterEach(() => vi.unstubAllGlobals())

describe('EventSheetHost', () => {
  it('opens from the store with the event, why it matters and its evidence', async () => {
    serve(DETAIL)
    renderHost()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))

    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    expect(within(sheet).getByText('Mar 31, 2021')).toBeInTheDocument()
    expect((await within(sheet).findAllByText('PH-ILD')).length).toBeGreaterThan(0)
    expect(within(sheet).getByText('First approved therapy for PH-ILD.')).toBeInTheDocument()
    expect(within(sheet).getByRole('img', { name: '2 records' })).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Open Web page' })).toHaveAttribute('href', 'https://example.com/w1')

    await userEvent.click(within(sheet).getByRole('button', { name: 'Open UT announces FDA approval' }))
    expect(await screen.findByText('UT announces FDA approval of Tyvaso')).toBeInTheDocument()
  })

  it('shows the event on the journey timeline with the encoded id and closes', async () => {
    serve(DETAIL)
    const router = renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    await userEvent.click(await screen.findByRole('button', { name: 'Show on the journey timeline' }))
    expect(router.state.location.pathname).toBe('/assets/trep/overview')
    expect(router.state.location.search).toBe(`?focus=${ENCODED}`)
    expect(new URLSearchParams(router.state.location.search).get('focus')).toBe(EVENT_ID)
    expect(useEventSheet.getState().current).toBeNull()
  })

  it('reads "Expected" for a milestone and closes with Escape', async () => {
    serve({ ...DETAIL, event: { ...DETAIL.event, is_milestone: true, date: '2099-01-15' } })
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    expect(within(sheet).getByText('Expected Jan 15, 2099')).toBeInTheDocument()
    expect(within(sheet).getByText(/^in \d+\.\d years$/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useEventSheet.getState().current).toBeNull()
  })

  it('says so when the event cannot be loaded', async () => {
    serve(null)
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    expect(await screen.findByText("This event couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Event unavailable' })).toBeInTheDocument()
  })

  it('moves to the next event with → and back with ←, but not while typing a comment', async () => {
    serve(DETAIL)
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    const box = screen.getByRole('textbox', { name: 'Add a comment' })
    await userEvent.type(box, 'draft{ArrowRight}')
    expect(useEventSheet.getState().current?.eventId).toBe(EVENT_ID)
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })).toBeInTheDocument()
    expect(box).not.toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'next:1' })
    await screen.findByRole('dialog', { name: 'TETON-1 started' })
    await userEvent.keyboard('{ArrowLeft}')
    expect(useEventSheet.getState().current?.eventId).toBe(EVENT_ID)
  })

  it('locates the event in place when its journey is on screen, scrolling the journey on prev/next too', async () => {
    serve(DETAIL)
    renderHost()
    useEventSheet.setState({ journeyAsset: 'trep' })
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    await userEvent.click(within(sheet).getByRole('button', { name: /TETON-1 started/ }))
    expect(useEventSheet.getState().locate).toMatchObject({ assetId: 'trep', eventId: 'next:1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Locate on timeline' }))
    expect(useEventSheet.getState()).toMatchObject({ current: null, locate: { eventId: 'next:1', seq: 2 } })
  })

  it('closes a record opened from one event when another event is shown', async () => {
    serve(DETAIL)
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Open UT announces FDA approval' }))
    expect(await screen.findByText('UT announces FDA approval of Tyvaso')).toBeInTheDocument()
    act(() => useEventSheet.getState().openEvent('trep', 'next:1'))
    await screen.findByRole('dialog', { name: 'TETON-1 started' })
    expect(screen.queryByText('UT announces FDA approval of Tyvaso')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/event-sheet-host.test.tsx`
Expected: FAIL — the new cases fail against the stub: `Unable to find role="dialog" and name "Event unavailable"`, `expected { assetId: 'trep', eventId: 'ai:trep:…' } to deeply equal { assetId: 'trep', eventId: 'next:1' }`, `Unable to find role="button" and name /TETON-1 started/`; the changed copy fails (`Unable to find role="img" and name "2 records"`).

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/journey/event-detail-sheet.tsx
import { ArrowRight, ChevronLeft, ChevronRight, Loader2, Route, Star, X } from 'lucide-react'
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import type { RecordTab } from '@/features/assets/api'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { RecordSheet } from '@/features/assets/components/record-sheet'
import { formatPhase } from '@/lib/format'
import { cn } from '@/lib/utils'
import { eventSheetFocus, useEventSheet, type OpenEvent } from '@/stores/event-sheet-store'
import { useAnnotations, useToggleStar } from './annotations-api'
import { useBranches, useEvent, useJourneyEvents } from './api'
import { BranchChip, CountdownChip, DetailsGrid, NoteTagChip, Targets } from './chips'
import { eventDate } from './format'
import { CATEGORY_META } from './constants'
import { branchModel, chronological, laneOf } from './journey-model'
import { BranchLineage } from './sheet/branch-lineage'
import { Comments } from './sheet/comments'
import { Evidence } from './sheet/evidence'
import { PositionStrip } from './sheet/position-strip'
import { RecordTerms } from './sheet/record-terms'
import { RegulatoryPath } from './sheet/regulatory-path'
import { SheetSection } from './sheet/sheet-section'

/** Keys typed into a field never navigate or close the sheet (README §6.4 "ignored inside inputs"). */
const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

const enc = encodeURIComponent

/**
 * The comprehensive event sheet (README §6.4), opened from any surface through the event-sheet store. Prev/next follow
 * the API's neighbours (key events for a key event); on the asset's own Overview they also scroll the journey.
 */
export function EventDetailSheet({ current, onClose }: { current: OpenEvent | null; onClose: () => void }) {
  // Keep the last event while the sheet animates out, so it never flashes "Loading…".
  const [shown, setShown] = useState<OpenEvent | null>(current)
  if (current && (current.assetId !== shown?.assetId || current.eventId !== shown?.eventId)) setShown(current)
  const [record, setRecord] = useState<{ eventId: string; tab: RecordTab; key: string } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const open = current !== null
  const assetId = shown?.assetId ?? ''
  const eventId = shown?.eventId ?? null
  const detail = useEvent(assetId, eventId)
  const event = detail.data?.event
  const title = event?.title ?? (detail.isError ? 'Event unavailable' : 'Loading…')

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || isTypingTarget(e.target)) return
    const n = detail.data?.neighbors
    const target = e.key === 'ArrowLeft' ? n?.prev : e.key === 'ArrowRight' ? n?.next : null
    if (target) {
      e.preventDefault()
      go(assetId, target.id)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent
          ref={contentRef}
          showCloseButton={false}
          onCloseAutoFocus={eventSheetFocus.onCloseAutoFocus}
          onEscapeKeyDown={(e) => {
            // Esc in the comment box leaves the box (keeping the draft); the next Esc closes the sheet.
            if (isTypingTarget(document.activeElement)) {
              e.preventDefault()
              contentRef.current?.focus()
            }
          }}
          onKeyDown={onKeyDown}
          className="gap-0 shadow-sheet data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-hair px-[18px] py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2 font-semibold">
              {event && (
                <>
                  <CategoryIcon category={event.category} />
                  <span>{CATEGORY_META[event.category]?.label ?? event.category}</span>
                  <HeaderBranch assetId={assetId} branch={event.branch} />
                  {event.user && <NoteTagChip tag={event.user.tag} />}
                </>
              )}
            </div>
            <div className="flex shrink-0 gap-0.5">
              {event && <StarButton assetId={assetId} eventId={event.id} />}
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
                <X />
              </Button>
            </div>
          </div>
          <div key={eventId ?? ''} className="flex-1 animate-fade-up overflow-y-auto px-[18px] pt-[18px] pb-6">
            {event && <p className="mb-1 font-mono text-[11.5px] text-muted-foreground capitalize">{event.type.replace(/_/g, ' ')}</p>}
            <SheetTitle className="text-[20px] leading-[1.3] font-semibold tracking-[-0.015em] text-pretty">{title}</SheetTitle>
            <SheetDescription asChild>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-text-secondary">
                {event && (
                  <>
                    <span className="font-mono">{eventDate(event, { day: true })}</span>
                    {event.is_milestone && <CountdownChip date={event.date} />}
                    {[event.region, event.phase ? formatPhase(event.phase) : null, event.nct_id].filter(Boolean).map((t) => (
                      <span key={t} className="rounded-[5px] bg-muted px-1.5 font-mono text-[11px] text-secondary-foreground">
                        {t}
                      </span>
                    ))}
                    <SignificanceBadge value={event.significance} />
                  </>
                )}
              </div>
            </SheetDescription>
            {open && detail.isPending && (
              <div className="flex justify-center py-10 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )}
            {detail.isError && <p className="mt-4 text-destructive">This event couldn't be loaded.</p>}
            {detail.data && event && (
              <Body assetId={assetId} detail={detail.data} onClose={onClose} onOpenRecord={(r) => setRecord({ eventId: event.id, ...r })} />
            )}
          </div>
          {detail.data && (
            <div className="flex gap-2 border-t border-hair px-[18px] py-3">
              {(['prev', 'next'] as const).map((k) => {
                const n = detail.data.neighbors[k]
                return (
                  <Button key={k} variant="outline" size="sm" disabled={!n} onClick={() => n && go(assetId, n.id)} className="h-8 min-w-0 flex-1 justify-center">
                    {k === 'prev' && <ChevronLeft />}
                    <span className="truncate">{n ? n.title : k === 'prev' ? 'Previous' : 'Next'}</span>
                    {k === 'next' && <ChevronRight />}
                  </Button>
                )
              })}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <RecordSheet
        assetId={assetId}
        tab={record?.tab ?? 'clinical'}
        recordKey={open && record && record.eventId === eventId ? record.key : null}
        onClose={() => setRecord(null)}
      />
    </>
  )
}

/** Open another event; when the asset's journey is on screen it scrolls there too (README §6.4 prev/next). */
function go(assetId: string, id: string) {
  const s = useEventSheet.getState()
  s.openEvent(assetId, id)
  if (s.journeyAsset === assetId) s.requestLocate(assetId, id)
}

function HeaderBranch({ assetId, branch }: { assetId: string; branch?: string }) {
  const model = branchModel(useBranches(assetId).data)
  if (!model.multi) return null
  return <BranchChip branch={model.byId.get(laneOf({ branch }, model))!} />
}

function StarButton({ assetId, eventId }: { assetId: string; eventId: string }) {
  const starred = useAnnotations(assetId).data?.stars.includes(eventId) ?? false
  const toggle = useToggleStar(assetId)
  return (
    <Button variant="ghost" size="icon-sm" aria-pressed={starred} aria-label="Mark as important" onClick={() => toggle.mutate({ eventId, on: !starred })}>
      <Star className={cn(starred && 'fill-star text-star-stroke')} />
    </Button>
  )
}

function Body({ assetId, detail, onClose, onOpenRecord }: { assetId: string; detail: NonNullable<ReturnType<typeof useEvent>['data']>; onClose: () => void; onOpenRecord: (r: { tab: RecordTab; key: string }) => void }) {
  const navigate = useNavigate()
  const { event, records, branchStats } = detail
  const model = branchModel(useBranches(assetId).data)
  const journeyAsset = useEventSheet((s) => s.journeyAsset)
  const pool = useJourneyEvents(assetId, event.key || event.via === 'user' ? 'key' : 'all').data?.events
  const byId = new Map((pool ?? []).map((e) => [e.id, e]))
  const missing = (event.links ?? []).some((id) => !byId.has(id))
  const all = useJourneyEvents(assetId, 'all', { enabled: missing && !!pool }).data?.events ?? []
  for (const e of all) if (!byId.has(e.id)) byId.set(e.id, e)
  const linked = (event.links ?? []).map((id) => byId.get(id)).filter((e) => !!e)
  const color = CATEGORY_META[event.category]?.color ?? '#2347d9'
  const inPlace = journeyAsset === assetId

  const locate = () => {
    if (inPlace) {
      useEventSheet.getState().requestLocate(assetId, event.id)
      onClose()
    } else {
      onClose()
      navigate(`/assets/${enc(assetId)}/overview?focus=${enc(event.id)}`)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={locate} className="mt-3 h-8 border-[#c7d1f4] text-primary hover:bg-primary-soft hover:text-primary">
        <Route /> {inPlace ? 'Locate on timeline' : 'Show on the journey timeline'} <ArrowRight />
      </Button>
      {event.summary && <p className="mt-3.5 leading-[1.55] text-secondary-foreground">{event.summary}</p>}
      {pool && pool.length > 1 && (
        <SheetSection title="Position in the journey">
          <PositionStrip event={event} pool={chronological(pool)} onPick={(id) => go(assetId, id)} />
        </SheetSection>
      )}
      {model.multi && (
        <SheetSection title="Branch">
          <BranchLineage event={event} model={model} stats={branchStats} />
        </SheetSection>
      )}
      {((event.indications?.length ?? 0) > 0 || event.product) && (
        <SheetSection title="Targets">
          <Targets e={event} label={false} />
        </SheetSection>
      )}
      <RecordTerms records={records} color={color} />
      <RegulatoryPath assetId={assetId} records={records} product={event.product} />
      {event.details && Object.keys(event.details).length > 0 && (
        <SheetSection title="Details">
          <DetailsGrid details={event.details} />
        </SheetSection>
      )}
      {event.impact && (
        <p className="mt-3 leading-normal text-secondary-foreground">
          <b className="font-semibold text-foreground">Why it matters · </b>
          {event.impact}
        </p>
      )}
      <Evidence event={event} records={records} onOpenRecord={onOpenRecord} />
      {linked.length > 0 && (
        <SheetSection title="Linked events">
          <ul>
            {linked.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => go(assetId, l.id)} className="flex w-full items-center gap-2 border-b border-hair px-0.5 py-2 text-left text-secondary-foreground hover:text-primary">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: CATEGORY_META[l.category]?.color }} />
                  <span className="min-w-0 flex-1 truncate">{l.title}</span>
                  <span className="font-mono text-[11.5px] text-muted-foreground">{l.date.slice(0, 7)}</span>
                  <ArrowRight className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        </SheetSection>
      )}
      <Comments assetId={assetId} eventId={event.id} />
    </>
  )
}
```

**Replace** the file:

```tsx
// file: apps/web/src/features/journey/event-sheet-host.tsx
import { useEventSheet } from '@/stores/event-sheet-store'
import { EventDetailSheet } from './event-detail-sheet'

/**
 * The app's one event sheet (spec §5 "Event sheet host"), mounted in AppLayout. Any surface opens it with
 * `useEventSheet.getState().openEvent(assetId, eventId)`.
 */
export function EventSheetHost() {
  const current = useEventSheet((s) => s.current)
  const close = useEventSheet((s) => s.closeEvent)
  return <EventDetailSheet current={current} onClose={close} />
}
```

Delete `apps/web/src/features/journey/event-sheet-stub.tsx` (`git rm`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/event-sheet-host.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (7 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 17: Horizontal track (default view)

**Files:**
- Create: `apps/web/src/features/journey/horizontal-track.tsx`
- Test: `apps/web/src/features/journey/horizontal-track.test.tsx`

**Interfaces:**
- Consumes: `HZ`, `trackLayout`, `trackWindow`, `trackActive`, `trackSeen`, `trackOffsetFor`, `trackHoverAt`, `TrackHover`, `JourneyViewProps` (Task 10); `laneOf`, `spanOf`, scroll helpers (Task 2); `BranchChip`, `NoteTagChip`, `Targets`, `eventDate` (Task 5); `CategoryIcon`, `SignificanceBadge`, `NOTE_TAGS`, `useMediaQuery`, `todayIso`, `formatDay` — existing.
- Produces: `HorizontalTrack(props: JourneyViewProps)` — `data-testid="journey-horizontal"`; outer block `maxP + vh` tall with a sticky pin; track and parallax layer moved through refs in a rAF scroll handler; renders only `trackWindow` cards/nodes; pinned labels `[data-row]`; lanes `[data-lane]` with `[data-cap]`/`[data-tail]`; cards `button[data-card]` with roving `tabIndex` (←/→/Home/End); hover pill `role="status"`; click → `onAdd({ date, branch, prev, next })`; `ref.jump(id)` scrolls (centres the card) and flashes it.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/horizontal-track.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { todayIso } from '@/lib/dates'
import { HorizontalTrack } from './horizontal-track'
import { branchModel, laneOf } from './journey-model'
import { trackLayout } from './track-layout'
import type { Branch, JourneyEventV3 } from './types'
import type { JourneyViewHandle, JourneyViewProps } from './view-types'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: id, color: '#0e7490', off, status: 'Approved · EU', origin: 'ai', ...extra })
const MODEL = branchModel([br('PAH', 0, { trunk: true, color: '#2347d9', status: 'Approved · US' }), br('CTEPH', -1, { from: 'PAH' }), br('PH-COPD', -5, { from: 'PAH', ended: 'Terminated', color: '#b54708' }), br('PPF', 4, { from: 'PAH', status: 'Phase 3 recruiting' })])
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const LIST = [
  ev('a', '2002-05-21', 'PAH'), ev('b', '2004-11-23', 'PAH'), ev('c', '2018-05-08', 'PH-COPD'), ev('d', '2020-04-03', 'CTEPH'),
  ev('e', '2022-01-10', 'PAH'), ev('f', '2023-05-22', 'PAH'), ev('g', '2024-06-06', 'PH-COPD'), ev('ai:trep:https://x.org/a/b:0', '2027-04-30', 'PAH', { is_milestone: true }),
]
const CLOSURES = { 'PH-COPD': { id: 'stop', date: '2022-11-29', title: 'PERFECT terminated' } }

function renderTrack(over: Partial<JourneyViewProps> = {}) {
  const ref = createRef<JourneyViewHandle>()
  const props: JourneyViewProps = { assetId: 'trep', list: LIST, model: MODEL, closures: CLOSURES, stars: ['a'], comments: { a: [{}, {}] }, focusBranch: null, onOpen: vi.fn(), onAdd: vi.fn(), onActive: vi.fn(), ...over }
  const view = render(<HorizontalTrack ref={ref} {...props} />)
  // jsdom: no layout, so the track measures a 1000px pin in a 768px window.
  const L = trackLayout({ list: props.list, branches: MODEL.list, laneOf: (e) => laneOf(e, MODEL), vw: 1000, vh: window.innerHeight, closures: CLOSURES, today: todayIso() })
  return { ...view, props, ref, L }
}

describe('HorizontalTrack', () => {
  it('pins a label per branch row, caps the closed branch and draws Today', () => {
    const { container } = renderTrack()
    expect(container.querySelector('[data-row="PH-COPD"]')).toHaveTextContent('PH-COPD')
    expect(container.querySelector('[data-row="PAH"]')).toHaveTextContent('trunk')
    expect(container.querySelector('[data-row="PPF"]')).toHaveTextContent('no events')
    expect(container.querySelector('[data-lane="PH-COPD"] [data-cap]')).toBeInTheDocument()
    expect(container.querySelector('[data-lane="PH-COPD"] [data-tail]')).toBeInTheDocument()
    expect(container.querySelector('[data-lane="PAH"] [data-cap]')).not.toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/NaN/)
  })

  it('shows date, branch and the add hint on hover, and hands the same date and branch to the composer on click', () => {
    const { container, props, L } = renderTrack()
    const svg = container.querySelector('svg')!
    const x = (L.xs[3]! + L.xs[4]!) / 2
    fireEvent.mouseMove(svg, { clientX: x, clientY: L.rowY('CTEPH') })
    const pill = screen.getByRole('status')
    expect(pill).toHaveTextContent(/^[A-Z][a-z]{2} \d{1,2}, 202[01]· CTEPHClick to add a note$/)
    fireEvent.click(svg, { clientX: x, clientY: L.rowY('CTEPH') })
    expect(props.onAdd).toHaveBeenCalledWith(expect.objectContaining({ branch: 'CTEPH', prev: 'Event d', next: 'Event e' }))
    const { date } = (props.onAdd as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(date > '2020-04-03' && date < '2022-01-10').toBe(true)
    fireEvent.mouseLeave(svg)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens a card, marks stars and comments, and keeps one tab stop that ←/→ move', async () => {
    const { container, props } = renderTrack()
    const first = container.querySelector<HTMLButtonElement>('[data-card="a"]')!
    expect(first).toHaveAttribute('tabindex', '0')
    expect(first.querySelector('[aria-label="Starred"]')).toBeInTheDocument()
    expect(first).toHaveTextContent('2')
    expect(container.querySelector('[data-card="b"]')).toHaveAttribute('tabindex', '-1')
    await userEvent.click(first)
    expect(props.onOpen).toHaveBeenCalledWith('a')
    first.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(container.querySelector('[data-card="b"]')).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(first).toHaveFocus()
  })

  it('renders only the cards near the viewport for a 1,270-event journey', () => {
    const many = Array.from({ length: 1270 }, (_, i) => ev(`e${i}`, `${1990 + Math.floor(i / 40)}-${String((i % 12) + 1).padStart(2, '0')}-10`, 'PAH'))
    const { container } = renderTrack({ list: many })
    const n = container.querySelectorAll('[data-card]').length
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(13)
  })

  it('jumps to an event (id with ":" and "/") and flashes it; unknown ids report false', () => {
    const { container, ref } = renderTrack()
    let ok = false
    act(() => {
      ok = ref.current!.jump('ai:trep:https://x.org/a/b:0')
    })
    expect(ok).toBe(true)
    expect(container.querySelector('[data-card="ai:trep:https://x.org/a/b:0"]')).toHaveClass('animate-journey-flash')
    expect(ref.current!.jump('nope')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/horizontal-track.test.tsx`
Expected: FAIL — `Failed to resolve import "./horizontal-track"`.

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/journey/horizontal-track.tsx
import { ChevronLeft, ChevronRight, MessageCircle, Plus, Star } from 'lucide-react'
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { formatDay, todayIso } from '@/lib/dates'
import { findScroller, offsetIn, onScroll, scrollToTop, viewportHeight, viewportTop } from '@/lib/scroll'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { BranchChip, NoteTagChip, Targets } from './chips'
import { eventDate } from './format'
import { NOTE_TAGS } from './constants'
import { laneOf, spanOf } from './journey-model'
import { HZ, trackActive, trackHoverAt, trackLayout, trackOffsetFor, trackSeen, trackWindow, type TrackHover } from './track-layout'
import type { JourneyEventV3 } from './types'
import type { JourneyViewProps } from './view-types'

interface Win {
  first: number
  last: number
  active: number
  seen: number
  p: number
}

/**
 * Horizontal journey (README §6.3, the default view): a sticky pin inside a block `maxP + vh` tall; scrolling down
 * moves the track left by `p`. Only cards near the viewport are rendered, so 1,000+ event journeys stay smooth.
 */
export function HorizontalTrack({ list, model, closures, stars, comments, focusBranch, onOpen, onAdd, onActive, ref }: JourneyViewProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const pinRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const cards = useRef(new Map<number, HTMLButtonElement>())
  const pendingFocus = useRef<number | null>(null)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [size, setSize] = useState({ vw: 1000, vh: 700 })
  const [flash, setFlash] = useState<string | null>(null)
  const [hov, setHov] = useState<TrackHover | null>(null)
  const n = list.length
  const [win, setWin] = useState<Win>(() => ({ first: 0, last: Math.min(n - 1, 12), active: 0, seen: -1, p: 0 }))
  const { vw, vh } = size
  const L = useMemo(
    () => trackLayout({ list, branches: model.list, laneOf: (e) => laneOf(e, model), vw, vh, closures, today: todayIso() }),
    [list, model, vw, vh, closures],
  )
  const starred = useMemo(() => new Set(stars), [stars])

  useLayoutEffect(() => {
    const pin = pinRef.current
    if (!pin) return
    const sc = findScroller(pin)
    const measure = () => setSize((s) => {
      const next = { vw: pin.clientWidth || 1000, vh: viewportHeight(sc) || 700 }
      return next.vw === s.vw && next.vh === s.vh ? s : next
    })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(pin)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const outer = outerRef.current
    if (!outer) return
    const sc = findScroller(outer)
    let raf = 0
    const update = () => {
      const p = Math.min(L.maxP, Math.max(0, viewportTop(sc) - outer.getBoundingClientRect().top))
      if (trackRef.current) trackRef.current.style.transform = `translateX(${-p}px)`
      if (bgRef.current) bgRef.current.style.transform = `translateX(${-p * 0.55}px)`
      const [first, last] = trackWindow(p, vw, n)
      const active = trackActive(p, vw, n)
      const seen = trackSeen(p, vw, n)
      setWin((w) => (w.first === first && w.last === last && w.active === active && seen <= w.seen ? w : { first, last, active, seen: Math.max(w.seen, seen), p }))
    }
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    const off = onScroll(sc, on)
    on()
    return () => {
      off()
      cancelAnimationFrame(raf)
    }
  }, [L.maxP, vw, n])

  useEffect(() => onActive(win.active), [win.active, onActive])

  useEffect(() => {
    const i = pendingFocus.current
    if (i === null) return
    const el = cards.current.get(i)
    if (el) {
      el.focus({ preventScroll: true })
      pendingFocus.current = null
    }
  }, [win])

  const goTo = (i: number) => {
    const outer = outerRef.current
    if (!outer || i < 0 || i >= n) return
    const sc = findScroller(outer)
    scrollToTop(sc, offsetIn(sc, outer) + trackOffsetFor(L, i, vw), !reduced)
  }

  useImperativeHandle(ref, () => ({
    jump(id) {
      const i = list.findIndex((e) => e.id === id)
      if (i < 0) return false
      goTo(i)
      setFlash(id)
      window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800)
      return true
    },
  }))

  const move = (i: number) => {
    const j = Math.min(n - 1, Math.max(0, i))
    pendingFocus.current = j
    goTo(j)
    const el = cards.current.get(j)
    if (el) {
      el.focus({ preventScroll: true })
      pendingFocus.current = null
    }
  }

  const hoverAt = (ev: ReactMouseEvent<SVGSVGElement>) => {
    // The SVG moves with the track, so pointer − SVG left is already a track x (README §6.3 "Bug to avoid").
    const r = ev.currentTarget.getBoundingClientRect()
    return trackHoverAt(L, list, ev.clientX - r.left, ev.clientY - r.top)
  }

  const lane = (e: JourneyEventV3) => model.byId.get(laneOf(e, model))!
  const dim = (id: string) => focusBranch !== null && focusBranch !== id
  const nR = L.rows.length
  const shown = n ? list.slice(win.first, win.last + 1).map((e, k) => ({ e, i: win.first + k })) : []

  return (
    <div ref={outerRef} data-testid="journey-horizontal" className="relative -mx-6 mt-5 max-[900px]:-mx-3.5" style={{ height: L.maxP + vh }}>
      <div ref={pinRef} className="sticky top-0 overflow-hidden bg-[radial-gradient(ellipse_80%_70%_at_50%_50%,#f3f5fd,rgba(249,250,251,0)_70%)]" style={{ height: vh }}>
        {!reduced && (
          <div ref={bgRef} aria-hidden="true" className="pointer-events-none absolute top-0 left-0 h-full will-change-transform">
            {L.bgYears.map((y) => (
              <span
                key={y.y}
                className="absolute -translate-y-1/2 text-[200px] leading-none font-bold tracking-[-0.06em] text-transparent select-none [-webkit-text-stroke:1.5px_rgba(35,71,217,0.10)]"
                style={{ left: y.bx + vw * 0.3, top: L.bandTop - 70 }}
              >
                {y.y}
              </span>
            ))}
          </div>
        )}
        <div ref={trackRef} className="absolute top-0 left-0 h-full will-change-transform" style={{ width: L.TW }}>
          <svg
            aria-hidden="true"
            width={L.TW}
            height={vh}
            className="absolute top-0 left-0 overflow-visible"
            onMouseMove={(ev) => setHov(hoverAt(ev))}
            onMouseLeave={() => setHov(null)}
            onClick={(ev) => {
              const q = hoverAt(ev)
              if (q) onAdd({ date: q.date, branch: q.lane, prev: q.prev?.title ?? null, next: q.next?.title ?? null })
            }}
          >
            <rect x={0} y={L.bandTop - 6} width={L.TW} height={nR * HZ.ROW + 12} fill="transparent" className="cursor-copy" />
            {L.years.map((y) => (
              <g key={y.y}>
                <line x1={y.x - HZ.COL / 2 + 6} x2={y.x - HZ.COL / 2 + 6} y1={L.top0 + 6} y2={L.bandBot + 8} stroke="#e4e7ec" strokeDasharray="2 4" />
                <text x={y.x - HZ.COL / 2 + 12} y={L.top0 + 20} className="fill-text-secondary font-mono text-[12px] font-semibold">
                  {y.y}
                </text>
              </g>
            ))}
            <line x1={L.todayX} x2={L.todayX} y1={L.bandTop - 16} y2={L.bandBot + 16} stroke="#101828" strokeDasharray="3 3" />
            <text x={L.todayX} y={L.bandTop - 22} textAnchor="middle" className="fill-foreground text-[10.5px] font-semibold">
              Today
            </text>
            {L.lanes.map((l) => (
              <g key={l.id} data-lane={l.id} className={cn('transition-opacity duration-300', dim(l.id) && 'opacity-[0.18]')}>
                {l.py !== null && <path d={`M${l.x1 - 64},${l.py} C${l.x1 - 30},${l.py} ${l.x1 - 34},${l.y} ${l.x1},${l.y}`} stroke={l.color} strokeWidth={3} strokeLinecap="round" fill="none" />}
                <line x1={l.x1} x2={Math.min(l.x2, L.todayX)} y1={l.y} y2={l.y} stroke={l.color} strokeWidth={l.trunk ? 4 : 3} strokeLinecap="round" />
                {!l.ended && l.x2 > L.todayX && <line x1={Math.max(l.x1, L.todayX)} x2={l.x2} y1={l.y} y2={l.y} stroke={l.color} strokeWidth={l.trunk ? 4 : 3} strokeLinecap="round" strokeDasharray="6 7" />}
                {l.tailX !== null && <line data-tail x1={l.capX! + 8} x2={l.tailX} y1={l.y} y2={l.y} stroke={l.color} strokeWidth={1.5} strokeDasharray="2 5" opacity={0.5} />}
                {!l.trunk && l.label && (
                  <g transform={`translate(${l.x1 + 6},${l.y - 9})`}>
                    <rect width={l.label.length * 6.6 + 14} height={18} rx={9} fill="#fff" stroke={l.color} />
                    <text x={7} y={12.5} fill={l.color} className="text-[10.5px] font-bold">
                      {l.label}
                    </text>
                  </g>
                )}
                {l.capX !== null && (
                  <g data-cap transform={`translate(${l.capX},${l.y})`}>
                    <circle r={8} fill="#fff" stroke={l.color} strokeWidth={2} />
                    <path d="M-3.2,-3.2 L3.2,3.2 M3.2,-3.2 L-3.2,3.2" stroke={l.color} strokeWidth={2} strokeLinecap="round" />
                  </g>
                )}
              </g>
            ))}
            {shown.map(({ e, i }) => {
              const b = lane(e)
              const y = L.rowY(b.id)
              const up = i % 2 === 0
              const on = i === win.active
              const rv = reduced || i <= win.seen
              const spans = spanOf(e, model).map(L.rowY)
              const x = L.xs[i]!
              const note = e.user ? (NOTE_TAGS[e.user.tag]?.color ?? '#6941c6') : null
              return (
                <g key={e.id} data-node={e.id} className={cn('transition-opacity duration-300', dim(b.id) && 'opacity-[0.18]')}>
                  <line x1={x} x2={x} y1={up ? L.bandTop - 14 : y} y2={up ? y : L.bandBot + 14} stroke={b.color} strokeWidth={1.5} className="transition-opacity delay-200 duration-500" opacity={rv ? (on ? 1 : 0.45) : 0} />
                  {spans.length > 0 && <line x1={x} x2={x} y1={Math.min(y, ...spans)} y2={Math.max(y, ...spans)} stroke={b.color} strokeWidth={2} strokeDasharray="2 3" opacity={rv ? 0.7 : 0} />}
                  {spans.map((sy) => (
                    <circle key={sy} cx={x} cy={sy} r={3.5} fill="#fff" stroke={b.color} strokeWidth={2} />
                  ))}
                  <circle
                    cx={x}
                    cy={y}
                    r={on ? 8 : e.significance === 'High' ? 6.5 : 5}
                    fill={e.is_milestone || note ? '#fff' : b.color}
                    stroke={note ?? (e.is_milestone ? b.color : '#fff')}
                    strokeWidth={2.5}
                    strokeDasharray={e.is_milestone ? '2.5 2' : undefined}
                    className={cn('origin-center transition-transform duration-500 ease-spring [transform-box:fill-box]', rv ? 'scale-100' : 'scale-0')}
                  />
                </g>
              )
            })}
            {hov && (
              <g pointerEvents="none">
                <line x1={hov.x} x2={hov.x} y1={L.bandTop - 10} y2={L.bandBot + 10} stroke="#101828" strokeDasharray="3 3" />
                <circle cx={hov.x} cy={hov.ly} r={9} fill="#fff" strokeWidth={2} stroke={model.byId.get(hov.lane)?.color} />
                <path d={`M${hov.x - 4},${hov.ly} h8 M${hov.x},${hov.ly - 4} v8`} strokeWidth={2} strokeLinecap="round" stroke={model.byId.get(hov.lane)?.color} />
              </g>
            )}
          </svg>
          {hov && (
            <div
              role="status"
              className="pointer-events-none absolute z-[8] inline-flex -translate-x-1/2 animate-fade items-center gap-1.5 rounded-full bg-foreground px-2.5 py-[5px] text-[12px] whitespace-nowrap text-white shadow-[0_6px_16px_rgba(16,24,40,0.2)]"
              style={{ left: hov.x, top: hov.ly - 42 }}
            >
              <Plus className="size-3" aria-hidden="true" />
              <b className="font-semibold">{formatDay(hov.date)}</b>
              {model.multi && (
                <span className="font-semibold" style={{ color: `color-mix(in srgb, ${model.byId.get(hov.lane)?.color} 45%, #fff)` }}>
                  · {model.byId.get(hov.lane)?.label}
                </span>
              )}
              <em className="ml-0.5 text-[11px] text-faint not-italic">Click to add a note</em>
            </div>
          )}
          {shown.map(({ e, i }) => {
            const b = lane(e)
            const up = i % 2 === 0
            const rv = reduced || i <= win.seen
            const nc = comments[e.id]?.length ?? 0
            const note = e.user ? (NOTE_TAGS[e.user.tag]?.color ?? '#6941c6') : null
            const style: CSSProperties = {
              left: L.xs[i]! - HZ.CW / 2,
              width: HZ.CW,
              ...(up ? { bottom: vh - (L.bandTop - 14) } : { top: L.bandBot + 14 }),
              transitionDelay: `${(i % 3) * 60}ms`,
              ...(note && { borderColor: note }),
            }
            return (
              <button
                key={e.id}
                ref={(el) => {
                  if (el) cards.current.set(i, el)
                  else cards.current.delete(i)
                }}
                type="button"
                data-card={e.id}
                tabIndex={i === win.active ? 0 : -1}
                onClick={() => onOpen(e.id)}
                onKeyDown={(ev) => {
                  const to = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : null
                  if (to === null) return
                  ev.preventDefault()
                  move(to)
                }}
                className={cn(
                  'absolute flex flex-col gap-[7px] rounded-[14px] border bg-card px-3.5 py-3 text-left shadow-panel transition-[opacity,transform,border-color,box-shadow] duration-700 ease-out-soft hover:border-[#c4ccda] hover:shadow-card-hover',
                  !rv ? (up ? 'translate-y-[-26px] opacity-0' : 'translate-y-[26px] opacity-0') : dim(b.id) ? 'opacity-30' : 'opacity-100',
                  i === win.active && 'border-[#c7d1f4] shadow-[0_14px_34px_rgba(35,71,217,0.13)]',
                  e.is_milestone && 'border-dashed',
                  flash === e.id && 'animate-journey-flash',
                )}
                style={style}
              >
                <span className="flex items-center gap-[7px] text-[11.5px] text-text-secondary">
                  <CategoryIcon category={e.category} className="size-[22px] rounded-md" />
                  <span className="font-mono">{eventDate(e, { short: true })}</span>
                  {starred.has(e.id) && <Star aria-label="Starred" className="size-3 fill-star text-star-stroke" />}
                  {nc > 0 && (
                    <span className="inline-flex items-center gap-[3px] text-muted-foreground">
                      <MessageCircle className="size-[11px]" aria-hidden="true" />
                      {nc}
                    </span>
                  )}
                  <span className="flex-1" />
                  <SignificanceBadge value={e.significance} />
                </span>
                <span className={cn('line-clamp-2 leading-[1.3] font-semibold text-pretty', e.significance === 'High' ? 'text-[15px]' : 'text-[14px]')}>{e.title}</span>
                <span className="flex flex-wrap gap-1">
                  {e.user && <NoteTagChip tag={e.user.tag} />}
                  {model.multi && <BranchChip branch={b} small />}
                  <Targets e={e} label={false} small limit={2} />
                </span>
              </button>
            )
          })}
        </div>
        <div className="absolute left-0 z-[3] w-[200px] bg-[linear-gradient(90deg,rgba(249,250,251,0.98)_70%,rgba(249,250,251,0))] pl-[18px] max-[900px]:w-[120px] max-[900px]:pl-2" style={{ top: L.bandTop, height: nR * HZ.ROW }}>
          {L.rows.map((b) => {
            const l = L.lanes.find((x) => x.id === b.id)
            const started = !!l && (l.trunk || l.x1 <= win.p + 0.75 * vw)
            const sub = !l ? 'no events' : started ? (l.trunk ? 'trunk' : l.ended ? 'closed' : (b.status.split(' · ')[0] ?? '')) : `from ${l.first!.date.slice(0, 4)}`
            return (
              <div key={b.id} data-row={b.id} className={cn('flex items-center gap-[7px] text-[12px] text-muted-foreground transition-opacity duration-300', !l ? 'opacity-25' : started ? 'opacity-100' : 'opacity-45')} style={{ height: HZ.ROW }}>
                <i aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: b.color, boxShadow: `0 0 0 3px color-mix(in srgb, ${b.color} 18%, transparent)` }} />
                <b className="min-w-[54px] text-[12.5px] font-[650]" style={{ color: b.color }}>
                  {b.label || 'Journey'}
                </b>
                <span className="truncate text-[11px] max-[900px]:hidden">{sub}</span>
              </div>
            )
          })}
        </div>
        <button type="button" aria-label="Previous event" disabled={win.active <= 0} onClick={() => goTo(win.active - 1)} className="absolute top-1/2 left-[208px] z-[4] -mt-5 flex size-10 items-center justify-center rounded-full border bg-card text-secondary-foreground shadow-[0_4px_12px_rgba(16,24,40,0.08)] disabled:opacity-35 max-[900px]:left-[124px]">
          <ChevronLeft className="size-[18px]" />
        </button>
        <button type="button" aria-label="Next event" disabled={win.active >= n - 1} onClick={() => goTo(win.active + 1)} className="absolute top-1/2 right-4 z-[4] -mt-5 flex size-10 items-center justify-center rounded-full border bg-card text-secondary-foreground shadow-[0_4px_12px_rgba(16,24,40,0.08)] disabled:opacity-35">
          <ChevronRight className="size-[18px]" />
        </button>
        <div className="absolute right-4 bottom-3.5 z-[4] inline-flex items-center gap-[5px] rounded-full border border-hair bg-card/90 px-[9px] py-[3px] text-[11.5px] text-muted-foreground">
          <Plus className="size-3" aria-hidden="true" />
          Hover a branch to see the date · click to add a note there
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/horizontal-track.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (5 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 18: Journey tree (alternate view)

**Files:**
- Create: `apps/web/src/features/journey/tree/use-tree-layout.ts`
- Create: `apps/web/src/features/journey/tree/tree-svg.tsx`
- Create: `apps/web/src/features/journey/tree/journey-tree.tsx`
- Test: `apps/web/src/features/journey/tree/journey-tree.test.tsx`

**Interfaces:**
- Consumes: `treeRows`, `TreeRow` (Task 11); `estimateRowHeight`, `rowTops`, `treeGeometry`, `treeGutters`, `treeWindow`, `treeActiveAt`, `treeHoverAt`, `TreeGeometry`, `TreeHover` (Task 11); `TreeCard` (Task 15); `JourneyViewProps`, `JourneyViewHandle` (Task 10); `spanOf`, `BranchModel` and scroll helpers (Task 2); `useElementWidth`, `useMediaQuery`, `formatDay`, `formatMonth`, `todayIso` — existing.
- Produces: `useTreeLayout(flowRef, rows, model) → { W, heights, tops, H, geo, register(key) }` (one ResizeObserver; measured heights per width); `TreeSvg({ geo, model, activeId, revealed(key), focusBranch, clipId, clipRef })`; `interface JourneyTreeProps extends JourneyViewProps { onStar(id); onJump(id) }`; `JourneyTree(props)` — `data-testid="journey-tree"`, absolute rows `[data-row]` within ±1,200px, sticky branch labels (wide pills / narrow chip bar, `data-on` when the probe passes), gutter `data-testid="tree-gutter"` with the hover pill `role="status"`, IntersectionObserver reveal (all at once without IO or with reduced motion), `ref.jump(id)` (card at 30% of the viewport + flash).

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/tree/journey-tree.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { todayIso } from '@/lib/dates'
import type { JourneyViewHandle } from '../view-types'
import { branchModel, spanOf } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'
import { estimateRowHeight, rowTops, treeGeometry } from './tree-geometry'
import { JourneyTree, type JourneyTreeProps } from './journey-tree'
import { treeRows } from './tree-rows'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: `${id} full`, color: '#0b7a6f', off, status: 'Approved · US', origin: 'ai', ...extra })
const MODEL = branchModel([
  br('PAH', 0, { trunk: true, color: '#2347d9' }),
  br('PH-ILD', 2, { from: 'PAH', why: 'INCREASE took inhaled treprostinil into WHO Group 3' }),
  br('PH-COPD', -5, { from: 'PAH', ended: 'Terminated', color: '#b54708' }),
])
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const LIST = [
  ev('a', '2002-05-21', 'PAH'), ev('b', '2004-11-23', 'PAH'), ev('c', '2017-02-01', 'PH-ILD'), ev('d', '2018-05-08', 'PH-COPD'),
  ev('e', '2022-01-10', 'PAH'), ev('f', '2024-06-06', 'PH-COPD'), ev('ai:trep:https://x.org/a/b:0', '2099-04-30', 'PH-ILD', { is_milestone: true }),
]
const CLOSURES = { 'PH-COPD': { id: 'stop', date: '2022-11-29', title: 'Phase 3 trial terminated: PERFECT' } }

function renderTree(over: Partial<JourneyTreeProps> = {}) {
  const ref = createRef<JourneyViewHandle>()
  const props: JourneyTreeProps = {
    assetId: 'trep', list: LIST, model: MODEL, closures: CLOSURES, stars: [], comments: {}, focusBranch: null,
    onOpen: vi.fn(), onAdd: vi.fn(), onActive: vi.fn(), onStar: vi.fn(), onJump: vi.fn(), ...over,
  }
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <JourneyTree ref={ref} {...props} />
    </QueryClientProvider>,
  )
  const rows = treeRows(props.list, MODEL, CLOSURES, todayIso())
  const heights = rows.map(estimateRowHeight)
  const { tops, H } = rowTops(heights)
  const geo = treeGeometry({ W: 1200, rows, tops, heights, H, model: MODEL, spanOf: (e) => spanOf(e, MODEL) })
  return { ...view, props, ref, geo }
}

describe('JourneyTree', () => {
  it('forks branches with their rationale, closes PH-COPD at its 2022 termination and marks Today', async () => {
    const { container } = renderTree({ list: LIST.map((e) => ({ ...e, significance: 'Low' as const })) })
    expect(await screen.findByText(/^Today · /)).toBeInTheDocument()
    expect(screen.getByText('PH-ILD full')).toBeInTheDocument()
    expect(screen.getByText('Forked from PAH · INCREASE took inhaled treprostinil into WHO Group 3')).toBeInTheDocument()
    expect(screen.getByText('Terminated Nov 2022 · Phase 3 trial terminated: PERFECT')).toBeInTheDocument()
    expect(container.querySelector('[data-cap="PH-COPD"]')).toBeInTheDocument()
    expect(container.querySelector('[data-lane="PH-COPD"] [data-tail]')).toBeInTheDocument()
    expect(screen.getByText('Projected milestones are dashed')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/NaN/)
  })

  it('shows the hover date and branch over the lanes and adds a note there on click', () => {
    const { geo, props } = renderTree()
    const gutter = screen.getByTestId('tree-gutter')
    const a = geo.nodes.find((n) => n.k === 'a')!
    const b = geo.nodes.find((n) => n.k === 'b')!
    fireEvent.mouseMove(gutter, { clientX: geo.tx + 2, clientY: (a.y + b.y) / 2 })
    expect(screen.getByRole('status')).toHaveTextContent(/^[A-Z][a-z]{2} \d{1,2}, 200[234]· PAHClick to add a note$/)
    fireEvent.click(gutter, { clientX: geo.tx + 2, clientY: (a.y + b.y) / 2 })
    expect(props.onAdd).toHaveBeenCalledWith(expect.objectContaining({ branch: 'PAH', prev: 'Event a', next: 'Event b' }))
  })

  it('stars and opens cards, and jumps to an event with ":" and "/" in its id', async () => {
    const { props, ref } = renderTree()
    const card = screen.getByRole('article', { name: 'Event b' })
    await userEvent.click(within(card).getByRole('button', { name: 'Mark as important' }))
    expect(props.onStar).toHaveBeenCalledWith('b')
    await userEvent.click(within(card).getByRole('button', { name: /Details/ }))
    expect(props.onOpen).toHaveBeenCalledWith('b')
    let ok = false
    act(() => {
      ok = ref.current!.jump('ai:trep:https://x.org/a/b:0')
    })
    expect(ok).toBe(true)
    expect(ref.current!.jump('missing')).toBe(false)
  })

  it('renders only rows near the viewport for a 1,270-event journey', () => {
    const many = Array.from({ length: 1270 }, (_, i) => ev(`e${i}`, `${1990 + Math.floor(i / 40)}-${String((i % 12) + 1).padStart(2, '0')}-10`, 'PAH', { significance: 'Low' }))
    const { container } = renderTree({ list: many })
    const rendered = container.querySelectorAll('[data-row]').length
    expect(rendered).toBeGreaterThan(3)
    expect(rendered).toBeLessThan(60)
  })

  it('draws one unlabeled trunk and no forks for an asset without branches', () => {
    renderTree({ model: branchModel([]), list: LIST.map((e) => ({ ...e, branch: undefined })) })
    expect(screen.queryByText(/New branch/)).not.toBeInTheDocument()
    expect(screen.getByText(/^Journey begins/)).not.toHaveTextContent('trunk')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/tree/journey-tree.test.tsx`
Expected: FAIL — `Failed to resolve import "./journey-tree"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/journey/tree/use-tree-layout.ts
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useElementWidth } from '@/lib/use-element-width'
import { spanOf, type BranchModel } from '../journey-model'
import { estimateRowHeight, rowTops, treeGeometry } from './tree-geometry'
import type { TreeRow } from './tree-rows'

/** jsdom and the first frame have no width yet: lay out as a wide flow. */
const FALLBACK_WIDTH = 1200

/**
 * Row heights (measured for rendered rows, estimated for the rest) → row tops → geometry. Measured heights are kept
 * per width and refreshed by one ResizeObserver, so subtree toggles and wrapping re-flow the lanes (PHASE_DETAILS §4).
 */
export function useTreeLayout(flowRef: RefObject<HTMLDivElement | null>, rows: TreeRow[], model: BranchModel) {
  const W = useElementWidth(flowRef) || FALLBACK_WIDTH
  const [measured, setMeasured] = useState<{ w: number; h: Map<string, number> }>({ w: W, h: new Map() })
  const sizes = measured.w === W ? measured.h : null
  const widthRef = useRef(W)
  useLayoutEffect(() => {
    widthRef.current = W
  }, [W])
  const observer = useRef<ResizeObserver | null>(null)
  const nodes = useRef(new Map<string, HTMLElement>())

  const register = useCallback((key: string) => (el: HTMLElement | null) => {
    const ro = (observer.current ??=
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const w = widthRef.current
            setMeasured((prev) => {
              const h = new Map(prev.w === w ? prev.h : [])
              let changed = prev.w !== w
              for (const entry of entries) {
                const k = (entry.target as HTMLElement).dataset.row
                const height = (entry.target as HTMLElement).offsetHeight
                if (k && height > 0 && Math.abs((h.get(k) ?? 0) - height) > 0.5) {
                  h.set(k, height)
                  changed = true
                }
              }
              return changed ? { w, h } : prev
            })
          }))
    const old = nodes.current.get(key)
    if (old && old !== el) ro?.unobserve(old)
    if (el) {
      nodes.current.set(key, el)
      ro?.observe(el)
    } else nodes.current.delete(key)
  }, [])

  return useMemo(() => {
    const heights = rows.map((r) => sizes?.get(r.key) ?? estimateRowHeight(r))
    const { tops, H } = rowTops(heights)
    const geo = treeGeometry({ W, rows, tops, heights, H, model, spanOf: (e) => spanOf(e, model) })
    return { W, heights, tops, H, geo, register }
  }, [W, rows, sizes, model, register])
}
```

```tsx
// file: apps/web/src/features/journey/tree/tree-svg.tsx
import type { Ref } from 'react'
import { cn } from '@/lib/utils'
import type { BranchModel } from '../journey-model'
import type { TreeGeometry } from './tree-geometry'

const DRAW = 'transition-[stroke-dashoffset,opacity] duration-800 ease-out-soft [stroke-dasharray:1]'
const POP = 'origin-center transition-transform duration-500 ease-spring [transform-box:fill-box]'

/**
 * Tree SVG layers (README §6.2): grey lanes, a coloured copy clipped to the scroll probe (the trunk "lights up"),
 * repeated vertical branch labels, fork curves, card connectors, nodes, span bridges, Today line and ⊗ caps.
 * Decorative: the cards carry the same information in the DOM.
 */
export function TreeSvg({
  geo,
  model,
  activeId,
  revealed,
  focusBranch,
  clipId,
  clipRef,
}: {
  geo: TreeGeometry
  model: BranchModel
  activeId: string | null
  revealed: (key: string) => boolean
  focusBranch: string | null
  clipId: string
  clipRef: Ref<SVGRectElement>
}) {
  const dim = (id: string) => focusBranch !== null && focusBranch !== id && 'opacity-[0.18]'
  return (
    <svg aria-hidden="true" width={geo.W} height={geo.H} className="pointer-events-none absolute top-0 left-0 z-[1] overflow-visible">
      <defs>
        <clipPath id={clipId}>
          <rect ref={clipRef} x={0} y={0} width={geo.W} height={0} />
        </clipPath>
      </defs>
      {[false, true].map((lit) => (
        <g key={String(lit)} clipPath={lit ? `url(#${clipId})` : undefined} opacity={lit ? 0.9 : 1}>
          {geo.lanes.map((l) => {
            const c = lit ? l.color : '#e4e7ec'
            const solidEnd = geo.yToday !== null && !l.ended ? Math.min(l.y2, geo.yToday) : l.y2
            const labels = lit && model.multi && l.label ? Array.from({ length: Math.max(0, Math.floor((l.y2 - l.y1 - 260) / 620)) }, (_, k) => l.y1 + 300 + k * 620) : []
            return (
              <g key={l.id} data-lane={lit ? l.id : undefined} className={cn('transition-opacity duration-300', dim(l.id))}>
                {labels.map((y) => (
                  <text key={y} transform={`translate(${l.x + (geo.narrow ? 4 : 7)},${y}) rotate(90)`} fill={l.color} className="text-[10px] font-bold tracking-[0.08em] uppercase opacity-85">
                    {l.label}
                  </text>
                ))}
                {l.px !== null && <path d={`M${l.px},${l.fy - 58} C${l.px},${l.fy - 26} ${l.x},${l.fy - 34} ${l.x},${l.fy - 6}`} stroke={c} strokeWidth={3} strokeLinecap="round" fill="none" />}
                <line x1={l.x} x2={l.x} y1={l.px !== null ? l.fy - 6 : l.y1} y2={solidEnd} stroke={c} strokeWidth={l.trunk ? 4 : 3} strokeLinecap="round" />
                {geo.yToday !== null && !l.ended && l.y2 > geo.yToday && <line x1={l.x} x2={l.x} y1={geo.yToday} y2={l.y2} stroke={c} strokeWidth={l.trunk ? 4 : 3} strokeLinecap="round" strokeDasharray="6 7" />}
                {l.tailY !== null && <line data-tail={lit ? '' : undefined} x1={l.x} x2={l.x} y1={l.y2 + 8} y2={l.tailY} stroke={c} strokeWidth={1.5} strokeDasharray="2 5" opacity={0.5} />}
              </g>
            )
          })}
        </g>
      ))}
      {geo.yToday !== null && <line x1={geo.xMin - 18} x2={geo.xMax + 18} y1={geo.yToday} y2={geo.yToday} stroke="#101828" strokeDasharray="3 3" />}
      {geo.lanes
        .filter((l) => l.px !== null)
        .map((l) => (
          <g key={`f${l.id}`} className={cn('transition-opacity duration-300', dim(l.id))}>
            <path d={`M${l.x},${l.fy} L${l.fx2},${l.fy}`} pathLength={1} stroke={l.color} strokeWidth={2} fill="none" className={cn(DRAW, 'delay-150', revealed(`f${l.id}`) ? '[stroke-dashoffset:0]' : '[stroke-dashoffset:1]')} />
            <circle cx={l.x} cy={l.fy} r={5} fill="#fff" stroke={l.color} strokeWidth={2.5} className={cn(POP, revealed(`f${l.id}`) ? 'scale-100' : 'scale-0')} />
          </g>
        ))}
      {geo.lanes
        .filter((l) => l.ended)
        .map((l) => (
          // The cap scales in an inner <g>, so the CSS transform never fights the SVG translate (PHASE_DETAILS pitfall).
          <g key={`x${l.id}`} data-cap={l.id} transform={`translate(${l.x},${l.y2})`}>
            <g className={cn(POP, revealed(`x${l.id}`) ? 'scale-100' : 'scale-0')}>
              <circle r={8} fill="#fff" stroke={l.color} strokeWidth={2} />
              <path d="M-3.2,-3.2 L3.2,3.2 M3.2,-3.2 L-3.2,3.2" stroke={l.color} strokeWidth={2} strokeLinecap="round" fill="none" />
            </g>
          </g>
        ))}
      {geo.nodes.map((n) => {
        const c = model.byId.get(n.lane)?.color ?? '#2347d9'
        const on = activeId === n.k
        const rv = revealed(n.k)
        return (
          <g key={n.k} data-node={n.k} className={cn('transition-opacity duration-300', dim(n.lane))}>
            <path d={`M${n.x},${n.y} L${n.x2},${n.y}`} pathLength={1} stroke={c} strokeWidth={on ? 2.25 : 1.75} strokeLinecap="round" fill="none" opacity={on ? 1 : 0.5} className={cn(DRAW, 'delay-100', rv ? '[stroke-dashoffset:0]' : '[stroke-dashoffset:1]')} />
            {n.span.length > 0 && <line x1={Math.min(n.x, ...n.span)} x2={Math.max(n.x, ...n.span)} y1={n.y} y2={n.y} stroke={c} strokeWidth={2} strokeDasharray="2 3" opacity={rv ? 0.75 : 0} className="transition-opacity delay-400 duration-500" />}
            {n.span.filter((x) => x !== n.x).map((x) => (
              <circle key={x} cx={x} cy={n.y} r={3.5} fill="#fff" stroke={c} strokeWidth={2} className={cn(POP, rv ? 'scale-100' : 'scale-0')} />
            ))}
            <circle
              cx={n.x}
              cy={n.y}
              r={on ? 8 : n.hi ? 6.5 : 5}
              fill={n.up || n.note ? '#fff' : c}
              stroke={n.note ?? (n.up ? c : '#fff')}
              strokeWidth={2.5}
              strokeDasharray={n.up ? '2.5 2' : undefined}
              className={cn(POP, rv ? 'scale-100' : 'scale-0')}
            />
            <circle cx={n.x2} cy={n.y} r={2.5} fill={c} className={cn(POP, 'delay-600', rv ? 'scale-100' : 'scale-0')} />
          </g>
        )
      })}
    </svg>
  )
}
```

```tsx
// file: apps/web/src/features/journey/tree/journey-tree.tsx
import { Flag, GitMerge, Pill, Plus, X } from 'lucide-react'
import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { formatMonth } from '@/lib/format'
import { formatDay, todayIso } from '@/lib/dates'
import { findScroller, offsetIn, onScroll, scrollToTop, viewportHeight, viewportTop } from '@/lib/scroll'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import type { JourneyViewProps } from '../view-types'
import { treeActiveAt, treeGutters, treeHoverAt, treeWindow, type TreeHover } from './tree-geometry'
import { treeRows, type TreeRow } from './tree-rows'
import { TreeCard } from './tree-card'
import { TreeSvg } from './tree-svg'
import { useTreeLayout } from './use-tree-layout'

export interface JourneyTreeProps extends JourneyViewProps {
  onStar: (id: string) => void
  /** A subtree's linked event: scroll, flash and open it. */
  onJump: (id: string) => void
}

/** Rows rendered beyond the viewport, above and below. */
const OVERSCAN = 1200

/**
 * Journey tree (README §6.2, the alternate view): branch lanes fork off their parent programme; cards alternate around
 * the trunk. Geometry comes from row heights (measured or estimated), so only rows near the viewport are rendered.
 */
export function JourneyTree({ assetId, list, model, closures, stars, comments, focusBranch, onOpen, onAdd, onActive, onStar, onJump, ref }: JourneyTreeProps) {
  const flowRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<SVGRectElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const clipId = `jt-lit-${useId().replace(/:/g, '')}`
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const revealAll = reduced || typeof IntersectionObserver === 'undefined'
  const rows = useMemo(() => treeRows(list, model, closures, todayIso()), [list, model, closures])
  const { geo, tops, heights, register } = useTreeLayout(flowRef, rows, model)
  const [win, setWin] = useState<[number, number]>([0, Math.min(rows.length - 1, 14)])
  const [active, setActive] = useState(0)
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const [openT, setOpenT] = useState<Set<string>>(() => new Set())
  const [flash, setFlash] = useState<string | null>(null)
  const [gh, setGh] = useState<TreeHover | null>(null)
  const byId = useMemo(() => new Map(list.map((e) => [e.id, e])), [list])
  const starred = useMemo(() => new Set(stars), [stars])
  const g = treeGutters(model)
  const isRevealed = (k: string) => revealAll || revealed.has(k)

  // Scroll: lit trunk clip, sticky labels, parallax years, active card, rendered window (rAF-throttled, refs only).
  useEffect(() => {
    const flow = flowRef.current
    if (!flow) return
    const sc = findScroller(flow)
    let raf = 0
    const update = () => {
      const vh = viewportHeight(sc)
      const top = viewportTop(sc) - flow.getBoundingClientRect().top
      const probe = top + vh * 0.55
      clipRef.current?.setAttribute('height', String(Math.max(0, probe)))
      labelsRef.current?.querySelectorAll<HTMLElement>('[data-ly]').forEach((el) => el.toggleAttribute('data-on', Number(el.dataset.ly) <= probe))
      if (!reduced) {
        flow.querySelectorAll<HTMLElement>('[data-bgyear]').forEach((el) => {
          const row = el.parentElement!
          el.style.transform = `translate(-50%, ${((row.offsetTop + row.offsetHeight / 2 - probe) * -0.45).toFixed(1)}px)`
        })
      }
      const a = treeActiveAt(geo.nodes, probe)
      setActive((x) => (x === a ? x : a))
      const [f, l] = treeWindow(tops, heights, top - OVERSCAN, top + vh + OVERSCAN)
      setWin((w) => (w[0] === f && w[1] === l ? w : [f, l]))
    }
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    const off = onScroll(sc, on)
    window.addEventListener('resize', on)
    on()
    return () => {
      off()
      window.removeEventListener('resize', on)
      cancelAnimationFrame(raf)
    }
  }, [geo, tops, heights, reduced])

  useEffect(() => onActive(active), [active, onActive])

  // Reveal on scroll: rendered rows fade in once, staggered 90 ms per batch (max 4).
  useEffect(() => {
    const flow = flowRef.current
    if (revealAll || !flow) return
    const io = new IntersectionObserver(
      (entries) => {
        const shown = entries.filter((x) => x.isIntersecting)
        if (!shown.length) return
        shown.forEach((x, i) => {
          ;(x.target as HTMLElement).style.setProperty('--dl', `${Math.min(i, 4) * 90}ms`)
          io.unobserve(x.target)
        })
        setRevealed((prev) => new Set([...prev, ...shown.map((x) => (x.target as HTMLElement).dataset.row!)]))
      },
      { root: findScroller(flow) === document.documentElement ? null : findScroller(flow), threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )
    flow.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => {
      if (!revealed.has(el.dataset.row!)) io.observe(el)
    })
    return () => io.disconnect()
  }, [win, rows, revealAll, revealed])

  useImperativeHandle(ref, () => ({
    jump(id) {
      const i = rows.findIndex((r) => r.kind === 'event' && r.key === id)
      const flow = flowRef.current
      if (i < 0 || !flow) return false
      const sc = findScroller(flow)
      scrollToTop(sc, offsetIn(sc, flow) + tops[i]! - viewportHeight(sc) * 0.3, !reduced)
      setFlash(id)
      window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800)
      return true
    },
  }))

  const gutLeft = Math.max(0, geo.xMin - 22)
  const hoverAt = (ev: ReactMouseEvent<HTMLDivElement>) => {
    const r = flowRef.current!.getBoundingClientRect()
    return treeHoverAt(geo, byId, ev.clientX - r.left, ev.clientY - r.top)
  }
  const dim = (id: string) => focusBranch !== null && focusBranch !== id
  const marker: CSSProperties = geo.narrow ? { marginLeft: g.nw } : { marginLeft: geo.tx, transform: 'translateX(-50%)' }
  const activeId = list[active]?.id ?? null
  const reveal = (k: string, side: 'l' | 'r' | null) =>
    cn(
      'transition-[opacity,transform] duration-700 ease-out-soft [transition-delay:var(--dl,0ms)]',
      isRevealed(k) ? 'translate-x-0 scale-100 opacity-100' : cn('scale-[0.97] opacity-0', side === 'l' && !geo.narrow ? '-translate-x-14' : 'translate-x-14'),
    )

  const renderRow = (r: TreeRow) => {
    switch (r.kind) {
      case 'root':
        return (
          <div className="pb-3 text-[12.5px] text-text-secondary">
            <Marker style={marker} narrow={geo.narrow}>
              <span className="flex size-[30px] items-center justify-center rounded-full bg-primary text-white shadow-[0_0_0_6px_var(--background),0_0_0_7px_#e4e7ec]">
                <Pill className="size-3.5" aria-hidden="true" />
              </span>
              <span>
                Journey begins · <b className="text-foreground">{list[0] ? formatMonth(list[0].date) : ''}</b>
                {model.multi && (
                  <>
                    {' · '}
                    <b style={{ color: model.trunk.color }}>{model.trunk.label}</b> trunk
                  </>
                )}
              </span>
            </Marker>
          </div>
        )
      case 'year':
        return (
          <div className={cn('relative pt-10 pb-[18px] transition-opacity duration-600', isRevealed(r.key) ? 'opacity-100' : 'opacity-0')}>
            <span
              data-bgyear
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 -mt-[90px] -translate-x-1/2 text-[180px] leading-none font-bold tracking-[-0.06em] whitespace-nowrap text-transparent tabular-nums select-none will-change-transform [-webkit-text-stroke:1.5px_rgba(35,71,217,0.11)] max-[979px]:-mt-[55px] max-[979px]:text-[110px]"
              style={{ left: geo.narrow ? '62%' : geo.tx }}
            >
              {r.year}
            </span>
            <Marker style={marker} narrow={geo.narrow}>
              <span className="relative rounded-full border bg-card px-3 py-[3px] font-mono text-[13px] font-semibold shadow-[0_0_0_5px_var(--background)]">{r.year}</span>
              <span className="relative bg-background px-1.5 text-[12px] text-muted-foreground">
                {r.n} event{r.n === 1 ? '' : 's'}
              </span>
            </Marker>
          </div>
        )
      case 'today':
        return (
          <div className="pt-9 pb-3.5">
            <Marker style={marker} narrow={geo.narrow}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-[12px] font-semibold text-white shadow-[0_0_0_5px_var(--background)]">
                <i aria-hidden="true" className="size-1.5 animate-blink-dot rounded-full bg-white" />
                Today · {formatDay(todayIso())}
              </span>
              <span className="bg-background px-1.5 text-[12px] text-muted-foreground">Expected milestones below</span>
            </Marker>
          </div>
        )
      case 'fork':
      case 'end': {
        const end = r.kind === 'end'
        const parent = model.byId.get(r.branch.from ?? '')?.label ?? model.trunk.label
        return (
          <div className={cn('flex pt-[22px] pb-1', geo.narrow || r.side === 'r' ? 'justify-end' : 'justify-start', dim(r.branch.id) && 'opacity-30')}>
            <div
              className={cn('flex items-center gap-3 rounded-xl border-[1.5px] border-dashed bg-card px-3.5 py-2.5', reveal(r.key, r.side))}
              style={{ width: geo.cardW, borderColor: r.branch.color }}
            >
              <span
                className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', end ? 'border-[1.5px] bg-card' : 'text-white')}
                style={end ? { borderColor: r.branch.color, color: r.branch.color } : { background: r.branch.color }}
              >
                {end ? <X className="size-[13px]" aria-hidden="true" /> : <GitMerge className="size-3.5" aria-hidden="true" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="text-[13px] text-secondary-foreground">
                  {end ? 'Branch closed · ' : 'New branch · '}
                  <b className="font-semibold" style={{ color: r.branch.color }}>
                    {end ? r.branch.label : r.branch.full}
                  </b>
                </span>
                <span className="text-[12px] text-pretty text-muted-foreground">
                  {r.kind === 'end' ? `${r.branch.ended ?? 'Closed'} ${formatMonth(r.closure.date)} · ${r.closure.title}` : `Forked from ${parent}${r.branch.why ? ` · ${r.branch.why}` : ''}`}
                </span>
              </span>
              {r.kind === 'fork' && (
                <span className="flex flex-col items-end font-mono text-[18px] leading-none font-semibold" style={{ color: r.branch.color }}>
                  {r.n}
                  <em className="mt-0.5 font-sans text-[10.5px] font-normal text-muted-foreground not-italic">events</em>
                </span>
              )}
            </div>
          </div>
        )
      }
      case 'event': {
        const e = r.e
        return (
          <article aria-label={e.title} className={cn('flex py-3.5', geo.narrow || r.side === 'r' ? 'justify-end' : 'justify-start', dim(r.lane) && 'opacity-30 transition-opacity duration-300')}>
            <div className={reveal(r.key, r.side)} style={{ width: geo.cardW }}>
              <TreeCard
                assetId={assetId}
                e={e}
                lane={model.multi ? (model.byId.get(r.lane) ?? null) : null}
                open={openT.has(e.id)}
                onToggle={() => setOpenT((s) => (s.has(e.id) ? new Set([...s].filter((x) => x !== e.id)) : new Set([...s, e.id])))}
                starred={starred.has(e.id)}
                nComments={comments[e.id]?.length ?? 0}
                onStar={() => onStar(e.id)}
                onOpen={() => onOpen(e.id)}
                onJump={onJump}
                resolve={(id) => byId.get(id)}
                className={cn(activeId === e.id && 'border-[#c7d1f4] shadow-card-active', flash === e.id && 'animate-journey-flash')}
              />
            </div>
          </article>
        )
      }
      case 'finish':
        return (
          <div className="mt-7 text-[12.5px] text-text-secondary">
            <Marker style={marker} narrow={geo.narrow}>
              <span className="flex size-[30px] items-center justify-center rounded-full border-[1.5px] border-dashed border-faint bg-card text-text-secondary">
                <Flag className="size-[13px]" aria-hidden="true" />
              </span>
              <span>{r.milestones ? 'Projected milestones are dashed' : 'End of the recorded journey'}</span>
            </Marker>
          </div>
        )
    }
  }

  return (
    <div ref={flowRef} data-testid="journey-tree" className="relative mt-5" style={{ height: geo.H }}>
      {model.multi && (
        <div ref={labelsRef} aria-hidden="true" className="sticky top-0 z-[6] h-0">
          {geo.narrow ? (
            <div className="absolute top-1.5 right-0 left-0 flex flex-wrap gap-1 rounded-[10px] border bg-card/95 px-2 py-1.5 shadow-[0_4px_12px_rgba(16,24,40,0.06)] backdrop-blur-sm">
              {geo.lanes.map((l) => (
                <span key={l.id} data-ly={l.y1} className="inline-flex items-center gap-[5px] rounded-full border px-[7px] py-px text-[11px] font-semibold opacity-35 transition-opacity data-[on]:opacity-100" style={{ color: l.color, borderColor: `color-mix(in srgb, ${l.color} 30%, #fff)` }}>
                  <i className="size-1.5 rounded-full" style={{ background: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
          ) : (
            [...geo.lanes]
              .sort((a, b) => a.x - b.x)
              .map((l, i) => (
                <span
                  key={l.id}
                  data-ly={l.y1}
                  className={cn('absolute -translate-x-1/2 -translate-y-1.5 rounded-full border bg-card/95 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap opacity-0 shadow-[0_2px_6px_rgba(16,24,40,0.06)] transition-[opacity,translate] duration-300 data-[on]:translate-y-0 data-[on]:opacity-100', dim(l.id) && 'data-[on]:opacity-35')}
                  style={{ left: l.x, top: i % 2 ? 32 : 8, color: l.color, borderColor: l.color }}
                >
                  {l.label}
                </span>
              ))
          )}
        </div>
      )}
      <div
        data-testid="tree-gutter"
        className="absolute top-0 z-[4] cursor-copy"
        style={{ left: gutLeft, width: geo.xMax - gutLeft + 22, height: geo.H }}
        onMouseMove={(ev) => setGh(hoverAt(ev))}
        onMouseLeave={() => setGh(null)}
        onClick={(ev) => {
          const q = hoverAt(ev)
          if (q) onAdd({ date: q.date, branch: q.lane, prev: q.prev?.title ?? null, next: q.next?.title ?? null })
        }}
      >
        {gh && (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -mt-[9px] flex size-[18px] items-center justify-center rounded-full border-2 bg-card"
              style={{ top: gh.y, left: gh.lx - gutLeft - 9, borderColor: gh.color, color: gh.color, boxShadow: `0 0 0 4px color-mix(in srgb, ${gh.color} 15%, transparent)` }}
            >
              <Plus className="size-[11px]" />
            </span>
            <span
              role="status"
              className={cn('pointer-events-none absolute z-[8] inline-flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-[5px] text-[12px] whitespace-nowrap text-white shadow-[0_6px_16px_rgba(16,24,40,0.2)]', geo.narrow ? '-translate-y-[140%]' : '-translate-y-1/2')}
              style={{ top: gh.y, left: gh.lx - gutLeft + 16 }}
            >
              <b className="font-semibold">{formatDay(gh.date)}</b>
              {model.multi && (
                <span className="font-semibold" style={{ color: `color-mix(in srgb, ${gh.color} 45%, #fff)` }}>
                  · {gh.label}
                </span>
              )}
              <em className="ml-0.5 text-[11px] text-faint not-italic">Click to add a note</em>
            </span>
          </>
        )}
      </div>
      <TreeSvg geo={geo} model={model} activeId={activeId} revealed={isRevealed} focusBranch={focusBranch} clipId={clipId} clipRef={clipRef} />
      {rows.slice(win[0], win[1] + 1).map((r, k) => {
        const i = win[0] + k
        return (
          <div key={r.key} ref={register(r.key)} data-row={r.key} className="absolute right-0 left-0 z-[2]" style={{ top: tops[i] }}>
            {renderRow(r)}
          </div>
        )
      })}
    </div>
  )
}

function Marker({ style, narrow, children }: { style: CSSProperties; narrow: boolean; children: ReactNode }) {
  return (
    <div className={cn('relative z-[3] flex w-max max-w-[90%] flex-col gap-1', narrow ? 'items-start text-left' : 'items-center text-center')} style={style}>
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/tree/journey-tree.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (5 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 19: Journey section: header, views, HUD, focus and locate

**Files:**
- Create: `apps/web/src/features/journey/journey-section.tsx`
- Test: `apps/web/src/features/journey/journey-section.test.tsx`

**Interfaces:**
- Consumes: `useJourneyEvents`, `useBranches`, `useEndedBranchEvents` (Task 1); `useEventSheet` (`openEvent`, `setJourneyAsset`, `subscribe` to `locate`) (Task 1); `branchClosures`, `branchModel`, `chronological`, `filterJourney`, `journeyCounts`, `laneOf` (Task 2); `useAnnotations`, `useToggleStar` (Task 3); `useJourneyFilters` (Task 4); `BranchChip`, `NoteDraftDialog`, `NoteDraft` (Task 5); `JourneyViewHandle` (Task 10); `JourneyHeader` (Task 14); `HorizontalTrack` (Task 17); `JourneyTree` (Task 18); `Skeleton`, `EmptyState`, `todayIso` — existing.
- Produces: `JourneySection({ asset: Pick<AssetDetail, 'id' | 'name'> })` — `<section aria-label="Asset journey">`; registers `journeyAsset` while mounted; handles `?focus=` (jump + open + drop the param; filtered out → `showEverything()` and retry when the data arrives; still absent → open the sheet anyway) and sheet `locate` requests (jump without reopening); HUD `data-testid="journey-hud"` (year · branch · nn/NN · progress, `aria-hidden`); empty states "No events match these filters" / "No journey events yet"; error "The journey couldn't be loaded."; hover/"Add to timeline" open `NoteDraftDialog`.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/journey-section.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { Mock } from 'vitest'
import { useEventSheet } from '@/stores/event-sheet-store'
import { JourneySection } from './journey-section'
import type { Branch, JourneyEventV3 } from './types'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: `${id} full`, color: '#0b7a6f', off, status: 'Approved · US', origin: 'ai', ...extra })
const BRANCHES = [br('PAH', 0, { trunk: true, color: '#2347d9' }), br('PH-ILD', 1, { from: 'PAH' }), br('PH-COPD', -1, { from: 'PAH', ended: 'Terminated' })]
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'Low', is_milestone: false, sources: [], via: 'journey', key: true, ...extra,
})
const DEEP = 'ai:trep:https://example.com/a/b:0'
const KEY = [ev('a', '2002-05-21', 'PAH'), ev('b', '2017-02-01', 'PH-ILD', { category: 'clinical' }), ev('c', '2018-05-08', 'PH-COPD')]
const ALL = [...KEY, ev(DEEP, '2019-03-01', 'PAH', { key: false }), ev('stop', '2022-11-29', 'PH-COPD', { type: 'trial_stopped', key: false })]

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '/assets/:assetId/overview', element: <JourneySection asset={{ id: 'trep', name: 'Treprostinil' }} /> }], { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  localStorage.clear()
  useEventSheet.setState({ current: null, journeyAsset: null, locate: null })
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/assets/trep/branches') return json(200, BRANCHES)
    if (url === '/api/assets/trep/timeline?scope=key&include=notes&limit=5000') return json(200, { events: [...KEY].reverse(), total: KEY.length })
    if (url === '/api/assets/trep/timeline?scope=all&include=notes&limit=5000') return json(200, { events: [...ALL].reverse(), total: ALL.length })
    if (url === '/api/assets/trep/timeline?scope=all&branch=PH-COPD&limit=5000') return json(200, { events: ALL.filter((e) => e.branch === 'PH-COPD'), total: 2 })
    if (url === '/api/assets/trep/annotations') return json(200, { stars: ['a'], comments: {}, notes: [] })
    return json(404, { code: 'NOT_FOUND', message: url })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('JourneySection', () => {
  it('shows the horizontal journey by default with the HUD, and the tree when chosen (saved to prefs)', async () => {
    const router = renderAt('/assets/trep/overview')
    expect(await screen.findByTestId('journey-horizontal')).toBeInTheDocument()
    expect(screen.getByText(/^3 events, 2002–2018 · 3 indication branches\./)).toBeInTheDocument()
    expect(screen.getByTestId('journey-hud')).toHaveTextContent('2002PAH01/03')
    expect(useEventSheet.getState().journeyAsset).toBe('trep')
    await userEvent.click(screen.getByRole('button', { name: 'Tree' }))
    expect(await screen.findByTestId('journey-tree')).toBeInTheDocument()
    expect(new URLSearchParams(router.state.location.search).get('view')).toBe('v')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/me/prefs', expect.objectContaining({ method: 'PATCH' })))
    expect(await screen.findByText('Terminated Nov 2022 · Event stop')).toBeInTheDocument()
  })

  it('filters by category through the URL and says when nothing matches', async () => {
    const router = renderAt('/assets/trep/overview?cat=ip')
    expect(await screen.findByText('No events match these filters')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Patents/ }))
    expect(await screen.findByTestId('journey-horizontal')).toBeInTheDocument()
    expect(router.state.location.search).toBe('')
  })

  it('deep-links ?focus= to an event outside the key events: shows all, jumps, opens the sheet and drops the param', async () => {
    const router = renderAt(`/assets/trep/overview?cat=clinical&focus=${encodeURIComponent(DEEP)}`)
    await waitFor(() => expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: DEEP }))
    const search = new URLSearchParams(router.state.location.search)
    expect(search.get('scope')).toBe('all')
    expect(search.get('cat')).toBeNull()
    expect(search.get('focus')).toBeNull()
    expect(document.querySelector(`[data-card="${DEEP}"]`)).toHaveClass('animate-journey-flash')
  })

  it('locates an event in place for the sheet without reopening it', async () => {
    renderAt('/assets/trep/overview')
    await screen.findByTestId('journey-horizontal')
    act(() => useEventSheet.getState().requestLocate('trep', 'b'))
    expect(document.querySelector('[data-card="b"]')).toHaveClass('animate-journey-flash')
    expect(useEventSheet.getState().current).toBeNull()
  })

  it('opens the composer stand-in from "Add to timeline" and says when the journey fails', async () => {
    renderAt('/assets/trep/overview')
    await screen.findByTestId('journey-horizontal')
    await userEvent.click(screen.getByRole('button', { name: 'Add to timeline' }))
    expect(within(screen.getByRole('dialog', { name: 'Add to the timeline' })).getByTestId('note-where')).toHaveTextContent('PAH')
  })

  it('says when the journey could not be loaded', async () => {
    fetchMock.mockImplementation(async () => json(500, { code: 'ERROR', message: 'boom' }))
    renderAt('/assets/trep/overview')
    expect(await screen.findByText("The journey couldn't be loaded.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/journey-section.test.tsx`
Expected: FAIL — `Failed to resolve import "./journey-section"`.

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/journey/journey-section.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import type { AssetDetail } from '@/features/assets/api'
import { EmptyState } from '@/features/assets/components/panel'
import { todayIso } from '@/lib/dates'
import { useEventSheet } from '@/stores/event-sheet-store'
import { useAnnotations, useToggleStar } from './annotations-api'
import { useBranches, useEndedBranchEvents, useJourneyEvents } from './api'
import { BranchChip } from './chips'
import { HorizontalTrack } from './horizontal-track'
import { JourneyHeader } from './journey-header'
import { branchClosures, branchModel, chronological, filterJourney, journeyCounts, laneOf } from './journey-model'
import { NoteDraftDialog, type NoteDraft } from './note-draft-dialog'
import { JourneyTree } from './tree/journey-tree'
import { useJourneyFilters } from './use-journey-filters'
import type { JourneyViewHandle } from './view-types'

const NO_STARS: string[] = []
const NO_COMMENTS = {}

/**
 * The Overview's journey (README §6.2–6.3): header + horizontal track (default) or tree, filters in the URL, the HUD,
 * `?focus=<eventId>` deep links and in-place "Locate on timeline" from the event sheet.
 */
export function JourneySection({ asset }: { asset: Pick<AssetDetail, 'id' | 'name'> }) {
  const assetId = asset.id
  const f = useJourneyFilters()
  const events = useJourneyEvents(assetId, f.scope)
  const branches = useBranches(assetId)
  const annotations = useAnnotations(assetId)
  const toggleStar = useToggleStar(assetId)
  const openEvent = useEventSheet((s) => s.openEvent)
  const model = useMemo(() => branchModel(branches.data), [branches.data])
  const ended = useMemo(() => model.list.filter((b) => b.ended).map((b) => b.id), [model])
  const endedEvents = useEndedBranchEvents(assetId, ended)
  const all = events.data?.events
  const dated = useMemo(() => chronological(all ?? []), [all])
  const closures = useMemo(() => branchClosures(endedEvents.data?.events ?? dated, ended), [endedEvents.data, dated, ended])
  const stars = annotations.data?.stars ?? NO_STARS
  const comments = annotations.data?.comments ?? NO_COMMENTS
  const catsKey = f.cats.join(',')
  const list = useMemo(() => filterJourney(dated, { cats: catsKey ? (catsKey.split(',') as typeof f.cats) : [], mine: f.mine }, stars), [dated, catsKey, f.mine, stars])
  const counts = useMemo(() => journeyCounts(dated, stars), [dated, stars])
  const [focusBranch, setFocusBranch] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const viewRef = useRef<JourneyViewHandle>(null)
  /** Whether the event a focus resolves to opens in the sheet (deep links do; "Locate on timeline" doesn't). */
  const focusOpens = useRef(true)
  const focusOn = useRef(f.focusOn)
  useEffect(() => {
    focusOn.current = f.focusOn
  })

  // The sheet can locate this asset's events in place while the journey is on screen.
  useEffect(() => {
    useEventSheet.getState().setJourneyAsset(assetId)
    return () => useEventSheet.getState().setJourneyAsset(null)
  }, [assetId])

  useEffect(
    () =>
      useEventSheet.subscribe((s, prev) => {
        if (!s.locate || s.locate === prev.locate || s.locate.assetId !== assetId) return
        if (viewRef.current?.jump(s.locate.eventId)) return
        focusOpens.current = false
        focusOn.current(s.locate.eventId)
      }),
    [assetId],
  )

  // ?focus=<eventId>: scroll + flash + open; when filtered out, show everything and retry once the data is in.
  useEffect(() => {
    const id = f.focus
    if (!id || !events.isSuccess) return
    const finish = () => {
      if (focusOpens.current) openEvent(assetId, id)
      focusOpens.current = true
      f.clearFocus()
    }
    if (list.some((e) => e.id === id)) {
      if (viewRef.current?.jump(id)) finish()
      return
    }
    if (f.scope === 'all' && !f.cats.length && !f.mine) finish()
    else f.showEverything()
  }, [f, events.isSuccess, list, assetId, openEvent])

  const jumpTo = (id: string) => {
    if (viewRef.current?.jump(id)) openEvent(assetId, id)
    else {
      focusOpens.current = true
      f.focusOn(id)
    }
  }

  const n = list.length
  const cur = n ? list[Math.min(active, n - 1)]! : null
  const curLane = cur ? model.byId.get(laneOf(cur, model)) : undefined
  const filtered = f.cats.length > 0 || f.mine !== null
  const viewProps = {
    assetId,
    list,
    model,
    closures,
    stars,
    comments,
    focusBranch,
    onOpen: (id: string) => openEvent(assetId, id),
    onAdd: setDraft,
    onActive: setActive,
  }

  return (
    <section aria-label="Asset journey" className="relative flex flex-col">
      <JourneyHeader
        model={model}
        list={list}
        undated={(all?.length ?? 0) - dated.length}
        counts={counts}
        view={f.view}
        scope={f.scope}
        cats={f.cats}
        mine={f.mine}
        focusBranch={focusBranch}
        onView={f.setView}
        onScope={f.setScope}
        onToggleCat={f.toggleCat}
        onMine={f.setMine}
        onFocusBranch={setFocusBranch}
        onClear={() => {
          f.clearFilters()
          setFocusBranch(null)
        }}
        onAdd={() => setDraft({ date: todayIso(), branch: model.trunk.id })}
      />
      {events.isPending && <Skeleton className="mt-5 h-[420px] w-full rounded-[14px]" />}
      {events.isError && <p className="mt-5 text-destructive">The journey couldn't be loaded.</p>}
      {events.isSuccess && n === 0 && (
        <EmptyState title={filtered ? 'No events match these filters' : 'No journey events yet'}>
          {filtered ? 'Clear the filters to see the whole journey.' : 'Events appear here as the crawl builds the journey.'}
        </EmptyState>
      )}
      {n > 0 &&
        (f.view === 'h' ? (
          <HorizontalTrack ref={viewRef} {...viewProps} />
        ) : (
          <JourneyTree ref={viewRef} {...viewProps} onStar={(id) => toggleStar.mutate({ eventId: id, on: !stars.includes(id) })} onJump={jumpTo} />
        ))}
      {cur && (
        <div aria-hidden="true" data-testid="journey-hud" className="sticky bottom-4 z-[5] mx-auto mt-2 flex w-max items-center gap-2.5 rounded-full border bg-card/95 px-3.5 py-1.5 text-[12.5px] shadow-[0_6px_18px_rgba(16,24,40,0.08)] backdrop-blur-md">
          <b className="font-mono font-semibold">{cur.date.slice(0, 4)}</b>
          {model.multi && curLane && <BranchChip branch={curLane} small />}
          <span className="font-mono text-muted-foreground">
            {String(Math.min(active, n - 1) + 1).padStart(2, '0')}/{String(n).padStart(2, '0')}
          </span>
          <span className="h-1 w-[120px] overflow-hidden rounded-sm bg-accent">
            <i className="block h-full bg-primary transition-[width] duration-300" style={{ width: `${((Math.min(active, n - 1) + 1) / n) * 100}%` }} />
          </span>
        </div>
      )}
      <NoteDraftDialog draft={draft} branches={model.multi ? model.list : []} onClose={() => setDraft(null)} />
    </section>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/journey-section.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (6 tests); `tsc` silent; oxlint reports no errors and no new warnings.

---

### Task 20: Overview journey slot shows the v3 journey; the v2 list goes

**Files:**
- Modify: `apps/web/src/features/assets/pages/tabs.tsx` (Task 9's journey slot: `JourneyTimeline` → `JourneySection`)
- Delete: `apps/web/src/features/assets/components/journey-timeline.tsx`
- Modify: `apps/web/src/features/assets/api.ts` (`TAB_FOR_COLLECTION` moves here)
- Modify: `apps/web/src/features/assets/pages/evidence-tab.tsx` (import from `../api`)
- Modify: `apps/web/src/features/chat/asset-panel.test.tsx` (allow the heavier Overview to render under full-suite load)
- Test: `apps/web/src/features/assets/pages/overview-journey.test.tsx`

**Interfaces:**
- Consumes: `JourneySection` (Task 19); after Tasks 6 and 7 only `evidence-tab.tsx` still uses `TAB_FOR_COLLECTION`.
- Produces: `OverviewTab` (ready branch) = KPI strip → `OverviewAnalytics` (Task 8) → `<JourneySection key={asset.id} asset={asset} />`. The LiveBuild early return (Phase 3) is untouched. `TAB_FOR_COLLECTION` is exported from `features/assets/api.ts`; `journey-timeline.tsx` (v2 `JourneyTimeline`) is deleted.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/assets/pages/overview-journey.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import type { AssetDetail } from '../api'
import { OverviewTab } from './tabs'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET = {
  id: 'trep', name: 'Treprostinil', aliases: [], company: { name: 'United Therapeutics' }, tags: {}, kind: 'primary', status: 'ready', updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 4, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 105 },
  latestEvent: null, competitorOf: [], kpis: { approvalRegions: ['US', 'EU'], activeTrials: 9, activePhase3: 3, upcomingMilestones: 5 }, competitors: [], suggestedQuestions: [],
} as AssetDetail

afterEach(() => vi.unstubAllGlobals())

describe('OverviewTab', () => {
  it('shows the KPI strip, the pinned analytics and the journey section (old list journey gone)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.startsWith('/api/assets/trep/timeline?scope=key')
          ? json(200, { events: [{ id: 'a', asset: 'trep', date: '2002-05-21', type: 'approval', category: 'regulatory', title: 'FDA approves Remodulin', significance: 'High', is_milestone: false, sources: [], via: 'journey' }], total: 1 })
          : json(404, { code: 'NOT_FOUND', message: url }),
      ),
    )
    const router = createMemoryRouter(
      [{ path: '/assets/:assetId', element: <Outlet context={ASSET} />, children: [{ path: 'overview', element: <OverviewTab /> }] }],
      { initialEntries: ['/assets/trep/overview'] },
    )
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('region', { name: 'Key metrics' })).toHaveTextContent('105')
    expect(screen.getByRole('region', { name: 'Pinned analytics' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Asset journey' })).toBeInTheDocument()
    expect(await screen.findByTestId('journey-horizontal')).toBeInTheDocument()
    expect(screen.queryByText('Company-sponsored trials only')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/assets/pages/overview-journey.test.tsx`
Expected: FAIL — `Unable to find role="region" and name "Asset journey"` (the Overview still renders the v2 list in its journey slot).

- [ ] **Step 3: Implement**

In `apps/web/src/features/assets/pages/tabs.tsx` (as Task 9 left it):

Before:
```tsx
import { AdverseEventsChart } from '../components/adverse-events-chart'
import { Chip } from '../components/badges'
import { JourneyTimeline } from '../components/journey-timeline'
import { OverviewAnalytics } from '@/features/analytics/overview-analytics'
import { EmptyState, KpiStrip, Panel } from '../components/panel'
```
After:
```tsx
import { AdverseEventsChart } from '../components/adverse-events-chart'
import { Chip } from '../components/badges'
import { JourneySection } from '@/features/journey/journey-section'
import { OverviewAnalytics } from '@/features/analytics/overview-analytics'
import { EmptyState, KpiStrip, Panel } from '../components/panel'
```

Before:
```tsx
      />
      <OverviewAnalytics asset={asset} />
      <JourneyTimeline assetId={asset.id} />
    </div>
  )
```
After:
```tsx
      />
      <OverviewAnalytics asset={asset} />
      <JourneySection key={asset.id} asset={asset} />
    </div>
  )
```


Delete `apps/web/src/features/assets/components/journey-timeline.tsx` (`git rm`).

In `apps/web/src/features/assets/api.ts`:

Before:
```ts
export type RecordTab = 'clinical' | 'regulatory' | 'documents' | 'company-ir' | 'news' | 'publications' | 'conferences' | 'patents'

export interface RecordsQuery {
  q?: string
```
After:
```ts
export type RecordTab = 'clinical' | 'regulatory' | 'documents' | 'company-ir' | 'news' | 'publications' | 'conferences' | 'patents'

/** Which asset tab shows a source record of this collection. */
export const TAB_FOR_COLLECTION: Record<string, RecordTab> = {
  fda_records: 'regulatory',
  ema_records: 'regulatory',
  trial_records: 'clinical',
  company_records: 'company-ir',
  articles: 'news',
  publication_records: 'publications',
  conference_records: 'conferences',
  patent_records: 'patents',
}

export interface RecordsQuery {
  q?: string
```

In `apps/web/src/features/assets/pages/evidence-tab.tsx`:

Before:
```tsx
import { formatDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RecordTab, SourceRecord } from '../api'
import { useEvidenceSummary, useLedger, type Decision, type EvidenceSourceKey, type EvidenceSummary, type LedgerRow } from '../competitors-api'
import { Chip } from '../components/badges'
import { LoadError } from '../components/competitors/load-error'
import { humanize } from '../components/competitors/utils'
import { TAB_FOR_COLLECTION } from '../components/journey-timeline'
import { EmptyState, Panel } from '../components/panel'
import { Pager } from '../components/pager'
```
After:
```tsx
import { formatDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TAB_FOR_COLLECTION, type RecordTab, type SourceRecord } from '../api'
import { useEvidenceSummary, useLedger, type Decision, type EvidenceSourceKey, type EvidenceSummary, type LedgerRow } from '../competitors-api'
import { Chip } from '../components/badges'
import { LoadError } from '../components/competitors/load-error'
import { humanize } from '../components/competitors/utils'
import { EmptyState, Panel } from '../components/panel'
import { Pager } from '../components/pager'
```

In `apps/web/src/features/chat/asset-panel.test.tsx`:

Before:
```tsx

    // The Competitors tab shows how many competitors there are.
    expect(await screen.findByRole('link', { name: 'Competitors 1' })).toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Ask Asset AI' })
```
After:
```tsx

    // The Competitors tab shows how many competitors there are.
    // The Overview now mounts the journey too: allow for a slower first render when the whole suite runs in parallel.
    expect(await screen.findByRole('link', { name: 'Competitors 1' }, { timeout: 4000 })).toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Ask Asset AI' })
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/assets/pages/overview-journey.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (1 tests); `tsc` silent; oxlint reports no errors and no new warnings.
Also run `cd apps/web && npx vitest run src/features/assets/pages/overview-tab.test.tsx src/features/chat/asset-panel.test.tsx` (Phase 3's Overview test and the asset page test): PASS.


---

### Task 21: Phase gate, container rebuild, live verification, commit

All steps run in the main checkout `/Users/abhisheksharma/Work/Hackathon-Mavericks/Pharmaedge-Hackathon_maverics` on `main`, after every task above is merged.

**Files:** none new.

- [ ] **Step 1: Lint, typecheck, full test suite, build**

Run: `cd apps/web && npm run lint && npx tsc -b && npm test && npx vite build 2>&1 | tail -3`
Expected: oxlint 0 errors and 13 warnings (the 14 at af0304f minus the one in the deleted `journey-timeline.tsx`; no new ones); `tsc` silent; vitest 68 files, 385 tests (47 / 273 at af0304f + 21 files / 112 tests); build succeeds. The Overview now mounts more on first render: if a route-level `findBy…` (e.g. Phase 3's `overview-tab.test.tsx`) times out only under full-suite load, rerun once before investigating.

- [ ] **Step 2: Rebuild and restart the web container**

Run: `docker compose build web && docker compose up -d web && sleep 3 && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/`
Expected: `200`.

- [ ] **Step 3: API facts behind the checks** (admin session)

```bash
EMAIL=$(grep '^ADMIN_EMAIL=' apps/api/.env | cut -d= -f2-) PASSWORD=$(grep '^ADMIN_PASSWORD=' apps/api/.env | cut -d= -f2-)
curl -s -c /tmp/pe4.cookies -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" http://localhost:8080/api/auth/login >/dev/null
curl -s -b /tmp/pe4.cookies http://localhost:8080/api/assets/treprostinil/branches | jq -c '[.[] | {id, off, from, ended}]'
curl -s -b /tmp/pe4.cookies 'http://localhost:8080/api/assets/treprostinil/timeline?scope=key&include=notes&limit=5000' | jq '.events | length'
curl -s -b /tmp/pe4.cookies 'http://localhost:8080/api/assets/treprostinil/timeline?scope=all&branch=PH-COPD&limit=5000' | jq -c '[.events[] | select(.type=="trial_stopped") | .date]'
curl -s -b /tmp/pe4.cookies 'http://localhost:8080/api/assets/infliximab/timeline?scope=all&include=notes&limit=5000' | jq '.events | length'
```
Expected: Treprostinil branches include PAH (trunk), PH-ILD (from PAH), IPF (from PH-ILD), PPF (from IPF), CTEPH (from PAH), PH-COPD (from PAH, `Terminated`) — extra closed programmes (CLI, PPHN, PH-HFpEF, SSc) are allowed (spec §4.2); ~105 key events; PH-COPD stops in 2022 (`2022-10-13`, `2022-11-29`); Infliximab ~1,270 events.

- [ ] **Step 4: Live checks with Playwright** (headless Chromium at 1440×900, signed in as the admin at http://localhost:8080; one script per item, screenshots kept under `/tmp/pe4/`) — every "Done when" item:
  0. **Overview composition (acceptance 2, SCREENS 6):** `/assets/treprostinil/overview` shows, top to bottom, the KPI strip (Approved in · Active trials · Upcoming milestones · Journey events · Company releases), the "Analytics" header with "Pinned for Treprostinil. Add your own from indexed data, or ask Asset AI to build one." and Reset, a 4-column grid with Development pipeline, Next milestones, Journey activity by year, Trials by phase, Enrolment by indication and the disabled dashed "Add analytics" tile, then the Journey header card; no "Upcoming milestones · Show all" column and no FAERS chart. Remove "Trials by phase" → reload → still gone (`PUT /analytics/pins`); Reset restores it. A Next milestones row opens the event sheet. An asset without trials (`/assets/sotatercept/overview`) shows Journey activity, Next milestones and Significance mix.
  1. **Horizontal rows + PH-COPD cap 2022:** `/assets/treprostinil/overview` (no `view` param, prefs default) shows `[data-testid="journey-horizontal"]`; the pinned labels list PAH, PH-ILD, IPF, PPF, CTEPH and PH-COPD (`[data-row]`); `[data-lane="PH-COPD"] [data-cap]` exists and its `transform` x lies between the x of the last 2022 card and the first 2023 card (read `[data-card]` positions from the track); a dotted `[data-tail]` follows it. Scroll the page: the track moves left, labels stay pinned, the HUD year advances.
  2. **Hover pill:** move the mouse over the PAH row between two cards → `[role="status"]` reads `^[A-Z][a-z]{2} \d{1,2}, \d{4} · PAH Click to add a note$` and its date lies between the two neighbouring cards' dates; click → the "Add to the timeline" dialog's Where strip shows the same date and "PAH".
  3. **Tree forks with rationale cards:** click "Tree" → `[data-testid="journey-tree"]`, URL `?view=v`, a `PATCH /api/me/prefs` with `{"journeyView":"v"}`; reload → still the tree. Scroll to 2017: "New branch · …interstitial lung disease…" with "Forked from PAH · …"; a "Branch closed · PH-COPD" row reads "Terminated Nov 2022 · …"; the trunk colours in as you scroll; sticky branch pills appear at the top; hovering the lanes shows the same pill format.
  4. **Subtree jump + flash:** on a TETON card click "Subtree", then a "Linked journey events" row → the page scrolls so that card sits about 30% down the viewport, it flashes (`animate-journey-flash`) and the event sheet opens on it.
  5. **The full sheet:** open "FDA approves efficacy supplement for Tyvaso" (or any PH-ILD approval) → header category + branch chip + star; type; title; facts; "Locate on timeline"; summary; "Position in the journey" with "#k of n"; "Branch" lineage chips PAH › PH-ILD and "Event k of n on this branch, … after “…”"; Targets; Regulatory path (NDA022387 steps, this one highlighted); Details; Why it matters; Evidence donut + sources; Linked events; Comments — post one (Enter), it appears, reload, it persists; star it, the card shows the star and "Starred 1". Open a trial event → "Trial · TETON-…" term bar; a patent event → "Patent term · …". ←/→ move between events (the journey follows), not while typing in the comment box; Esc in the box leaves it, Esc again closes and focus returns to the card.
  6. **Deep links from Home:** on `/`, click a Portfolio timeline dot of an AI event (id with `https://`), click "Show on the journey timeline" → lands on `/assets/<id>/overview`, the journey scrolls to the card, flashes it, opens the sheet, and the `focus` param is gone. Repeat from ⌘K ("TETON") and from a Next milestones row.
  7. **All scope, windowed:** `/assets/infliximab/overview?scope=all` scrolls smoothly end to end in both views; at any point `document.querySelectorAll('[data-card]').length` ≤ 15 (horizontal) and `[data-row]` ≤ 80 (tree).
  8. **Other surfaces:** Overview "Upcoming milestones" rows, Competitors tab signals and milestones, a chat timeline card and the live build's "Just added" rows (`/assets/treprostinil/overview?build=1`) open the event sheet. An asset with few branches (`/assets/env101/overview`) and one with none render without errors.
  9. **Reduced motion:** with `reducedMotion: 'reduce'` both views show every card at once, no parallax numerals in the horizontal view, no smooth scroll.

- [ ] **Step 5: Commit on `main`**

```bash
git status --short   # only the paths below; never infra/mongo/*
git add apps/web/src/index.css apps/web/src/lib/scroll.ts apps/web/src/lib/scroll.test.ts \
  apps/web/src/stores/event-sheet-store.ts apps/web/src/stores/stores.test.ts \
  apps/web/src/features/journey apps/web/src/features/analytics apps/web/src/features/assets apps/web/src/features/chat \
  docs/superpowers/plans/2026-10-09-v3-phase-4-journey-views.md
git commit -m "v3 phase 4: Overview (KPIs, pinned analytics, journey: horizontal default + tree), event detail sheet, deep links"
```

(The commit message body ends with the `Co-Authored-By` line required by the session. `git add apps/web/src/features/assets` also records the deletion of `journey-timeline.tsx`; `features/journey` records the deletion of `event-sheet-stub.tsx`.)
