# Asset Journey v3: implementation design

**Date:** 2026-10-09
**Status:** Approved (design approved in session 2026-10-09)
**Repo:** `Pharmaedge-Hackathon_maverics`
**Builds on:** `docs/superpowers/specs/2026-10-08-asset-journey-platform-design.md`

## 1. What this is

The design team's v3 handoff (`docs/design/asset-journey-v3/`) is the source of truth for screens,
copy, tokens, motion, data contracts and the phase plan. This document does not repeat it. It records:

- how the handoff is delivered (process, verification, commits);
- the decisions taken where the handoff is ambiguous or where real data differs from the prototype;
- additions beyond `DATA_CONTRACTS.md` needed to make the design work on real data.

Read the handoff in this order: `README.md`, `SCREENS.md` (+ `screenshots/`), `IMPLEMENTATION_PLAN.md`,
`PHASE_DETAILS.md`, `DATA_CONTRACTS.md`, `design_files/ANALYTICS_PIPELINE.md`. The HTML/JSX in
`design_files/` is a design reference only and is never shipped.

**Goal:** every item of the handoff's acceptance checklist (`IMPLEMENTATION_PLAN.md`, "Acceptance
checklist") holds on the running stack with real data, with no regression in existing tabs, chat, jobs
or auth.

## 2. Delivery process

- Phases 0–7 exactly as in `IMPLEMENTATION_PLAN.md`, in order. Each phase gets its own implementation
  plan in `docs/superpowers/plans/2026-10-09-v3-phase-<n>-<topic>.md`, written just before the phase
  starts (so it matches the code the previous phase left).
- A phase is done when:
  1. `apps/web`: `npm run lint`, `npx tsc -b`, `npm test` pass;
  2. `apps/api`: `npm run lint`, `npm test` (unit + e2e) pass;
  3. `crawler/` (when touched): `pytest` passes in the repo `.venv` (test deps installed there);
  4. the phase's "Done when" criteria are checked against the local Docker stack.
- One commit per phase on `main`. The user's own uncommitted `infra/mongo/*` edits are never staged.
- Before the first data write (Phase 1) a `mongodump` backup of the local database is taken. Data
  writes are additive (new collections, new optional fields); nothing existing is deleted except what
  the existing rebuild logic already replaces.
- Local Docker containers (`api`, `crawler-api`, `crawler-worker`, `web`) are rebuilt at the end of a
  phase that changes them, so the app at `http://localhost:8080` reflects the work.
- After Phase 7: a full `/audit` (accessibility, performance, theming, responsive, anti-patterns) and
  fixes for what it finds.

## 3. Decisions on ambiguities

| Topic | Handoff says | Decision |
|---|---|---|
| Default journey view | README §6.2 calls the tree "default"; IMPLEMENTATION_PLAN Phase 4, SCREENS 7 and the acceptance checklist say horizontal | **Horizontal is the default**; the tree is the alternate. |
| Web-search fallback (analytics build, notes/find) | May be stubbed as `method:'none'` | **Real**: OpenAI Responses `web_search` tool restricted to the allow-list in `ANALYTICS_PIPELINE.md` §2, behind `ANALYTICS_WEB_SEARCH=1` (on locally). Off → `method:'none'`. |
| Live updates | Poll 2 s, optional SSE | Polling only. |
| Records table virtualisation (>200 rows) | Virtualise | Not needed: records tabs stay server-paged (page size ≤100). |
| Analytics recompute at finalize | Crawler calls the API, or computes in Python | Computed in the API on request, cached with the existing per-asset versioned Valkey cache (the crawler already bumps the version when a job ends) and persisted to `asset_analytics`. |
| Weekly digest toggle (Settings) | Toggle | Persisted in prefs; no email is sent (no mail infrastructure). |
| Uploads | "Coming soon" | Stays coming soon. |

## 4. Real data vs the prototype

The prototype journey has ~40 curated events. Real data has far more (Treprostinil: 909 events, 176
High, many near-duplicates such as six separate "TETON-2 met primary endpoint" events), and existing
events carry none of the v3 enrichment fields. Three additions make the design hold on real data.

### 4.1 Key events (`journey_events.key`)

- New crawler module `journey/key_events.py`, run in `finalize` after branches are assigned.
- `key = true` when the event is High significance, or a High/Medium milestone, and it is
  company-relevant (non-clinical, or company-sponsored clinical, or AI-extracted). Near-duplicates
  (same `type` and branch within ~45 days) collapse to one key event: the rule event if present,
  otherwise the one with the most sources. Team notes (`via:'user'`) always count as key.
- Target: roughly 40–80 key events for a primary asset.
- API `GET /assets/:id/timeline` gains `scope=key|all` (default `all`, so existing callers are
  unchanged). The journey "Key events / All" switch and the Home portfolio timeline use it.
- "All" renders only the cards near the viewport (windowed), so long journeys stay smooth.

### 4.2 Indication branches (`journey/branches.py`)

