# Implementation plan: phased, with acceptance criteria

Work top to bottom. Each phase is shippable and must pass `npm run lint && npm test` in `apps/web` and `apps/api` (and `pytest` in `crawler/` where touched) before the next one starts. Cross-references: README § = screen spec, DC § = `DATA_CONTRACTS.md`.

Legend: **W** = apps/web, **A** = apps/api, **C** = crawler.

---

## Phase 0: Foundations (½–1 day)

- [ ] **W** Add tokens from README §4 to `src/index.css` (`--hair`, `--faint`, category/collection/branch/tag colours as CSS vars + `@theme inline` mappings).
- [ ] **W** Create `features/journey/` with `types.ts` (DC §A), `constants.ts` (CATEGORY_META colours and icons; COLLECTION_META colour and tab; BRANCH_PALETTE; NOTE_TAGS; PHASE_COLORS).
- [ ] **W** Shared primitives in `components/charts/`: `ChartCard`, `Legend`, `VBars`, `StackBars`, `HBars`, `Donut`, `Gantt`, `Heat`, `Funnel`, `Stat`, `TermBar`, `MiniDonut`. Pure SVG + Tailwind, width via a `useElementWidth` hook (`ResizeObserver`). Port from `design_files/pe/analytics.jsx` and `aj/sheet.jsx`. Respect reduced motion.
- [ ] **W** `lib/dates.ts`: `yearFraction(iso)`, `relativeFuture(iso)` ("in 9 months"), `formatMonth`, `interpolateDate(fa, fb, t)`.
- [ ] **W** Add `KindBadge` to `features/assets/components/badges.tsx`.

**Done when:** Storybook-style test page (or vitest render tests) renders each chart with fixture data; there are no console warnings.

## Phase 1: Backend data (2–3 days)

- [ ] **A** Extend the timeline DTO to `JourneyEventV3` (optional fields) and add `include=notes` (DC §B.1).
- [ ] **A** `GET /assets/:id/branches`, `GET /assets/:id/events/:eventId`, `GET /portfolio/timeline`.
- [ ] **A** Annotations module (`annotations/` with controller, service, DTOs): stars, comments, notes CRUD (DC §B.3). Indexes from DC §D. Extend lifecycle delete.
- [ ] **A** Jobs: extend `/jobs/:id` to `JobProgress`; add `/jobs/:id/feed`.
- [ ] **A** Analytics module: `/analytics` (blocks), `/records/:tab/insights`, `/analytics/pins` (DC §B.4). Valkey cache.
- [ ] **A** `/search`, `/notifications`, `/me/prefs`.
- [ ] **C** Feed emission + records per collection (DC §E.1–2).
- [ ] **C** Event enrichment in rules and AI steps (DC §E.3–4).
- [ ] **C** `journey/branches.py` + `asset_branches` upsert in `finalize` (DC §E.5).
- [ ] Tests: e2e specs per new route (pattern: `apps/api/test/*.e2e-spec.ts`), crawler unit tests.

**Done when:** for Treprostinil, `/branches` returns PAH (trunk), PH-ILD, IPF, PPF, CTEPH, PH-COPD (ended); `/timeline` items carry `branch`, `indications`, `product`, `details`; `/jobs/:id/feed` streams the step log during a refresh; `/analytics` returns all blocks.

## Phase 2: Shell, Home, Asset Search (2 days)

- [ ] **W** Sidebar: "Your assets" group, live dot on Crawl jobs, collapse (README §5.1). Mobile drawer.
- [ ] **W** Top bar: crawl chip (uses `useJobs({status:'running'})`), Add asset, notifications popover, palette trigger.
- [ ] **W** `CommandPalette` (cmdk via shadcn `command`), global ⌘K/Ctrl+K in `app-layout.tsx`.
- [ ] **W** Home rewrite (README §5.2): hero, KPI strip, **PortfolioTimeline**, What changed, Next milestones, Crawls card, Tracked asset cards with sparkline, Competitive signals, Asset AI starters.
- [ ] **W** Asset Search: KindBadge, kind Seg with counts, grid view (README §5.3).

**Done when:** every sidebar item navigates; ⌘K finds "TETON" and "NCT04708782"; Home portfolio dots open the event sheet (Phase 4 can stub it with RecordSheet until then); badges show on All/Primary/Competitors.

## Phase 3: Live build (2 days)

- [ ] **W** `features/journey/live-build/`: `BuildStrip`, `AgentPipeline` (1100×470 scaled stage; nodes; edges; particles), `FormingTimeline`, `JustAdded`, `ActivityLog`. Port geometry from `aj/graph.jsx` (node coordinates are final) and visuals from `aj/live.jsx`.
- [ ] **W** Drive it from `useJobProgress` + `useJobFeed`: step statuses/progress from `job.steps`, record ticks from `records_by_coll` (or fetch record years via `/records/:tab?fields=date` once per step completion), events from the timeline query refetched when an `event` feed item arrives.
- [ ] **W** Overview: show LiveBuild when `asset.status === 'onboarding'` or `?build=1`; "Explore the journey" clears `build`.
- [ ] **W** Chat job card: segmented bar + counters + "Watch the live build".

**Done when:** starting a refresh shows the planned nodes, then running nodes and particles, rising counts, events popping on the forming timeline and log lines in order; on completion, the strip turns green with "Explore the journey".

