# Screen inventory

Every screen and overlay in the design, with its screenshot, route, prototype source, data, states and acceptance notes. Screenshots are in `screenshots/` (captured at 1680×980 effective, scaled 55%). Live versions are in `design_files/PharmaEdge App.html`. The gallery `design_files/PharmaEdge Screens.html` deep-links to each one.

Prototype deep link format: `PharmaEdge App.html#page=…&id=…&tab=…&sim=done|30&focus=<eventId>&orient=h|v`. Production routes are the react-router paths shown.

| # | Screen | Screenshot | Production route | Prototype source |
|---|---|---|---|---|
| 1 | Home dashboard | `01-home-dashboard.jpg` | `/` | `pe/home.jsx` |
| 2 | Asset Search, table | `02-asset-search-table.jpg` | `/assets` | `pe/pages.jsx` `AssetSearchPage` |
| 3 | Asset Search, grid | `03-asset-search-grid.jpg` | `/assets?view=grid` | same |
| 4 | Asset AI | `04-asset-ai-chat.jpg` | `/chat`, `/chat/:sessionId` | `pe/chat.jsx` |
| 5 | Command palette (⌘K) | `05-command-palette.jpg` | overlay, any route | `pe/shell.jsx` `CommandPalette` |
| 6 | Asset Overview: KPIs + pinned analytics | `06-overview-kpis-pinned-analytics.jpg` | `/assets/:id/overview` | `pe/asset.jsx`, `pe/overview-analytics.jsx` |
| 7 | Journey, horizontal (default) | `07-journey-horizontal.jpg` | `/assets/:id/overview?view=h` | `aj/story.jsx` + `aj/horizontal.jsx` |
| 8 | Journey, horizontal hover date | `08-journey-horizontal-hover-date.jpg` | same | `aj/horizontal.jsx` (`bandMove`) |
| 9 | Journey, tree with fork | `09-journey-tree-fork.jpg` | `/assets/:id/overview?view=v` | `aj/story.jsx` |
| 10 | Journey, tree card subtree | `10-journey-tree-subtree.jpg` | same | `aj/story.jsx` `TreeCard`/`TreeNode` |
| 11 | Event detail sheet | `11-event-detail-sheet.jpg` | overlay, `?focus=<eventId>` | `aj/sheet.jsx` `EventDetail` |
| 12 | Note composer | `12-note-composer.jpg` | overlay | `aj/notes.jsx` `NoteComposer` |
| 13 | Add analytics dialog | `13-add-analytics-dialog.jpg` | overlay | `pe/overview-analytics.jsx` `AddAnalytics` |
| 14 | Analytics tab: stats + pipeline | `14-analytics-tab.jpg` | `/assets/:id/analytics` | `pe/analytics.jsx` `AnalyticsTab` |
| 15 | Analytics tab: charts | `15-analytics-tab-charts.jpg`, `15b-…` | same | same |
| 16–23 | Records tabs: Evidence, Clinical, Regulatory, Publications, Conferences, Documents, Company IR, Patents | `16-…` to `23-…` | `/assets/:id/{tab}` | `pe/records.jsx` + `pe/records-data.js` + `TabInsights` in `pe/analytics.jsx` |
| 24 | Competitors tab | `24-tab-competitors.jpg` | `/assets/:id/competitors` | `pe/asset.jsx` `CompetitorsTab` |
| 25 | Analytics, asset without curated records | `25-analytics-sotatercept.jpg` | `/assets/sotatercept/analytics` | same (fallbacks) |
| 26 | Competitor asset | `26-competitor-yutrepia.jpg` | `/assets/yutrepia/competitors` | same |
| 27 | Crawl jobs | `27-crawl-jobs.jpg` | `/jobs` | `pe/pages.jsx` `JobsPage` |
| 28 | Crawl job, failed | `28-crawl-job-failed.jpg` | `/jobs/:jobId` | `pe/pages.jsx` `JobPage` |
| 29 | Uploads (coming soon) | `29-uploads.jpg` | `/uploads` | `pe/pages.jsx` `UploadsPage` |
| 30 | Settings | `30-settings.jpg` | `/settings` | `pe/pages.jsx` `SettingsPage` |
| 31 | Live build (onboarding) | `31-live-build-overview.jpg` | `/assets/:id/overview` while onboarding, or `?build=1` | `aj/live.jsx`, `aj/graph.jsx` |
| 33 | Crawl job, live | `33-crawl-job-live.jpg` | `/jobs/:jobId` | `pe/pages.jsx` |
| 34 | Home during onboarding | `34-home-during-onboarding.jpg` | `/` | `pe/home.jsx` |

