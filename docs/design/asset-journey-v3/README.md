# Handoff: PharmaEdge v3 — Asset Journey, Analytics, Annotations & App Redesign

> Target codebase: `Pharmaedge-Hackathon_maverics/` (web: `apps/web` React 19 + Vite + Tailwind v4 + shadcn/ui + react-router + TanStack Query + lucide-react + sonner + zustand; api: `apps/api` NestJS + MongoDB + Valkey + LLM service; crawler: `crawler/` Python service with `service/steps.py`, `journey/rules.py`).
> Read this README first, then `SCREENS.md` (every screen with screenshot, route, data, states), `IMPLEMENTATION_PLAN.md` (phased tasks + acceptance criteria), `PHASE_DETAILS.md` (file-by-file changes, component signatures, tests, pitfalls), `DATA_CONTRACTS.md` (types, endpoints, Mongo schemas, crawler changes), `IMPLEMENTATION_PROMPT.md` (copy-paste prompts per phase for Claude Code) and `design_files/ANALYTICS_PIPELINE.md`. Screenshots of all 34 screens/overlays are in `screenshots/`.

---

## 1. Overview

This package covers every change designed in this project, end to end:

1. **Live onboarding build** — when an asset is added, the Overview shows the agent pipeline building the journey in real time (sources → record store → rules/AI → journey), a "journey taking shape" time axis where records land and events crystallise, and a live activity log.
2. **Journey tree** — the finished journey as a vertical **indication-branch tree** (PAH trunk; PH-ILD, IPF, PPF, CTEPH, PH-COPD fork off the programme that led to them; closed branches are capped), with scroll reveal (alternating right/left), parallax year numerals, a trunk that "lights up" as you scroll, sticky branch labels, per-card **subtree** (evidence → indications → linked events), and **hover-to-add** with the exact date.
3. **Horizontal journey** — same data laid out as horizontal branch rows; vertical scroll drives horizontal travel; branch names are pinned on the left.
4. **Annotations** — per-user stars, team comments, and timeline **notes** (tags: Important, Missed by AI, Question, Risk, Opportunity) that can be added manually or by asking Asset AI to find the event (index search → web fallback).
5. **Event detail sheet** — comprehensive, with position-in-journey strip, branch lineage, trial / patent term bars, regulatory path, evidence donut, linked events, comments, prev/next and **"Show on the journey timeline"** deep link from anywhere.
6. **Analytics** — new **Analytics** tab (pipeline matrix, activity by year, trial gantt, phase/enrolment, evidence over time, source mix, triage funnel, patent runway, competitive heatmap, significance), **insight charts above every records tab**, and **pinned analytics on the Overview** with an **Add analytics** flow (library / AI suggestions / ask) that uses indexed data first and public web search only as a fallback (stubbed now, spec in `ANALYTICS_PIPELINE.md`).
7. **App-level redesign** — Home dashboard (portfolio timeline, what changed, next milestones, crawls, tracked-asset cards, competitive signals, Asset AI starters), Asset Search with **Primary / Competitor badges** and grid view, ⌘K command palette, notifications, top-bar live crawl chip, sidebar "Your assets", records tabs with real columns, Crawl job detail, Settings.

## 2. About the design files

The files in `design_files/` are **design references created in HTML/JSX** (in-browser Babel, no build step). They show intended look, data shape and behaviour. **Do not ship them.** Recreate each piece in `apps/web` using the existing patterns (shadcn components, Tailwind tokens from `src/index.css`, `Panel`/`KpiStrip`/`Chip`/`CategoryIcon`/`SignificanceBadge`, TanStack Query hooks in `features/*/api.ts`, react-router routes in `src/routes.tsx`). Where the prototype simulates something (sim clock, canned AI answers, sample data), the plan says what replaces it.

Open `design_files/PharmaEdge App.html` (full app) or `design_files/PharmaEdge Screens.html` (gallery of every screen; each tile deep-links into the app). Deep links use the hash: `#page=asset&id=treprostinil&tab=overview&sim=done&focus=e24&orient=h` (`sim=done` skips the onboarding animation; `sim=30` freezes it mid-build).

## 3. Fidelity

**High-fidelity.** Colours, type, spacing, radii, motion and copy are final and already aligned with the codebase's tokens (`src/index.css`). Rebuild pixel-close using existing primitives. Sample data (anything not in Mongo today — product names per event, "why it matters", branch rationale, analytics sample values) is illustrative; the data must come from the backend changes in `DATA_CONTRACTS.md`.

