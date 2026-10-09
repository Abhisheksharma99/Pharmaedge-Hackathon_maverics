# v3 Phase 3: Live Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an asset's crawl building its journey on the Overview (build strip, agent pipeline, "Journey taking shape" with "Just added", activity log) from the real job progress and job feed, and turn the chat job card into a live card that links to it.

**Architecture:** Web only (`apps/web`). Data hooks: `useJobFeed` (new `features/jobs/feed.ts`) accumulates `GET /jobs/:id/feed` by cursor inside the query cache, so a remount resumes where it stopped; `useTimelineV3` and `useEventsById` join `useEvent` in `features/journey/api.ts`; `useLiveBuild(asset)` (in `features/journey/live-build/`) composes the asset's newest job, its progress, its feed, the key-event timeline and the events the feed announces, and reloads the asset when the job ends. Two pure modules carry the logic: `pipeline-layout.ts` (the agent graph geometry, ported verbatim from `aj/graph.jsx`) and `build-model.ts` (phase, stages, counts, record ticks, labels). One presentational component per block (`BuildStrip`, `AgentPipeline`, `FormingTimeline`, `JustAdded`, `ActivityLog`), composed by `LiveBuild`; `OverviewTab` renders `LiveBuild` while the asset is onboarding or the URL has `?build=1`.

**Tech Stack:** React 19, TypeScript 6 (`verbatimModuleSyntax`: type-only imports use `import type`/`type`), Tailwind v4, shadcn, TanStack Query 5.104 (`queryFn` context has `client`), react-router 8, lucide-react, vitest 4 + Testing Library (jsdom), `fetch` mocked with `vi.stubGlobal` as in the existing tests. SVG particles use SMIL `<animateMotion>`/`<mpath>` (typed in `@types/react`).

**Spec:** `docs/superpowers/specs/2026-10-09-asset-journey-v3-design.md` (§2 delivery and phase gate, §3 "Live updates: polling only", §5 job feed + record-year histogram); screens `docs/design/asset-journey-v3/README.md` §4 (tokens, motion, reduced motion) and §6.1, `SCREENS.md` 4 and 31 (+ `screenshots/04-asset-ai-chat.jpg`, `screenshots/31-live-build-overview.jpg`), `IMPLEMENTATION_PLAN.md` Phase 3 and acceptance item 10, `PHASE_DETAILS.md` Phase 3, `DATA_CONTRACTS.md` §A (`JobFeedItem`, `JobProgress`) and §B.2; prototype `design_files/aj/graph.jsx`, `aj/live.jsx`, `aj/data.js`, `aj/base.css`, `pe/chat.jsx` (`JobCardS`); API `apps/api/src/jobs/jobs.controller.ts`; feed writers `crawler/service/pipeline.py`, `crawler/service/steps.py`, `crawler/service/progress.py`.

**Code blocks:** a block whose first line is `// file: <path>` is the complete content of that file (the `// file:` line itself is not part of the file) — a new file, or a full replacement where the step says **Replace** (paths from the repo root). Other blocks are before/after snippets to apply exactly. Commands run from the repo root of your worktree unless they start with `cd`.

## Global Constraints

- Only `apps/web` changes. No new API routes. Phase 3 reads (Phase 1b, on `main`): `GET /api/jobs?asset=<id>` (newest first); `GET /api/jobs/:id` → the job plus `records: {coll,count}[]`, `events_created`, `feed_cursor`, `record_years: {coll,year,n}[]`; `GET /api/jobs/:id/feed?since=N` → `{ items: JobFeedItem[], cursor }` (≤500 items, ascending `id`, the cursor never goes back); `GET /api/assets/:id/timeline?scope=key`; `GET /api/assets/:id/events/:eventId` (event ids contain `:` and `/` — always `encodeURIComponent`); `GET /api/assets/:id`.
- What the crawler actually writes (read `crawler/service/pipeline.py`, `steps.py`, `progress.py`):
  - Feed lines `{ job, id, t, step, kind, text, verdict?, event_id?, merged? }`; `step` is `'plan'` or a crawl step name; `kind` is `info` (plan line, step start = the step label, notable lines), `done` (step summary), `warn` (failed / skipped / cancelled / couldn't fetch), `ai` (triage sample with `verdict` `Ingest` | `Headline` | `Skip`), `event` (`event_id`, `merged` = source count) — event lines are written only for **new High-significance** events, at most 40 per step, by the `journey` and `ai_events` steps.
  - `records` and `record_years` are the asset's whole record store (not this job's additions), measured after every step; `events_created` is the growth of the asset's journey since the job started (0 for most refreshes).
  - Steps: `regulatory, ema_chmp, clinical, publications, conferences, company_site, company_news, news, industry_news, journey, ai_triage, ai_events, index, competitors, fda_calendar, patents, finalize` (the `onboard` order; `refresh` and `competitor` plans reorder or drop some). Source steps (for "Sources x/y") are all but `journey, ai_triage, ai_events, index, finalize`. Step `counts` keys used here: `new` / `*_new` / `*_updated` (records stored), `competitors`, `events` (journey: rule events; ai_events: extracted candidates), `<coll>_ingest` / `<coll>_skip` (triage), `chunks` (index), `suggested_questions` (finalize).
- Agent pipeline geometry (final, `aj/graph.jsx`): design space `1100 × 470`, `AG_OFF = 30`; scale `clamp(width / 1100, 0.58, 1.25)`, centred, wrapper height `470 × scale + 16`, horizontal scroll under the 0.58 floor. Sources `x 16, y 30 + 34i, 206 × 28` in the order `regulatory, ema_chmp, fda_calendar, clinical, publications, conferences, patents, company_site, company_news, news, industry_news, competitors`; collections `x 300, y 44 + 46i, 176 × 38` in the order `fda_records, ema_records, trial_records, publication_records, conference_records, patent_records, company_records, articles`; reasoning `x 548, 228 × 60` at `y 44` (Rules engine), `150` (AI triage), `244` (Event extraction), `348` (Search index); outputs `x 846, width 240`: Journey `y 30, h 230`, Asset AI `y 274, h 70`, Competitor set `y 356, h 88`. Column headings at x 16 / 300 / 548 / 846. The 33 edges of `agEdges()` with its colours and `ty` offsets.
- Forming timeline (`aj/live.jsx`): 5 lanes × 30px (Regulatory, Clinical, Safety, Company, Patents), label column 92px, right pad 14px, records strip 30px, ticks 1.6 × 8 at opacity .55 in the collection colour, dots High r6 / Medium r4.6 / Low r3.4 (milestones hollow with dash `2 1.6`), year labels every 2 years (every 4 below 720px), dashed "Today" line, future hatched (45°, 6px, `#eef0f3`), minimum width 420px.
- Layout (README §6.1): build strip → "Agent pipeline" panel → grid `minmax(0,1fr) 380px` (one column at ≤1180px) of "Journey taking shape" (forming timeline + Just added) and "Activity" (min-height 360px, log fills it). Gaps 20px.
- Polling only (spec §3, no SSE): job list 2 s while a job is active / 15 s otherwise (existing `useJobs`); job progress 2 s while active (existing `useJobProgress`); feed 2 s while the job is active, then only until `cursor ≥ feed_cursor` — a fetch made after the end that brings nothing stops it. The key timeline is refetched only when a new `event` line arrives and when the job ends (again 3 s later).
- Motion (README §4 "Motion", `aj/base.css`): node spawn `ag-in` 0.5 s `cubic-bezier(.2,.9,.3,1.15)` (stagger 60 ms per plan position); running node border + shimmer 1.6 s; edge draw 0.8 s (`pathLength = 1`); 3 particles per **active** edge, r 2.8 (index edges r 2), 1.5 s loop (1.1 s); record ticks drop in 0.6 s; events pop 0.55 s spring `cubic-bezier(.2,1.6,.4,1)` with a ring 1.6 s and a beam 1.3 s; Just added rows 0.55 s; log lines 0.35 s; caret 1 s. **Reduced motion:** the global `prefers-reduced-motion` rule in `index.css` ends every CSS animation at once; particles are SMIL (not covered by CSS) and are not rendered at all under `prefers-reduced-motion: reduce`.
- Copy, verbatim from the handoff: "Planning the crawl" / "Building the journey" / "Journey ready"; "Laying out {n} steps across {k} sources for {asset}"; "Step {i} of {n} · {step label}"; "{e} events from {r} records · finished in {duration}"; stats "Records", "Events", "Sources", "Elapsed" / "Duration"; "Explore the journey"; stages "Collect", "Build", "Expand", "Finalize"; "Agent pipeline" / "Source agents collect records into the store; rules and AI turn them into dated journey events."; legend "Planned", "Running", "Done"; columns "Source agents", "Record store", "Reasoning", "Outputs"; "Waits for structured records", "{n} events by rule", "Waits for unstructured records", "{k} kept · {d} dropped", "Extract, date and consolidate", "{n} events · {m} candidates", "Passages for Asset AI", "{p} passages", "Journey", "Ready" / "Building" / "Waiting", "events", "rules {a} · ai {b} · rebuild {c}", "Asset AI", "Index builds after triage", "{p} passages · {q} questions", "Competitor set", "Top 5 by indication and mechanism"; "Journey taking shape" / "Records land as ticks on the time axis; events crystallise in their lane as rules and AI find them."; "Records", "Today"; "Just added", "{n} events", "Events appear here once the rules engine starts reading structured records."; "Activity" / "Live from the crawl worker" | "{n} entries"; "Plan"; chat card "Watch the live build" / "Open the journey", "{r} records", "{e} events", "{x}/{y} sources"; breadcrumb "Building journey".
- Decisions (spec/handoff silent or the 1b API differs — binding):
  - **The timeline is stale during a crawl.** `/assets/:id/timeline` is served from the API's per-asset versioned cache, which the crawler bumps only when a job ends. So the live build plots `timeline?scope=key` **plus** every event announced by an `event` feed line, each loaded through the uncached `GET /assets/:id/events/:eventId`; it refetches the timeline only when a new `event` line arrives and when the job ends (+3 s, because the crawler marks the job finished just before it bumps the version).
  - **Event counts on the live build count the events it plots** (strip "Events", the Journey node, "Just added", the done sentence), so the page agrees with itself; job cards elsewhere (chat card here, Phase 2's Crawls card) show the job's `events_created`.
  - **No per-step progress exists** (`JobStep` has no `p`): the running segment of the bar is fully striped and animated, and a running reasoning node's bottom bar blinks.
  - Source node counts = records the step stored (`new` + `*_new` + `*_updated` counts), shown once the step is done; collection bars are relative to the largest collection (final totals are unknown).
  - Reasoning sub-lines come from the step's counts when it is done and from the plotted events while it runs (`{n} events by rule` uses `counts.events` once done); while running, AI triage reads "Triaging stored records" and the search index "Chunking records for Asset AI" (wording from `aj/data.js` LOG); a failed or skipped step shows its error.
  - Stage labels are one per run of consecutive steps in the same stage (the refresh plan interleaves Collect and Expand).
  - A failed or cancelled job reads "Crawl failed" / "Crawl cancelled" with "{x} of {n} steps finished" and still offers "Explore the journey"; the Journey node reads "Ready" once the job has ended.
  - The live build follows the asset's **newest** job (`?build=1` carries no job id). New copy for the edge states: an asset never crawled shows a "Live build" panel "No crawl yet" / "Use “Refresh data” to collect this asset’s sources and watch its journey being built."; a load error "The live build couldn't be loaded." (the tone of "The journey couldn't be loaded.").
  - "Explore the journey" clears `build` and also leaves the build of an asset that still reads as onboarding (local state), so it never dead-ends. The Overview switches to the journey by itself when `/assets/:id` (reloaded at job end) says `ready`.
  - After a crawl that announced nothing, Just added says "This crawl added no new high-significance events." (new copy).
  - The forming timeline spans 2000 → today + 3, stretching to older data (not before 1985) and later data (not after today + 6); above ~1,200 records one tick stands for several (`recordTicks`), so the strip keeps its shape.
  - Competitor chips come from the asset's competitor list once the `competitors` step is done ("{n} competitors" until the asset reloads).
  - While the asset is onboarding, the Overview tab shows a blinking warning dot and the breadcrumb reads "Building journey" (screen 31).
  - `aria-live="polite"` sits on the strip's title and sub-line only (the elapsed clock ticks every second); the log is `role="log"`.
  - The non-live Overview stays the current content (KPI strip, timeline, milestones); Phase 4 replaces it with the journey section.
- Tests mock `fetch` with `vi.stubGlobal` and build `Response`s like the existing tests; date-dependent tests fake only `Date` (`vi.useFakeTimers({ toFake: ['Date'] })`) and restore with `vi.useRealTimers()`; polls are triggered in tests with `client.refetchQueries(...)` or `focusManager`, never by waiting 2 s.
- `cd apps/web && npm run lint && npx tsc -b && npm test` green (baseline on `v3-phase-2`: 35 files, 204 tests; oxlint 14 warnings, 0 errors). Tasks do not commit; the phase commits once in Task 12, on `main`, never staging `infra/mongo/*`.

## Review Focus

- **Feed cursor resume across remounts:** leaving the Overview (another tab) and coming back must continue from the cached cursor (`since=3`, not `since=0`) and never show a line twice. Test in Task 2 (`resumes from the cached cursor after a remount`).
- **Out-of-order or duplicate feed lines** (a page `[2, 1, 3]`, then a page repeating line 3): one line per id, in id order, the later copy winning, the cursor never moving back. Tests in Task 2 (`mergeFeed`, `pages by cursor and keeps lines that arrive twice or out of order once`).
- **A job that finishes while the tab is hidden** (polling paused): on return the job reads finished, the feed catches up to the job's last line, and the asset is reloaded (so an onboarding Overview flips to the journey); an asset still marked onboarding whose job had already ended is reloaded on mount. Tests in Task 2 (`feedPollInterval`, `marks a fetch made after the job ended as final`) and Task 10 (`catches up the feed and reloads the asset when the job ended while the tab was hidden`, `reloads an asset still marked onboarding whose job had already ended`).
- **Timeline refetch only on `event` feed items:** an `info`/`done` line must not refetch `/timeline?scope=key`; an `event` line must (once), and its event must be loaded by id and plotted. Test in Task 10 (`refetches the key timeline only when the feed announces an event, and loads that event`).
- **Reduced motion stops particles:** with `prefers-reduced-motion: reduce`, active edges keep their state but render no `[data-particle]`. Test in Task 6.
- **The Overview switching between LiveBuild and the journey:** onboarding → live build with the tab dot and "Building journey"; status flips to ready when the job ends → journey; `?build=1` on a ready asset → live build until "Explore the journey" clears it. Tests in Task 11.
- **Undated or partial-date events** (`""`, `"2020-02"`) on the forming timeline: never plotted at `NaN`, partial dates placed at the start of the period. Test in Task 7.

## Task Dependencies

| Wave | Tasks (mutually independent, run in parallel) | Depends on |
|---|---|---|
| 1 | 1, 2, 3, 4 | — |
| 2 | 5 (1, 4) · 6 (3, 4) · 7 (4) · 8 (4) · 9 (1) · 10 (2, 4) | wave 1 |
| 3 | 11 (1, 4, 5, 6, 7, 8, 10) | wave 2 |
| 4 | 12 (phase gate) | all |

No two tasks touch the same file. Existing files modified, each by exactly one task: `apps/web/src/index.css` → Task 1; `apps/web/src/features/journey/api.ts` → Task 2; `apps/web/src/features/chat/components/cards/job-card.tsx` → Task 9; `apps/web/src/features/assets/pages/tabs.tsx` and `apps/web/src/features/assets/pages/asset-layout.tsx` → Task 11. New files live in `apps/web/src/features/jobs/` (Tasks 1, 2) and `apps/web/src/features/journey/live-build/` (Tasks 3–8, 10, 11), one owner each. Phase 2 files read but not changed: `features/jobs/api.ts` (`useJobs`, `useJobProgress`, `isActive`), `features/jobs/steps.ts` (`STEP_META`, `stepShort`, `stepDuration`, `stepsFinished`, `currentStep`, `jobDuration`), `features/jobs/components/step-bar.tsx` (`StepBar`), `features/journey/types.ts`, `features/journey/constants.ts`, `lib/dates.ts`, `lib/use-element-width.ts`, `lib/use-media-query.ts`.

---

### Task 1: Live-build motion utilities and job counters

**Files:**
- Modify: `apps/web/src/index.css` (live-build animations in the second `@theme` block)
- Create: `apps/web/src/features/jobs/job-counters.ts`
- Test: `apps/web/src/features/jobs/job-counters.test.ts`

**Interfaces:**
- Consumes: `Job` (`features/jobs/api.ts`), `JobProgress` (`features/journey/types.ts`) — existing.
- Produces:
  - `SOURCE_STEPS: ReadonlySet<string>` (the 12 source steps); `sourceProgress(job: Pick<Job,'steps'>): { done: number; total: number }` (source steps with status `done` / source steps in the plan); `recordsTotal(job: Pick<JobProgress,'records'>): number`.
  - Tailwind utilities `animate-ag-in`, `animate-node-run`, `animate-draw`, `animate-pulse-ring`, `animate-stripes`, `animate-tick-in`, `animate-dot-in`, `animate-ring`, `animate-beam`, `animate-row-in`, `animate-log-in`, `animate-caret` (used by Tasks 5–8).

- [ ] **Step 1: Write the failing test**

```ts
// file: apps/web/src/features/jobs/job-counters.test.ts
import type { JobStep } from './api'
import { recordsTotal, SOURCE_STEPS, sourceProgress } from './job-counters'

const step = (name: string, status: JobStep['status']): JobStep => ({
  name,
  label: name,
  status,
  counts: {},
  error: null,
  started_at: null,
  finished_at: null,
})

describe('job counters', () => {
  it('knows the twelve source steps of an onboarding', () => {
    expect(SOURCE_STEPS.size).toBe(12)
    expect(SOURCE_STEPS.has('regulatory')).toBe(true)
    expect(SOURCE_STEPS.has('journey')).toBe(false)
    expect(SOURCE_STEPS.has('finalize')).toBe(false)
  })

  it('counts only finished-and-done source steps against the sources in the plan', () => {
    const steps = [
      step('regulatory', 'done'),
      step('clinical', 'failed'),
      step('news', 'skipped'),
      step('patents', 'running'),
      step('journey', 'done'),
      step('finalize', 'pending'),
    ]
    expect(sourceProgress({ steps })).toEqual({ done: 1, total: 4 })
    expect(sourceProgress({ steps: [] })).toEqual({ done: 0, total: 0 })
  })

  it('adds up the records of every collection', () => {
    expect(recordsTotal({ records: [{ coll: 'fda_records', count: 44 }, { coll: 'trial_records', count: 74 }] })).toBe(118)
    expect(recordsTotal({ records: [] })).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/jobs/job-counters.test.ts`
Expected: FAIL — `Failed to resolve import "./job-counters" from "src/features/jobs/job-counters.test.ts"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/jobs/job-counters.ts
import type { JobProgress } from '@/features/journey/types'
import type { Job } from './api'

/** Steps that collect from a source (the design's "Sources 9/12"); the journey build, triage, index and finalize are not sources. */
export const SOURCE_STEPS: ReadonlySet<string> = new Set([
  'regulatory',
  'ema_chmp',
  'clinical',
  'publications',
  'conferences',
  'company_site',
  'company_news',
  'news',
  'industry_news',
  'competitors',
  'fda_calendar',
  'patents',
])

/** Source steps done / source steps in the job's plan. A failed or skipped source is not done. */
export function sourceProgress(job: Pick<Job, 'steps'>): { done: number; total: number } {
  const sources = job.steps.filter((s) => SOURCE_STEPS.has(s.name))
  return { done: sources.filter((s) => s.status === 'done').length, total: sources.length }
}

/** Records in the asset's store so far (GET /jobs/:id `records`, measured after every step). */
export function recordsTotal(job: Pick<JobProgress, 'records'>): number {
  return job.records.reduce((sum, r) => sum + r.count, 0)
}
```

In `apps/web/src/index.css`, inside the second `@theme {` block (the one with `--animate-blink-dot`):

Before:
```css
    --animate-blink-dot: blink-dot 1.2s ease-in-out infinite;
```
After:
```css
    --animate-blink-dot: blink-dot 1.2s ease-in-out infinite;
    /* live build (README §4 "Motion"; design_files/aj/base.css) */
    --animate-ag-in: ag-in 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
    --animate-node-run: ag-in 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.15) both, shimmer 1.6s linear infinite;
    --animate-draw: draw 0.8s ease-out forwards;
    --animate-pulse-ring: pulse-ring 1.6s ease-out infinite;
    --animate-stripes: stripes 0.6s linear infinite;
    --animate-tick-in: tick-in 0.6s ease-out both;
    --animate-dot-in: dot-in 0.55s cubic-bezier(0.2, 1.6, 0.4, 1) both;
    --animate-ring: ring 1.6s ease-out forwards;
    --animate-beam: beam 1.3s ease-out forwards;
    --animate-row-in: row-in 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    --animate-log-in: log-in 0.35s ease-out both;
    --animate-caret: blink-dot 1s steps(1) infinite;
```

Before:
```css
    @keyframes blink-dot {
        50% { opacity: 0.25; }
    }
}
```
After:
```css
    @keyframes blink-dot {
        50% { opacity: 0.25; }
    }
    @keyframes ag-in {
        from { opacity: 0; transform: scale(0.86); }
        to { opacity: 1; transform: none; }
    }
    @keyframes shimmer {
        from { background-position: 120% 0; }
        to { background-position: -120% 0; }
    }
    @keyframes draw {
        to { stroke-dashoffset: 0; }
    }
    @keyframes pulse-ring {
        0% { transform: scale(0.4); opacity: 0.8; }
        100% { transform: scale(1.3); opacity: 0; }
    }
    @keyframes stripes {
        to { background-position: 11.3px 0; }
    }
    @keyframes tick-in {
        from { opacity: 0; transform: translateY(-14px); }
        to { opacity: 0.55; transform: none; }
    }
    @keyframes dot-in {
        from { transform: scale(0); }
        to { transform: scale(1); }
    }
    @keyframes ring {
        0% { transform: scale(1); opacity: 0.8; }
        100% { transform: scale(3.6); opacity: 0; }
    }
    @keyframes beam {
        0% { opacity: 0; }
        15% { opacity: 0.85; }
        100% { opacity: 0; }
    }
    @keyframes row-in {
        from { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; transform: translateY(-8px); }
        to { opacity: 1; max-height: 60px; }
    }
    @keyframes log-in {
        from { opacity: 0; transform: translateY(5px); }
        to { opacity: 1; transform: none; }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/jobs/job-counters.test.ts && npx tsc -b && grep -c "@keyframes" src/index.css`
Expected: PASS (1 file, 3 tests); `tsc` silent; grep prints `16`.

---

### Task 2: Job feed and journey data hooks

**Files:**
- Create: `apps/web/src/features/jobs/feed.ts`
- Modify: `apps/web/src/features/journey/api.ts` (imports; append `useTimelineV3`, `useEventsById`)
- Test: `apps/web/src/features/jobs/feed.test.tsx`, `apps/web/src/features/journey/api.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`lib/api.ts`), `isActive`, `Job` (`features/jobs/api.ts`), `JobFeedItem`, `JobProgress`, `JourneyEventV3` (`features/journey/types.ts`), `toQueryString` (`features/assets/api.ts`), `EventDetail` (already in `features/journey/api.ts`) — existing.
- Produces:
  - `features/jobs/feed.ts`: `interface FeedPage { items: JobFeedItem[]; cursor: number }`; `interface FeedState { items: JobFeedItem[]; cursor: number; fresh: number; final: boolean }`; `EMPTY_FEED: FeedState`; `mergeFeed(prev: FeedState, page: FeedPage): FeedState`; `feedPollInterval(job: (Pick<Job,'status'> & Pick<JobProgress,'feed_cursor'>) | undefined, feed: FeedState | undefined): number | false`; `useJobFeed(job: Pick<JobProgress,'id'|'status'|'feed_cursor'> | undefined)` → `UseQueryResult<FeedState>`, query key `['job', id, 'feed']`.
  - `features/journey/api.ts`: `interface TimelineV3Query { scope?: 'key' | 'all'; limit?: number }`; `useTimelineV3(assetId: string, query?: TimelineV3Query)` → `UseQueryResult<{ events: JourneyEventV3[]; total: number }>`, key `['asset', assetId, 'timeline-v3', query]`; `useEventsById(assetId: string, ids: string[]): JourneyEventV3[]` (keys `['asset', assetId, 'event', id]`, shared with `useEvent`; ids that fail are left out).

- [ ] **Step 1: Write the failing tests**

```tsx
// file: apps/web/src/features/jobs/feed.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { JobFeedItem } from '@/features/journey/types'
import { EMPTY_FEED, feedPollInterval, mergeFeed, useJobFeed, type FeedState } from './feed'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const line = (id: number, text = `line ${id}`): JobFeedItem => ({ id, t: '2026-10-09T10:00:00Z', step: 'regulatory', kind: 'info', text })
const JOB = { id: 'j1', status: 'running' as const, feed_cursor: 3 }

/** The feed endpoint over `lines`: what `since` asks for, oldest first, at most 500. */
function serveFeed(lines: () => JobFeedItem[]) {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      const m = /^\/api\/jobs\/j1\/feed\?since=(\d+)$/.exec(url)
      if (!m) return json(404, { code: 'NOT_FOUND', message: url })
      const since = Number(m[1])
      const items = lines().filter((l) => l.id > since).slice(0, 500)
      return json(200, { items, cursor: Math.max(since, ...items.map((i) => i.id)) })
    }),
  )
  return urls
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