The standalone single-asset prototype `design_files/Asset Journey Live.html` contains screens 7–12 and 31 without the app shell.

---

## Per-screen detail

For each screen: **Data** = endpoints/hooks (see DATA_CONTRACTS), **States** = loading / empty / error / special, **Interactions**, **Acceptance**.

### 1. Home dashboard
- **Data:** `useAssets`, `usePortfolioTimeline(range, competitors)`, `useHomeSignals` (existing `/signals`), `useJobs({status:'running'})`, `useMe()`.
- **Layout:** hero (date, greeting, summary sentence, Ask input) → KPI strip (5) → Portfolio timeline panel → 2-col (What changed | Next milestones + Crawls) → Tracked assets grid → 2-col (Competitive signals | Asset AI starters).
- **States:** skeleton rows per panel; "Quiet quarter / No new key events in the last 90 days." empty; while onboarding, the asset's timeline row shows "Building · n%" and fills live.
- **Interactions:** range Seg (±1 year / 3 years / All time); Show competitors switch; dot hover tooltip (title, asset · date); dot click → Event detail sheet with "Show on the journey timeline"; asset chip → asset; cards → asset Overview; Crawls card → live build.
- **Acceptance:** the counts in the hero sentence and KPI strip match the data; the timeline updates while a job runs.

### 2–3. Asset Search
- **Data:** `useAssets()` (add `brand`, `regions`, `kind`, `competitorOf`, `latestEvent`, `counts.events`).
- **Interactions:** search; kind Seg with counts **All 9 / Primary 4 / Competitors 5**; table/grid toggle (URL `?view=`); row/card → asset.
- **KindBadge:** Primary = primary-soft/primary; Competitor = orange-soft/#9a3f06; tooltip text as in the README.
- **Empty:** "No assets match "q"" / "Add it with Asset AI to start building its journey."

### 4. Asset AI
- Existing chat plus: history sidebar (260px), the identity card (existing), a **live job card** (segmented bar, records/events/sources counters, "Watch the live build"), event citations open the Event detail sheet, follow-up chips, `?ask=` auto-send and `?intent=add` prefill.

### 5. Command palette
- **Data:** `useSearch(q)` (debounced 150 ms). Groups: Assets (≤6), Events (≥2 chars, ≤6), Pages, Actions. Keyboard ↑/↓/↵/esc; hover selects; the selected row shows an arrow.

### 6. Overview: KPIs + pinned analytics
- KPI strip (existing component). **Pinned analytics** header ("Analytics · Pinned for {name}. Add your own from indexed data, or ask Asset AI to build one.") with Reset and **Add analytics**; 4-col grid of removable `ChartCard`s; dashed **Add analytics** tile last.
- **Data:** `useAnalyticsPins(id)`, `useAssetAnalytics(id)`.
- **Acceptance:** pins persist per user; Reset restores the defaults; cards degrade when the data is missing (hidden, not erroring).