---

## 4. Design tokens

Existing tokens in `apps/web/src/index.css` are the base (13px root, Geist / Geist Mono, `--primary #2347d9`, `--background #f9fafb`, `--border #e4e7ec`, `--text-secondary #475467`, `--muted-foreground #667085`, success/warning/danger/orange/violet + soft variants). **Add** these:

| Token | Value | Use |
|---|---|---|
| `--hair` | `#eef0f3` | inner dividers (already used inline as `#eef0f3`) |
| `--faint` | `#98a2b3` | tertiary text, axis labels |
| `--cat-regulatory` / soft | `#2347d9` / `#eef2fd` | category = regulatory |
| `--cat-clinical` / soft | `#0b7a6f` / `#e6f4f2` | clinical |
| `--cat-safety` / soft | `#b42318` / `#fef3f2` | safety |
| `--cat-company` / soft | `#e0620f` / `#fdeee4` | company |
| `--cat-ip` / soft | `#6941c6` / `#f4f3ff` | patents |
| collection colours | fda `#2347d9`, ema `#5873e8`, trial `#0b7a6f`, publication `#475467`, conference `#7a5af8`, patent `#6941c6`, company `#e0620f`, articles `#98a2b3` | record ticks, evidence donuts, source dots |
| branch palette (ordered) | `#2347d9`, `#0b7a6f`, `#6941c6`, `#e0620f`, `#0e7490`, `#b54708` | indication branches (trunk first). Assign by branch order; persist on the branch doc |
| note tag colours | Important `#b42318`, Missed by AI `#6941c6`, Question `#2347d9`, Risk `#b54708`, Opportunity `#0b7a6f` | note pins, tag chips |
| star | fill `#fdb022`, stroke `#dc8a0e` | starred events |
| phase colours | P1 `#98a2b3`, P2 `#7a5af8`, P3 `#2347d9`, P4 `#0b7a6f` | trials charts |
| primary badge | bg `--primary-soft #eef2fd`, fg `#2347d9` | Primary asset badge |
| competitor badge | bg `--orange-soft #fdeee4`, fg `#9a3f06` | Competitor asset badge |

Typography (Geist; mono = Geist Mono): page h1 24/30 650 −0.02em · asset name 28/34 650 −0.02em · dashboard greeting 30/36 650 −0.025em · panel title 15/20 600 · tree card title High 21px / Medium 18px / Low 14.5px (650, −0.015em, `text-wrap: balance`) · body 13px/1.45 · small 12–12.5px · micro labels 11px 600 uppercase +0.06em · mono dates/ids 11–12px · KPI values 26–28px 600–650 tabular-nums · parallax year 180px 700 −0.06em, transparent fill, 1.5px stroke `rgba(35,71,217,.11)`.

Radii: panels 14 · tree cards 16 · generic cards/tables 12 · chips/inputs 8 · buttons 10 (h40) / 8 (h32) · pills 999. Shadows: panel `0 1px 2px rgba(16,24,40,.04)` · card hover `0 10px 24px rgba(16,24,40,.08)` · active tree card `0 16px 40px rgba(35,71,217,.10)` · popover `0 12px 32px rgba(16,24,40,.14)` · sheet `-16px 0 40px rgba(16,24,40,.16)` · dialog `0 24px 60px rgba(16,24,40,.25)`. Focus ring: `0 0 0 3px rgba(35,71,217,.12)` + border primary.

Motion (all respect `prefers-reduced-motion: reduce` → no transforms, instant opacity):
- Ease out: `cubic-bezier(.2,.8,.2,1)`; spring pop: `cubic-bezier(.2,1.6,.4,1)`.
- Card reveal: opacity 0→1, `translateX(±56px) scale(.97)`→none, 700–800 ms, stagger 90 ms per batch (max 4).
- Branch connector draw: `stroke-dashoffset 1→0` with `pathLength=1`, 800 ms, 100 ms delay; node pop scale 0→1 500 ms spring.
- Parallax: year numeral `translateY((rowCentre − probe) × −0.45px)`, probe = 55% of scroll viewport height.
- Trunk lighting: coloured copy of all lane strokes clipped by `<clipPath><rect height = probeY − flowTop>`.
- Horizontal: vertical scroll → `translateX(−p)`; background year layer `translateX(−0.55p)`.
- Live build: agent-graph particles along edges 1.5 s loop (SMIL `animateMotion` in prototype; CSS `offset-path` or canvas acceptable), records drop in 600 ms, events pop 550 ms spring with an expanding ring 1.6 s and a vertical "crystallise" beam 1.3 s.