afterEach(() => vi.unstubAllGlobals())

describe('mergeFeed', () => {
  it('keeps one line per id, in id order, and never moves the cursor back', () => {
    const first = mergeFeed(EMPTY_FEED, { items: [line(3), line(1), line(2)], cursor: 3 })
    expect(first.items.map((l) => l.id)).toEqual([1, 2, 3])
    expect(first).toMatchObject({ cursor: 3, fresh: 3 })
    const next = mergeFeed({ ...first, fresh: 0 }, { items: [line(3, 'again'), line(4)], cursor: 4 })
    expect(next.items.map((l) => [l.id, l.text])).toEqual([[1, 'line 1'], [2, 'line 2'], [3, 'again'], [4, 'line 4']])
    expect(next).toMatchObject({ cursor: 4, fresh: 1 })
    expect(mergeFeed(next, { items: [], cursor: 2 }).cursor).toBe(4)
  })
})

describe('feedPollInterval', () => {
  const feed = (cursor: number, extra: Partial<FeedState> = {}): FeedState => ({ items: [], cursor, fresh: 0, final: false, ...extra })
  it('polls every 2 s while the job runs, then only until the last line is in', () => {
    expect(feedPollInterval(undefined, undefined)).toBe(false)
    expect(feedPollInterval({ status: 'running', feed_cursor: 9 }, feed(9))).toBe(2000)
    expect(feedPollInterval({ status: 'queued', feed_cursor: 0 }, undefined)).toBe(2000)
    expect(feedPollInterval({ status: 'completed', feed_cursor: 9 }, feed(9))).toBe(false)
    // ended while the last fetch was in flight: one more fetch
    expect(feedPollInterval({ status: 'completed', feed_cursor: 9 }, feed(5))).toBe(2000)
    // a fetch after the end still brought lines: keep going
    expect(feedPollInterval({ status: 'failed', feed_cursor: 9 }, feed(7, { final: true, fresh: 2 }))).toBe(2000)
    // a fetch after the end brought nothing: the missing line will never come
    expect(feedPollInterval({ status: 'completed', feed_cursor: 9 }, feed(7, { final: true }))).toBe(false)
  })
})

describe('useJobFeed', () => {
  it('pages by cursor and keeps lines that arrive twice or out of order once, in order', async () => {
    const pages = [
      { items: [line(2), line(1), line(3)], cursor: 3 },
      { items: [line(3, 'again'), line(4)], cursor: 4 },
    ]
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        return json(200, pages.shift() ?? { items: [], cursor: 4 })
      }),
    )
    const client = newClient()
    const { result } = renderHook(() => useJobFeed(JOB), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.data?.cursor).toBe(3))
    expect(result.current.data?.items.map((l) => l.id)).toEqual([1, 2, 3])

    await act(() => client.refetchQueries({ queryKey: ['job', 'j1', 'feed'] }))
    await waitFor(() => expect(result.current.data?.cursor).toBe(4))
    expect(urls).toEqual(['/api/jobs/j1/feed?since=0', '/api/jobs/j1/feed?since=3'])
    expect(result.current.data?.items.map((l) => [l.id, l.text])).toEqual([
      [1, 'line 1'],
      [2, 'line 2'],
      [3, 'again'],
      [4, 'line 4'],
    ])
  })

  it('resumes from the cached cursor after a remount', async () => {
    let lines = [line(1), line(2), line(3)]
    const urls = serveFeed(() => lines)
    const client = newClient()
    const first = renderHook(() => useJobFeed(JOB), { wrapper: wrapper(client) })
    await waitFor(() => expect(first.result.current.data?.cursor).toBe(3))
    first.unmount()

    lines = [...lines, line(4)]
    const second = renderHook(() => useJobFeed({ ...JOB, feed_cursor: 4 }), { wrapper: wrapper(client) })
    await waitFor(() => expect(second.result.current.data?.cursor).toBe(4))
    expect(urls).toEqual(['/api/jobs/j1/feed?since=0', '/api/jobs/j1/feed?since=3'])
    expect(second.result.current.data?.items.map((l) => l.id)).toEqual([1, 2, 3, 4])
  })

  it('reads every waiting page in one go when more than 500 lines are waiting', async () => {
    const lines = Array.from({ length: 502 }, (_, i) => line(i + 1))
    const urls = serveFeed(() => lines)
    const { result } = renderHook(() => useJobFeed({ id: 'j1', status: 'completed', feed_cursor: 502 }), { wrapper: wrapper(newClient()) })
    await waitFor(() => expect(result.current.data?.cursor).toBe(502))
    expect(urls).toEqual(['/api/jobs/j1/feed?since=0', '/api/jobs/j1/feed?since=500'])
    expect(result.current.data?.items).toHaveLength(502)
  })

  it('marks a fetch made after the job ended as final', async () => {
    serveFeed(() => [line(1)])
    const client = newClient()
    client.setQueryData(['job', 'j1'], { id: 'j1', status: 'completed' })
    const { result } = renderHook(() => useJobFeed({ id: 'j1', status: 'completed', feed_cursor: 2 }), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.data).toMatchObject({ cursor: 1, final: true, fresh: 1 }))
  })

  it('stays idle without a job', () => {
    const urls = serveFeed(() => [])
    const { result } = renderHook(() => useJobFeed(undefined), { wrapper: wrapper(newClient()) })
    expect(result.current.fetchStatus).toBe('idle')
    expect(urls).toEqual([])
  })
})
```

```tsx
// file: apps/web/src/features/journey/api.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useEventsById, useTimelineV3 } from './api'
import type { JourneyEventV3 } from './types'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const event = (id: string): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date: '2021-04-01',
  type: 'approval',
  category: 'regulatory',
  title: `Event ${id}`,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.unstubAllGlobals())

