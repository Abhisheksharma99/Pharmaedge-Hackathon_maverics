# Phase details: file-by-file

Companion to `IMPLEMENTATION_PLAN.md`. For each phase: the files to create (**+**) or modify (**~**), component and hook signatures, where to port from in `design_files/`, the tests to add, and pitfalls. Paths are relative to the repo root.

---

## Phase 0: Foundations

| | File | What |
|---|---|---|
| ~ | `apps/web/src/index.css` | Add vars: `--hair`, `--faint`, `--cat-*`, `--cat-*-soft`, `--coll-*`, `--tag-*`, `--star`; map them in `@theme inline` (`--color-hair`, …). |
| + | `apps/web/src/features/journey/types.ts` | DC §A types. |
| + | `apps/web/src/features/journey/constants.ts` | `CATEGORY_META` (re-export from `assets/components/badges.tsx` + colour hex), `COLLECTION_META {color, tab}`, `BRANCH_PALETTE`, `NOTE_TAGS {label, color}`, `PHASE_COLORS`, `STAGES = ['Phase 1','Phase 2','Phase 3','Filed','Approved']`. |
| + | `apps/web/src/lib/dates.ts` | `yearFraction`, `relativeFuture`, `formatMonth`, `formatDate` (re-use `lib/format`), `interpolateDate(a,b,t)`, `clampDay`. |
| + | `apps/web/src/lib/use-element-width.ts` | `ResizeObserver` hook returning width (`useLayoutEffect`). |
| + | `apps/web/src/components/charts/{chart-card,legend,v-bars,stack-bars,h-bars,donut,gantt,heat,funnel,stat,term-bar,mini-donut}.tsx` | Port from `design_files/pe/analytics.jsx` (charts) and `aj/sheet.jsx` (TermBar, MiniDonut). Props below. |
| ~ | `apps/web/src/features/assets/components/badges.tsx` | `KindBadge({kind, competitorOf})`. |
| + | `apps/web/src/components/charts/charts.test.tsx` | Render each chart with fixtures; snapshot the bar counts and labels. |

Chart props:
```ts
VBars({ data: {l:string; v:number; c?:string}[]; h?: number; unit?: string })
StackBars({ cols: (string|number)[]; series: {k:string;l:string;c:string;vals:number[]}[]; h?: number; every?: number })
HBars({ data: {l:string; v:number; c?:string}[]; unit?: string })            // labels clamp to 2 lines
Donut({ data: {l:string; v:number; c:string}[]; size?: number; center?: ReactNode; sub?: string })
Gantt({ rows: {l:string; sub?:string; s:number; e:number; c:string; tag?:string; dash?:boolean; tip?:string}[]; from:number; to:number })
Heat({ rows: {l:string; sub?:string}[]; cols: string[]; cell: (row, col) => {label:ReactNode; bg:string; fg:string; t?:string} })
Funnel({ steps: {l:string; v:number; c:string}[] })
Stat({ icon: LucideIcon; label: string; value: ReactNode; sub?: string; color?: string })
TermBar({ start: string; end: string; label: string; color: string })   // today marker
```
**Pitfalls:** animate with CSS keyframes on mount only (`transform-box: fill-box`); never animate on every re-render. Chart cards use `container-type: inline-size` for internal breakpoints.

---

## Phase 1: Backend