---

## 5. Screens / views

Routes map to the existing router (`src/routes.tsx`). New = **bold**.

### 5.1 Shell (all pages) — `components/layout/*`
- **Sidebar 232px** (collapsible to 60px): Workspace (Home, Asset Search, Asset AI) · Intelligence (Asset Journey, Company IR, Conferences — asset-scoped as today) · Data (Uploads "Soon", Crawl jobs with live dot while any job runs) · **Your assets** (primary assets, 20px tile with first two letters on `--primary-soft`, building % in warning colour) · footer Settings + Collapse. Mobile (<900px): off-canvas drawer 260px with scrim `rgba(16,24,40,.3)`, opened from a hamburger in the top bar.
- **Top bar 56px**: search trigger (opens palette; `⌘K` / `Ctrl+K` global) · **crawl chip** while a job runs (18px progress ring, "**Treprostinil** · <current step short label>", `%` in primary; click → asset Overview live build) else "✓ All crawls finished" in success · **Add asset** (primary, sm) → `/chat?intent=add` · **notifications bell** with unread badge (danger, 15px) → 350px popover (unread dot, title, sub, relative time; "Mark all read") · account menu.
- **Command palette** (shadcn `CommandDialog`/cmdk): 620px, groups Assets (tile + brand · company · competitor), Events (≥2 chars; title or NCT ID), Pages, Actions ("Add an asset", "Ask Asset AI: “q”"). ↑/↓/↵/esc; footer key hints.

### 5.2 Home `/` — `features/home/home-page.tsx` (rewrite)
Order (gap 20px):
1. **Hero**: date (12.5px muted), "Good morning, {first}" 30px, summary sentence ("**N new events** in the last 30 days (k high-significance) · **M milestones** in the next 6 months · Treprostinil journey **62% built**"); right: Ask Asset AI input 46px (violet sparkle, send button 34×34) → `/chat?ask=`.
2. **KPI strip** (existing `KpiStrip`): Tracked assets (primary count, "x competitors monitored") · New events (90d) · Upcoming milestones (12 mo) · Records collected · Crawls running.
3. **Portfolio timeline** panel: left 210px row labels (tile, name, company or "vs X" for competitors, live "Building · 62%" with blinking dot), right SVG; rows 46px alternating `#fafbfc`; category-coloured dots (High r6.5 / Med r5 / Low r3.6; milestones hollow dashed); today dashed line + "Today"; future hatched (45° 6px pattern `#eef0f3`); range Seg ±1 year / 3 years / All time; "Show competitors" switch; hover tooltip; click dot → Event detail sheet. While onboarding, the asset's row fills live.
4. Grid `1.45fr / 1fr`: **What changed** (90-day High+Medium events grouped Last 7 / 30 / 90 days; CatIcon 30, title, asset chip, competitor tag, date, "AI · n sources") | column: **Next milestones** (date block 46px, title, asset, countdown, proximity bar) + **Crawls** (live job card with segmented step bar + last 3 jobs with JobStatusBadge).
5. **Tracked assets** cards (auto-fill ≥270px): tile 36, name, brand·company, status pill (building % or approved regions), indication tags (investigational dashed), **sparkline** (events per year 2015→2027, current year primary, future dashed), Latest event, footer counts + next milestone countdown.
6. Grid: **Competitive signals** (competitor events, "vs X") | **Asset AI** starters (4 questions + "Add an asset by chatting").

### 5.3 Asset Search `/assets` — `features/assets/pages/asset-search-page.tsx`
Search input (name, brand, company, indication, mechanism) · Seg **All 9 / Primary 4 / Competitors 5** (counts) · view toggle table/grid. Table columns: Asset (tile + name + **KindBadge** + brand·company + "vs …" for competitors) · Indications (tags; investigational dashed) · Approved in · Status (Collecting % / Ready) · Events · Latest update (title + date). Grid = tracked-asset card variant with KindBadge. **KindBadge**: 19px pill, 10.5px 600, 5px dot; tooltip "Primary asset · full crawl" / "Competitor of X · light crawl".