## Phase 4: Journey views + detail sheet (4–5 days)

- [ ] **W** `JourneySection` (header, branch cards, chips incl. Starred/Team notes, orientation Seg persisted via `/me/prefs`, Add to timeline). Filters in URL search params.
- [ ] **W** `HorizontalTrack` (**default view**; README §6.3). Hover band → guide + date pill; click → composer. Prev/next arrows; pinned left labels; parallax years.
- [ ] **W** `JourneyTree` (README §6.2): `useTreeGeometry`, rows (year / today / fork / event / branch closed), TreeCard + Subtree, SVG layers (base/lit/labels/forks/connectors/nodes/spans/caps), sticky labels (wide and narrow), gutter hover-to-add, HUD, IntersectionObserver reveal, parallax years.
- [ ] **W** `EventDetailSheet` (README §6.4) using `useEvent`; replace event clicks everywhere (Home, chat citations that are events, records tab "In the journey", competitor tab). Keep `RecordSheet` for plain records.
- [ ] **W** Deep link `?focus=<eventId>` on Overview: scroll, flash, open sheet; "Show on the journey timeline" navigates there from any sheet.

**Done when:** for Treprostinil, the horizontal view shows 6 branch rows with the PH-COPD cap at 2022; hovering shows "Mmm d, yyyy · Branch"; the tree view shows forks with rationale cards; Subtree links jump and flash; the sheet's position strip, lineage, trial/patent bars, regulatory path, evidence donut and comments all render; deep links work from Home.

## Phase 5: Annotations (2 days)

- [ ] **W** `NoteComposer` with the Where strip (date · branch · after/before), fields, tags, Add manually, Ask Asset AI → `useFindNote` with the 3-step progress UI and the found/exists/none results (README §6.5).
- [ ] **W** Star toggle (card, horizontal card icon, sheet), comment thread in the sheet, comment counts on cards, note cards/pins styled by tag, Starred/Team notes filters.
- [ ] **A** `notes/find` pipeline (structured → vector → web fallback) and `crawl_feedback` for "Missed by AI".
- [ ] **W** Notifications for comments on starred events.

**Done when:** a note added from a hover position appears at that date on that branch in both views, opens in the sheet, survives reload, and is visible to a second user; "Ask Asset AI" with "Yutrepia approved" returns a found result with sources.

## Phase 6: Analytics (3 days)

- [ ] **W** Asset tab **Analytics** (route `analytics` in `routes.tsx` + `ASSET_TABS`), README §7.1 with `useAssetAnalytics`.
- [ ] **W** `TabInsights` above each records table (README §7.2) via `/records/:tab/insights`.
- [ ] **W** Records tabs: new columns, facets, distribution bar, "Journey" link column, record sheet with "In the journey" (README §5.5).
- [ ] **W** Overview pinned analytics + Add analytics dialog (README §7.3): library from templates; suggestions; ask → build run with step list; pin/unpin/reset persisted via `/analytics/pins`.
- [ ] **A** `/analytics/suggestions` heuristics and `/analytics/build` (index first, web fallback per `ANALYTICS_PIPELINE.md`; this can start as stubs returning `method:'none'` for web until the search tool is wired).

**Done when:** the Analytics tab renders all blocks for Treprostinil and degrades gracefully for an asset without trials or patents; pins persist per user; a suggestion builds a chart with sources and can be pinned.

## Phase 7: Polish, a11y, perf, QA (1–2 days)

- [ ] Reduced motion everywhere; focus states; keyboard (⌘K, Esc, ←/→ in the sheet, Enter to comment).
- [ ] Perf: memoise geometry; rAF-throttle scroll handlers; one IntersectionObserver per view; avoid re-rendering cards on scroll (pass `active` via CSS class or context, not props to every card); virtualise records tables over 200 rows.
- [ ] Empty/loading/error states for every new panel (skeletons match the final layout; error copy matches existing tone, e.g. "The journey couldn't be loaded.").
- [ ] Playwright e2e (`e2e/`): onboarding live build → explore; horizontal hover-add note; deep link focus; analytics pin; ⌘K search.
- [ ] Visual check against `design_files/PharmaEdge Screens.html` at 1440, 1280, 1024 and 390 widths.

---

## Acceptance checklist (whole feature)

1. Primary/Competitor badges on Asset Search (table and grid; All tab).
2. Overview: KPI strip → pinned analytics → journey (horizontal default, tree optional).
3. Branches fork, close and label correctly; branch names are always visible (pinned left in horizontal; sticky/inline in the tree).
4. Hover anywhere on a branch shows the date and branch; click adds a note there.
5. Cards reveal on scroll; parallax years; the trunk lights up (tree).
6. Every card shows indications, product, key details, "why it matters", subtree, star and comments.
7. Event detail sheet is comprehensive and deep-linkable from everywhere ("Show on the journey timeline").
8. Notes: manual or Asset AI (found/exists/none) with sources; "Missed by AI" feeds the crawler.
9. Analytics tab, tab insights, pinned analytics with the add flow (index first, web fallback, sources shown).
10. Live build reflects real job progress and the feed.
11. Home dashboard, ⌘K, notifications, crawl chip, "Your assets".
12. No regressions in existing tabs, chat, jobs, auth; all tests green.