### apps/api
| | File | What |
|---|---|---|
| ~ | `src/assets/assets.service.ts` | `timeline()` projects the new optional fields; `include=notes` merges `journey_notes` (map to `via:'user'`). |
| ~ | `src/assets/assets.controller.ts` | `GET :id/branches`, `GET :id/events/:eventId`. |
| + | `src/portfolio/portfolio.{module,controller,service}.ts` | `GET /portfolio/timeline` with a Valkey cache of 60 s. |
| + | `src/annotations/annotations.{module,controller,service}.ts`, `dto/*.ts` | Stars, comments, notes CRUD and `notes/find`. Role checks: author or admin for edit/delete. |
| + | `src/analytics/analytics.{module,controller,service}.ts`, `analytics.blocks.ts`, `analytics.suggest.ts`, `analytics.build.ts` | DC §B.4. `blocks.ts` contains pure aggregation functions (unit-tested). |
| ~ | `src/jobs/jobs.controller.ts` | Extend `GET /jobs/:id`; add `GET /jobs/:id/feed`. |
| + | `src/search/search.controller.ts` | `/search`. |
| + | `src/notifications/*`, `src/prefs/*` | DC §B.5. |
| ~ | `src/assets/asset-lifecycle.service.ts` | Delete the new collections on asset removal. |
| ~ | `src/app.module.ts` | Register the modules. |
| + | `test/annotations.e2e-spec.ts`, `test/analytics.e2e-spec.ts`, `test/journey.e2e-spec.ts`, `test/portfolio.e2e-spec.ts` | Follow `test/helpers/test-app.ts`. |

Index creation: in each service's `onModuleInit`, `createIndex` as in DC §D (idempotent).

### crawler
| | File | What |
|---|---|---|
| ~ | `service/jobs.py` | `JobStore.feed()` (Mongo + in-memory), `records_by_coll`, `events_created`. |
| ~ | `service/pipeline.py` | Emit step start/done feed items; count records per collection after each step. |
| ~ | `service/steps.py` | Emit notable lines (copy tone from `design_files/aj/data.js` `LOG`); in `finalize`, call `journey.branches.derive()` and the analytics recompute; read `crawl_feedback`. |
| ~ | `journey/rules.py` | Add `indications`, `product`, `details`, `links` to rule events. |
| ~ | AI event extraction module (`ai/…`) | Extend the prompt and parser with `indications`, `product`, `impact`, `links`. |
| + | `journey/branches.py` | `derive(db, asset) -> list[Branch]`; `assign(events, branches)` writes `branch`/`span`. DC §E.5. |
| + | `journey/test_branches.py`; ~ `journey/test_rules.py`; ~ `service/test_pipeline.py` | |

**Acceptance fixture:** load `data/treprostinil/*` and run `finalize` (or the journey rebuild) → branches `PAH` (trunk), `PH-ILD` (from PAH, 2017), `IPF` (from PH-ILD, 2021), `PPF` (from IPF, 2023), `CTEPH` (from PAH, 2020, partner SciPharm), `PH-COPD` (from PAH, 2018, ended Terminated 2022).

---

## Phase 2: Shell, Home, Asset Search

| | File | What |
|---|---|---|
| ~ | `apps/web/src/components/layout/app-sidebar.tsx` | "Your assets" group (`useAssets` primary), live dot on Crawl jobs (`useJobs({status:'running'})`), mobile drawer (shadcn `Sheet side="left"`). |
| ~ | `apps/web/src/components/layout/app-header.tsx` | Search trigger, `CrawlChip`, Add asset, `NotificationsPopover`, account menu. |
| + | `apps/web/src/components/layout/{crawl-chip,notifications-popover,command-palette}.tsx` | Port from `pe/shell.jsx`. Palette via `npx shadcn add command` if missing. |
| ~ | `apps/web/src/components/layout/app-layout.tsx` | Global ⌘K listener; render `<CommandPalette/>`. |
| ~ | `apps/web/src/stores/shell-store.ts` | `paletteOpen`, `setPaletteOpen`. |
| ~ | `apps/web/src/features/home/home-page.tsx` | Rewrite with `Hero`, `KpiStrip`, `PortfolioTimeline`, `WhatChanged`, `NextMilestones`, `CrawlsCard`, `TrackedAssets`, `CompetitiveSignals`, `AskCard`. |
| + | `apps/web/src/features/home/components/*.tsx` | One file per block (port from `pe/home.jsx`). |
| ~ | `apps/web/src/features/home/api.ts` | `usePortfolioTimeline`. |
| ~ | `apps/web/src/features/assets/pages/asset-search-page.tsx` | KindBadge, kind Seg with counts, grid view, URL `?view=&kind=&q=`. |
| + | tests | Palette keyboard nav; portfolio timeline range filter; kind counts. |