### 5.4 Asset layout `/assets/:id/*` — `asset-layout.tsx`
Header unchanged except status pill logic. Tabs: **Overview · Analytics (new)** · Evidence · Clinical · Regulatory · Publications · Conferences · Documents · Company IR · Patents · Competitors (count badge). Overview tab shows a blinking warning dot while onboarding.

#### Overview — onboarding (`asset.status === 'onboarding'` or `?build=1`) → **Live build** (§6.1)
#### Overview — ready → KPI strip → **Pinned analytics** (§7.3) → **Journey** section (tree or horizontal, §6.2–6.3)
#### **Analytics** tab (§7.1)
#### Records tabs → **TabInsights** row (§7.2) + existing records table, upgraded columns (§5.5)
#### Competitors → existing tab (cards with indication coverage chips approved/investigational/none)

### 5.5 Records tabs columns (replace generic lists)
- Clinical: NCT ID (mono) · Study (acronym bold + title) · Phase tag · Status badge (recruiting/active → primary, completed → success, terminated → danger, unknown → muted) · Indication pill (success-soft) · Sponsor (muted if not company) · Enrolment · Start → primary completion (mono). Toggle "Company-sponsored only". Facets: phase, status, indication.
- Regulatory: Date · Region tag · Record type · Application (mono) · Product · Class · Status. Facets region/type/status.
- Publications: PMID · Title · Journal (italic) · Year · Design tag. Conferences: Congress · Date · Abstract · Format (Late-breaking = danger tag). Documents: icon + title · Type · Date · Pages. Company IR: Date · Press release · Category. Patents: Patent · Title · Covers · Assignee · Granted · Expiry · Status. Evidence: Date · Record (title + domain) · Decision (Ingest/Headline/Skip verdict pills) · Reason.
- Every tab: distribution bar (first facet, clickable legend filters), search, facet selects, rows animate in (fadeUp 350 ms, 25 ms stagger capped at 12), last column "Journey" → link dot when the record backs an event; row click → record sheet (all fields grid + "In the journey" → Event detail). While onboarding, show "{step}: queued/running/done" pill and only the rows collected so far.

### 5.6 Asset AI `/chat` — `features/chat/*`
Keep current architecture. Add: job card uses live job (segmented step bar, records/events/sources counters, "Watch the live build" → `/assets/:id/overview?build=1`); citations open the **Event detail sheet** (not RecordSheet) when the citation is a journey event; `?ask=` auto-sends; `?intent=add` prefills "Add ".

### 5.7 Crawl jobs `/jobs`, `/jobs/:id`
List: Asset (tile + name) · Type · Status · Steps `x/y` + 64px mini bar · Requested by · Started · Duration. Detail: header actions (status, "Live build view", "Open asset"), steps list with status glyph (pending dashed, running spinner, done success disc, failed x, warning triangle), mono counts line, error/warning text, running step tinted `#f8f9fe` with progress bar.

### 5.8 Settings — Profile, Notifications toggles (High-significance events; crawl finished/failed; weekly digest), Team table.

---

## 6. Journey views (the core)

### 6.1 Live build (onboarding) — `features/journey/live-build/*`
- **Build strip** (panel): status dot (pulsing ring) · title "Planning the crawl" → "Building the journey" → "Journey ready" · sub "Step k of 17 · {label}" · stats Records / Events / Sources x/12 / Elapsed (22px) · **segmented bar** (one segment per step, `flex-grow = expected duration`, pending `--accent`, running striped primary with `--p` width, done primary, done-with-warning `#dc8a35`) · stage labels Collect / Build / Expand / Finalize. When done: success border + "Explore the journey →".
- **Agent pipeline** (fixed 1100×470 design space scaled to width, min 0.58, centred): columns Source agents (12 nodes 206×28: status glyph, short label, record count) → Record store (8 collection nodes 176×38: mono name, count, fill bar) → Reasoning (Rules engine, AI triage [AI tag], Event extraction [AI tag], Search index; 228×60 with tile, sub-status, progress bar) → Outputs (Journey node 240×230 with big event count, category stack bar + legend, footer "rules · ai · rebuild"; Asset AI node; Competitor set node 88px tall listing chips). Nodes spawn during the planning phase (dashed "planned" state), collection nodes appear on first record. Edges draw in; active edges get coloured particles. Legend Planned / Running / Done.
- **Journey taking shape**: SVG with 5 category lanes (30px) + records strip; records land as 1.6×8 ticks coloured by collection; events pop on their lane with ring + beam; today line; future hatched; hover tooltip; **Just added** list (last 5, animated in).
- **Activity log** (380px column, auto-scroll unless user scrolled up): mono clock, step tag, text kinds: info, done ✓, warn ⚠, AI verdict pills (Ingest / Headline / Skip), event "+" with merged-records chip, typing caret on the latest line.
- Source of truth: job feed endpoint (DATA_CONTRACTS §B.2). Poll every 2 s while running (existing `useJob` cadence) or SSE.