describe('journey hooks', () => {
  it('reads the key-event timeline', async () => {
    const fetchMock = vi.fn(async () => json(200, { events: [event('e1')], total: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTimelineV3('trep', { scope: 'key' }), { wrapper })
    await waitFor(() => expect(result.current.data?.total).toBe(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/timeline?scope=key', expect.anything())
  })

  it('loads events by id in the order given, URL-encoded, leaving out the ones that fail', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        const id = decodeURIComponent(url.split('/events/')[1] ?? '')
        return id === 'gone' ? json(404, { code: 'EVENT_NOT_FOUND', message: 'Event not found' }) : json(200, { event: event(id), records: [] })
      }),
    )
    const ids = ['ai:trep:https://example.com/a/b:0', 'gone', 'e2']
    const { result } = renderHook(() => useEventsById('trep', ids), { wrapper })
    await waitFor(() => expect(result.current.map((e) => e.id)).toEqual(['ai:trep:https://example.com/a/b:0', 'e2']))
    expect(urls).toContain('/api/assets/trep/events/ai%3Atrep%3Ahttps%3A%2F%2Fexample.com%2Fa%2Fb%3A0')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/features/jobs/feed.test.tsx src/features/journey/api.test.tsx`
Expected: FAIL — `Failed to resolve import "./feed"` (feed.test.tsx); `TypeError: useTimelineV3 is not a function` and `TypeError: useEventsById is not a function` (api.test.tsx).

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/jobs/feed.ts
import { useQuery } from '@tanstack/react-query'
import type { JobFeedItem, JobProgress } from '@/features/journey/types'
import { apiFetch } from '@/lib/api'
import { isActive, type Job } from './api'

/** GET /jobs/:id/feed?since=N: up to 500 lines after N, ascending id; the cursor never goes back. */
export interface FeedPage {
  items: JobFeedItem[]
  cursor: number
}

/** The live-build log so far, accumulated across polls (and remounts: it lives in the query cache). */
export interface FeedState {
  items: JobFeedItem[]
  cursor: number
  /** Lines the last fetch added. */
  fresh: number
  /** The last fetch started after the job had finished. */
  final: boolean
}

const FEED_PAGE_SIZE = 500
const FEED_MAX_PAGES = 20
export const EMPTY_FEED: FeedState = { items: [], cursor: 0, fresh: 0, final: false }

/** Adds a page to the log: one line per id (a repeated id replaces the line), in id order; the cursor only moves forward. */
export function mergeFeed(prev: FeedState, page: FeedPage): FeedState {
  const byId = new Map(prev.items.map((item) => [item.id, item]))
  const before = byId.size
  for (const item of page.items) byId.set(item.id, item)
  return {
    items: [...byId.values()].sort((a, b) => a.id - b.id),
    cursor: Math.max(prev.cursor, page.cursor, ...page.items.map((item) => item.id)),
    fresh: prev.fresh + byId.size - before,
    final: prev.final,
  }
}

/**
 * Feed polling: every 2 s while the job runs; once it has ended, until the job's last line is in. A fetch that started
 * after the end and found nothing new stops it (a line the crawler failed to write never arrives).
 */
export function feedPollInterval(
  job: (Pick<Job, 'status'> & Pick<JobProgress, 'feed_cursor'>) | undefined,
  feed: FeedState | undefined,
): number | false {
  if (!job) return false
  if (isActive(job.status)) return 2000
  if (!feed || feed.cursor >= job.feed_cursor) return false
  return !feed.final || feed.fresh > 0 ? 2000 : false
}

/**
 * The job's live-build log (DATA_CONTRACTS §B.2), polled by cursor. Each fetch resumes from the cursor in the cache,
 * so a remount continues where it stopped, and reads every waiting page (≤500 lines each). Idle while `job` is undefined.
 */
export function useJobFeed(job: Pick<JobProgress, 'id' | 'status' | 'feed_cursor'> | undefined) {
  const id = job?.id ?? null
  return useQuery({
    queryKey: ['job', id, 'feed'],
    queryFn: async ({ client, queryKey, signal }) => {
      const status = client.getQueryData<Job>(['job', id])?.status
      let state: FeedState = { ...(client.getQueryData<FeedState>(queryKey) ?? EMPTY_FEED), fresh: 0, final: !!status && !isActive(status) }
      for (let page = 0; page < FEED_MAX_PAGES; page++) {
        const next = await apiFetch<FeedPage>(`/jobs/${encodeURIComponent(id!)}/feed?since=${state.cursor}`, { signal })
        state = mergeFeed(state, next)
        if (next.items.length < FEED_PAGE_SIZE) break
      }
      return state
    },
    enabled: id !== null,
    refetchInterval: (q) => feedPollInterval(job, q.state.data),
  })
}
```

In `apps/web/src/features/journey/api.ts`:

Before:
```ts
import { useQuery } from '@tanstack/react-query'
import type { RecordTab } from '@/features/assets/api'
import { apiFetch } from '@/lib/api'
```
After:
```ts
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { toQueryString, type RecordTab } from '@/features/assets/api'
import { apiFetch } from '@/lib/api'
```

Before:
```ts
    queryFn: () => apiFetch<EventDetail>(`/assets/${encodeURIComponent(assetId)}/events/${encodeURIComponent(eventId!)}`),
    enabled: eventId !== null,
  })
}
```
After:
```ts
    queryFn: () => apiFetch<EventDetail>(`/assets/${encodeURIComponent(assetId)}/events/${encodeURIComponent(eventId!)}`),
    enabled: eventId !== null,
  })
}

export interface TimelineV3Query {
  /** key = the curated key events (spec §4.1); all (the API default) = everything. */
  scope?: 'key' | 'all'
  limit?: number
}

/**
 * GET /assets/:id/timeline with the v3 fields (branch, via, key, …). The API caches it per asset data version, which
 * the crawler bumps when a job ends: during a crawl it returns what was cached before.
 */
export function useTimelineV3(assetId: string, query: TimelineV3Query = {}) {
  return useQuery({
    queryKey: ['asset', assetId, 'timeline-v3', query],
    queryFn: () =>
      apiFetch<{ events: JourneyEventV3[]; total: number }>(`/assets/${encodeURIComponent(assetId)}/timeline${toQueryString(query)}`),
  })
}

const loadedEvents = (results: UseQueryResult<EventDetail>[]) => results.flatMap((r) => (r.data ? [r.data.event] : []))

/** Several events by id (uncached on the API, sharing useEvent's cache here), in the order given; ids that fail are left out. */
export function useEventsById(assetId: string, ids: string[]): JourneyEventV3[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['asset', assetId, 'event', id],
      queryFn: () => apiFetch<EventDetail>(`/assets/${encodeURIComponent(assetId)}/events/${encodeURIComponent(id)}`),
      staleTime: Infinity,
    })),
    combine: loadedEvents,
  })
}
```

(`loadedEvents` is module-level on purpose: a stable `combine` lets TanStack keep the same array until a result changes.)

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && npx vitest run src/features/jobs/feed.test.tsx src/features/journey/api.test.tsx && npx tsc -b`
Expected: PASS (2 files, 9 tests); `tsc` silent.

---

### Task 3: Agent pipeline geometry

**Files:**
- Create: `apps/web/src/features/journey/live-build/pipeline-layout.ts`
- Test: `apps/web/src/features/journey/live-build/pipeline-layout.test.ts`

**Interfaces:**
- Consumes: `JobStep` (`features/jobs/api.ts`), `collectionMeta` (`features/journey/constants.ts`) — existing.
- Produces: `AG_W = 1100`, `AG_H = 470`, `AG_OFF = 30`; `AG_SRC` (12 step names), `AG_COLL` (8 collections), `AG_REASON = ['journey','ai_triage','ai_events','index']` (readonly tuples); `AG_COLUMNS: [label: string, x: number][]`; `interface NodeBox { x; y; w; h }`; `AG_NODES: Record<string, NodeBox>` keyed `s:<step>`, `c:<collection>`, `r:<step>`, `o:journey|assetai|compset`; `interface AgentEdge { id: string; from: string; to: string; steps: string[]; color: string; d: string; faint?: boolean }`; `AG_EDGES: AgentEdge[]` (33, ids `age-0` … `age-32` in `agEdges()` order); `agPath(a: NodeBox, b: NodeBox, e: { ty?: number; vertical?: boolean; under?: boolean }): string`; `type EdgeState = 'pending' | 'active' | 'done'`; `edgeState(steps: string[], byName: ReadonlyMap<string, Pick<JobStep,'status'>>): EdgeState`; `nodeVisible(key: string, plan: ReadonlySet<string>, records: Readonly<Record<string, number>>): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// file: apps/web/src/features/journey/live-build/pipeline-layout.test.ts
import type { JobStep } from '@/features/jobs/api'
import { AG_COLUMNS, AG_EDGES, AG_H, AG_NODES, AG_W, agPath, edgeState, nodeVisible } from './pipeline-layout'

const steps = (entries: [string, JobStep['status']][]) => new Map(entries.map(([name, status]) => [name, { status }]))

describe('agent pipeline layout', () => {
  it('uses the design space and node boxes of the prototype', () => {
    expect([AG_W, AG_H]).toEqual([1100, 470])
    expect(Object.keys(AG_NODES)).toHaveLength(27)
    expect(AG_NODES['s:regulatory']).toEqual({ x: 16, y: 30, w: 206, h: 28 })
    expect(AG_NODES['s:competitors']).toEqual({ x: 16, y: 404, w: 206, h: 28 })
    expect(AG_NODES['c:fda_records']).toEqual({ x: 300, y: 44, w: 176, h: 38 })
    expect(AG_NODES['c:articles']).toEqual({ x: 300, y: 366, w: 176, h: 38 })
    expect(AG_NODES['r:journey']).toEqual({ x: 548, y: 44, w: 228, h: 60 })
    expect(AG_NODES['r:index']).toEqual({ x: 548, y: 348, w: 228, h: 60 })
    expect(AG_NODES['o:journey']).toEqual({ x: 846, y: 30, w: 240, h: 230 })
    expect(AG_NODES['o:assetai']).toEqual({ x: 846, y: 274, w: 240, h: 70 })
    expect(AG_NODES['o:compset']).toEqual({ x: 846, y: 356, w: 240, h: 88 })
    expect(AG_COLUMNS.map(([, x]) => x)).toEqual([16, 300, 548, 846])
  })

  it('draws the edges of the prototype', () => {
    expect(AG_EDGES).toHaveLength(33)
    const edge = (from: string, to: string) => AG_EDGES.find((e) => e.from === from && e.to === to)
    expect(edge('s:regulatory', 'c:fda_records')).toMatchObject({ d: 'M222,44 C264.9,44 257.1,63 300,63', steps: ['regulatory'], color: '#2347d9' })
    expect(edge('c:patent_records', 'r:journey')).toMatchObject({ d: 'M476,293 C515.6,293 508.4,91 548,91', steps: ['journey', 'finalize'] })
    expect(edge('r:ai_triage', 'r:ai_events')?.d).toBe('M662,210 C662,224 662,230 662,244')
    expect(edge('c:articles', 'r:index')).toMatchObject({ d: 'M476,385 C515.6,385 508.4,395 548,395', faint: true })
    expect(edge('s:competitors', 'o:compset')?.d).toBe('M222,418 C422,470 586,452 846,400')
    expect(new Set(AG_EDGES.map((e) => e.id)).size).toBe(33)
  })

  it('ends a path in the middle of the target unless told otherwise', () => {
    expect(agPath({ x: 0, y: 0, w: 10, h: 10 }, { x: 110, y: 0, w: 10, h: 20 }, {})).toBe('M10,5 C65,5 55,10 110,10')
  })

  it('is active while a step runs, done once its first step finished, pending before', () => {
    expect(edgeState(['journey', 'finalize'], steps([['journey', 'pending'], ['finalize', 'pending']]))).toBe('pending')
    expect(edgeState(['journey', 'finalize'], steps([['journey', 'running'], ['finalize', 'pending']]))).toBe('active')
    expect(edgeState(['journey', 'finalize'], steps([['journey', 'done'], ['finalize', 'pending']]))).toBe('done')
    expect(edgeState(['journey', 'finalize'], steps([['journey', 'done'], ['finalize', 'running']]))).toBe('active')
    expect(edgeState(['journey', 'finalize'], steps([['finalize', 'failed']]))).toBe('done')
    expect(edgeState(['news'], steps([['news', 'skipped']]))).toBe('done')
    expect(edgeState(['index'], steps([]))).toBe('pending')
  })

  it('shows the nodes a job plans, and a collection once it holds a record', () => {
    const plan = new Set(['regulatory', 'journey', 'finalize'])
    const records = { fda_records: 44, ema_records: 0 }
    const shown = Object.keys(AG_NODES).filter((k) => nodeVisible(k, plan, records))
    expect(shown).toEqual(['s:regulatory', 'c:fda_records', 'r:journey', 'o:journey'])
    expect(nodeVisible('o:assetai', new Set(['index']), {})).toBe(true)
    expect(nodeVisible('o:compset', new Set(['competitors']), {})).toBe(true)
    expect(nodeVisible('x:unknown', plan, records)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/pipeline-layout.test.ts`
Expected: FAIL — `Failed to resolve import "./pipeline-layout"`.

- [ ] **Step 3: Implement**

Port of `design_files/aj/graph.jsx` (`agLayout`, `agEdges`, `agPath`): coordinates, edge list, colours and `ty` offsets are unchanged; path numbers are rounded to 2 decimals.

```ts
// file: apps/web/src/features/journey/live-build/pipeline-layout.ts
import type { JobStep } from '@/features/jobs/api'
import { collectionMeta } from '../constants'

/**
 * Agent pipeline geometry (design_files/aj/graph.jsx; node coordinates are final): a fixed 1100×470 design space,
 * scaled to the panel width. Node keys: `s:` source step, `c:` record collection, `r:` reasoning step, `o:` output.
 */
export const AG_W = 1100
export const AG_H = 470
export const AG_OFF = 30

export const AG_SRC = [
  'regulatory',
  'ema_chmp',
  'fda_calendar',
  'clinical',
  'publications',
  'conferences',
  'patents',
  'company_site',
  'company_news',
  'news',
  'industry_news',
  'competitors',
] as const
export const AG_COLL = [
  'fda_records',
  'ema_records',
  'trial_records',
  'publication_records',
  'conference_records',
  'patent_records',
  'company_records',
  'articles',
] as const
export const AG_REASON = ['journey', 'ai_triage', 'ai_events', 'index'] as const

/** Which collections each source step writes to. */
const AG_SRC_COLL: Record<string, string[]> = {
  regulatory: ['fda_records', 'ema_records'],
  ema_chmp: ['ema_records'],
  fda_calendar: ['fda_records'],
  clinical: ['trial_records'],
  publications: ['publication_records'],
  conferences: ['conference_records'],
  patents: ['patent_records'],
  company_site: ['company_records'],
  company_news: ['company_records'],
  news: ['articles'],
  industry_news: ['articles'],
}
const AG_RULES_IN = ['fda_records', 'ema_records', 'trial_records', 'patent_records']
const AG_TRIAGE_IN = ['publication_records', 'conference_records', 'company_records', 'articles']

/** Column headings and their x. */
export const AG_COLUMNS: [label: string, x: number][] = [
  ['Source agents', 16],
  ['Record store', 300],
  ['Reasoning', 548],
  ['Outputs', 846],
]

export interface NodeBox {
  x: number
  y: number
  w: number
  h: number
}

function agLayout(): Record<string, NodeBox> {
  const n: Record<string, NodeBox> = {}
  const o = AG_OFF
  AG_SRC.forEach((k, i) => (n[`s:${k}`] = { x: 16, y: o + i * 34, w: 206, h: 28 }))
  AG_COLL.forEach((k, i) => (n[`c:${k}`] = { x: 300, y: o + 14 + i * 46, w: 176, h: 38 }))
  n['r:journey'] = { x: 548, y: o + 14, w: 228, h: 60 }
  n['r:ai_triage'] = { x: 548, y: o + 120, w: 228, h: 60 }
  n['r:ai_events'] = { x: 548, y: o + 214, w: 228, h: 60 }
  n['r:index'] = { x: 548, y: o + 318, w: 228, h: 60 }
  n['o:journey'] = { x: 846, y: o, w: 240, h: 230 }
  n['o:assetai'] = { x: 846, y: o + 244, w: 240, h: 70 }
  n['o:compset'] = { x: 846, y: o + 326, w: 240, h: 88 }
  return n
}
export const AG_NODES: Record<string, NodeBox> = agLayout()

export interface AgentEdge {
  id: string
  from: string
  to: string
  /** The edge is active while any of these steps runs, done once the first has finished. */
  steps: string[]
  color: string
  /** SVG path in design-space coordinates. */
  d: string
  /** Index edges: thinner, more transparent particles. */
  faint?: boolean
}

interface EdgeSpec {
  from: string
  to: string
  steps: string[]
  color: string
  /** y offset of the end point inside the target node (default: its middle). */
  ty?: number
  vertical?: boolean
  under?: boolean
  faint?: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Cubic edge from the right side of `a` to the left side of `b`; `vertical` drops from a's bottom; `under` loops below. */
export function agPath(a: NodeBox, b: NodeBox, e: Pick<EdgeSpec, 'ty' | 'vertical' | 'under'>): string {
  if (e.vertical) {
    const x = a.x + a.w / 2
    return `M${x},${a.y + a.h} C${x},${a.y + a.h + 14} ${x},${b.y - 14} ${x},${b.y}`
  }
  const x1 = a.x + a.w
  const y1 = a.y + a.h / 2
  const x2 = b.x
  const y2 = e.ty != null ? b.y + e.ty : b.y + b.h / 2
  if (e.under) return `M${x1},${y1} C${x1 + 200},${y1 + 52} ${x2 - 260},${y2 + 52} ${x2},${y2}`
  const dx = (x2 - x1) * 0.55
  return `M${x1},${y1} C${r2(x1 + dx)},${y1} ${r2(x2 - dx)},${y2} ${x2},${y2}`
}

function agEdges(): AgentEdge[] {
  const specs: EdgeSpec[] = []
  const color = (c: string) => collectionMeta(c).color
  AG_SRC.forEach((s) => (AG_SRC_COLL[s] ?? []).forEach((c) => specs.push({ from: `s:${s}`, to: `c:${c}`, steps: [s], color: color(c) })))
  AG_RULES_IN.forEach((c, i) => specs.push({ from: `c:${c}`, to: 'r:journey', steps: ['journey', 'finalize'], color: color(c), ty: 14 + i * 11 }))
  AG_TRIAGE_IN.forEach((c, i) => specs.push({ from: `c:${c}`, to: 'r:ai_triage', steps: ['ai_triage'], color: color(c), ty: 14 + i * 11 }))
  specs.push({ from: 'r:ai_triage', to: 'r:ai_events', steps: ['ai_events'], color: '#7a5af8', vertical: true })
  AG_COLL.forEach((c, i) => specs.push({ from: `c:${c}`, to: 'r:index', steps: ['index'], color: color(c), ty: 12 + i * 5, faint: true }))
  specs.push({ from: 'r:journey', to: 'o:journey', steps: ['journey', 'finalize'], color: '#2347d9', ty: 58 })
  specs.push({ from: 'r:ai_events', to: 'o:journey', steps: ['ai_events'], color: '#7a5af8', ty: 168 })
  specs.push({ from: 'r:index', to: 'o:assetai', steps: ['index'], color: '#475467' })
  specs.push({ from: 's:competitors', to: 'o:compset', steps: ['competitors'], color: '#e0620f', under: true })
  return specs.map((e, i) => ({
    id: `age-${i}`,
    from: e.from,
    to: e.to,
    steps: e.steps,
    color: e.color,
    d: agPath(AG_NODES[e.from]!, AG_NODES[e.to]!, e),
    ...(e.faint && { faint: true }),
  }))
}
export const AG_EDGES: AgentEdge[] = agEdges()

export type EdgeState = 'pending' | 'active' | 'done'

/** Active while one of the edge's steps runs; done once its first planned step has finished; pending otherwise. */
export function edgeState(steps: string[], byName: ReadonlyMap<string, Pick<JobStep, 'status'>>): EdgeState {
  const planned = steps.flatMap((n) => {
    const s = byName.get(n)
    return s ? [s] : []
  })
  if (planned.some((s) => s.status === 'running')) return 'active'
  const first = planned[0]
  return first && first.status !== 'pending' ? 'done' : 'pending'
}

/**
 * Which nodes exist for this job: source and reasoning nodes for the steps in its plan, a collection once it holds
 * a record, an output when a step that feeds it is planned.
 */
export function nodeVisible(key: string, plan: ReadonlySet<string>, records: Readonly<Record<string, number>>): boolean {
  const [kind, name = ''] = key.split(':')
  if (kind === 's' || kind === 'r') return plan.has(name)
  if (kind === 'c') return (records[name] ?? 0) > 0
  if (key === 'o:journey') return plan.has('journey') || plan.has('ai_events') || plan.has('finalize')
  if (key === 'o:assetai') return plan.has('index')
  if (key === 'o:compset') return plan.has('competitors')
  return false
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/pipeline-layout.test.ts && npx tsc -b`
Expected: PASS (1 file, 5 tests); `tsc` silent.

---

### Task 4: Live-build model (pure helpers)

**Files:**
- Create: `apps/web/src/features/journey/live-build/build-model.ts`
- Test: `apps/web/src/features/journey/live-build/build-model.test.ts`

**Interfaces:**
- Consumes: `isActive`, `Job`, `JobStep` (`features/jobs/api.ts`), `stepDuration` (`features/jobs/steps.ts`), `CATEGORIES` (`features/journey/constants.ts`), `EventCategory`, `EventVia`, `JobFeedItem`, `JobProgress`, `JourneyEventV3` (`features/journey/types.ts`) — existing.
- Produces:
  - `type BuildPhase = 'planning' | 'running' | 'done'`; `buildPhase(job: Pick<Job,'status'|'steps'>): BuildPhase`.
  - `type Stage = 'Collect' | 'Build' | 'Expand' | 'Finalize'`; `stepStage(name: string): Stage`; `interface StageRun { stage: Stage; grow: number; first: number; last: number }`; `stageRuns(steps: Pick<JobStep,'name'>[]): StageRun[]`.
  - `stepRecordCount(step: Pick<JobStep,'name'|'status'|'counts'>): number | null`; `triageCounts(counts: Record<string, number>): { kept: number; dropped: number }`.
  - `formatClock(seconds: number): string` ("10:32"); `secondsSince(fromIso: string | null | undefined, to: number): number`.
  - `interface RecordTick { key: string; coll: string; at: number; jitter: number }`; `recordTicks(recordYears: JobProgress['record_years'], maxTicks?: number): RecordTick[]`; `formingYears(years: number[], todayYear: number): { y0: number; y1: number }`.
  - `viaLabel(e: JourneyEventV3): string`; `tipVia(e: JourneyEventV3): string`; `categoryCounts(events): Record<EventCategory, number>`; `viaCounts(events): Record<EventVia, number>`.
  - `liveEventIds(items: JobFeedItem[]): string[]`; `lastEventLine(items: JobFeedItem[]): number`; `uniqueEvents(...lists: JourneyEventV3[][]): JourneyEventV3[]`.

- [ ] **Step 1: Write the failing test**

```ts
// file: apps/web/src/features/journey/live-build/build-model.test.ts
import type { JobStep } from '@/features/jobs/api'
import type { JobFeedItem, JourneyEventV3 } from '../types'
import {
  buildPhase,
  categoryCounts,
  formatClock,
  formingYears,
  lastEventLine,
  liveEventIds,
  recordTicks,
  secondsSince,
  stageRuns,
  stepRecordCount,
  stepStage,
  tipVia,
  triageCounts,
  uniqueEvents,
  viaCounts,
  viaLabel,
} from './build-model'

const step = (name: string, status: JobStep['status'], counts: Record<string, number> = {}): JobStep => ({
  name,
  label: name,
  status,
  counts,
  error: null,
  started_at: null,
  finished_at: null,
})

const event = (id: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date: '2021-04-01',
  type: 'approval',
  category: 'regulatory',
  title: `Event ${id}`,
  significance: 'High',
  is_milestone: false,
  sources: [{ collection: 'fda_records', record_key: 'NDA1' }],
  via: 'journey',
  ...extra,
})

const feedLine = (id: number, kind: JobFeedItem['kind'], event_id?: string): JobFeedItem => ({
  id,
  t: '2026-10-09T10:00:00Z',
  step: 'journey',
  kind,
  text: `line ${id}`,
  ...(event_id && { event_id }),
})

describe('build phase and stages', () => {
  it('plans while queued or before any step starts, runs, then is done whatever the outcome', () => {
    expect(buildPhase({ status: 'queued', steps: [step('regulatory', 'pending')] })).toBe('planning')
    expect(buildPhase({ status: 'running', steps: [step('regulatory', 'pending')] })).toBe('planning')
    expect(buildPhase({ status: 'running', steps: [step('regulatory', 'running')] })).toBe('running')
    expect(buildPhase({ status: 'running', steps: [step('regulatory', 'done'), step('journey', 'pending')] })).toBe('running')
    for (const status of ['completed', 'completed_with_errors', 'failed', 'cancelled'] as const) {
      expect(buildPhase({ status, steps: [] })).toBe('done')
    }
  })

  it('groups consecutive steps of a stage, sized by their expected durations', () => {
    expect(stepStage('clinical')).toBe('Collect')
    expect(stepStage('patents')).toBe('Expand')
    expect(stepStage('something_new')).toBe('Collect')
    const runs = stageRuns(['regulatory', 'clinical', 'journey', 'ai_events', 'patents', 'finalize'].map((n) => step(n, 'pending')))
    expect(runs).toEqual([
      { stage: 'Collect', grow: 8, first: 0, last: 1 },
      { stage: 'Build', grow: 8.5, first: 2, last: 3 },
      { stage: 'Expand', grow: 4, first: 4, last: 4 },
      { stage: 'Finalize', grow: 3, first: 5, last: 5 },
    ])
    // the refresh plan interleaves stages: each run gets its own label
    expect(stageRuns(['regulatory', 'fda_calendar', 'ema_chmp'].map((n) => step(n, 'pending'))).map((r) => r.stage)).toEqual([
      'Collect',
      'Expand',
      'Collect',
    ])
  })
})

describe('step counts', () => {
  it('counts the records a finished source step stored', () => {
    expect(stepRecordCount(step('regulatory', 'done', { fda_new: 40, fda_updated: 4, ema_new: 12, ema_updated: 0 }))).toBe(56)
    expect(stepRecordCount(step('clinical', 'done', { trials_new: 3, trials_updated: 71 }))).toBe(74)
    expect(stepRecordCount(step('ema_chmp', 'done', { new: 6, ema_chmp_opinion: 3 }))).toBe(6)
    expect(stepRecordCount(step('competitors', 'done', { competitors: 5, jobs_started: 2 }))).toBe(5)
    expect(stepRecordCount(step('regulatory', 'running', { fda_new: 40 }))).toBeNull()
    expect(stepRecordCount(step('regulatory', 'failed'))).toBeNull()
  })

  it('reads the triage outcome', () => {
    expect(triageCounts({ articles_ingest: 50, publication_records_ingest: 24, articles_skip: 100, conference_records_skip: 12, articles_headline: 9 })).toEqual({
      kept: 74,
      dropped: 112,
    })
  })

  it('formats clocks and elapsed time', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(632.4)).toBe('10:32')
    expect(formatClock(3725)).toBe('62:05')
    expect(formatClock(-5)).toBe('00:00')
    expect(secondsSince('2026-10-09T10:00:00Z', Date.parse('2026-10-09T10:02:05Z'))).toBe(125)
    expect(secondsSince(null, Date.now())).toBe(0)
  })
})

describe('forming timeline data', () => {
  it('draws one tick per record, keyed by bucket so a growing bucket keeps its ticks', () => {
    const before = recordTicks([{ coll: 'fda_records', year: 2021, n: 2 }])
    const after = recordTicks([
      { coll: 'fda_records', year: 2021, n: 3 },
      { coll: 'trial_records', year: 2019, n: 1 },
    ])
    expect(before.map((t) => t.key)).toEqual(['fda_records:2021:0', 'fda_records:2021:1'])
    expect(after.slice(0, 2)).toEqual(before)
    expect(after).toHaveLength(4)
    for (const t of after) {
      expect(t.at).toBeGreaterThanOrEqual(Math.floor(t.at))
      expect(t.at - Math.floor(t.at)).toBeLessThan(1)
      expect(t.jitter).toBeGreaterThanOrEqual(0)
      expect(t.jitter).toBeLessThan(1)
    }
    expect(Math.floor(after[3]!.at)).toBe(2019)
  })

  it('lets one tick stand for several records past the cap', () => {
    const ticks = recordTicks([
      { coll: 'publication_records', year: 2020, n: 3000 },
      { coll: 'articles', year: 2024, n: 1 },
    ])
    expect(ticks).toHaveLength(1001) // 3001 records, 3 per tick: 1000 + 1
  })

  it('spans 2000 to three years ahead, stretching for older or later data within limits', () => {
    expect(formingYears([], 2026)).toEqual({ y0: 2000, y1: 2029 })
    expect(formingYears([2004, 2027], 2026)).toEqual({ y0: 2000, y1: 2029 })
    expect(formingYears([1993.4, 2031], 2026)).toEqual({ y0: 1993, y1: 2032 })
    expect(formingYears([1950, 2090, NaN], 2026)).toEqual({ y0: 1985, y1: 2032 })
  })
})

describe('events', () => {
  it('says how each event was built', () => {
    expect(viaLabel(event('a'))).toBe('Rule · fda_records')
    expect(viaLabel(event('b', { via: 'finalize', sources: [{ collection: 'patent_records', record_key: 'US1' }] }))).toBe('Rebuild · patent_records')
    expect(viaLabel(event('c', { via: 'ai_events', sources: [{ collection: 'articles', record_key: 'x' }] }))).toBe('AI · 1 record')
    expect(
      viaLabel(
        event('d', {
          via: 'ai_events',
          sources: [{ collection: 'articles', record_key: 'x' }],
          merged_sources: [{ collection: 'company_records', record_key: 'y' }],
        }),
      ),
    ).toBe('AI · merged 2 records')
    expect(viaLabel(event('e', { sources: [] }))).toBe('Rule')
    expect(tipVia(event('f', { via: 'ai_events' }))).toBe('AI · 1 record')
    expect(tipVia(event('g', { via: 'finalize' }))).toBe('Journey rebuild')
    expect(tipVia(event('h'))).toBe('Rule')
  })

  it('counts events by category and by how they were built', () => {
    const events = [event('a'), event('b', { category: 'clinical', via: 'ai_events' }), event('c', { via: 'finalize' })]
    expect(categoryCounts(events)).toEqual({ regulatory: 2, clinical: 1, safety: 0, company: 0, ip: 0 })
    expect(viaCounts(events)).toEqual({ journey: 1, ai_events: 1, finalize: 1, user: 0 })
  })

  it('reads announced events from the feed', () => {
    const items = [feedLine(1, 'info'), feedLine(2, 'event', 'e1'), feedLine(3, 'event'), feedLine(4, 'event', 'e2'), feedLine(5, 'event', 'e1'), feedLine(6, 'done')]
    expect(liveEventIds(items)).toEqual(['e1', 'e2'])
    expect(lastEventLine(items)).toBe(5)
    expect(lastEventLine([feedLine(1, 'info')])).toBe(0)
  })

  it('keeps each event once, the first copy winning', () => {
    const merged = uniqueEvents([event('a', { title: 'first' }), event('b')], [event('a', { title: 'second' }), event('c')])
    expect(merged.map((e) => [e.id, e.title])).toEqual([
      ['a', 'first'],
      ['b', 'Event b'],
      ['c', 'Event c'],
    ])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/build-model.test.ts`
Expected: FAIL — `Failed to resolve import "./build-model"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/journey/live-build/build-model.ts
import { isActive, type Job, type JobStep } from '@/features/jobs/api'
import { stepDuration } from '@/features/jobs/steps'
import { CATEGORIES } from '../constants'
import type { EventCategory, EventVia, JobFeedItem, JobProgress, JourneyEventV3 } from '../types'

/** done once the job has ended; planning while queued or before any step starts; running otherwise. */
export type BuildPhase = 'planning' | 'running' | 'done'

export function buildPhase(job: Pick<Job, 'status' | 'steps'>): BuildPhase {
  if (!isActive(job.status)) return 'done'
  return job.steps.some((s) => s.status !== 'pending') ? 'running' : 'planning'
}

export type Stage = 'Collect' | 'Build' | 'Expand' | 'Finalize'

/** Stage of each crawl step (design_files/aj/data.js STAGE); source steps not listed collect. */
const STEP_STAGE: Record<string, Stage> = {
  journey: 'Build',
  ai_triage: 'Build',
  ai_events: 'Build',
  index: 'Build',
  competitors: 'Expand',
  fda_calendar: 'Expand',
  patents: 'Expand',
  finalize: 'Finalize',
}

export const stepStage = (name: string): Stage => STEP_STAGE[name] ?? 'Collect'

export interface StageRun {
  stage: Stage
  /** Sum of the run's expected step durations (its width under the segmented bar). */
  grow: number
  /** Indexes of the run's first and last step. */
  first: number
  last: number
}

/** Stage labels under the segmented bar: one per run of consecutive steps in the same stage, so they line up with it. */
export function stageRuns(steps: Pick<JobStep, 'name'>[]): StageRun[] {
  const runs: StageRun[] = []
  steps.forEach((s, i) => {
    const stage = stepStage(s.name)
    const last = runs.at(-1)
    if (last && last.stage === stage) {
      last.grow += stepDuration(s.name)
      last.last = i
    } else runs.push({ stage, grow: stepDuration(s.name), first: i, last: i })
  })
  return runs
}

/** Records a finished source step stored (`new`, `*_new`, `*_updated` counts); competitors: how many it ranked. null until done. */
export function stepRecordCount(step: Pick<JobStep, 'name' | 'status' | 'counts'>): number | null {
  if (step.status !== 'done') return null
  if (step.name === 'competitors') return Number(step.counts.competitors) || 0
  return Object.entries(step.counts).reduce(
    (sum, [k, v]) => (k === 'new' || k.endsWith('_new') || k.endsWith('_updated') ? sum + (Number(v) || 0) : sum),
    0,
  )
}

/** AI triage outcome from its counts (`<collection>_ingest` kept, `<collection>_skip` dropped). */
export function triageCounts(counts: Record<string, number>): { kept: number; dropped: number } {
  let kept = 0
  let dropped = 0
  for (const [k, v] of Object.entries(counts)) {
    if (k.endsWith('_ingest')) kept += Number(v) || 0
    if (k.endsWith('_skip')) dropped += Number(v) || 0
  }
  return { kept, dropped }
}

/** "10:32" (minutes:seconds; minutes keep counting past an hour). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Seconds from an ISO time to `to` (epoch ms); 0 when the time is missing. */
export function secondsSince(fromIso: string | null | undefined, to: number): number {
  const from = Date.parse(fromIso ?? '')
  return Number.isNaN(from) ? 0 : Math.max(0, (to - from) / 1000)
}

/** Deterministic 0–1 from a string (FNV-1a), so a record tick keeps its place across polls. */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

export interface RecordTick {
  /** `coll:year:i`: stable while the bucket grows, so only new ticks animate in. */
  key: string
  coll: string
  /** Year fraction on the time axis. */
  at: number
  /** 0–1 vertical position in the records strip. */
  jitter: number
}

/**
 * Record ticks for the forming timeline from the per-year histogram (GET /jobs/:id `record_years`). Above `maxTicks`
 * records one tick stands for several, so the strip keeps its shape without drawing thousands of marks.
 */
export function recordTicks(recordYears: JobProgress['record_years'], maxTicks = 1200): RecordTick[] {
  const total = recordYears.reduce((sum, b) => sum + b.n, 0)
  const unit = Math.max(1, Math.ceil(total / maxTicks))
  const ticks: RecordTick[] = []
  for (const { coll, year, n } of recordYears) {
    for (let i = 0; i < Math.ceil(n / unit); i++) {
      const key = `${coll}:${year}:${i}`
      ticks.push({ key, coll, at: year + hash01(`${key}:x`) * 0.999, jitter: hash01(`${key}:y`) })
    }
  }
  return ticks
}

/** Time axis of the forming timeline: from 2000 (earlier when the data is, not before 1985) to 3–6 years past today. */
export function formingYears(years: number[], todayYear: number): { y0: number; y1: number } {
  const known = years.filter(Number.isFinite)
  const min = known.length ? Math.min(...known) : 2000
  const max = known.length ? Math.max(...known) : todayYear
  return {
    y0: Math.max(1985, Math.min(2000, Math.floor(min))),
    y1: Math.max(todayYear + 3, Math.min(todayYear + 6, Math.floor(max) + 1)),
  }
}

const sourceCount = (e: JourneyEventV3) => e.sources.length + (e.merged_sources?.length ?? 0)

/** How an event was built, for "Just added" (design_files/aj/live.jsx viaLabel). */
export function viaLabel(e: JourneyEventV3): string {
  const n = sourceCount(e)
  const coll = e.sources[0]?.collection
  if (e.via === 'user') return e.user?.mode === 'ai' ? `You + AI · ${n} sources` : 'Added by you'
  if (e.via === 'ai_events') return n > 1 ? `AI · merged ${n} records` : 'AI · 1 record'
  if (e.via === 'finalize') return coll ? `Rebuild · ${coll}` : 'Rebuild'
  return coll ? `Rule · ${coll}` : 'Rule'
}

/** The forming timeline's tooltip line under the title. */
export function tipVia(e: JourneyEventV3): string {
  const n = sourceCount(e)
  if (e.via === 'ai_events') return `AI · ${n} record${n === 1 ? '' : 's'}`
  return e.via === 'finalize' ? 'Journey rebuild' : 'Rule'
}

export function categoryCounts(events: Pick<JourneyEventV3, 'category'>[]): Record<EventCategory, number> {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<EventCategory, number>
  for (const e of events) if (e.category in counts) counts[e.category]++
  return counts
}

export function viaCounts(events: Pick<JourneyEventV3, 'via'>[]): Record<EventVia, number> {
  const counts: Record<EventVia, number> = { journey: 0, ai_events: 0, finalize: 0, user: 0 }
  for (const e of events) if (e.via in counts) counts[e.via]++
  return counts
}

/** Event ids announced by `event` lines, oldest first, once each. */
export function liveEventIds(items: JobFeedItem[]): string[] {
  const ids = new Set<string>()
  for (const item of items) if (item.kind === 'event' && item.event_id) ids.add(item.event_id)
  return [...ids]
}

/** Id of the newest `event` line (0 when there is none): the timeline refetches when it grows. */
export function lastEventLine(items: JobFeedItem[]): number {
  return items.reduce((max, item) => (item.kind === 'event' && item.id > max ? item.id : max), 0)
}

/** Events once each by id; the first occurrence wins. */
export function uniqueEvents(...lists: JourneyEventV3[][]): JourneyEventV3[] {
  const byId = new Map<string, JourneyEventV3>()
  for (const list of lists) for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e)
  return [...byId.values()]
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/build-model.test.ts && npx tsc -b`
Expected: PASS (1 file, 12 tests); `tsc` silent.

---

### Task 5: Build strip

**Files:**
- Create: `apps/web/src/features/journey/live-build/build-strip.tsx`
- Test: `apps/web/src/features/journey/live-build/build-strip.test.tsx`

**Interfaces:**
- Consumes: `recordsTotal`, `sourceProgress` (Task 1); `buildPhase`, `formatClock`, `secondsSince`, `stageRuns` (Task 4); `currentStep`, `jobDuration`, `stepDuration`, `stepsFinished` (`features/jobs/steps.ts`), `Button`, `formatNumber`, `cn`, `JobProgress` — existing. CSS utilities `animate-stripes`, `animate-pulse-ring`, `animate-ag-in` (Task 1).
- Produces: `BuildStrip({ job: JobProgress; eventsCount: number; onExplore: () => void })` — a `<section aria-label="Live build">` with an `h2` title, stats as `<dt>`/`<dd>` pairs, a `role="progressbar"` "Crawl progress" (`aria-valuenow` = finished steps) with one `[data-status]` segment per step, stage labels (`data-current` on the current one), and the "Explore the journey" button once the job has ended.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/live-build/build-strip.test.tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JobStep } from '@/features/jobs/api'
import type { JobProgress } from '../types'
import { BuildStrip } from './build-strip'

const step = (name: string, status: JobStep['status'], label = name): JobStep => ({
  name,
  label,
  status,
  counts: {},
  error: null,
  started_at: null,
  finished_at: null,
})

const job = (extra: Partial<JobProgress> = {}): JobProgress => ({
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'onboard',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running', 'Journey events (rules)'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '2026-10-09T09:59:58Z',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: null,
  records: [
    { coll: 'fda_records', count: 1000 },
    { coll: 'trial_records', count: 234 },
  ],
  events_created: 99,
  feed_cursor: 12,
  record_years: [],
  ...extra,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T10:02:05Z'))
})
afterEach(() => vi.useRealTimers())

describe('BuildStrip', () => {
  it('shows the running step, the counters and one segment per step', () => {
    render(<BuildStrip job={job()} eventsCount={7} onExplore={() => {}} />)
    const strip = screen.getByRole('region', { name: 'Live build' })
    expect(within(strip).getByRole('heading', { name: 'Building the journey' })).toBeInTheDocument()
    expect(strip).toHaveTextContent('Step 3 of 4 · Journey events (rules)')
    expect(within(strip).getByText('Records').nextElementSibling).toHaveTextContent('1,234')
    expect(within(strip).getByText('Events').nextElementSibling).toHaveTextContent('7')
    expect(within(strip).getByText('Sources').nextElementSibling).toHaveTextContent('2/2')
    expect(within(strip).getByText('Elapsed').nextElementSibling).toHaveTextContent('02:05')
    const bar = within(strip).getByRole('progressbar', { name: 'Crawl progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    const segments = [...bar.querySelectorAll<HTMLElement>('[data-status]')]
    expect(segments.map((s) => s.dataset.status)).toEqual(['done', 'done', 'running', 'pending'])
    expect(segments.map((s) => s.style.flexGrow)).toEqual(['4', '4', '3.5', '3'])
    expect(within(strip).getByText('Build')).toHaveAttribute('data-current', 'true')
    expect(within(strip).getByText('Collect')).not.toHaveAttribute('data-current')
    expect(within(strip).queryByRole('button', { name: /Explore the journey/ })).not.toBeInTheDocument()
  })

  it('plans before the first step starts', () => {
    render(
      <BuildStrip
        job={job({ status: 'queued', started_at: null, steps: [step('regulatory', 'pending'), step('clinical', 'pending'), step('journey', 'pending'), step('finalize', 'pending')] })}
        eventsCount={0}
        onExplore={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Planning the crawl' })).toBeInTheDocument()
    expect(screen.getByText('Laying out 4 steps across 2 sources for Treprostinil')).toBeInTheDocument()
    expect(screen.getByText('Elapsed').nextElementSibling).toHaveTextContent('00:00')
  })

  it('turns green with the totals and "Explore the journey" when the job completes', async () => {
    const onExplore = vi.fn()
    const steps = ['regulatory', 'clinical', 'journey', 'finalize'].map((n) => step(n, 'done'))
    render(<BuildStrip job={job({ status: 'completed', steps, finished_at: '2026-10-09T10:03:05Z' })} eventsCount={7} onExplore={onExplore} />)
    expect(screen.getByRole('heading', { name: 'Journey ready' })).toBeInTheDocument()
    expect(screen.getByText('7 events from 1,234 records · finished in 3m 05s')).toBeInTheDocument()
    expect(screen.getByText('Duration').nextElementSibling).toHaveTextContent('03:05')
    await userEvent.click(screen.getByRole('button', { name: /Explore the journey/ }))
    expect(onExplore).toHaveBeenCalledOnce()
  })

  it('says when the crawl failed, and still lets you explore', () => {
    const steps = [step('regulatory', 'done'), step('clinical', 'failed'), step('journey', 'skipped'), step('finalize', 'pending')]
    render(<BuildStrip job={job({ status: 'failed', steps, finished_at: '2026-10-09T10:01:00Z' })} eventsCount={0} onExplore={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Crawl failed' })).toBeInTheDocument()
    expect(screen.getByText('3 of 4 steps finished')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Explore the journey/ })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/build-strip.test.tsx`
Expected: FAIL — `Failed to resolve import "./build-strip"`.

- [ ] **Step 3: Implement**

Port of `BuildStrip` in `design_files/aj/live.jsx` and its CSS (`.bstrip`, `.bs-*`, `.segbar`, `.stages` in `aj/base.css`).

```tsx
// file: apps/web/src/features/journey/live-build/build-strip.tsx
import { ArrowRight, Check, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import type { JobStep } from '@/features/jobs/api'
import { recordsTotal, sourceProgress } from '@/features/jobs/job-counters'
import { currentStep, jobDuration, stepDuration, stepsFinished } from '@/features/jobs/steps'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { JobProgress } from '../types'
import { buildPhase, formatClock, secondsSince, stageRuns } from './build-model'

const SEGMENT: Record<JobStep['status'], string> = {
  pending: 'bg-accent',
  running: 'bg-[#d5ddfa]',
  done: 'bg-primary',
  failed: 'bg-[#dc8a35]',
  skipped: 'bg-[#d0d5dd]',
}
const STRIPES: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.3) 0 4px, transparent 4px 8px)',
  backgroundSize: '11.3px 11.3px',
}

/** Wall-clock time, re-read every second while `ticking` (the elapsed clock). */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

/**
 * Live build header (README §6.1 "Build strip"): what the crawl is doing, its counters, one segment per step (as wide
 * as the step's expected duration) and the stage labels; "Explore the journey" once it has ended.
 */
export function BuildStrip({ job, eventsCount, onExplore }: { job: JobProgress; eventsCount: number; onExplore: () => void }) {
  const phase = buildPhase(job)
  const now = useNow(phase !== 'done')
  const n = job.steps.length
  const finished = stepsFinished(job)
  const sources = sourceProgress(job)
  const records = recordsTotal(job)
  const current = currentStep(job)
  const at = current?.index ?? job.steps.findIndex((s) => s.status === 'pending')
  const ready = job.status === 'completed' || job.status === 'completed_with_errors'
  const end = Date.parse(job.finished_at ?? '')
  const seconds = secondsSince(job.started_at, phase === 'done' && !Number.isNaN(end) ? end : now)

  const title =
    phase === 'planning'
      ? 'Planning the crawl'
      : phase === 'running'
        ? 'Building the journey'
        : ready
          ? 'Journey ready'
          : job.status === 'failed'
            ? 'Crawl failed'
            : 'Crawl cancelled'
  const sub =
    phase === 'planning' ? (
      `Laying out ${n} steps across ${sources.total} sources for ${job.assetName ?? job.asset}`
    ) : phase === 'running' ? (
      <>
        Step {at >= 0 ? at + 1 : n} of {n}
        {at >= 0 && (
          <>
            {' · '}
            <span className="font-medium text-foreground">{job.steps[at]!.label}</span>
          </>
        )}
      </>
    ) : ready ? (
      `${formatNumber(eventsCount)} events from ${formatNumber(records)} records · finished in ${jobDuration(job)}`
    ) : (
      `${finished} of ${n} steps finished`
    )
  const stats: [label: string, value: string][] = [
    ['Records', formatNumber(records)],
    ['Events', formatNumber(eventsCount)],
    ['Sources', `${sources.done}/${sources.total}`],
    [phase === 'done' ? 'Duration' : 'Elapsed', formatClock(seconds)],
  ]

  return (
    <section
      aria-label="Live build"
      className={cn('rounded-[14px] border bg-card px-5 pt-[18px] pb-3.5 shadow-panel transition-colors duration-500', ready && 'border-[#bfe3dd]')}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_380px] items-start gap-3">
          <StatusDot phase={phase} status={job.status} />
          <div aria-live="polite" className="min-w-0">
            <h2 className="text-[17px] leading-6 font-semibold tracking-[-0.01em]">{title}</h2>
            <p className="mt-[3px] text-text-secondary">{sub}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-7">
          <dl className="flex flex-wrap items-center gap-7">
            {stats.map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse">
                <dt className="text-[12px] text-muted-foreground">{label}</dt>
                <dd className="text-[22px] leading-7 font-semibold tracking-[-0.02em] tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {phase === 'done' && (
            <Button size="lg" className="h-10 animate-fade-up rounded-[10px] px-4" onClick={onExplore}>
              Explore the journey <ArrowRight />
            </Button>
          )}
        </div>
      </div>
      <div
        role="progressbar"
        aria-label="Crawl progress"
        aria-valuemin={0}
        aria-valuemax={n}
        aria-valuenow={finished}
        className="mt-4 flex h-2 gap-[3px]"
      >
        {job.steps.map((s, i) => (
          <i
            key={`${i}-${s.name}`}
            data-status={s.status}
            title={`${i + 1}. ${s.label}`}
            className={cn('relative block min-w-1 overflow-hidden rounded-[3px] transition-colors duration-300', SEGMENT[s.status])}
            style={{ flexGrow: stepDuration(s.name), flexBasis: 0 }}
          >
            {s.status === 'running' && <span className="absolute inset-0 animate-stripes bg-primary" style={STRIPES} />}
          </i>
        ))}
      </div>
      <div className="mt-[7px] flex gap-[3px] text-[11.5px] text-muted-foreground">
        {stageRuns(job.steps).map((r) => {
          const on = phase === 'running' && at >= r.first && at <= r.last
          return (
            <span
              key={r.first}
              data-current={on || undefined}
              className={cn('min-w-0 truncate transition-colors duration-300', on && 'font-semibold text-primary')}
              style={{ flexGrow: r.grow, flexBasis: 0 }}
            >
              {r.stage}
            </span>
          )
        })}
      </div>
    </section>
  )
}

function StatusDot({ phase, status }: { phase: ReturnType<typeof buildPhase>; status: JobProgress['status'] }) {
  if (phase === 'done') {
    const ok = status === 'completed' || status === 'completed_with_errors'
    return (
      <span
        className={cn(
          'flex size-6 shrink-0 animate-ag-in items-center justify-center rounded-full text-white',
          ok ? 'bg-success' : status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground',
        )}
      >
        {ok ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
      </span>
    )
  }
  return (
    <span className="relative mt-[-1px] flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft">
      <i className="size-2 rounded-full bg-primary" />
      <span aria-hidden="true" className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-primary" />
    </span>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/build-strip.test.tsx && npx tsc -b`
Expected: PASS (1 file, 4 tests); `tsc` silent.

---

### Task 6: Agent pipeline

**Files:**
- Create: `apps/web/src/features/journey/live-build/agent-pipeline.tsx`
- Test: `apps/web/src/features/journey/live-build/agent-pipeline.test.tsx`

**Interfaces:**
- Consumes: everything from Task 3; `categoryCounts`, `stepRecordCount`, `triageCounts`, `viaCounts` (Task 4); `isActive`, `JobStep` (`features/jobs/api.ts`), `stepShort` (`features/jobs/steps.ts`), `useElementWidth` (`lib/use-element-width.ts`), `useMediaQuery` (`lib/use-media-query.ts`), `CATEGORIES`, `CATEGORY_META`, `collectionMeta` (`features/journey/constants.ts`), `formatNumber`, `cn` — existing. CSS utilities `animate-ag-in`, `animate-node-run`, `animate-draw`, `animate-blink-dot`.
- Produces: `AgentPipeline({ job: JobProgress; events: JourneyEventV3[]; competitors: string[] })` — nodes carry `data-node="<key>"` (+ `data-status` for step nodes), edges `<g data-edge="age-N" data-state>`, particles `circle[data-particle]`; `PipelineLegend()` for the panel header.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/live-build/agent-pipeline.test.tsx
import { render, screen } from '@testing-library/react'
import type { JobStep } from '@/features/jobs/api'
import type { JobProgress, JourneyEventV3 } from '../types'
import { AgentPipeline } from './agent-pipeline'

const step = (name: string, status: JobStep['status'], counts: Record<string, number> = {}, error: string | null = null): JobStep => ({
  name,
  label: name,
  status,
  counts,
  error,
  started_at: null,
  finished_at: null,
})

const job = (steps: JobStep[], extra: Partial<JobProgress> = {}): JobProgress => ({
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status: 'running',
  steps,
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: null,
  records: [
    { coll: 'fda_records', count: 44 },
    { coll: 'ema_records', count: 0 },
  ],
  events_created: 0,
  feed_cursor: 0,
  record_years: [],
  ...extra,
})

const event = (id: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date: '2021-04-01',
  type: 'approval',
  category: 'regulatory',
  title: id,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
  ...extra,
})

/** matchMedia that reports `prefers-reduced-motion: reduce` as `reduce`. */
function motion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

const node = (key: string) => document.querySelector<HTMLElement>(`[data-node="${key}"]`)
// edge ids follow the layout order (pipeline-layout.ts): age-0 regulatory → fda_records, age-12 fda_records → rules
// engine, age-30 event extraction → journey
const edge = (id: string) => document.querySelector(`[data-edge="${id}"]`)

afterEach(() => vi.unstubAllGlobals())

describe('AgentPipeline', () => {
  it('shows only the planned steps and the collections holding records, with particles on running edges', () => {
    motion(false)
    render(<AgentPipeline job={job([step('regulatory', 'running'), step('journey', 'pending'), step('finalize', 'pending')])} events={[]} competitors={[]} />)
    expect(node('s:regulatory')).toHaveAttribute('data-status', 'running')
    expect(node('s:regulatory')).toHaveTextContent('FDA · EMA')
    expect(node('s:clinical')).toBeNull()
    expect(node('c:fda_records')).toHaveTextContent('fda_records44')
    expect(node('c:ema_records')).toBeNull()
    expect(node('r:journey')).toHaveAttribute('data-status', 'pending')
    expect(node('r:journey')).toHaveTextContent('Rules engineWaits for structured records')
    expect(node('r:ai_triage')).toBeNull()
    expect(node('o:journey')).toHaveTextContent('Waiting')
    expect(node('o:assetai')).toBeNull()
    expect(node('o:compset')).toBeNull()

    expect(edge('age-0')).toHaveAttribute('data-state', 'active')
    expect(edge('age-0')?.querySelectorAll('[data-particle]')).toHaveLength(3)
    expect(edge('age-12')).toHaveAttribute('data-state', 'pending')
    expect(edge('age-12')?.querySelectorAll('[data-particle]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-edge]')).toHaveLength(3)
  })

  it('draws no particles when the user prefers reduced motion', () => {
    motion(true)
    render(<AgentPipeline job={job([step('regulatory', 'running'), step('journey', 'pending')])} events={[]} competitors={[]} />)
    expect(edge('age-0')).toHaveAttribute('data-state', 'active')
    expect(document.querySelectorAll('[data-particle]')).toHaveLength(0)
  })

  it('fills the outputs as steps finish', () => {
    motion(false)
    const steps = [
      step('regulatory', 'done', { fda_new: 40, fda_updated: 4, ema_new: 12 }),
      step('news', 'failed', {}, 'RuntimeError: feed down'),
      step('journey', 'done', { events: 31 }),
      step('ai_triage', 'done', { articles_ingest: 74, articles_skip: 112 }),
      step('ai_events', 'running'),
      step('index', 'done', { chunks: 1240 }),
      step('competitors', 'done', { competitors: 5 }),
      step('finalize', 'pending'),
    ]
    const events = [event('a'), event('b', { category: 'clinical' }), event('c', { via: 'ai_events', category: 'company' })]
    render(<AgentPipeline job={job(steps)} events={events} competitors={['Yutrepia', 'Uptravi']} />)
    expect(node('s:regulatory')).toHaveTextContent('56')
    expect(node('s:news')?.getAttribute('title')).toBe('news · RuntimeError: feed down')
    expect(node('r:journey')).toHaveTextContent('31 events by rule')
    expect(node('r:ai_triage')).toHaveTextContent('74 kept · 112 dropped')
    expect(node('r:ai_events')).toHaveTextContent('1 events')
    expect(node('r:index')).toHaveTextContent('1,240 passages')
    const journey = node('o:journey')!
    expect(journey).toHaveTextContent('Building')
    expect(journey).toHaveTextContent('3events')
    expect(journey).toHaveTextContent('Regulatory1Clinical1Safety0Company1Patents0')
    expect(journey).toHaveTextContent('rules 2 · ai 1 · rebuild 0')
    expect(node('o:assetai')).toHaveTextContent('1,240 passages · 0 questions')
    expect(node('o:compset')).toHaveTextContent('YutrepiaUptravi')
    expect(edge('age-30')).toHaveAttribute('data-state', 'active')
    expect(screen.getAllByText('AI')).toHaveLength(2)
  })

  it('reads Ready once the job has ended', () => {
    motion(false)
    const steps = [step('regulatory', 'done'), step('journey', 'done'), step('finalize', 'done', { suggested_questions: 4 })]
    render(<AgentPipeline job={job(steps, { status: 'completed' })} events={[event('a')]} competitors={[]} />)
    expect(node('o:journey')).toHaveTextContent('Ready')
    expect(document.querySelectorAll('[data-state="active"]')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/agent-pipeline.test.tsx`
Expected: FAIL — `Failed to resolve import "./agent-pipeline"`.

- [ ] **Step 3: Implement**

Port of `AgentGraph` in `design_files/aj/graph.jsx` and `.ag-*` in `aj/base.css`. Keys are stable (edge id, step name, collection name) so a poll never re-mounts an element and replays its entrance; particles exist only on active edges and never under reduced motion (`useMediaQuery` reports `true` where `matchMedia` is missing, so jsdom renders none unless a test stubs `matchMedia`).

```tsx
// file: apps/web/src/features/journey/live-build/agent-pipeline.tsx
import { Check, CircleDashed, Database, Filter, Loader2, Route, Sparkles, TriangleAlert, Users, type LucideIcon } from 'lucide-react'
import { useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { isActive, type JobStep } from '@/features/jobs/api'
import { stepShort } from '@/features/jobs/steps'
import { formatNumber } from '@/lib/format'
import { useElementWidth } from '@/lib/use-element-width'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { CATEGORIES, CATEGORY_META, collectionMeta } from '../constants'
import type { JobProgress, JourneyEventV3 } from '../types'
import { categoryCounts, stepRecordCount, triageCounts, viaCounts } from './build-model'
import { AG_COLL, AG_COLUMNS, AG_EDGES, AG_H, AG_NODES, AG_REASON, AG_SRC, AG_W, edgeState, nodeVisible } from './pipeline-layout'

type Status = JobStep['status']

const NODE = 'absolute rounded-lg border bg-card transition-[border-color,box-shadow,background-color,color] duration-300'
const SHIMMER: CSSProperties = {
  backgroundImage: 'linear-gradient(90deg, transparent 0%, #eef2fd 50%, transparent 100%)',
  backgroundSize: '60% 100%',
  backgroundRepeat: 'no-repeat',
}

function tone(status: Status): string {
  if (status === 'pending') return 'animate-ag-in border-dashed border-[#cfd4dc] bg-[#fcfcfd] text-muted-foreground'
  if (status === 'running') return 'animate-node-run border-primary shadow-[0_0_0_3px_rgba(35,71,217,0.12)]'
  return 'animate-ag-in'
}

const REASON_ICON: Record<string, LucideIcon> = { journey: Route, ai_triage: Filter, ai_events: Sparkles, index: Database }
const REASON_WAITING: Record<string, string> = {
  journey: 'Waits for structured records',
  ai_triage: 'Waits for unstructured records',
  ai_events: 'Extract, date and consolidate',
  index: 'Passages for Asset AI',
}

/** A step that failed or was skipped carries its reason (shown as a warning). */
const warning = (s: JobStep) => (s.status === 'failed' || s.status === 'skipped' ? (s.error ?? s.status) : null)

function StatusGlyph({ status, warn }: { status: Status; warn?: string | null }) {
  if (status === 'running') return <Loader2 aria-hidden="true" className="size-[13px] shrink-0 animate-spin text-primary" />
  if (warn) {
    return (
      <span title={warn} className="inline-flex shrink-0 text-[#c4690f]">
        <TriangleAlert aria-hidden="true" className="size-3" />
      </span>
    )
  }
  if (status === 'done') {
    return (
      <span className="inline-flex size-3.5 shrink-0 animate-ag-in items-center justify-center rounded-full bg-success text-white">
        <Check aria-hidden="true" className="size-2.5" strokeWidth={3} />
      </span>
    )
  }
  return <CircleDashed aria-hidden="true" className="size-[13px] shrink-0 text-[#c0c6d0]" />
}

/** The legend for the panel header: Planned / Running / Done. */
export function PipelineLegend() {
  return (
    <div className="flex items-center gap-3.5 text-[12px] text-text-secondary">
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded border border-dashed border-[#b8bfca] bg-[#fcfcfd]" />
        Planned
      </span>
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded border border-primary shadow-[0_0_0_2px_rgba(35,71,217,0.15)]" />
        Running
      </span>
      <span className="flex items-center gap-1.5">
        <i className="size-3 rounded border border-success bg-success" />
        Done
      </span>
    </div>
  )
}

/**
 * The agent pipeline (README §6.1; geometry from design_files/aj/graph.jsx): source agents → record store → reasoning →
 * outputs, drawn in a 1100×470 design space scaled to the panel (0.58–1.25). Nodes exist for the steps the job plans
 * (dashed until they run) and for collections that hold records; active edges carry particles unless the user
 * prefers reduced motion. Elements keep stable keys, so polls don't replay their entrance animations.
 */
export function AgentPipeline({ job, events, competitors }: { job: JobProgress; events: JourneyEventV3[]; competitors: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const uid = useId().replace(/[^\w-]/g, '')
  const scale = width ? Math.min(1.25, Math.max(0.58, width / AG_W)) : 1
  const offset = width ? Math.max(0, (width - AG_W * scale) / 2) : 0

  const byName = new Map(job.steps.map((s) => [s.name, s]))
  const plan = new Set(byName.keys())
  const order = new Map(job.steps.map((s, i) => [s.name, i]))
  const records = Object.fromEntries(job.records.map((r) => [r.coll, r.count]))
  const maxRecords = Math.max(1, ...job.records.map((r) => r.count))
  const visible = (key: string) => nodeVisible(key, plan, records)
  const edges = AG_EDGES.filter((e) => visible(e.from) && visible(e.to)).map((e) => ({ ...e, state: edgeState(e.steps, byName) }))
  const box = (key: string, step?: string): CSSProperties => {
    const n = AG_NODES[key]!
    return { left: n.x, top: n.y, width: n.w, height: n.h, animationDelay: step ? `${(order.get(step) ?? 0) * 60}ms` : undefined }
  }

  const via = viaCounts(events)
  const cats = categoryCounts(events)
  const ended = !isActive(job.status)
  const building = ['journey', 'ai_events', 'finalize'].some((n) => byName.get(n)?.status === 'running')
  const index = byName.get('index')
  const finalize = byName.get('finalize')
  const comp = byName.get('competitors')

  const reasonSub = (name: string, s: JobStep): string => {
    if (s.status === 'pending') return REASON_WAITING[name] ?? ''
    if (s.status !== 'running' && s.status !== 'done') return warning(s) ?? ''
    if (name === 'journey') return `${s.status === 'done' ? (s.counts.events ?? 0) : via.journey} events by rule`
    if (name === 'ai_triage') {
      if (s.status === 'running') return 'Triaging stored records'
      const t = triageCounts(s.counts)
      return `${t.kept} kept · ${t.dropped} dropped`
    }
    if (name === 'ai_events') return s.status === 'running' ? `${via.ai_events} events` : `${via.ai_events} events · ${s.counts.events ?? 0} candidates`
    return s.status === 'running' ? 'Chunking records for Asset AI' : `${formatNumber(s.counts.chunks ?? 0)} passages`
  }

  return (
    <div ref={ref} className="relative overflow-x-auto overflow-y-hidden" style={{ height: AG_H * scale + 16 }}>
      <div
        data-stage
        className="absolute top-2 left-0 origin-top-left"
        style={{ width: AG_W, height: AG_H, transform: `translateX(${offset}px) scale(${scale})` }}
      >
        {AG_COLUMNS.map(([label, x]) => (
          <div key={label} className="absolute top-0.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase" style={{ left: x }}>
            {label}
          </div>
        ))}
        <svg aria-hidden="true" width={AG_W} height={AG_H} viewBox={`0 0 ${AG_W} ${AG_H}`} className="pointer-events-none absolute top-0 left-0 overflow-visible">
          {edges.map((e) => {
            const active = e.state === 'active'
            return (
              <g key={e.id} data-edge={e.id} data-state={e.state}>
                <path
                  id={`${uid}-${e.id}`}
                  d={e.d}
                  pathLength={1}
                  fill="none"
                  strokeDasharray={1}
                  strokeDashoffset={1}
                  stroke={active ? e.color : e.state === 'done' ? '#c9d0dc' : '#e8ebf0'}
                  strokeWidth={active ? (e.faint ? 1.2 : 1.9) : 1.5}
                  opacity={e.faint ? (active ? 0.45 : 0.4) : active ? 0.7 : 1}
                  className="animate-draw transition-[stroke,opacity] duration-400"
                />
                {active &&
                  !reduced &&
                  [0, 1, 2].map((k) => (
                    <circle key={k} data-particle r={e.faint ? 2 : 2.8} fill={e.color} style={{ filter: 'drop-shadow(0 0 2px rgba(35,71,217,0.35))' }}>
                      <animateMotion dur={e.faint ? '1.1s' : '1.5s'} repeatCount="indefinite" begin={`-${k * 0.5}s`}>
                        <mpath href={`#${uid}-${e.id}`} />
                      </animateMotion>
                    </circle>
                  ))}
              </g>
            )
          })}
        </svg>

        {AG_SRC.filter((n) => visible(`s:${n}`)).map((n) => {
          const s = byName.get(n)!
          const warn = warning(s)
          const count = stepRecordCount(s)
          return (
            <div
              key={n}
              data-node={`s:${n}`}
              data-status={s.status}
              title={warn ? `${s.label} · ${warn}` : s.label}
              className={cn(NODE, tone(s.status), 'flex items-center gap-[7px] px-[9px] text-[12px]')}
              style={{ ...box(`s:${n}`, n), ...(s.status === 'running' && SHIMMER) }}
            >
              <StatusGlyph status={s.status} warn={warn} />
              <span className={cn('min-w-0 flex-1 truncate font-medium text-foreground', s.status === 'pending' && 'font-normal text-muted-foreground')}>
                {stepShort(s)}
              </span>
              <span className="font-mono text-[11.5px] text-text-secondary tabular-nums">{count === null ? '' : formatNumber(count)}</span>
            </div>
          )
        })}

        {AG_COLL.filter((c) => visible(`c:${c}`)).map((c) => {
          const n = records[c] ?? 0
          const filling = edges.some((e) => e.to === `c:${c}` && e.state === 'active')
          return (
            <div
              key={c}
              data-node={`c:${c}`}
              className={cn(NODE, 'flex animate-ag-in flex-col justify-center gap-1.5 bg-[#fcfcfd] px-2.5', filling && 'border-[#b8c4ef] shadow-[0_0_0_3px_rgba(35,71,217,0.07)]')}
              style={box(`c:${c}`)}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11.5px] text-secondary-foreground">{c}</span>
                <span className="font-mono text-[12px] font-semibold tabular-nums">{formatNumber(n)}</span>
              </div>
              <div className="h-[3px] overflow-hidden rounded-[2px] bg-accent">
                <i className="block h-full rounded-[2px] transition-[width] duration-300" style={{ width: `${(n / maxRecords) * 100}%`, background: collectionMeta(c).color }} />
              </div>
            </div>
          )
        })}

        {AG_REASON.filter((n) => visible(`r:${n}`)).map((n) => {
          const s = byName.get(n)!
          const Icon = REASON_ICON[n]!
          return (
            <div
              key={n}
              data-node={`r:${n}`}
              data-status={s.status}
              className={cn(NODE, tone(s.status), 'flex items-center gap-2.5 overflow-hidden px-3')}
              style={{ ...box(`r:${n}`, n), ...(s.status === 'running' && SHIMMER) }}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-muted text-text-secondary transition-colors duration-300',
                  s.status === 'running' && 'bg-primary-soft text-primary',
                  s.status === 'done' && 'bg-success-soft text-success',
                )}
              >
                <Icon aria-hidden="true" className="size-[15px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('flex items-center gap-1.5 text-[13px] font-semibold text-foreground', s.status === 'pending' && 'text-text-secondary')}>
                  {stepShort(s)}
                  {(n === 'ai_triage' || n === 'ai_events') && (
                    <span className="rounded bg-violet-soft px-[5px] text-[10px] leading-[15px] font-semibold text-violet">AI</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-text-secondary">{reasonSub(n, s)}</div>
              </div>
              <StatusGlyph status={s.status} warn={warning(s)} />
              {s.status === 'running' && (
                <div className="absolute inset-x-0 bottom-0 h-[3px] bg-primary-soft">
                  <i className="block h-full w-full animate-blink-dot bg-primary" />
                </div>
              )}
            </div>
          )
        })}

        {visible('o:journey') && (
          <div
            data-node="o:journey"
            className={cn(
              NODE,
              'flex animate-ag-in flex-col gap-1.5 px-3.5 py-3',
              ended
                ? 'border-[#9fd3cb] shadow-[0_0_0_4px_rgba(11,122,111,0.08)]'
                : building
                  ? 'border-primary shadow-[0_0_0_4px_rgba(35,71,217,0.10)]'
                  : !events.length && 'border-dashed',
            )}
            style={box('o:journey')}
          >
            <OutputHeader icon={Route} tile="bg-primary text-white" label="Journey">
              <span
                className={cn(
                  'rounded-full bg-muted px-[7px] py-0.5 text-[11px] font-semibold text-muted-foreground',
                  ended ? 'bg-success-soft text-success' : (events.length > 0 || building) && 'bg-primary-soft text-primary',
                )}
              >
                {ended ? 'Ready' : events.length > 0 || building ? 'Building' : 'Waiting'}
              </span>
            </OutputHeader>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-[40px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{formatNumber(events.length)}</span>
              <span className="text-text-secondary">events</span>
            </div>
            <div className="mt-1 flex h-1.5 gap-0.5 overflow-hidden rounded-[3px]">
              {CATEGORIES.map((c) =>
                cats[c] > 0 ? <i key={c} className="block transition-[flex-grow] duration-400" style={{ flexGrow: cats[c], background: CATEGORY_META[c].color }} /> : null,
              )}
              {!events.length && <i className="block grow bg-hair" />}
            </div>
            <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-[3px] text-[11.5px] text-text-secondary">
              {CATEGORIES.map((c) => (
                <li key={c} className="flex items-center gap-[5px]">
                  <b className="size-1.5 rounded-full" style={{ background: CATEGORY_META[c].color }} />
                  {CATEGORY_META[c].label}
                  <em className="ml-auto font-mono text-[11px] text-foreground not-italic">{cats[c]}</em>
                </li>
              ))}
            </ul>
            <div className="mt-auto truncate font-mono text-[10.5px] text-muted-foreground">
              rules {via.journey} · ai {via.ai_events} · rebuild {via.finalize}
            </div>
          </div>
        )}

        {index && visible('o:assetai') && (
          <div data-node="o:assetai" className={cn(NODE, tone(index.status), 'flex flex-col gap-1.5 px-3.5 py-3')} style={box('o:assetai')}>
            <OutputHeader icon={Sparkles} tile="bg-violet-soft text-violet" label="Asset AI">
              <StatusGlyph status={finalize?.status === 'done' ? 'done' : index.status === 'running' ? 'running' : 'pending'} />
            </OutputHeader>
            <div className="truncate text-[11.5px] text-text-secondary">
              {index.status === 'pending'
                ? 'Index builds after triage'
                : `${formatNumber(index.counts.chunks ?? 0)} passages · ${finalize?.counts.suggested_questions ?? 0} questions`}
            </div>
          </div>
        )}

        {comp && visible('o:compset') && (
          <div data-node="o:compset" className={cn(NODE, tone(comp.status), 'flex flex-col gap-1.5 px-3.5 py-3')} style={box('o:compset')}>
            <OutputHeader icon={Users} tile="bg-orange-soft text-orange" label="Competitor set">
              <StatusGlyph status={comp.status} warn={warning(comp)} />
            </OutputHeader>
            {comp.status === 'done' && competitors.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {competitors.slice(0, 5).map((c) => (
                  <span key={c} className="animate-ag-in rounded-[5px] bg-orange-soft px-1.5 py-px text-[11px] text-competitor">
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <div className="truncate text-[11.5px] text-text-secondary">
                {comp.status === 'done' ? `${stepRecordCount(comp) ?? 0} competitors` : 'Top 5 by indication and mechanism'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function OutputHeader({ icon: Icon, tile, label, children }: { icon: LucideIcon; tile: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', tile)}>
        <Icon aria-hidden="true" className="size-[15px]" />
      </span>
      <span className="flex-1 font-semibold text-foreground">{label}</span>
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/agent-pipeline.test.tsx && npx tsc -b`
Expected: PASS (1 file, 4 tests); `tsc` silent.

---

### Task 7: Forming timeline and Just added

**Files:**
- Create: `apps/web/src/features/journey/live-build/forming-timeline.tsx`
- Create: `apps/web/src/features/journey/live-build/just-added.tsx`
- Test: `apps/web/src/features/journey/live-build/forming-timeline.test.tsx`

**Interfaces:**
- Consumes: `formingYears`, `recordTicks`, `tipVia`, `viaLabel` (Task 4); `formatDay`, `todayIso`, `yearFraction` (`lib/dates.ts`), `useElementWidth`, `CATEGORIES`, `CATEGORY_META`, `collectionMeta`, `CategoryIcon`, `SignificanceBadge` (`features/assets/components/badges.tsx`), `formatNumber`, `cn` — existing. CSS utilities `animate-tick-in`, `animate-dot-in`, `animate-ring`, `animate-beam`, `animate-row-in`, `animate-fade`.
- Produces: `FormingTimeline({ recordYears: JobProgress['record_years']; recordCount: number; events: JourneyEventV3[] })` — ticks `rect[data-tick]` keyed by bucket, events `g[data-event="<id>"]`, hover → `role="tooltip"`; `JustAdded({ latest: JourneyEventV3[]; total: number; ended: boolean })` — shows the first five of `latest` (newest first).

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/live-build/forming-timeline.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import type { JourneyEventV3 } from '../types'
import { FormingTimeline } from './forming-timeline'
import { JustAdded } from './just-added'

const event = (id: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date: '2021-04-01',
  type: 'approval',
  category: 'regulatory',
  title: `Event ${id}`,
  significance: 'High',
  is_milestone: false,
  sources: [{ collection: 'fda_records', record_key: 'NDA1' }],
  via: 'journey',
  ...extra,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T09:00:00'))
})
afterEach(() => vi.useRealTimers())

describe('FormingTimeline', () => {
  it('lands record ticks and pops dated events on their lane, skipping the undated', () => {
    const years = [
      { coll: 'fda_records', year: 2021, n: 2 },
      { coll: 'trial_records', year: 2019, n: 1 },
    ]
    const events = [event('a'), event('b', { category: 'clinical', date: '2027-06-30', is_milestone: true }), event('c', { date: '' }), event('d', { date: '2020-02' })]
    const { container, rerender } = render(<FormingTimeline recordYears={years} recordCount={1234} events={events} />)
    expect(container.querySelectorAll('[data-tick]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-event]')).toHaveLength(3)
    expect(container.querySelector('[data-event="c"]')).toBeNull()
    expect(container.querySelector('[cx="NaN"]')).toBeNull()
    expect(container).toHaveTextContent('1,234')
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Regulatory')).toBeInTheDocument()

    // a later poll keeps the existing ticks (same keys, same elements) and adds the new one
    const first = container.querySelector('[data-tick]')
    rerender(<FormingTimeline recordYears={[{ ...years[0]!, n: 3 }, years[1]!]} recordCount={1235} events={events} />)
    expect(container.querySelectorAll('[data-tick]')).toHaveLength(4)
    expect(container.querySelector('[data-tick]')).toBe(first)
  })

  it('shows the title, date and origin of a hovered event', () => {
    const { container } = render(
      <FormingTimeline recordYears={[]} recordCount={0} events={[event('a', { via: 'ai_events', title: 'TETON-2 meets primary endpoint' })]} />,
    )
    fireEvent.mouseEnter(container.querySelector('[data-event="a"]')!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('TETON-2 meets primary endpointApr 1, 2021 · AI · 1 record')
    fireEvent.mouseLeave(container.querySelector('[data-event="a"]')!)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('JustAdded', () => {
  it('waits for the rules engine, and says when a finished crawl added nothing', () => {
    const { rerender } = render(<JustAdded latest={[]} total={0} ended={false} />)
    expect(screen.getByText('Events appear here once the rules engine starts reading structured records.')).toBeInTheDocument()
    rerender(<JustAdded latest={[]} total={106} ended />)
    expect(screen.getByText('This crawl added no new high-significance events.')).toBeInTheDocument()
  })

  it('lists the five newest events with how they were built', () => {
    const latest = ['f', 'e', 'd', 'c', 'b', 'a'].map((id) => event(id))
    latest[0] = event('f', { via: 'ai_events', title: 'FDA accepts Tyvaso sNDA', merged_sources: [{ collection: 'articles', record_key: 'x' }] })
    render(<JustAdded latest={latest} total={41} ended={false} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[0]).toHaveTextContent('FDA accepts Tyvaso sNDAApr 1, 2021AI · merged 2 recordsHigh')
    expect(items[1]).toHaveTextContent('Rule · fda_records')
    expect(screen.getByText('41 events')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/forming-timeline.test.tsx`
Expected: FAIL — `Failed to resolve import "./forming-timeline"`.

- [ ] **Step 3: Implement**

Port of `FormingTimeline` and `JustAdded` in `design_files/aj/live.jsx` (`.ft-*`, `.ja-*` in `aj/base.css`).

```tsx
// file: apps/web/src/features/journey/live-build/forming-timeline.tsx
import { useId, useMemo, useRef, useState } from 'react'
import { formatDay, todayIso, yearFraction } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { useElementWidth } from '@/lib/use-element-width'
import { CATEGORIES, CATEGORY_META, collectionMeta } from '../constants'
import type { JobProgress, JourneyEventV3 } from '../types'
import { formingYears, recordTicks, tipVia } from './build-model'

const L = 92
const R = 14
const LANE_H = 30
const TOP = 6
const REC_TOP = TOP + CATEGORIES.length * LANE_H + 12
const REC_H = 30
const AXIS_Y = REC_TOP + REC_H + 16
const H = AXIS_Y + 10

const radius = (e: JourneyEventV3) => (e.significance === 'High' ? 6 : e.significance === 'Medium' ? 4.6 : 3.4)
const laneY = (e: Pick<JourneyEventV3, 'category'>) => TOP + CATEGORIES.indexOf(e.category) * LANE_H + LANE_H / 2

/**
 * "Journey taking shape" (README §6.1; design_files/aj/live.jsx FormingTimeline): five category lanes over a records
 * strip. Records land as ticks at their real years (the job's record-year histogram); events pop on their lane with a
 * ring and a beam. Ticks and dots are keyed by bucket / event id, so only new ones animate.
 */
export function FormingTimeline({
  recordYears,
  recordCount,
  events,
}: {
  recordYears: JobProgress['record_years']
  recordCount: number
  events: JourneyEventV3[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const hatch = `${useId().replace(/[^\w-]/g, '')}-hatch`
  const [hover, setHover] = useState<string | null>(null)
  const ticks = useMemo(() => recordTicks(recordYears), [recordYears])
  const placed = events.filter((e) => CATEGORIES.includes(e.category) && Number.isFinite(yearFraction(e.date)))
  const today = yearFraction(todayIso())
  const { y0, y1 } = formingYears([...recordYears.map((r) => r.year), ...placed.map((e) => yearFraction(e.date))], Math.floor(today))

  const W = Math.max(width, 420)
  const x = (y: number) => L + ((Math.min(y1, Math.max(y0, y)) - y0) / (y1 - y0)) * (W - L - R)
  const tx = x(today)
  const every = W < 720 ? 4 : 2
  const years: number[] = []
  for (let y = y0; y <= y1; y += every) years.push(y)
  const shown = hover ? placed.find((e) => e.id === hover) : undefined

  return (
    <div className="px-4 pt-3.5 pb-1">
      <div ref={ref} className="relative">
        <svg aria-hidden="true" width={W} height={H} className="block overflow-visible">
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#eef0f3" strokeWidth="2" />
            </pattern>
          </defs>
          {CATEGORIES.map((c, i) => (
            <g key={c}>
              <rect x={L} y={TOP + i * LANE_H} width={W - L - R} height={LANE_H} fill={i % 2 ? '#fff' : '#fafbfc'} />
              <circle cx={8} cy={laneY({ category: c })} r={3.5} fill={CATEGORY_META[c].color} />
              <text x={18} y={laneY({ category: c }) + 4} className="fill-text-secondary text-[11.5px] font-medium">
                {CATEGORY_META[c].label}
              </text>
            </g>
          ))}
          <rect data-future x={tx} y={TOP} width={Math.max(0, W - R - tx)} height={REC_TOP + REC_H - TOP} fill={`url(#${hatch})`} />
          {years.map((y) => (
            <line key={y} x1={x(y)} x2={x(y)} y1={TOP} y2={REC_TOP + REC_H} stroke="#eef0f3" />
          ))}
          <rect x={L} y={REC_TOP} width={W - L - R} height={REC_H} rx={6} fill="#f9fafb" stroke="#eef0f3" />
          <text x={18} y={REC_TOP + 13} className="fill-text-secondary text-[11.5px] font-medium">
            Records
          </text>
          <text x={18} y={REC_TOP + 26} className="fill-muted-foreground font-mono text-[11px]">
            {formatNumber(recordCount)}
          </text>
          {ticks.map((t) => (
            <rect
              key={t.key}
              data-tick
              className="animate-tick-in"
              x={x(t.at)}
              y={REC_TOP + 4 + t.jitter * (REC_H - 16)}
              width={1.6}
              height={8}
              fill={collectionMeta(t.coll).color}
              opacity={0.55}
            />
          ))}
          {placed.map((e) => {
            const ex = x(yearFraction(e.date))
            const ey = laneY(e)
            const c = CATEGORY_META[e.category].color
            const r = radius(e)
            return (
              <g key={e.id} data-event={e.id} className="cursor-pointer" onMouseEnter={() => setHover(e.id)} onMouseLeave={() => setHover(null)}>
                <line className="animate-beam opacity-0" x1={ex} x2={ex} y1={REC_TOP + 2} y2={ey} stroke={c} strokeWidth={1.5} />
                <circle className="origin-center animate-ring [transform-box:fill-box]" cx={ex} cy={ey} r={r} fill="none" stroke={c} strokeWidth={1.5} />
                <circle
                  className="origin-center animate-dot-in [transform-box:fill-box]"
                  cx={ex}
                  cy={ey}
                  r={r}
                  fill={e.is_milestone ? '#fff' : c}
                  stroke={e.is_milestone ? c : '#fff'}
                  strokeWidth={e.is_milestone ? 1.6 : 1.2}
                  strokeDasharray={e.is_milestone ? '2 1.6' : undefined}
                />
                <circle cx={ex} cy={ey} r={10} fill="transparent" />
              </g>
            )
          })}
          <line x1={tx} x2={tx} y1={TOP - 2} y2={REC_TOP + REC_H + 4} stroke="#101828" strokeWidth={1} strokeDasharray="3 3" />
          <text x={tx} y={AXIS_Y} textAnchor="middle" className="fill-foreground text-[10.5px] font-semibold">
            Today
          </text>
          {years
            .filter((y) => Math.abs(x(y) - tx) > 30)
            .map((y) => (
              <text key={y} x={x(y)} y={AXIS_Y} textAnchor="middle" className="fill-muted-foreground font-mono text-[10.5px]">
                {y}
              </text>
            ))}
        </svg>
        {shown && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-20 flex w-max max-w-[260px] animate-fade flex-col gap-0.5 rounded-lg bg-foreground px-[9px] py-[7px] text-[12px] leading-[1.35] text-white shadow-[0_6px_16px_rgba(16,24,40,0.18)]"
            style={{ left: x(yearFraction(shown.date)), top: laneY(shown) - 6, transform: 'translate(-50%, calc(-100% - 8px))' }}
          >
            <b className="font-medium">{shown.title}</b>
            <span className="text-[11.5px] text-[#c3c9d4]">
              {formatDay(shown.date)} · {tipVia(shown)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
```

```tsx
// file: apps/web/src/features/journey/live-build/just-added.tsx
import { Sparkles } from 'lucide-react'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { formatDay } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { JourneyEventV3 } from '../types'
import { viaLabel } from './build-model'

/**
 * "Just added" under the forming timeline: the five newest events the crawl announced (the crawler announces new
 * High-significance events), newest first.
 */
export function JustAdded({ latest, total, ended }: { latest: JourneyEventV3[]; total: number; ended: boolean }) {
  return (
    <div className="border-t border-hair px-4 pt-3 pb-3.5">
      <div className="mb-1 flex justify-between text-[11px] font-semibold tracking-[0.06em] text-text-secondary uppercase">
        <span>Just added</span>
        {total > 0 && <span className="font-mono font-medium tracking-normal text-muted-foreground normal-case">{formatNumber(total)} events</span>}
      </div>
      {latest.length === 0 ? (
        <p className="my-1.5 text-muted-foreground">
          {ended ? 'This crawl added no new high-significance events.' : 'Events appear here once the rules engine starts reading structured records.'}
        </p>
      ) : (
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
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/forming-timeline.test.tsx && npx tsc -b`
Expected: PASS (1 file, 4 tests); `tsc` silent.

---

### Task 8: Activity log

**Files:**
- Create: `apps/web/src/features/journey/live-build/activity-log.tsx`
- Test: `apps/web/src/features/journey/live-build/activity-log.test.tsx`

**Interfaces:**
- Consumes: `formatClock`, `secondsSince` (Task 4); `JobStep`, `stepShort`, `cn`, `JobFeedItem` — existing. CSS utilities `animate-log-in`, `animate-caret`.
- Produces: `ActivityLog({ items: JobFeedItem[]; steps: JobStep[]; startedAt: string | null; running: boolean })` — `role="log"` "Crawl activity", absolutely positioned to fill its (relative) parent; one `[data-kind]` row per line (last 140); the caret line carries `data-caret`.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/live-build/activity-log.test.tsx
import { render, screen } from '@testing-library/react'
import type { JobStep } from '@/features/jobs/api'
import type { JobFeedItem } from '../types'
import { ActivityLog } from './activity-log'

const STEPS: JobStep[] = [
  { name: 'regulatory', label: 'Regulatory (FDA, EMA)', status: 'done', counts: {}, error: null, started_at: null, finished_at: null },
  { name: 'ai_triage', label: 'AI triage of stored records', status: 'running', counts: {}, error: null, started_at: null, finished_at: null },
]
const at = (s: number) => new Date(Date.parse('2026-10-09T10:00:00Z') + s * 1000).toISOString()
const line = (id: number, extra: Partial<JobFeedItem> = {}): JobFeedItem => ({ id, t: at(id), step: 'regulatory', kind: 'info', text: `line ${id}`, ...extra })

describe('ActivityLog', () => {
  it('writes each kind of line with its clock and step tag, and a caret on the newest while running', () => {
    const items = [
      line(1, { step: 'plan', text: 'Planning onboard for Treprostinil · 17 steps' }),
      line(2, { kind: 'done', text: 'Stored 44 FDA and 12 EMA records' }),
      line(3, { step: 'news', kind: 'warn', text: 'Skipped: No newsroom crawler' }),
      line(65, { step: 'ai_triage', kind: 'ai', verdict: 'Ingest', text: '“FDA Accepts Inhaled Treprostinil sNDA for IPF”' }),
      line(66, { step: 'ai_triage', kind: 'event', text: 'FDA approves Tyvaso DPI', event_id: 'e27', merged: 3 }),
    ]
    render(<ActivityLog items={items} steps={STEPS} startedAt="2026-10-09T10:00:00Z" running />)
    const rows = [...screen.getByRole('log', { name: 'Crawl activity' }).querySelectorAll<HTMLElement>('[data-kind]')]
    expect(rows.map((r) => r.dataset.kind)).toEqual(['info', 'done', 'warn', 'ai', 'event'])
    expect(rows[0]).toHaveTextContent('00:01PlanPlanning onboard for Treprostinil · 17 steps')
    expect(rows[1]).toHaveTextContent('00:02FDA · EMAStored 44 FDA and 12 EMA records')
    expect(rows[2]).toHaveTextContent('00:03Newswires · BingSkipped: No newsroom crawler')
    expect(rows[3]).toHaveTextContent('01:05AI triageIngest“FDA Accepts Inhaled Treprostinil sNDA for IPF”')
    expect(rows[4]).toHaveTextContent('01:06AI triage+FDA approves Tyvaso DPI3')
    expect(document.querySelectorAll('[data-caret]')).toHaveLength(1)
    expect(rows[4]!.querySelector('[data-caret]')).not.toBeNull()
  })

  it('drops the caret once the job has ended and keeps only the last 140 lines', () => {
    const items = Array.from({ length: 150 }, (_, i) => line(i + 1))
    render(<ActivityLog items={items} steps={STEPS} startedAt={null} running={false} />)
    expect(document.querySelectorAll('[data-kind]')).toHaveLength(140)
    expect(screen.queryByText('line 10')).not.toBeInTheDocument()
    expect(screen.getByText('line 150')).toBeInTheDocument()
    expect(document.querySelector('[data-caret]')).toBeNull()
  })

  it('follows new lines unless the user scrolled up more than 40px', () => {
    const { rerender } = render(<ActivityLog items={[line(1)]} steps={STEPS} startedAt={null} running />)
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
    rerender(<ActivityLog items={[line(1), line(2)]} steps={STEPS} startedAt={null} running />)
    expect(log.scrollTop).toBe(1000)

    log.scrollTop = 600 // 1000 − 600 − 300 = 100px from the bottom
    log.dispatchEvent(new Event('scroll'))
    rerender(<ActivityLog items={[line(1), line(2), line(3)]} steps={STEPS} startedAt={null} running />)
    expect(log.scrollTop).toBe(600)

    log.scrollTop = 680 // back within 40px of the bottom
    log.dispatchEvent(new Event('scroll'))
    rerender(<ActivityLog items={[line(1), line(2), line(3), line(4)]} steps={STEPS} startedAt={null} running />)
    expect(log.scrollTop).toBe(1000)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/activity-log.test.tsx`
Expected: FAIL — `Failed to resolve import "./activity-log"`.

- [ ] **Step 3: Implement**

Port of `ActivityLog` in `design_files/aj/live.jsx` (`.log-*`, `.vd-*`, `.caret` in `aj/base.css`). The prototype's `fx` kind is not produced by the crawler and is not ported.

```tsx
// file: apps/web/src/features/journey/live-build/activity-log.tsx
import { Check, GitMerge, TriangleAlert } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import type { JobStep } from '@/features/jobs/api'
import { stepShort } from '@/features/jobs/steps'
import { cn } from '@/lib/utils'
import type { JobFeedItem } from '../types'
import { formatClock, secondsSince } from './build-model'

/** Lines kept on screen (design_files/aj/live.jsx). */
const LOG_LINES = 140

const VERDICT: Record<NonNullable<JobFeedItem['verdict']>, string> = {
  Ingest: 'bg-success-soft text-success',
  Headline: 'bg-warning-soft text-warning',
  Skip: 'bg-muted text-muted-foreground',
}

/**
 * The crawl worker's live log (README §6.1 "Activity log"): clock since the job started, step tag, and the line by kind
 * (info, done ✓, warn ⚠, AI verdict pill, event + merged-records chip), with a typing caret on the newest line while
 * the job runs. It follows new lines unless the user has scrolled up more than 40px.
 */
export function ActivityLog({ items, steps, startedAt, running }: { items: JobFeedItem[]; steps: JobStep[]; startedAt: string | null; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lines = items.slice(-LOG_LINES)
  const last = lines.at(-1)?.id
  const byName = new Map(steps.map((s) => [s.name, s]))
  const start = startedAt ?? items[0]?.t ?? null

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [last])

  return (
    <div
      ref={ref}
      role="log"
      aria-label="Crawl activity"
      className="absolute inset-0 overflow-auto pt-2 pb-3"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {lines.map((l) => {
        const caret = running && l.id === last
        return (
          <div key={l.id} data-kind={l.kind} className="grid animate-log-in grid-cols-[40px_minmax(0,1fr)] gap-2 px-4 py-1 text-[12.5px] leading-[1.45]">
            <span className="pt-px font-mono text-[11px] text-faint">{formatClock(secondsSince(start, Date.parse(l.t)))}</span>
            <div className="min-w-0">
              <span className="mr-1.5 inline-block rounded bg-muted px-[5px] text-[11px] leading-[17px] font-semibold text-text-secondary">
                {l.step === 'plan' ? 'Plan' : stepShort(byName.get(l.step) ?? { name: l.step, label: l.step })}
              </span>
              <span
                data-caret={caret || undefined}
                className={cn(
                  'text-secondary-foreground',
                  l.kind === 'warn' && 'text-warning',
                  l.kind === 'done' && 'font-medium text-foreground',
                  caret && "after:ml-1 after:inline-block after:h-[13px] after:w-1.5 after:animate-caret after:bg-primary after:align-[-2px] after:content-['']",
                )}
              >
                {l.kind === 'event' && (
                  <>
                    <span className="mr-1 font-bold text-success">+</span>
                    <b className="font-medium text-foreground">{l.text}</b>
                    {(l.merged ?? 0) > 1 && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-violet-soft px-[5px] align-[1px] text-[11px] text-violet">
                        <GitMerge aria-hidden="true" className="size-[11px]" />
                        {l.merged}
                      </span>
                    )}
                  </>
                )}
                {l.kind === 'ai' && (
                  <>
                    {l.verdict && (
                      <span className={cn('mr-1.5 inline-block rounded px-[5px] text-[10.5px] leading-4 font-semibold', VERDICT[l.verdict])}>{l.verdict}</span>
                    )}
                    {l.text}
                  </>
                )}
                {l.kind === 'warn' && (
                  <>
                    <TriangleAlert aria-hidden="true" className="mr-1 inline-block size-3 align-[-2px]" />
                    {l.text}
                  </>
                )}
                {l.kind === 'done' && (
                  <>
                    <Check aria-hidden="true" className="mr-1 inline-block size-3 align-[-2px] text-success" strokeWidth={2.6} />
                    {l.text}
                  </>
                )}
                {l.kind === 'info' && l.text}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/activity-log.test.tsx && npx tsc -b`
Expected: PASS (1 file, 3 tests); `tsc` silent.

---

### Task 9: Chat job card — segmented bar, counters, "Watch the live build"

**Files:**
- Modify: `apps/web/src/features/chat/components/cards/job-card.tsx` (Replace)
- Test: `apps/web/src/features/chat/components/cards/job-card.test.tsx`

**Interfaces:**
- Consumes: `recordsTotal`, `sourceProgress` (Task 1); `useJobProgress`, `isActive` (`features/jobs/api.ts`), `StepBar` (`features/jobs/components/step-bar.tsx`, Phase 2), `JobStatusBadge` (`features/jobs/jobs-pages.tsx`), `formatNumber` — existing.
- Produces: `JobCard({ card })` unchanged signature. It now reads `GET /jobs/:id` through `useJobProgress` (same `['job', id]` cache as before), shows `StepBar` and "{records} records · {events_created} events · {done}/{total} sources", and links to `/assets/:id/overview?build=1` ("Watch the live build") while the job is queued or running, `/assets/:id/overview` ("Open the journey") after. The step-errors list stays.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/chat/components/cards/job-card.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { JobStep } from '@/features/jobs/api'
import type { JobProgress } from '@/features/journey/types'
import { JobCard } from './job-card'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const step = (name: string, status: JobStep['status'], label = name, error: string | null = null): JobStep => ({
  name,
  label,
  status,
  counts: {},
  error,
  started_at: null,
  finished_at: null,
})

const job = (extra: Partial<JobProgress>): JobProgress => ({
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'onboard',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'pending'), step('journey', 'running', 'Journey events (rules)'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: null,
  records: [
    { coll: 'fda_records', count: 1000 },
    { coll: 'trial_records', count: 234 },
  ],
  events_created: 7,
  feed_cursor: 9,
  record_years: [],
  ...extra,
})

function renderCard(data: JobProgress) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url === '/api/jobs/j1' ? json(200, data) : json(404, { code: 'NOT_FOUND', message: url }))),
  )
  const card = { type: 'job' as const, jobId: 'j1', assetId: 'trep', assetName: 'Treprostinil' }
  const router = createMemoryRouter([{ path: '*', element: <JobCard card={card} /> }])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('chat JobCard', () => {
  it('shows the segmented step bar, the counters and a link to the live build while the crawl runs', async () => {
    renderCard(job({}))
    expect(await screen.findByText('Step 2 of 4 · Journey events (rules)')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Crawl steps' })
    expect([...bar.querySelectorAll<HTMLElement>('[data-status]')].map((s) => s.dataset.status)).toEqual(['done', 'pending', 'running', 'pending'])
    expect(screen.getByText(/records$/)).toHaveTextContent('1,234 records')
    expect(screen.getByText(/events$/)).toHaveTextContent('7 events')
    expect(screen.getByText(/sources$/)).toHaveTextContent('1/2 sources')
    expect(screen.getByRole('link', { name: /Watch the live build/ })).toHaveAttribute('href', '/assets/trep/overview?build=1')
  })

  it('opens the journey once the crawl has ended, and keeps listing step errors', async () => {
    const steps = [step('regulatory', 'done'), step('clinical', 'failed', 'Clinical trials', 'HTTP 503'), step('journey', 'done'), step('finalize', 'done')]
    renderCard(job({ status: 'completed_with_errors', steps, finished_at: '2026-10-09T10:05:00Z' }))
    expect(await screen.findByText('4 of 4 steps finished')).toBeInTheDocument()
    expect(screen.getByText('Completed with errors')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open the journey/ })).toHaveAttribute('href', '/assets/trep/overview')
    expect(screen.getByRole('list', { name: 'Step errors' })).toHaveTextContent('Clinical trials: HTTP 503')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/chat/components/cards/job-card.test.tsx`
Expected: FAIL — both tests: `Unable to find an accessible element with the role "progressbar" and name "Crawl steps"` and `Unable to find an accessible element with the role "link" and name /Open the journey/` (the current card has a plain bar and "Open asset").

- [ ] **Step 3: Implement**

**Replace** the card (port of `JobCardS` in `design_files/pe/chat.jsx`; screen 4):

```tsx
// file: apps/web/src/features/chat/components/cards/job-card.tsx
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { isActive, useJobProgress } from '@/features/jobs/api'
import { StepBar } from '@/features/jobs/components/step-bar'
import { recordsTotal, sourceProgress } from '@/features/jobs/job-counters'
import { JobStatusBadge } from '@/features/jobs/jobs-pages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Card } from '../../api'

type JobCardData = Extract<Card, { type: 'job' }>

/** Progress of the crawl started from the chat (polls while it runs): step bar, counters, link to the live build. */
export function JobCard({ card }: { card: JobCardData }) {
  const job = useJobProgress(card.jobId)
  const j = job.data
  const overview = `/assets/${encodeURIComponent(card.assetId)}/overview`
  const live = !j || isActive(j.status)
  const sources = sourceProgress(j ?? { steps: [] })
  const finished = j ? j.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length : 0
  const total = j?.steps.length ?? 0
  const current = j?.steps.find((s) => s.status === 'running')
  const problems = j?.steps.filter((s) => s.error) ?? []

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">Collecting data for {card.assetName}</p>
          <p className="text-[12.5px] text-text-secondary">
            {!j
              ? 'Checking progress…'
              : current
                ? `Step ${finished + 1} of ${total} · ${current.label}`
                : isActive(j.status)
                  ? 'Waiting to start'
                  : `${finished} of ${total} steps finished`}
          </p>
        </div>
        {j && <JobStatusBadge status={j.status} />}
      </div>
      {job.isPending && <Skeleton className="h-1.5 w-full" />}
      {job.isError && <p className="text-destructive">Progress is unavailable right now.</p>}
      {j && <StepBar steps={j.steps} />}
      {j && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground tabular-nums">{formatNumber(recordsTotal(j))}</b> records
          </span>
          <span>
            <b className="font-semibold text-foreground tabular-nums">{formatNumber(j.events_created)}</b> events
          </span>
          <span>
            <b className="font-semibold text-foreground tabular-nums">
              {sources.done}/{sources.total}
            </b>{' '}
            sources
          </span>
        </p>
      )}
      {problems.length > 0 && (
        <ul aria-label="Step errors" className="space-y-0.5 text-[12.5px]">
          {problems.map((s) => (
            <li key={s.name} className={cn('line-clamp-2', s.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
              <span className="font-medium">{s.label}:</span> {s.error}
            </li>
          ))}
        </ul>
      )}
      <Link
        to={live ? `${overview}?build=1` : overview}
        className="inline-flex w-max items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
      >
        {live ? 'Watch the live build' : 'Open the journey'} <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/chat && npx tsc -b`
Expected: PASS (6 files, 24 tests on the Phase 2 baseline, including the 2 new ones); `tsc` silent.

---

### Task 10: Live-build data hook

**Files:**
- Create: `apps/web/src/features/journey/live-build/use-live-build.ts`
- Test: `apps/web/src/features/journey/live-build/use-live-build.test.tsx`

**Interfaces:**
- Consumes: `useJobFeed` (Task 2, `features/jobs/feed.ts`); `useTimelineV3`, `useEventsById` (Task 2, `features/journey/api.ts`); `lastEventLine`, `liveEventIds`, `uniqueEvents` (Task 4); `useJobs`, `useJobProgress`, `isActive` (`features/jobs/api.ts`), `AssetDetail` — existing.
- Produces: `interface LiveBuildData { state: 'loading' | 'error' | 'none' | 'ready'; job: JobProgress | undefined; feed: JobFeedItem[]; events: JourneyEventV3[]; latest: JourneyEventV3[] }`; `useLiveBuild(asset: Pick<AssetDetail, 'id' | 'status'>): LiveBuildData`. Side effects: invalidates `['asset', id, 'timeline-v3']` when the newest `event` line id grows; when the job is seen ending (or is already ended while the asset is still `onboarding`) invalidates `['asset', id]` (exact), `['asset', id, 'timeline-v3']` and `['assets']`, and again 3 s later.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/journey/live-build/use-live-build.test.tsx
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { JobStep } from '@/features/jobs/api'
import type { JobFeedItem, JobProgress, JourneyEventV3 } from '../types'
import { useLiveBuild } from './use-live-build'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const job = (id: string, extra: Partial<JobProgress> = {}): JobProgress => ({
  id,
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status: 'running',
  steps: [step('regulatory', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: null,
  records: [{ coll: 'fda_records', count: 44 }],
  events_created: 0,
  feed_cursor: 1,
  record_years: [],
  ...extra,
})
const line = (id: number, extra: Partial<JobFeedItem> = {}): JobFeedItem => ({ id, t: '2026-10-09T10:00:00Z', step: 'journey', kind: 'info', text: `line ${id}`, ...extra })
const event = (id: string): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date: '2021-04-01',
  type: 'approval',
  category: 'regulatory',
  title: `Event ${id}`,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
})

/** A fake API whose job, feed and timeline the test changes as the crawl goes on. */
function fakeApi() {
  const api = {
    jobs: [job('j1')] as JobProgress[],
    job: job('j1'),
    feed: [line(1, { step: 'plan' })] as JobFeedItem[],
    timeline: [event('k1')],
    events: { e9: event('e9') } as Record<string, JourneyEventV3>,
    urls: [] as string[],
    timelineCalls: () => api.urls.filter((u) => u === '/api/assets/trep/timeline?scope=key').length,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      api.urls.push(url)
      if (url === '/api/jobs?asset=trep') return json(200, api.jobs)
      if (url === `/api/jobs/${api.job.id}`) return json(200, api.job)
      const feed = /^\/api\/jobs\/[^/]+\/feed\?since=(\d+)$/.exec(url)
      if (feed) {
        const since = Number(feed[1])
        const items = api.feed.filter((l) => l.id > since)
        return json(200, { items, cursor: Math.max(since, ...items.map((l) => l.id)) })
      }
      if (url === '/api/assets/trep/timeline?scope=key') return json(200, { events: api.timeline, total: api.timeline.length })
      const ev = /^\/api\/assets\/trep\/events\/(.+)$/.exec(url)
      const found = ev && api.events[decodeURIComponent(ev[1]!)]
      if (found) return json(200, { event: found, records: [] })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  return api
}

function setup(status: 'onboarding' | 'ready' = 'ready') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['asset', 'trep'], { id: 'trep', status })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => useLiveBuild({ id: 'trep', status }), { wrapper })
  const poll = () => act(() => client.refetchQueries({ queryKey: ['job'] }))
  return { client, ...hook, poll }
}

afterEach(() => {
  focusManager.setFocused(undefined)
  vi.unstubAllGlobals()
})

describe('useLiveBuild', () => {
  it('follows the newest job of the asset', async () => {
    const api = fakeApi()
    api.jobs = [job('j2'), job('j1', { status: 'completed' })]
    api.job = job('j2')
    const { result } = setup()
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.job?.id).toBe('j2')
    await waitFor(() => expect(result.current.feed).toHaveLength(1))
    expect(api.urls).not.toContain('/api/jobs/j1')
  })

  it('says when the asset has never been crawled', async () => {
    const api = fakeApi()
    api.jobs = []
    const { result } = setup()
    await waitFor(() => expect(result.current.state).toBe('none'))
  })

  it('refetches the key timeline only when the feed announces an event, and loads that event', async () => {
    const api = fakeApi()
    const { result, poll } = setup()
    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(['k1']))
    expect(api.timelineCalls()).toBe(1)

    api.feed.push(line(2, { kind: 'done', text: '31 events from structured sources' }))
    api.job = { ...api.job, feed_cursor: 2 }
    await poll()
    await waitFor(() => expect(result.current.feed).toHaveLength(2))
    expect(api.timelineCalls()).toBe(1)

    api.feed.push(line(3, { kind: 'event', text: 'Event e9', event_id: 'e9', merged: 1 }))
    api.job = { ...api.job, feed_cursor: 3 }
    await poll()
    await waitFor(() => expect(result.current.latest.map((e) => e.id)).toEqual(['e9']))
    expect(result.current.events.map((e) => e.id)).toEqual(['k1', 'e9'])
    expect(api.urls).toContain('/api/assets/trep/events/e9')
    await waitFor(() => expect(api.timelineCalls()).toBe(2))
  })

  it('catches up the feed and reloads the asset when the job ended while the tab was hidden', async () => {
    const api = fakeApi()
    const { result, client } = setup('onboarding')
    await waitFor(() => expect(result.current.feed).toHaveLength(1))
    expect(client.getQueryState(['asset', 'trep'])?.isInvalidated).toBe(false)

    act(() => focusManager.setFocused(false))
    api.feed.push(line(2, { kind: 'done', text: 'Asset ready · 41 key events · 6 branches' }))
    api.job = job('j1', { status: 'completed', feed_cursor: 2, finished_at: '2026-10-09T10:05:00Z' })
    act(() => focusManager.setFocused(true))

    await waitFor(() => expect(result.current.job?.status).toBe('completed'))
    await waitFor(() => expect(result.current.feed.map((l) => l.id)).toEqual([1, 2]))
    // nothing else watches the asset here: only the job-ended reload can have invalidated it
    expect(client.getQueryState(['asset', 'trep'])?.isInvalidated).toBe(true)
  })

  it('reloads an asset still marked onboarding whose job had already ended', async () => {
    const api = fakeApi()
    api.job = job('j1', { status: 'completed', feed_cursor: 1 })
    const { client } = setup('onboarding')
    await waitFor(() => expect(client.getQueryState(['asset', 'trep'])?.isInvalidated).toBe(true))
  })

  it('leaves a ready asset alone when its last job had already ended', async () => {
    const api = fakeApi()
    api.job = job('j1', { status: 'completed', feed_cursor: 1 })
    const { result, client } = setup('ready')
    await waitFor(() => expect(result.current.feed).toHaveLength(1))
    expect(client.getQueryState(['asset', 'trep'])?.isInvalidated).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/use-live-build.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-live-build"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/journey/live-build/use-live-build.ts
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import type { AssetDetail } from '@/features/assets/api'
import { isActive, useJobProgress, useJobs } from '@/features/jobs/api'
import { useJobFeed } from '@/features/jobs/feed'
import { useEventsById, useTimelineV3 } from '../api'
import type { JobFeedItem, JobProgress, JourneyEventV3 } from '../types'
import { lastEventLine, liveEventIds, uniqueEvents } from './build-model'

export interface LiveBuildData {
  /** loading: finding the job; error: it couldn't be loaded; none: the asset has never been crawled. */
  state: 'loading' | 'error' | 'none' | 'ready'
  job: JobProgress | undefined
  feed: JobFeedItem[]
  /** On the forming timeline: the key journey plus every event the feed announced, once each. */
  events: JourneyEventV3[]
  /** Events the feed announced, newest first. */
  latest: JourneyEventV3[]
}

const NO_LINES: JobFeedItem[] = []
/** The crawler bumps the API's cache version just after it marks the job finished: reload once more after this. */
const REFRESH_AGAIN_MS = 3000

/**
 * Everything the live build shows for an asset's newest crawl job: the job (polled 2 s while active), its feed (by
 * cursor), and the events. The API serves the timeline from a cache that only moves when the job ends, so events the
 * feed announces are loaded one by one (uncached route); the timeline is refetched only when the feed announces an
 * event, and the asset, timeline and asset list are reloaded when the job ends — also when that happened while the tab
 * was hidden, or before this view mounted for an asset still marked onboarding.
 */
export function useLiveBuild(asset: Pick<AssetDetail, 'id' | 'status'>): LiveBuildData {
  const qc = useQueryClient()
  const jobs = useJobs({ asset: asset.id })
  const progress = useJobProgress(jobs.data?.[0]?.id ?? null)
  const job = progress.data
  const feed = useJobFeed(job)
  const timeline = useTimelineV3(asset.id, { scope: 'key' })
  const items = feed.data?.items ?? NO_LINES
  const ids = useMemo(() => liveEventIds(items), [items])
  const announced = useEventsById(asset.id, ids)

  const lastEvent = feed.data ? lastEventLine(feed.data.items) : null
  const seenEvent = useRef<number | null>(null)
  useEffect(() => {
    if (lastEvent === null) return
    if (seenEvent.current !== null && lastEvent > seenEvent.current) {
      void qc.invalidateQueries({ queryKey: ['asset', asset.id, 'timeline-v3'] })
    }
    seenEvent.current = lastEvent
  }, [lastEvent, asset.id, qc])

  const finished = job ? !isActive(job.status) : null
  const wasActive = useRef(false)
  useEffect(() => {
    if (finished === null) return
    if (!finished) {
      wasActive.current = true
      return
    }
    if (!wasActive.current && asset.status !== 'onboarding') return
    wasActive.current = false
    const reload = () => {
      void qc.invalidateQueries({ queryKey: ['asset', asset.id], exact: true })
      void qc.invalidateQueries({ queryKey: ['asset', asset.id, 'timeline-v3'] })
      void qc.invalidateQueries({ queryKey: ['assets'] })
    }
    reload()
    const timer = setTimeout(reload, REFRESH_AGAIN_MS)
    return () => clearTimeout(timer)
  }, [finished, job?.id, asset.id, asset.status, qc])

  const events = useMemo(() => uniqueEvents(timeline.data?.events ?? [], announced), [timeline.data, announced])
  const latest = useMemo(() => [...announced].reverse(), [announced])
  const state =
    jobs.isError || progress.isError
      ? 'error'
      : jobs.data && jobs.data.length === 0
        ? 'none'
        : job
          ? 'ready'
          : 'loading'
  return { state, job, feed: items, events, latest }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/live-build/use-live-build.test.tsx && npx tsc -b`
Expected: PASS (1 file, 6 tests); `tsc` silent.

---

### Task 11: LiveBuild on the Overview

**Files:**
- Create: `apps/web/src/features/journey/live-build/live-build.tsx`
- Modify: `apps/web/src/features/assets/pages/tabs.tsx` (`OverviewTab`)
- Modify: `apps/web/src/features/assets/pages/asset-layout.tsx` (Overview tab dot, breadcrumb)
- Test: `apps/web/src/features/assets/pages/overview-tab.test.tsx`

**Interfaces:**
- Consumes: `useLiveBuild` (Task 10); `BuildStrip` (Task 5); `AgentPipeline`, `PipelineLegend` (Task 6); `FormingTimeline`, `JustAdded` (Task 7); `ActivityLog` (Task 8); `buildPhase` (Task 4); `recordsTotal` (Task 1); `Panel`, `EmptyState` (`features/assets/components/panel.tsx`), `Skeleton`, `AssetDetail`, `useAssetContext`, `AssetLayout` — existing.
- Produces: `LiveBuild({ asset: AssetDetail; onExplore: () => void })`. `OverviewTab` renders it when `?build=1` or the asset is `onboarding` (until "Explore the journey" for that asset); "Explore the journey" removes `build` from the URL. `AssetLayout` shows `[data-live-dot]` on the Overview tab and the breadcrumb "Building journey" on the Overview while the asset is onboarding.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/assets/pages/overview-tab.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { AssetDetail } from '@/features/assets/api'
import type { JobStep } from '@/features/jobs/api'
import type { JobProgress } from '@/features/journey/types'
import { useShellStore } from '@/stores/shell-store'
import { AssetLayout } from './asset-layout'
import { OverviewTab } from './tabs'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASSET: AssetDetail = {
  id: 'trep',
  name: 'Treprostinil',
  aliases: [],
  company: { name: 'United Therapeutics' },
  tags: { indications: ['PAH'] },
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null,
  competitorOf: [],
  kpis: { approvalRegions: ['US'], activeTrials: 0, activePhase3: 0, upcomingMilestones: 0 },
  competitors: [],
  suggestedQuestions: [],
}
const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const JOB: JobProgress = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status: 'running',
  steps: [step('regulatory', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: null,
  records: [{ coll: 'fda_records', count: 44 }],
  events_created: 0,
  feed_cursor: 1,
  record_years: [{ coll: 'fda_records', year: 2021, n: 44 }],
}
const DONE: JobProgress = { ...JOB, status: 'completed', steps: JOB.steps.map((s) => ({ ...s, status: 'done' })), finished_at: '2026-10-09T10:03:05Z' }

function fakeApi(asset: AssetDetail, job: JobProgress) {
  const api = { asset, job }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/assets/trep') return json(200, api.asset)
      if (url === '/api/jobs?asset=trep') return json(200, [api.job])
      if (url === '/api/jobs/j1') return json(200, api.job)
      if (url.startsWith('/api/jobs/j1/feed')) return json(200, { items: [], cursor: 0 })
      if (url === '/api/assets/trep/timeline?scope=key') return json(200, { events: [], total: 0 })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  return api
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: '/assets/:assetId', element: <AssetLayout />, children: [{ path: 'overview', element: <OverviewTab /> }] }],
    { initialEntries: [path] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, client }
}

const breadcrumb = () => within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText((_, el) => el?.getAttribute('aria-current') === 'page')

beforeEach(() => useShellStore.setState({ assetAiOpen: false }))
afterEach(() => vi.unstubAllGlobals())

describe('Overview live build', () => {
  it('shows the live build while the asset is onboarding, with a live dot on the Overview tab', async () => {
    fakeApi({ ...ASSET, status: 'onboarding' }, JOB)
    renderAt('/assets/trep/overview')
    expect(await screen.findByRole('heading', { name: 'Building the journey' })).toBeInTheDocument()
    expect(breadcrumb()).toHaveTextContent('Building journey')
    expect(screen.getByRole('link', { name: 'Overview' }).querySelector('[data-live-dot]')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Agent pipeline' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Journey taking shape' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Key metrics' })).not.toBeInTheDocument()
  })

  it('switches to the journey on its own when onboarding finishes', async () => {
    const api = fakeApi({ ...ASSET, status: 'onboarding' }, JOB)
    const { client } = renderAt('/assets/trep/overview')
    expect(await screen.findByRole('heading', { name: 'Building the journey' })).toBeInTheDocument()

    api.job = DONE
    api.asset = { ...ASSET, status: 'ready' }
    await act(() => client.refetchQueries({ queryKey: ['job', 'j1'], exact: true }))

    expect(await screen.findByRole('region', { name: 'Key metrics' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Live build' })).not.toBeInTheDocument()
    expect(breadcrumb()).toHaveTextContent('Overview')
    expect(screen.getByRole('link', { name: 'Overview' }).querySelector('[data-live-dot]')).toBeNull()
  })

  it('shows the build of a ready asset with ?build=1 until "Explore the journey" clears it', async () => {
    fakeApi(ASSET, DONE)
    const { router } = renderAt('/assets/trep/overview?build=1')
    expect(await screen.findByRole('heading', { name: 'Journey ready' })).toBeInTheDocument()
    expect(breadcrumb()).toHaveTextContent('Overview')

    await userEvent.click(screen.getByRole('button', { name: /Explore the journey/ }))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByRole('region', { name: 'Key metrics' })).toBeInTheDocument()
  })

  it('shows the journey without ?build=1 once the asset is ready', async () => {
    fakeApi(ASSET, JOB)
    renderAt('/assets/trep/overview')
    expect(await screen.findByRole('region', { name: 'Key metrics' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Live build' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/assets/pages/overview-tab.test.tsx`
Expected: FAIL — 3 of 4 tests: `Unable to find role="heading" and name "Building the journey"` (twice) and `… name "Journey ready"`; the fourth (a ready asset without `?build=1` shows the journey) already passes and guards the regression.

- [ ] **Step 3: Implement**

Composition of `LiveBuild` in `design_files/aj/live.jsx` (screen 31):

```tsx
// file: apps/web/src/features/journey/live-build/live-build.tsx
import { Skeleton } from '@/components/ui/skeleton'
import type { AssetDetail } from '@/features/assets/api'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { recordsTotal } from '@/features/jobs/job-counters'
import { ActivityLog } from './activity-log'
import { AgentPipeline, PipelineLegend } from './agent-pipeline'
import { buildPhase } from './build-model'
import { BuildStrip } from './build-strip'
import { FormingTimeline } from './forming-timeline'
import { JustAdded } from './just-added'
import { useLiveBuild } from './use-live-build'

/**
 * The asset Overview while its journey is being built (README §6.1, screen 31): build strip, agent pipeline, "Journey
 * taking shape" with "Just added", and the activity log, all driven by the asset's newest crawl job.
 */
export function LiveBuild({ asset, onExplore }: { asset: AssetDetail; onExplore: () => void }) {
  const build = useLiveBuild(asset)

  if (build.state === 'loading') {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-[118px] rounded-[14px]" />
        <Skeleton className="h-[520px] rounded-[14px]" />
      </div>
    )
  }
  if (build.state === 'error') {
    return (
      <Panel title="Live build">
        <p className="px-5 py-4 text-destructive">The live build couldn't be loaded.</p>
      </Panel>
    )
  }
  if (build.state === 'none' || !build.job) {
    return (
      <Panel title="Live build">
        <EmptyState title="No crawl yet">Use “Refresh data” to collect this asset’s sources and watch its journey being built.</EmptyState>
      </Panel>
    )
  }

  const { job, events, latest, feed } = build
  const running = buildPhase(job) !== 'done'
  return (
    <div className="flex animate-fade-up flex-col gap-5">
      <BuildStrip job={job} eventsCount={events.length} onExplore={onExplore} />
      <Panel
        title="Agent pipeline"
        description="Source agents collect records into the store; rules and AI turn them into dated journey events."
        actions={<PipelineLegend />}
      >
        <AgentPipeline job={job} events={events} competitors={asset.competitors.map((c) => c.name)} />
      </Panel>
      <div className="grid items-stretch gap-5 min-[1181px]:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Journey taking shape" description="Records land as ticks on the time axis; events crystallise in their lane as rules and AI find them.">
          <FormingTimeline recordYears={job.record_years} recordCount={recordsTotal(job)} events={events} />
          <JustAdded latest={latest} total={events.length} ended={!running} />
        </Panel>
        <Panel
          title="Activity"
          description={running ? 'Live from the crawl worker' : `${feed.length} entries`}
          className="flex flex-col"
          bodyClassName="relative min-h-[360px] flex-1"
        >
          <ActivityLog items={feed} steps={job.steps} startedAt={job.started_at} running={running} />
        </Panel>
      </div>
    </div>
  )
}
```

In `apps/web/src/features/assets/pages/tabs.tsx`:

Before:
```tsx
import { useState } from 'react'
import { Label } from '@/components/ui/label'
```
After:
```tsx
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Label } from '@/components/ui/label'
```

Before:
```tsx
import { formatDate, formatNumber, formatPhase, formatStatus } from '@/lib/format'
```
After:
```tsx
import { LiveBuild } from '@/features/journey/live-build/live-build'
import { formatDate, formatNumber, formatPhase, formatStatus } from '@/lib/format'
```

Before:
```tsx
export function OverviewTab() {
  const asset = useAssetContext()
  const { kpis, counts } = asset
  return (
```
After:
```tsx
export function OverviewTab() {
  const asset = useAssetContext()
  const [params, setParams] = useSearchParams()
  // "Explore the journey" leaves the live build even if the asset still reads as onboarding.
  const [exploredId, setExploredId] = useState<string | null>(null)
  const { kpis, counts } = asset
  if (params.get('build') === '1' || (asset.status === 'onboarding' && exploredId !== asset.id)) {
    return (
      <LiveBuild
        key={asset.id}
        asset={asset}
        onExplore={() => {
          setExploredId(asset.id)
          setParams((prev) => {
            const next = new URLSearchParams(prev)
            next.delete('build')
            return next
          })
        }}
      />
    )
  }
  return (
```

In `apps/web/src/features/assets/pages/asset-layout.tsx`:

Before:
```tsx
  const tabLabel = ASSET_TABS.find((t) => t.path === tab)?.label ?? ''
```
After:
```tsx
  const onboarding = asset.data?.status === 'onboarding'
  const tabLabel = onboarding && tab === 'overview' ? 'Building journey' : (ASSET_TABS.find((t) => t.path === tab)?.label ?? '')
```

Before:
```tsx
                  {t.label}
                  {t.path === 'competitors' && competitorCount > 0 && (
```
After:
```tsx
                  {t.label}
                  {t.path === 'overview' && onboarding && (
                    <span aria-hidden="true" data-live-dot className="ml-1.5 size-1.5 animate-blink-dot rounded-full bg-warning" />
                  )}
                  {t.path === 'competitors' && competitorCount > 0 && (
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/assets src/features/chat/asset-panel.test.tsx && npx tsc -b`
Expected: PASS (8 files, 27 tests on the Phase 2 baseline: every `features/assets` file including the 4 new tests, and the asset-page Asset AI test); `tsc` silent.

---

### Task 12: Phase gate, container rebuild, live verification, commit

All steps run in the main checkout `/Users/abhisheksharma/Work/Hackathon-Mavericks/Pharmaedge-Hackathon_maverics` on `main`, after every task above is merged (and after the Phase 2 commit is on `main`). Phase 1a/1b are live in the `crawler-*` and `api` containers already.

**Files:** none new in the repo (the live-check script lives in `/tmp`).

- [ ] **Step 1: Lint, typecheck, full test suite, build**

Run: `cd apps/web && npm run lint && npx tsc -b && npm test && npx vite build 2>&1 | tail -3`
Expected: oxlint 0 errors and no warning in a Phase 3 file (the 14 pre-existing `only-export-components` / `set-state-in-effect` warnings may remain); `tsc` silent; vitest: all files pass — 47 files, 260 tests (204 baseline + 56 new; more if Phase 2 review fixes added tests); build succeeds.

- [ ] **Step 2: Rebuild and restart the web container**

Run: `docker compose build web && docker compose up -d web && sleep 3 && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/`
Expected: image builds, container recreated, `200`.

- [ ] **Step 3: Write the live-check script** (outside the repo, not committed)

```js
// /tmp/pe3-live-check.cjs — run: node /tmp/pe3-live-check.cjs (EMAIL, PASSWORD in the environment; BASE optional)
const { chromium } = require('/Users/abhisheksharma/Work/Hackathon-Mavericks/Pharmaedge-Hackathon_maverics/node_modules/playwright-core')
const BASE = process.env.BASE ?? 'http://localhost:8080'
const ok = (cond, what) => console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}`)

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', process.env.EMAIL)
  await page.fill('input[type=password]', process.env.PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
  const api = (path) => page.evaluate((p) => fetch(`/api${p}`).then((r) => r.json()), path)
  const [job] = await api('/jobs?asset=treprostinil&limit=1')
  // a second tab in the same session that prefers reduced motion
  const calm = await context.newPage()
  await calm.emulateMedia({ reducedMotion: 'reduce' })

  await page.goto(`${BASE}/assets/treprostinil/overview?build=1`)
  await calm.goto(`${BASE}/assets/treprostinil/overview?build=1`)
  await page.getByRole('region', { name: 'Live build' }).waitFor()
  // Done when 1: the planned nodes
  const nodes = await page.$$eval('[data-node]', (els) => els.map((e) => e.dataset.node))
  ok(['s:regulatory', 'r:journey', 'o:journey'].every((k) => nodes.includes(k)), `planned nodes shown: ${nodes.join(', ')}`)
  ok(!nodes.includes('s:clinical'), 'steps outside the plan are not drawn')
  // Done when 2: running nodes and particles; none under reduced motion
  await page.waitForSelector('[data-node][data-status="running"]', { timeout: 20000 })
  const particles = (await page.$$('[data-particle]')).length
  ok(particles > 0, `a node runs and active edges carry particles (${particles})`)
  await calm.waitForSelector('[data-node][data-status="running"]', { timeout: 5000 })
  ok((await calm.$$('[data-particle]')).length === 0, 'no particles under prefers-reduced-motion')
  // Done when 3: rising counts (the clock, and the records once the first step is measured)
  const stat = (label) => page.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd').innerText()
  const first = { elapsed: await stat('Elapsed'), records: await stat('Records') }
  await page.waitForTimeout(4000)
  const second = { elapsed: await stat('Elapsed').catch(() => 'ended'), records: await stat('Records') }
  ok(first.elapsed !== second.elapsed, `clock runs ${first.elapsed} → ${second.elapsed}; records ${first.records} → ${second.records}`)
  // Done when 6: on completion the strip turns green with "Explore the journey"
  await page.getByRole('heading', { name: 'Journey ready' }).waitFor({ timeout: 180000 })
  ok(await page.getByRole('button', { name: /Explore the journey/ }).isVisible(), 'strip reads "Journey ready" with "Explore the journey"')
  // acceptance 10: the view reflects the real job …
  await page.waitForTimeout(2500)
  const done = await api(`/jobs/${job.id}`)
  const total = done.records.reduce((s, r) => s + r.count, 0).toLocaleString('en-US')
  ok((await stat('Records')) === total, `Records ${await stat('Records')} = sum of job.records ${total}`)
  const segments = await page.$$eval('[role=progressbar][aria-label="Crawl progress"] [data-status]', (els) => els.map((e) => e.dataset.status))
  ok(JSON.stringify(segments) === JSON.stringify(done.steps.map((s) => s.status)), `step bar [${segments}] = job steps`)
  // … and its feed. Done when 5: log lines in order
  const feed = []
  for (let since = 0; ; ) {
    const p = await api(`/jobs/${job.id}/feed?since=${since}`)
    feed.push(...p.items)
    if (p.items.length < 500) break
    since = p.cursor
  }
  const lines = feed.slice(-140)
  const rows = await page.$$eval('[role=log] [data-kind]', (els) => els.map((e) => e.textContent))
  ok(rows.length === lines.length && lines.every((l, i) => rows[i].includes(l.text)), `log shows the ${lines.length} feed lines in order`)
  // Done when 4: events on the forming timeline — the key journey plus every event the feed announced
  const plotted = await page.$$eval('[data-event]', (els) => els.map((e) => e.dataset.event))
  const announced = feed.filter((l) => l.kind === 'event' && l.event_id).map((l) => l.event_id)
  ok(plotted.length > 0, `forming timeline plots ${plotted.length} events`)
  ok(announced.every((id) => plotted.includes(id)), `all ${announced.length} announced events are plotted (a refresh of an up-to-date asset may announce none)`)
  await page.screenshot({ path: '/tmp/pe3-live-done.png', fullPage: true })
  await page.getByRole('button', { name: /Explore the journey/ }).click()
  await page.getByRole('region', { name: 'Key metrics' }).waitFor()
  ok(!page.url().includes('build='), `"Explore the journey" clears build and shows the journey: ${page.url()}`)
  await browser.close()
})()
```

- [ ] **Step 4: Start a short refresh and watch it live** — one check per "Done when" item and acceptance item 10

```bash
EMAIL=$(grep '^ADMIN_EMAIL=' apps/api/.env | cut -d= -f2-) PASSWORD=$(grep '^ADMIN_PASSWORD=' apps/api/.env | cut -d= -f2-)
curl -s -c /tmp/pe3.cookies -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" http://localhost:8080/api/auth/login >/dev/null
curl -s -b /tmp/pe3.cookies -H 'Content-Type: application/json' -d '{"steps":["regulatory","journey","finalize"]}' \
  http://localhost:8080/api/assets/treprostinil/refresh | jq '{id, status, steps: [.steps[].name]}'
EMAIL="$EMAIL" PASSWORD="$PASSWORD" node /tmp/pe3-live-check.cjs
```
Expected: the new job (`status` `queued`, steps `["regulatory","journey","finalize"]`; a `JOB_ALREADY_RUNNING` body means another crawl runs — wait for it and rerun the block), then 12 lines, every one `PASS` (the 3-step refresh takes about 30 s; the script watches it from planning to "Journey ready"). Open `/tmp/pe3-live-done.png` and compare with `docs/design/asset-journey-v3/screenshots/31-live-build-overview.jpg`: strip, pipeline columns and nodes, forming timeline lanes with record ticks, activity log. "All N announced events are plotted" may read `all 0`: a refresh of an up-to-date asset creates no new High events (Tasks 7 and 10 test the popping).

- [ ] **Step 5: Manual spot checks** (Chrome at http://localhost:8080, signed in as the admin)
  1. **Chat job card:** open a chat that contains a crawl job card (one created by "Add …" in Asset AI): it shows the segmented step bar, "{n} records · {n} events · {x}/{y} sources" and "Open the journey" (or "Watch the live build" while that job runs). If no chat has a job card, Task 9's tests cover it — say so in the report.
  2. **Remount:** during a running refresh, switch Overview → Clinical → Overview: the activity log continues without repeating lines.
  3. **Width:** at 1024px the "Journey taking shape" and "Activity" panels stack; at 390px the agent pipeline scrolls sideways inside its panel and the page itself does not.
  4. **Entry points:** the top-bar crawl chip and Home's Crawls card open `/assets/treprostinil/overview?build=1` while the refresh runs.

- [ ] **Step 6: Commit on `main`**

```bash
git status --short   # only the paths below; never infra/mongo/*
git add apps/web/src/index.css \
  apps/web/src/features/jobs/job-counters.ts apps/web/src/features/jobs/job-counters.test.ts \
  apps/web/src/features/jobs/feed.ts apps/web/src/features/jobs/feed.test.tsx \
  apps/web/src/features/journey/api.ts apps/web/src/features/journey/api.test.tsx \
  apps/web/src/features/journey/live-build \
  apps/web/src/features/chat/components/cards/job-card.tsx apps/web/src/features/chat/components/cards/job-card.test.tsx \
  apps/web/src/features/assets/pages/tabs.tsx apps/web/src/features/assets/pages/asset-layout.tsx \
  apps/web/src/features/assets/pages/overview-tab.test.tsx \
  docs/superpowers/plans/2026-10-09-v3-phase-3-live-build.md
git commit -m "v3 phase 3: live build on the Overview (build strip, agent pipeline, forming timeline, activity log) and live chat job card"
```

(The commit message body ends with the `Co-Authored-By` line required by the session.)