### 7–8. Journey, horizontal (default)
- **Header card** (shared with the tree): title + counts, "How this journey was built", **Tree / Horizontal** Seg, Key events / All, **Add to timeline**, branch cards (6), category chips, Starred, Team notes, Clear.
- **Track:** branch rows with pinned left labels (dot, label, status/"from 2017"/"closed"); year ruler; parallax background years; cards alternate above/below with connectors; Today line; dashed future; ⊗ caps on closed branches; prev/next arrows; HUD (year · branch · n/N · progress).
- **Hover (screen 8):** dashed vertical guide, "+" ring on the hovered branch row, dark pill **"Feb 11, 2013 · CTEPH · Click to add a note"**. Click → Note composer prefilled.
- **Acceptance:** branch names stay visible while scrolling; the hover date matches the neighbouring cards; click opens the composer with the same date and branch.

### 9–10. Journey, tree
- Trunk + forks; "New branch" rows (dashed, branch colour, rationale, count); sticky branch label pills; repeated vertical lane labels; cards alternate sides (left branches on the left); trunk lights up as you scroll; parallax years; Today divider; "Branch closed" rows.
- **Card** (screen 10): meta (CatIcon, category + type, branch chip, date, significance), title (→ detail), summary, **Targets** (indication pills, product, region), details grid, "Why it matters", footer (via label, ☆, 💬 n, **Subtree n**, **Details →**). **Subtree** shows elbow connectors: record keys → key facts; Indications; Linked journey events (click → scroll + flash + open).
- **Hover-to-add** on the lanes gutter with the same pill as screen 8.

### 11. Event detail sheet
- 560px. Sections in order: type · title · facts · **Show on the journey timeline / Locate on timeline** · summary · Position in the journey strip · Branch lineage + "Event k of n on this branch, x years after …" · Targets · Trial term bar / Patent term bar · Regulatory path · Details · Why it matters · Evidence donut + sources + how it was built · Linked events · Comments (+ composer) · prev/next footer.
- **Data:** `useEvent(id, eventId)`, `useAnnotations(id)`.
- **Acceptance:** opens from every event surface; ←/→ navigate; Esc closes; deep link `?focus=` scrolls the timeline to the event and opens the sheet.

### 12. Note composer
- Where strip (date, branch, after/before); fields; tags; **Add manually** / **Ask Asset AI to find it** → 3-step progress → found / exists / none results.
- **Acceptance:** a saved note appears at that date and branch in both views, with a tag-coloured node and card, and is visible to teammates.

### 13. Add analytics dialog
- Tabs: Suggested by AI (badges From indexed data · n records / Needs web search / Limited public data), From your data (library), Ask for an analysis (textarea, chips, "How this works"). Run view: steps → chart + method badge + note + sources → Add to Overview.

### 14–15, 25. Analytics tab
- 6 stats + chart grid (pipeline matrix, activity by year, trial gantt, phase bars, enrolment hbar, evidence over time, source mix, triage funnel, patent runway gantt, competitive heat, significance donut). Screen 25 shows the fallbacks for an asset without curated trials or patents.

### 16–23. Records tabs
- TabInsights row (2–3 charts) → panel with distribution bar, search, facets, table (columns per README §5.5), "Journey" link column, footer "Showing x of y · N in the record store". Record row → record sheet; "In the journey" → Event detail.
- **Onboarding state:** spill "{step}: queued/running/done" and only the rows collected so far; queued empty state "This tab fills in when "{step label}" runs."

### 24, 26. Competitors / competitor asset
- Cards: tile, name, brand · company, stage tag (Approved / Phase 3), mechanism, indication coverage chips (approved = success, investigational = dashed warning, none = struck-through), "Shared indication and mechanism", Open journey. A competitor asset shows "Competes with" its primaries and a Competitor tag in the header.

### 27–28, 33. Crawl jobs
- List with mini step bars; detail with step glyphs, counts, warnings/errors, running tint and progress; header actions "Live build view" and "Open asset".

### 29. Uploads: coming-soon card. 30. Settings: Profile, Notifications toggles, Team table with Invite.

### 31, 34. Live build
- Build strip, Agent pipeline, Journey taking shape + Just added, Activity log (screen 31). Home during onboarding (screen 34): hero "Treprostinil journey n% built", crawl chip in the top bar, Crawls card live, the timeline row filling, the asset card status %.