### 6.2 Journey tree (vertical, default) — `features/journey/tree/*`
- **Header** card: title, description ("37 events, 2002–2028 · 6 indication branches…"), actions: "How this journey was built" (→ `?build=1`), Seg **Tree / Horizontal** (persist per user, `localStorage aj.orient` → move to user prefs later), Seg Key events / All, **Add to timeline** (primary). **Branch cards** grid (auto-fill ≥190px): dot + label (branch colour) + "Trunk" / "from {parent}" + count; full name; status ("Approved · US, EU · since 2002", closed branches warning colour). Click = focus branch (others fade to .3/.18). Category chips with counts, divider, **Starred** and **Team notes** chips, Clear.
- **Geometry** (`useTreeGeometry`): measure after layout (`useLayoutEffect` + `ResizeObserver`); `narrow = flowWidth < 980`. Lane gap 40px (wide) / 16px (narrow). Trunk x = centre shifted by `(gutterLeft − gutterRight)/2` where gutters = `(-minOff)·gap+30` and `maxOff·gap+30`. Narrow: trunk at `14 + (−minOff)·16`, all cards on the right. Branch `off` (negative = left of trunk) comes from the branch doc.
- **Rows** (in date order): Year marker (pill + "n events" + parallax numeral), Today marker (black pill with blinking dot; lines solid above, dashed below), **Fork row** before a branch's first event ("New branch · {full}" + "Forked from {parent} · {why}" + count; dashed border in branch colour), Event card, **Branch closed** row after the last event of an ended branch (lane gets an ⊗ cap; draw cap in an inner `<g>` so the CSS scale doesn't override the SVG translate).
- **Card**: width `(100% − gutters)/2 − 8px`; side = branch side (trunk events alternate r/l). Content: optional note header (tag colour), meta (CatIcon 28, category + type, **branch chip**, date mono, countdown for milestones, significance), title (button → detail), summary, **Targets** (indication pills in category soft colour, product pill, region tag), details grid (auto-fill 140px cells), "Why it matters", footer (via label, ★ star toggle, 💬 comments count, **Subtree** toggle with node count, **Details →**). Starred card: 2px inset ring `#fdb022`. Note card: border + faint gradient in tag colour.
- **Subtree** (elbow connectors 1.5px `#d0d5dd`, 7px radius): "Consolidated from N records" → record keys (collection dots) / single record → key facts; "Indications"; "Linked journey events" (click → scroll + flash + open detail).
- **SVG layers**: base grey lanes; lit coloured copy clipped to scroll probe; repeated vertical branch labels along each lane every 620px (10px 700 uppercase, rotated 90°); fork curves from parent lane; card connectors (draw on reveal); nodes (trunk-colour fill, white stroke; milestones hollow dashed; notes white fill with tag-colour stroke; active r8); span bridges for multi-branch events (dotted line + 3.5px secondary dots).
- **Sticky branch labels**: wide → pills at top of flow, staggered on two rows, appear when the scroll probe passes the branch start; narrow → sticky chip bar with all branches (started ones opaque).
- **Hover-to-add**: transparent gutter over the lanes area (`cursor: copy`). On move: nearest started lane by x; date interpolated linearly between the nearest event nodes above/below by y (day clamp 1–28); show a "+" ring on the lane and a dark pill "**Apr 27, 2005** · PAH · Click to add a note". Click → Note composer prefilled (date, branch, prev/next event titles).
- **HUD** (sticky bottom pill): year · branch chip · `03/37` · progress bar.
- **Deep link** `?focus=<eventId>`: after geometry is ready, scroll so the card sits at 30% of viewport, flash (box-shadow pulse 1.8 s), open detail. If filtered out, reset filters and retry (max 3).