---

## Phase 3: Live build

| | File | What |
|---|---|---|
| + | `apps/web/src/features/journey/live-build/build-strip.tsx` | Props `{ job: JobProgress; eventsCount: number; onExplore(): void }`. |
| + | `…/live-build/agent-pipeline.tsx` | Props `{ job: JobProgress; events: JourneyEventV3[] }`. Constants `AG_W=1100, AG_H=470, AG_OFF=30`, node map and edges exactly as in `aj/graph.jsx` (`agLayout`, `agEdges`, `agPath`). Node spawn: source/reasoning nodes at plan time, collection nodes on the first record. |
| + | `…/live-build/forming-timeline.tsx` | Props `{ records: {coll, y}[]; events }`. Ticks keyed by record id so they only animate on mount. |
| + | `…/live-build/just-added.tsx`, `activity-log.tsx` | Feed items; stick-to-bottom unless the user has scrolled up more than 40px. |
| + | `…/live-build/live-build.tsx` | Composes the above; grid `minmax(0,1fr) 380px` (1 column at ≤1180px). |
| ~ | `apps/web/src/features/jobs/api.ts` | `useJobProgress`, `useJobFeed`. |
| ~ | `apps/web/src/features/assets/pages/tabs.tsx` (`OverviewTab`) | Branch: onboarding or `?build=1` → `<LiveBuild/>`. |
| ~ | `apps/web/src/features/chat/components/cards/job-card.tsx` | Segmented bar + counters + link. |

**Pitfalls:** don't re-key SVG elements per poll (it re-triggers animations); particles only on active edges; disable particles under reduced motion.

---

## Phase 4: Journey views + detail sheet

| | File | What |
|---|---|---|
| + | `apps/web/src/features/journey/journey-section.tsx` | Header card (branch cards, chips, Seg, Add), filter state ↔ URL, renders `HorizontalTrack` or `JourneyTree`, owns `detailId` and `composer` state, `jump(id)` and the `?focus=` effect. |
| + | `…/horizontal-track.tsx` | Props `{ list, branches, laneOf, scrollRef, onOpen, onAdd, focusId, active, setActive, stars, comments }`. Constants `COL 178, CW 304, PADL 236, ROW 34, CA 196, RUL 30`. **Coordinate rule:** inside the translated track, `x = clientX − svgRect.left` (do not add the scroll offset). |
| + | `…/tree/journey-tree.tsx`, `tree/use-tree-geometry.ts`, `tree/tree-card.tsx`, `tree/subtree.tsx`, `tree/tree-svg.tsx` | Port from `aj/story.jsx`. Geometry returns `{W,H,tx,gap,narrow,nodes[],lanes[],yToday,yEnd,xMin,xMax}`. Lanes: `{id,x,px?,fy,y1,y2,fx2,ended,c,label}`. |
| + | `…/hover-add.ts` | Shared date interpolation (`dateAt(neighbours, t)`) used by both views. |
| + | `…/event-detail-sheet.tsx` (+ `position-strip.tsx`, `branch-lineage.tsx`, `regulatory-path.tsx`) | Port from `aj/sheet.jsx`. Props `{ assetId, eventId, list, onClose, onNav, onLocate? }`. Uses `useEvent`. |
| ~ | `apps/web/src/features/assets/pages/tabs.tsx` | `OverviewTab` = KpiStrip → `<OverviewAnalytics/>` (Phase 6, a placeholder for now) → `<JourneySection/>`. Remove the old `JourneyTimeline` from the Overview (keep the component for chat cards). |
| ~ | Home, chat citation, records "In the journey", competitors | Open `EventDetailSheet`; "Show on the journey timeline" → `navigate('/assets/:id/overview?focus=:eventId')`. |
| ~ | `apps/web/src/features/assets/api.ts` | `useTimelineV3`, `useBranches`, `useEvent`. |
| + | tests | Geometry unit tests (fork y, lane x, narrow switch); hover date interpolation; focus deep link; keyboard in the sheet. |

