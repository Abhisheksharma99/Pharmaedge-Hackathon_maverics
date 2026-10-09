# Claude Code prompts (one per phase)

Paste these one at a time into Claude Code at the repo root (`Pharmaedge-Hackathon_maverics/`). Each prompt assumes the previous phase is merged.

---

## Kick-off (paste first)

```
You are implementing the "PharmaEdge v3: Asset Journey, Analytics, Annotations & App Redesign" handoff.
Read, in this order, before writing code:
  design_handoff_asset_journey_v3/README.md
  design_handoff_asset_journey_v3/SCREENS.md (and look at screenshots/*.jpg)
  design_handoff_asset_journey_v3/IMPLEMENTATION_PLAN.md
  design_handoff_asset_journey_v3/PHASE_DETAILS.md (file-by-file tasks per phase)
  design_handoff_asset_journey_v3/DATA_CONTRACTS.md
  design_handoff_asset_journey_v3/design_files/ANALYTICS_PIPELINE.md
The HTML/JSX in design_handoff_asset_journey_v3/design_files/ is a DESIGN REFERENCE (in-browser Babel prototype).
Do not copy it verbatim; rebuild in apps/web using its stack (React 19, Vite, Tailwind v4 tokens in src/index.css,
shadcn/ui, lucide-react, TanStack Query, react-router, zustand, sonner) and existing components
(Panel, KpiStrip, Chip, CategoryIcon, SignificanceBadge, RecordSheet, Segmented, JobStatusBadge).
Backend: NestJS in apps/api (MongoDB via the Db provider, Valkey cache, LlmService). Crawler: Python in crawler/.
Rules: extend existing types and endpoints with optional fields (don't break current screens); add tests for every
new route/hook; keep copy exactly as in the README; respect prefers-reduced-motion; no new UI libraries except cmdk
(via shadcn command) if not already present.
Start with Phase 0 only. When it's done, list the files you changed and the acceptance criteria you verified.
```

## Phase 0

```
Implement Phase 0 from IMPLEMENTATION_PLAN.md: tokens, features/journey/{types,constants}.ts, components/charts/*
(port from design_files/pe/analytics.jsx and design_files/aj/sheet.jsx: VBars, StackBars, HBars, Donut, Gantt, Heat,
Funnel, Stat, TermBar, MiniDonut, ChartCard, Legend), lib/dates.ts, and KindBadge. Add vitest render tests with fixtures.
```

## Phase 1

```
Implement Phase 1 (backend). Follow DATA_CONTRACTS.md §B and §D exactly for routes, DTOs, collections and indexes,
and §E for the crawler. Create apps/api/src/annotations and apps/api/src/analytics modules; extend assets, jobs and the
lifecycle delete. In crawler/: emit job feed items, records_by_coll, event enrichment fields, and the new
journey/branches.py run in finalize. Add e2e specs (apps/api/test) and pytest tests. Verify with the Treprostinil
fixture in data/treprostinil that /branches returns PAH (trunk), PH-ILD, IPF, PPF, CTEPH and PH-COPD (ended).
```

## Phase 2

```
Implement Phase 2: shell (sidebar "Your assets", crawl chip, notifications, Add asset), CommandPalette with global ⌘K,
the Home dashboard per README §5.2 (PortfolioTimeline with range Seg and competitor toggle, What changed, Next milestones,
Crawls, Tracked asset cards with sparkline, Competitive signals, Asset AI starters), and Asset Search per README §5.3 with
KindBadge, kind counts and grid view. Reference design_files/pe/{shell,home,pages}.jsx for layout and copy.
```

## Phase 3

```
Implement Phase 3: the live build on Overview (README §6.1). Port the AgentPipeline geometry from design_files/aj/graph.jsx
(1100×470 stage, node coordinates are final) and BuildStrip / FormingTimeline / JustAdded / ActivityLog from
design_files/aj/live.jsx. Replace the prototype's simulated clock (aj/engine.jsx) with useJobProgress + useJobFeed
(poll 2 s while running). Update the chat JobCard. Show the live build when asset.status === 'onboarding' or ?build=1.
```

## Phase 4

```
Implement Phase 4: JourneySection with HorizontalTrack as the DEFAULT view (README §6.3; port design_files/aj/horizontal.jsx,
including hover band → date pill → note composer; note the svg-inside-translated-track coordinate rule) and JourneyTree
as the alternate (README §6.2; port design_files/aj/story.jsx: geometry, fork/closed rows, sticky labels, gutter
hover-to-add, subtree, lit trunk, parallax). Build EventDetailSheet (README §6.4; port design_files/aj/sheet.jsx) and
use it for every journey-event click across the app. Implement ?focus=<eventId> deep links and
"Show on the journey timeline". Persist the orientation via /me/prefs and filters via URL params.
```

## Phase 5

```
Implement Phase 5: annotations. NoteComposer (README §6.5) with the Where strip (date · branch · after/before), manual add,
and "Ask Asset AI to find it" calling POST /assets/:id/notes/find with the 3-step progress UI and the found/exists/none
results. Stars (cards, horizontal cards, sheet), comments in the sheet, comment counts on cards, note styling by tag,
Starred / Team notes filters. Backend: notes/find pipeline and crawl_feedback for "Missed by AI". Optimistic updates.
```

## Phase 6

```
Implement Phase 6: the asset Analytics tab (README §7.1), TabInsights above every records table (README §7.2), upgraded
records-tab columns/facets/record sheet (README §5.5), and Overview pinned analytics with the Add analytics dialog
(README §7.3; port design_files/pe/overview-analytics.jsx). Backend: /analytics/suggestions and /analytics/build per
ANALYTICS_PIPELINE.md (index first, web fallback; stub web as method:'none' if the search tool isn't wired yet).
Never render analytics values without sources.
```

## Phase 7

```
Implement Phase 7: reduced motion, focus/keyboard, perf (rAF-throttled scroll, memoised geometry, single
IntersectionObserver, virtualised long tables), empty/loading/error states, and Playwright e2e for: onboarding → explore;
horizontal hover → add note; deep-link focus; analytics pin; ⌘K search. Compare against design_files/PharmaEdge Screens.html
at 1440 / 1280 / 1024 / 390 widths and fix deviations. Finish with the acceptance checklist in IMPLEMENTATION_PLAN.md.
```