- Candidates: the asset's approved and investigational indications plus conditions of
  company-sponsored, started (not withdrawn) Phase ≥2 trials and indications on regulatory events.
- Conditions are normalised with a synonym table (PAH, PH-ILD, IPF, PPF, CTEPH, PH-COPD, …), then an
  LLM groups what remains into strategic indication programmes.
- A branch needs an approval or a started company Phase ≥2 trial.
- The trunk, parent (`from`), `why`, `ended`, `status`, `off` and colour rules follow
  `DATA_CONTRACTS.md` §E.5. Parent and `why` come from an LLM call. Branches with `origin:'user'` are
  never overwritten.
- **Acceptance (Treprostinil):** the six fixture branches exist with the expected parents, fork years
  and `ended` state: PAH (trunk), PH-ILD (from PAH), IPF (from PH-ILD), PPF (from IPF), CTEPH
  (from PAH), PH-COPD (from PAH, ended). Extra closed programmes found in real data (e.g. PH-HFpEF)
  are allowed.

### 4.3 Enrichment (`ai/enrich.py`)

- Rule events get deterministic `indications`, `product`, `details` and `links` in `journey/rules.py`
  (`DATA_CONTRACTS.md` §E.3).
- AI extraction returns `indications`, `product`, `impact` and `links` for new events (§E.4).
- An enrichment pass in `finalize` fills `impact`, `product`, `indications` and `links` on key events
  that lack them, batched (~20 events per call, triage model, cached by content hash). A one-off
  backfill runs it over every existing asset in Phase 1.

## 5. Additions beyond DATA_CONTRACTS

- **Job feed:** a separate `job_feed` collection `{ job, id, t, step, kind, text, verdict?, event_id?,
  merged? }` with a per-job monotonic `id` (the cursor), index `{job:1, id:1}`. Written by the
  pipeline (step start/done) and by steps (notable lines, AI verdicts, events).
- **Record-year histogram:** `JobProgress` includes `record_years: {coll, year, n}[]` for the asset so
  the live build's forming timeline places record ticks at real years.
- **Notifications:** stored per user (fan-out to active users at write time) and filtered by the
  Settings toggles. The crawler writes onboarding started/finished, job failed and new High events on
  primary assets when a job ends; the API writes "new comment on a starred event".
- **Event sheet host:** one `EventDetailSheet` mounted in `AppLayout`, opened through a small zustand
  store from any surface (Home, chat citations, records tabs, competitors, journey).
- **Records ↔ journey link:** records list items include the ids of journey events that cite them
  (`sources` or `merged_sources`), for the "Journey" column and the record sheet's "In the journey".

## 6. Architecture summary

- **Web (`apps/web`):** new `components/charts/*` (pure SVG, no Recharts), `features/journey/*`
  (types, constants, hooks, journey section, horizontal track, `tree/*`, event detail sheet, note
  composer, `live-build/*`), `features/analytics/*`, `features/home/components/*`,
  `components/layout/{crawl-chip,notifications-popover,command-palette}`. cmdk via
  `npx shadcn add command`. Filters live in URL params, orientation in `/me/prefs` (localStorage
  fallback). Optimistic mutations with rollback and `toast.error`.
- **API (`apps/api`):** new modules `annotations`, `analytics`, `portfolio`, `search`,
  `notifications`, `prefs`, a `WebSearchService`; extended `assets` (timeline v3, branches, event
  detail, records insights/years, record→event links) and `jobs` (progress, feed).
- **Crawler (`crawler/`):** feed emission, records per collection, rule and AI enrichment,
  `branches.py`, `key_events.py`, `enrich.py`, `crawl_feedback` handling and notifications in
  `finalize`/job end.

## 7. Testing

- Web: vitest render tests for charts; unit tests for tree geometry, hover-date interpolation and
  dates; component tests for palette keyboard navigation, kind counts, composer flows (manual, found,
  exists, none) and sheet keyboard handling, with `fetch` mocked as the existing tests do.
- API: e2e specs per new route on the existing in-memory Mongo test app (`test/helpers/test-app.ts`),
  including permissions (author/admin) and per-user data.
- Crawler: pytest for enrichment fields, branches (trunk choice, assignment, ended, off/colour
  stability, user branches kept), key events, feed order.
- Playwright (Phase 7) against the rebuilt stack: onboarding live build → explore; horizontal hover →
  add note; deep-link focus; analytics pin; ⌘K search. Visual checks at 1440 / 1280 / 1024 / 390.

## 8. Risks

- **LLM cost/latency:** branch grouping, parent selection, enrichment backfill and web search add
  calls. Mitigated by batching, the crawler's content-hash cache and enriching key events only.
- **Data quality:** AI events can be mis-dated or duplicated. Key-event collapsing hides most
  duplicates in the default view; "All" still shows them.
- **Scope:** ~17–20 developer days of work in the handoff. Per-phase plans and per-phase commits keep
  each step reviewable and revertible.