**Pitfalls:**
- An SVG `<g transform>` and a CSS transform on the same element conflict. Put scale animations on an inner `<g>`.
- `position: sticky` breaks inside `overflow: hidden` ancestors. Panels that contain sticky headers must use `overflow: clip` or none.
- Measure geometry in `useLayoutEffect` and re-measure on `ResizeObserver` and on subtree toggle.
- Throttle scroll handlers with rAF. Update the trunk clip and parallax via refs/inline styles, not React state. Only `active` index changes go through state.

---

## Phase 5: Annotations

| | File | What |
|---|---|---|
| + | `apps/web/src/features/journey/note-composer.tsx` | Port from `aj/notes.jsx`; uses `useAddNote`, `useFindNote`. |
| + | `apps/web/src/features/journey/annotations-api.ts` | `useAnnotations`, `useToggleStar`, `useAddComment`, `useAddNote`, `useFindNote` (optimistic: update `['asset', id, 'annotations']` and the timeline cache). |
| ~ | tree card, horizontal card, sheet | Star toggle, comment counts, note styling (`--tag-*`). |
| ~ | `apps/api/src/annotations/annotations.service.ts` | `find()`: (1) Mongo text search on `journey_events` + record collections in a ±18-month window; (2) vector search on `record_chunks` (existing `chat-tools.ts` search helper); (3) web fallback behind a feature flag; returns `found`/`exists`/`none`. "Missed by AI" → insert into `crawl_feedback`. |
| + | tests | Composer flows (manual, found, exists, none) with MSW; API e2e for permissions. |

---

## Phase 6: Analytics

| | File | What |
|---|---|---|
| ~ | `apps/web/src/routes.tsx`, `asset-layout.tsx` (`ASSET_TABS`) | Add `analytics` after `overview`. |
| + | `apps/web/src/features/analytics/analytics-tab.tsx`, `pipeline-matrix.tsx` | Port from `pe/analytics.jsx` (`AnalyticsTab`, `PipelineMatrix`, `pipelineFor`). Data from `useAssetAnalytics` (server-computed blocks); keep `pipelineFor` logic server-side in `analytics.blocks.ts`. |
| + | `…/tab-insights.tsx` | Per-tab chart sets (README §7.2) from `useTabInsights`. |
| + | `…/overview-analytics.tsx`, `add-analytics-dialog.tsx`, `templates.ts` | Port from `pe/overview-analytics.jsx`. `templates.ts` = the `OV_TEMPLATES` registry (key → title, span, requires, render(blocks)). |
| ~ | `apps/web/src/features/assets/components/records-view.tsx` + each tab in `pages/tabs.tsx` | New columns, facets, distribution bar, Journey column, record sheet "In the journey" (port from `pe/records.jsx` `REC_CFG`). |
| ~ | `apps/api/src/analytics/*` | Suggestions heuristics table, build runs (`analytics_runs` collection, statuses), web fallback behind `ANALYTICS_WEB_SEARCH=1`. |

**Pitfalls:** never show numbers without sources (custom specs); web-sourced cards show "Asset AI · public web sources" and a sources disclosure; sample values from the prototype must not ship.

---

## Phase 7: Polish & QA
- `e2e/journey.spec.ts`: horizontal hover → composer has the date; add a note → it appears; deep link focus.
- `e2e/analytics.spec.ts`: pin from the library; build a suggestion; Reset.
- `e2e/onboarding.spec.ts`: add asset in chat → live build → explore.
- `e2e/palette.spec.ts`: ⌘K → "TETON" → event.
- Lighthouse: the Overview with the journey must stay > 80 performance on a mid laptop; scroll stays at 60 fps with 40 events (profile with the React Profiler).
- Visual diff against `screenshots/` at 1440 wide.