### 6.3 Horizontal journey — `features/journey/horizontal-track.tsx`
- Sticky pin (height = scroll viewport) inside an outer block of height `maxP + vh`, where `maxP = trackWidth − viewportWidth`. Translate track by `−p` where `p = clamp(−outerTop, 0, maxP)`.
- Layout constants: column 178px per event, card 304px, left pad 236px, row 34px, card area 196px above and below, ruler 30px; vertically centred.
- Rows = branches sorted by `off`. Lanes start 74px before their first event, fork curve from parent row; trunk starts at pad − 110. Solid to today x (midpoint between last past and first milestone), dashed after. Inline branch label pill at lane start. Ended lanes capped.
- Cards alternate above/below; connector from node to card edge. Reveal when `x − p < vw − 40` (monotonic).
- **Pinned left labels** (200px, gradient fade): dot, label, status/"from 2017"/"closed"; faded until started (`x1 ≤ p + 0.75·vw`).
- Parallax background years at `0.55×`, de-duplicated so numerals are ≥520px apart.
- Prev/next arrows; hover band → dashed guide + "+" on the hovered row + date pill; click → Note composer (date, branch, prev/next). **Bug to avoid**: the SVG lives inside the translated track, so `clientX − svgRect.left` is already a track coordinate (don't add `p`).

### 6.4 Event detail sheet — `features/journey/event-detail-sheet.tsx` (replaces event usage of `RecordSheet`)
560px right sheet (shadcn `Sheet`). Header: CatIcon + category, branch chip, note tag; star toggle; close. Body sections: type (mono, capitalised) · title 20px · facts (date or "Expected …" + countdown, region/phase/NCT tags, significance) · **Show on the journey timeline** / **Locate on timeline** · summary · **Position in the journey** (SVG strip of all asset events, current r7 with halo, click a dot to navigate, "#k of n") · **Branch** lineage chips (PAH › PH-ILD › IPF) + "Event k of n on this branch, x years after '…'" · Targets · **Trial** term bar (start → primary completion, today marker, `Phase · n=`) · **Patent term** bar (grant → expiry) · **Regulatory path** (all records for the same product, current highlighted) · Details grid · Why it matters · **Evidence** (donut by collection + source list with "Open" → record sheet) + how it was built (rule / AI consolidation / rebuild / user) · **Linked events** · **Comments** (avatar initials, name, date, text; textarea Enter = send). Footer prev/next (truncate titles). Keys: ← / → / Esc (ignored inside inputs).

### 6.5 Note composer — `features/journey/note-composer.tsx`
560px dialog. **Where strip** (top): calendar icon, **date** (13.5px bold), branch dot+label, "after '…' · before '…'" — live-updates. Fields: What happened? · Context for Asset AI (optional) · Date · Branch · Category · Tag chips. Actions: **Add manually** | **Ask Asset AI to find it** → 3 animated steps (Reading your note → Searching FDA/EMA/ClinicalTrials.gov/PubMed → Searching news, press releases and competitor journeys) → result: **found** (proposed event with sources → "Add to journey"), **exists** (matching journey event → jump), **none** ("Keep as a note"). After save: close, scroll to the new note, open its detail.

---

## 7. Analytics

### 7.1 Analytics tab — `features/analytics/analytics-tab.tsx`
Stat row (auto-fit ≥170px, 1px dividers): Approved indications · In development (labels) · Active trials (Phase 3 count, patients) · Next catalyst (countdown + title) · Patent runway (years to next non-invalidated expiry) · Evidence records. Chart grid 4 columns (2 at ≤1180px, 1 at ≤700px; cards use container queries):
Development pipeline (span 2; rows = branches; stages Phase 1 → Phase 2 → Phase 3 → Filed → Approved; bar to `(stage+.55)/5`; terminated = hatched grey + "· terminated"; right column next milestone + countdown) · Journey activity by year (span 2; stacked by category; hover tooltip) · Clinical trial timeline (span 2; gantt start→PCD, phase colour, dashed if terminated/unknown, today line) · Trials by phase · Enrolment by indication · Evidence collected over time (span 2; records per year by collection) · Source mix (donut) · AI triage funnel (Unstructured → Relevant → Ingested → Candidates → Journey events, step %) · Patent runway (span 2; gantt grant→expiry, invalidated red dashed) · Competitive landscape (span 2; heat: asset + competitors × indications: Approved / In trials / —) · Significance mix.

### 7.2 Tab insights (above each records table)
Clinical: Phase bars · Status donut · Trial starts by year (company vs investigator). Regulatory: activity by year (US vs EU) · Outcome donut · By product. Publications: per year (all records) · Design donut · Journals. Conferences: congress × year heat · Format donut. Company IR: releases by year × topic · Topics donut. Patents: term gantt · Status donut. Evidence: triage funnel · Decisions donut · Top sources. Documents: types donut · pages by document. Fallback (assets without curated records): records by year by collection + collections donut.

### 7.3 Overview pinned analytics + Add analytics
Section "Analytics — Pinned for {asset}" with Reset and **Add analytics**. Defaults: with trial data → pipeline, next milestones, activity, trials by phase, enrolment; otherwise activity, milestones, significance. Each card removable (×). Dashed "Add analytics" tile at the end. Dialog tabs: **Suggested by AI** (rows: title, why, sources, badge `From indexed data · n records` (success) / `Needs web search` (warning) / `Limited public data` (danger), Build / Search & build) · **From your data** (template library, Add/Added) · **Ask for an analysis** (textarea, example chips, "How this works" 3 steps). Run view: animated pipeline steps → result chart + method badge (Indexed data · no new crawl / Public web sources / Not available) + note + sources → **Add to Overview**. Custom cards show "Asset AI · indexed data / public web sources" and an expandable sources list. Spec: `design_files/ANALYTICS_PIPELINE.md`.

---

## 8. State management (web)

- Server state via TanStack Query (new hooks listed in DATA_CONTRACTS §C). Keys: `['asset', id, 'timeline-v3']`, `['asset', id, 'branches']`, `['asset', id, 'annotations']`, `['asset', id, 'analytics']`, `['asset', id, 'analytics','pins']`, `['job', id, 'feed', since]`, `['portfolio','timeline', range]`, `['notifications']`, `['search', q]`.
- Optimistic updates for star toggle, comments, notes, pins (rollback + `toast.error`).
- UI state: orientation (user pref), scope/categories/mine filters (URL search params so links are shareable: `?view=h&scope=all&cat=clinical&mine=starred&focus=e24`), focused branch, detail event id (`?event=` optional), composer draft.
- Zustand (`stores/shell-store.ts`): add `paletteOpen`, `sidebarCollapsed` (exists), `lastAssetId` (exists).

## 9. Accessibility
Cards are buttons/links with visible focus; timeline SVGs `aria-hidden` with equivalent DOM; sheet/dialog trap focus (shadcn); keyboard: ⌘K, Esc, ←/→ in sheet, Enter to send comment; colour never sole carrier (labels on branch chips, significance text); reduced motion honoured; live regions: build strip `aria-live=polite`, progressbars with `aria-valuenow`.

## 10. Files in `design_files/`
`PharmaEdge App.html` (entry) · `PharmaEdge Screens.html` (gallery) · `Asset Journey Live.html` (standalone journey prototype) · `aj/` (journey engine: `data.js` sample journey + step plan mirroring `PLANS.onboard`, `enrich.js` event enrichment + branches + subtree, `engine.jsx` sim clock, `graph.jsx` agent pipeline, `live.jsx` build strip/forming timeline/log, `timeline.jsx` classic explorer + KPI strip, `story.jsx` tree, `horizontal.jsx`, `sheet.jsx` event detail, `notes.jsx` annotations store/composer, `ui.jsx` icons & primitives, CSS `base.css`, `story.css`) · `pe/` (app: `data.js` portfolio, `records-data.js` curated record tables, `shell.jsx`, `home.jsx`, `asset.jsx`, `records.jsx`, `analytics.jsx` charts + Analytics tab + insights, `overview-analytics.jsx`, `pages.jsx`, `chat.jsx`, `main.jsx`, `analytics.css`) · `ANALYTICS_PIPELINE.md`.

Icons: lucide-react names used — Landmark, FlaskConical, ShieldAlert, Megaphone, Stamp, Pill, Sparkles, Check, Loader2, X, ArrowUpRight, ArrowRight, ChevronLeft/Right, Calendar, RefreshCw, Database, Route, Globe, Newspaper, BookOpen, Users, Search, Presentation, Filter, ArrowDownUp, GitMerge, TriangleAlert, CircleDashed, Home, Building2, Upload, Activity, Settings, Clock, Flag, Menu, Plus, Bell, LogOut, Send, TrendingUp, LayoutGrid, List, FileText, Star, MessageCircle, Columns2, Rows2, ChartColumn. No other assets.
