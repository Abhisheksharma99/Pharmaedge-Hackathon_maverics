# v3 Phase 2: Shell, Home, Asset Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the app shell (sidebar with "Your assets", top bar with crawl chip, notifications and ⌘K palette), rewrite Home as the v3 dashboard, and upgrade Asset Search (kind badges, kind switch with counts, grid view) on the Phase 1b API.

**Architecture:** Web only (`apps/web`). Thin TanStack Query hooks per Phase 1b route (`features/me`, `features/search`, `features/journey/api.ts`, `usePortfolioTimeline`, `useJobProgress`); pure helpers in `.ts` files (step labels/progress, portfolio scale, Home aggregations) with unit tests; one component per Home block under `features/home/components/`. Overlay state lives in zustand: `paletteOpen`/`mobileNavOpen` in `stores/shell-store.ts` (not persisted) and the app-wide event sheet in `stores/event-sheet-store.ts`, rendered once by `EventSheetHost` in `AppLayout` (spec §5 "Event sheet host"; Phase 4 swaps its stub for `EventDetailSheet`). The ⌘K palette is cmdk via `npx shadcn add command`.

**Tech Stack:** React 19, TypeScript 6 (`verbatimModuleSyntax`: type-only imports use `import type`/`type`), Tailwind v4, shadcn (radix-nova) + `radix-ui`, cmdk 1.1.1, TanStack Query 5, zustand 5, react-router 8, lucide-react, vitest 4 + Testing Library (jsdom), `fetch` mocked with `vi.stubGlobal` as in the existing tests.

**Spec:** `docs/superpowers/specs/2026-10-09-asset-journey-v3-design.md` (§2 delivery, §3 decisions, §5 event sheet host, §6 web architecture); screens `docs/design/asset-journey-v3/README.md` §5.1–5.3, `SCREENS.md` 1–3, 5, 34 (+ `screenshots/01,02,03,05,34`), `IMPLEMENTATION_PLAN.md` Phase 2, `PHASE_DETAILS.md` Phase 2; API shapes from `docs/superpowers/plans/2026-10-09-v3-phase-1b-api.md` Tasks 2, 3, 4, 6.

**Code blocks:** a block whose first line is `// file: <path>` is the complete content of that file — a new file, or a full replacement where the step says **Replace** (paths from the repo root). Other blocks are before/after snippets to apply exactly. Commands run from the repo root of your worktree unless they start with `cd`.

## Global Constraints

- Only `apps/web` changes (plus `package-lock.json` for cmdk). No new API routes: Phase 2 reads only the routes defined by the Phase 1b plan and the existing ones (`/assets`, `/assets/:id`, `/jobs`, `/jobs/:id`, `/record/:tab`, `/chat/*`).
- Routes consumed: `GET /api/portfolio/timeline?competitors=true` → `{ assets: {id,name,kind,company,status,progress,competitorOf}[], events: EventV3[] }` (key events only); `GET /api/search?q=` → `{ assets[], events: {id,asset,assetName,title,date,category,nct_id}[] }` (q 1–120 chars, events from 2 chars); `GET /api/notifications` → `{ items: {id,kind,title,sub,link,read,at}[], unread }`; `POST /api/notifications/read` `{ids?}` → `{ unread }`; `GET|PATCH /api/me/prefs` → `{ journeyView, sidebarCollapsed, notify }`; `GET /api/jobs?status=running`; `GET /api/jobs/:id` (+ `records`, `events_created`, `feed_cursor`, `record_years`); `GET /api/assets/:id/events/:eventId` → `{ event, records, neighbors, branchStats }`.
- Event ids contain `:` and `/` (e.g. `ai:trep:https://example.com/a/b:0`): always `encodeURIComponent` them in paths and in `?focus=`.
- Shell sizes (README §5.1): sidebar 232px, collapsed 60px; below 900px an off-canvas drawer 260px with scrim `rgba(16,24,40,0.3)` opened by a hamburger; top bar 56px; crawl chip ring 18px; unread badge 15px (danger); notifications popover 350px; palette 620px wide at 12vh from the top.
- Palette groups, in order: Assets (≤6, primary first), Events (only from 2 characters; ≤6 from `/search`), Pages (Home, Asset Search, Asset AI, Crawl jobs, Settings), Actions ("Add an asset", "Ask Asset AI: “q”"). ↑/↓ move, ↵ opens, esc closes, hover selects, the selected row shows an arrow. Search debounce 150 ms. ⌘K and Ctrl+K toggle it on every page.
- Home order (gap 20px): hero → KPI strip (5) → Portfolio timeline → grid `1.45fr / 1fr` (What changed | Next milestones + Crawls; one column ≤1100px) → Tracked assets (auto-fill ≥270px) → grid (Competitive signals | Asset AI). Portfolio rows 46px, label column 210px (132px below 640px), dots High r6.5 / Medium r5 / Low r3.6, milestones hollow and dashed, ranges ±1 year `[T−1, T+1.15]`, 3 years `[T−3, T+1.6]` (default), All time.
- Copy is verbatim from the handoff: "Portfolio timeline" / "Every journey on one axis. Hollow markers are expected milestones; select one to see its evidence."; "What changed" / "High- and medium-significance events across your assets and their competitors"; empty "Quiet quarter" / "No new key events in the last 90 days."; "Next milestones" / "Readouts, regulatory decisions and patent expiries"; "Competitive signals" / "Moves by competitors of your assets"; KindBadge tooltips "Primary asset · full crawl" / "Competitor of X · light crawl"; Asset Search empty "No assets match “q”" / "Add it with Asset AI to start building its journey."; "All crawls finished"; "Search assets, events, trials…".
- Polling: running jobs 2 s while active / 15 s otherwise (existing `useJobs`), job progress 2 s while active, portfolio 10 s while any crawl runs, notifications 60 s.
- Live dots use `animate-blink-dot` (1.2 s, opacity .25 at 50%); the global reduced-motion rule in `index.css` stops them.
- Decisions (spec/handoff silent or the 1b API differs — binding):
  - The Home dashboard reads one query, `/portfolio/timeline?competitors=true`, and filters it client-side; every Home count and list is therefore over **key events** (spec §4.1), which is what the "No new key events" empty state already says.
  - Crawl % everywhere = finished steps ÷ steps of the job from `/jobs?status=running` (`jobProgress`), not the 60 s-cached portfolio `progress`. The job has no per-step progress, so the running segment of a step bar blinks instead of filling.
  - Key flags are only set at `finalize`, so an onboarding asset has no key events yet: its portfolio row shows "Building · n%" and record ticks per year from `GET /jobs/:id` `record_years` ("the row fills live").
  - The palette's Assets group filters the cached `/assets` list (it has brands, and `/search` rejects an empty query); `/search` feeds Events. Choosing an event opens the event sheet; the sheet's "Show on the journey timeline" goes to `/assets/:id/overview?focus=<id>` (Phase 4 handles `focus`).
  - Brand = the first alias that differs from the asset name; "Approved in" / the Home status pill come from `/assets/:id` `kpis.approvalRegions` (one cached request per visible asset).
  - Sidebar collapse is saved to `/me/prefs` (applied once when prefs load; localStorage keeps working if prefs fail).
  - `/chat?ask=` auto-sends the question (README §5.6) — Home, the palette and the starter questions link to it.
  - "Next scheduled refresh 06:00" is not shown (there is no scheduler); the KPI hint reads "Nothing running".
- Tests mock `fetch` with `vi.stubGlobal` and build `Response`s like the existing tests; date-dependent tests fake only `Date` (`vi.useFakeTimers({ toFake: ['Date'] })`, `vi.setSystemTime(new Date('2026-10-09T09:00:00'))`) and restore with `vi.useRealTimers()`.
- `cd apps/web && npm run lint && npx tsc -b && npm test` green (baseline: 13 files, 99 tests). Tasks do not commit; the phase commits once in Task 16, on `main`, never staging `infra/mongo/*`.

## Review Focus

- **Event ids with `:` and `/` in paths and deep links** (`ai:trep:https://example.com/a/b:0`): the sheet fetches `/api/assets/trep/events/ai%3Atrep%3Ahttps%3A%2F%2Fexample.com%2Fa%2Fb%3A0` and "Show on the journey timeline" lands on `?focus=` with the same id decoded. Tests in Task 3 (`useEvent` URL) and Task 5 (deep link).
- **cmdk vs server results**: cmdk's own filter would hide `/search` events (their value is an id, not "TETON"), and its auto-selection would leave the highlight on "Ask Asset AI" when events arrive after the debounce; the palette must set `shouldFilter={false}`, own the highlight, and select the first row whenever the user hasn't moved it. Queries under 2 characters send nothing; queries are trimmed and capped at 120 characters. Tests in Task 4 (TETON by title, NCT04708782 by id, highlight on the first event) and Task 2 (debounce, min length, cap).
- **Undated or partial-date key events** (`""`, `"2021-03"`): never plotted at `NaN`, never counted in the hero/KPIs, never crash the lists. Tests in Task 8 (`[cx="NaN"]` absent) and Task 9 (`homeCounts`, `whatChanged` ignore `""`).
- **Notification links written by the crawler/API**: only in-app paths (`/…`, not `//…` or `https://…`) are followed; the item is still marked read. Test in Task 7.
- **Shell when a side route fails** (404 in the existing route tests, 500 in production hiccups): pages still render; the bell stays usable; the crawl chip renders nothing while jobs are unknown (never a false "All crawls finished"); the sidebar keeps its local collapse state. Tests in Task 6 and Task 7; the existing route-level tests (`auth-flow`, `chat-turn`, `asset-panel`) stay green in Task 16.

## Task Dependencies

| Wave | Tasks (mutually independent, run in parallel) | Depends on |
|---|---|---|
| 1 | 1, 2, 3, 14 | — |
| 2 | 4 (1, 2, 3) · 5 (1, 3) · 6 (1, 2) · 7 (1, 2) · 8 (1, 3) · 9 (1, 3) · 10 (1, 3) · 11 (1, 3) | wave 1 |
| 3 | 12 (8, 9, 10, 11) · 13 (1, 3, 11) · 15 (4, 5) | wave 2 |
| 4 | 16 (phase gate) | all |

No two tasks in the same wave touch the same file. Files touched by more than one task (always in different waves): `apps/web/src/features/home/api.ts` (Task 3 adds the portfolio hook; Task 12 removes the now-unused `useSignals`). Single-owner shared files: `package.json` / `package-lock.json` / `src/test/setup.ts` → Task 4; `src/components/layout/app-layout.tsx` → Task 15; `src/stores/shell-store.ts` and `src/index.css` → Task 1; `src/lib/dates.ts` → Task 7; `src/features/auth/auth-flow.test.tsx` → Task 12; `src/features/chat/*` → Task 14.

---

### Task 1: Shell state, event-sheet store, job step helpers, asset tile

**Files:**
- Modify: `apps/web/src/stores/shell-store.ts` (Replace)
- Create: `apps/web/src/stores/event-sheet-store.ts`
- Create: `apps/web/src/features/jobs/steps.ts`
- Create: `apps/web/src/features/assets/components/asset-tile.tsx`
- Modify: `apps/web/src/index.css` (blink-dot animation)
- Test: `apps/web/src/stores/stores.test.ts`, `apps/web/src/features/jobs/steps.test.ts`, `apps/web/src/features/assets/components/asset-tile.test.tsx`

**Interfaces:**
- Consumes: `Job`, `JobStep`, `isActive` from `apps/web/src/features/jobs/api.ts` (existing).
- Produces:
  - `useShellStore` gains `setSidebarCollapsed(collapsed: boolean)`, `paletteOpen: boolean`, `setPaletteOpen(open: boolean)`, `mobileNavOpen: boolean`, `setMobileNavOpen(open: boolean)`; only `sidebarCollapsed`, `lastAssetId`, `assetAiOpen` are persisted (`localStorage` key `aj-shell`). `toggleSidebar()` stays.
  - `useEventSheet` (zustand): `current: OpenEvent | null`, `openEvent(assetId: string, eventId: string): void`, `closeEvent(): void`; `type OpenEvent = { assetId: string; eventId: string }`.
  - `features/jobs/steps.ts`: `STEP_META: Record<string, { short: string; dur: number }>`, `stepShort(step: Pick<JobStep,'name'|'label'>): string`, `stepDuration(name: string): number`, `stepsFinished(job: Pick<Job,'steps'>): number`, `jobProgress(job: Pick<Job,'steps'>): number` (0–1), `currentStep(job): { step: JobStep; index: number } | null`, `jobStepLabel(job): string` ("planning" / running step / next step / "finishing"), `runningByAsset(jobs: Job[] | undefined): Map<string, Job>` (newest active job per asset), `jobDuration(job: Pick<Job,'started_at'|'finished_at'>, now?: number): string`.
  - `AssetTile({ name: string; kind: 'primary' | 'competitor'; size?: number; className?: string })` — two letters, `aria-hidden`.
  - CSS utility `animate-blink-dot`.

- [ ] **Step 1: Write the failing tests**

```ts
// file: apps/web/src/stores/stores.test.ts
import { useEventSheet } from './event-sheet-store'
import { useShellStore } from './shell-store'

beforeEach(() => {
  localStorage.clear()
  useShellStore.setState({ sidebarCollapsed: false, paletteOpen: false, mobileNavOpen: false })
  useEventSheet.setState({ current: null })
})

describe('shell store', () => {
  it('opens and closes the palette and the mobile drawer, and sets the sidebar state', () => {
    const shell = useShellStore.getState()
    shell.setPaletteOpen(true)
    shell.setMobileNavOpen(true)
    shell.setSidebarCollapsed(true)
    expect(useShellStore.getState()).toMatchObject({ paletteOpen: true, mobileNavOpen: true, sidebarCollapsed: true })
    useShellStore.getState().toggleSidebar()
    expect(useShellStore.getState().sidebarCollapsed).toBe(false)
  })

  it('remembers the sidebar but never an open overlay', () => {
    useShellStore.getState().setSidebarCollapsed(true)
    useShellStore.getState().setPaletteOpen(true)
    useShellStore.getState().setMobileNavOpen(true)
    const saved = JSON.parse(localStorage.getItem('aj-shell') ?? '{}').state
    expect(saved).toMatchObject({ sidebarCollapsed: true })
    expect(saved).not.toHaveProperty('paletteOpen')
    expect(saved).not.toHaveProperty('mobileNavOpen')
  })
})

describe('event sheet store', () => {
  it('holds the one open event and closes it', () => {
    useEventSheet.getState().openEvent('trep', 'ai:trep:https://example.com/a/b:0')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'ai:trep:https://example.com/a/b:0' })
    useEventSheet.getState().openEvent('nint', 'e2')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'nint', eventId: 'e2' })
    useEventSheet.getState().closeEvent()
    expect(useEventSheet.getState().current).toBeNull()
  })
})
```

```ts
// file: apps/web/src/features/jobs/steps.test.ts
import type { Job, JobStep } from './api'
import {
  currentStep,
  jobDuration,
  jobProgress,
  jobStepLabel,
  runningByAsset,
  STEP_META,
  stepDuration,
  stepShort,
  stepsFinished,
} from './steps'

const step = (name: string, status: JobStep['status']): JobStep => ({
  name,
  label: `${name} (detail)`,
  status,
  counts: {},
  error: null,
  started_at: null,
  finished_at: null,
})

const job = (id: string, asset: string, status: Job['status'], steps: JobStep[] = []): Job => ({
  id,
  asset,
  assetName: asset,
  type: 'onboard',
  status,
  steps,
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: null,
  finished_at: null,
})

// crawler/service/steps.py STEPS
const CRAWLER_STEPS = [
  'regulatory', 'fda_calendar', 'ema_chmp', 'clinical', 'publications', 'conferences', 'patents', 'company_site',
  'company_news', 'news', 'industry_news', 'journey', 'ai_triage', 'ai_events', 'index', 'competitors', 'finalize',
]

describe('step labels', () => {
  it('has a short label and a duration for every crawler step', () => {
    for (const name of CRAWLER_STEPS) expect(STEP_META[name], name).toBeDefined()
    expect(stepShort(step('regulatory', 'running'))).toBe('FDA · EMA')
    expect(stepShort({ name: 'new_source', label: 'New source (beta, AI-screened)' })).toBe('New source')
    expect(stepDuration('ai_events')).toBe(5)
    expect(stepDuration('new_source')).toBe(3)
  })
})

describe('job progress', () => {
  it('counts done, failed and skipped steps as finished', () => {
    const j = job('j1', 'trep', 'running', [
      step('regulatory', 'done'),
      step('clinical', 'failed'),
      step('news', 'skipped'),
      step('journey', 'running'),
      step('finalize', 'pending'),
    ])
    expect(stepsFinished(j)).toBe(3)
    expect(jobProgress(j)).toBeCloseTo(0.6)
    expect(currentStep(j)).toEqual({ step: j.steps[3], index: 3 })
    expect(jobStepLabel(j)).toBe('Rules engine')
  })

  it('reads "planning" before the first step and names the next step between two', () => {
    expect(jobProgress(job('j0', 'x', 'queued'))).toBe(0)
    expect(jobStepLabel(job('j0', 'x', 'queued', [step('regulatory', 'pending')]))).toBe('planning')
    expect(jobStepLabel(job('j2', 'x', 'running', [step('regulatory', 'done'), step('clinical', 'pending')]))).toBe('ClinicalTrials.gov')
    expect(jobStepLabel(job('j3', 'x', 'running', [step('regulatory', 'done')]))).toBe('finishing')
  })

  it('keeps the newest active job per asset', () => {
    const map = runningByAsset([job('new', 'trep', 'running'), job('old', 'trep', 'running'), job('done', 'sota', 'completed'), job('q', 'nint', 'queued')])
    expect([...map.keys()]).toEqual(['trep', 'nint'])
    expect(map.get('trep')?.id).toBe('new')
    expect(runningByAsset(undefined).size).toBe(0)
  })

  it('formats durations like the jobs page', () => {
    expect(jobDuration({ started_at: null, finished_at: null })).toBe('—')
    expect(jobDuration({ started_at: '2026-10-09T10:00:00Z', finished_at: '2026-10-09T10:00:42Z' })).toBe('42s')
    expect(jobDuration({ started_at: '2026-10-09T10:00:00Z', finished_at: null }, Date.parse('2026-10-09T10:03:05Z'))).toBe('3m 05s')
  })
})
```

```tsx
// file: apps/web/src/features/assets/components/asset-tile.test.tsx
import { render } from '@testing-library/react'
import { AssetTile } from './asset-tile'

describe('AssetTile', () => {
  it('shows two letters sized from the tile, primary on primary-soft', () => {
    const { container } = render(<AssetTile name="treprostinil" kind="primary" size={36} />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile).toHaveTextContent('Tr')
    expect(tile).toHaveClass('bg-primary-soft', 'text-primary')
    expect(tile).toHaveStyle({ width: '36px', height: '36px', fontSize: '15px' })
    expect(tile).toHaveAttribute('aria-hidden', 'true')
  })

  it('mutes competitors and skips punctuation', () => {
    const { container } = render(<AssetTile name="(S)-Yutrepia" kind="competitor" />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile).toHaveTextContent('Sy')
    expect(tile).toHaveClass('bg-muted', 'text-text-secondary')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/stores/stores.test.ts src/features/jobs/steps.test.ts src/features/assets/components/asset-tile.test.tsx`
Expected: FAIL — `Failed to resolve import "./event-sheet-store"`, `Failed to resolve import "./steps"`, `Failed to resolve import "./asset-tile"`.

- [ ] **Step 3: Implement**

**Replace** the shell store:

```ts
// file: apps/web/src/stores/shell-store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ShellState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  /** Last asset page visited; the sidebar's asset sections link back to it. */
  lastAssetId: string | null
  setLastAssetId: (id: string) => void
  /** Asset AI drawer on asset pages. */
  assetAiOpen: boolean
  setAssetAiOpen: (open: boolean) => void
  /** ⌘K command palette. */
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  /** Off-canvas navigation below 900px. */
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
}

/** Layout preferences, remembered per browser; overlays always start closed. */
export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      lastAssetId: null,
      setLastAssetId: (id) => set({ lastAssetId: id }),
      assetAiOpen: false,
      setAssetAiOpen: (open) => set({ assetAiOpen: open }),
      paletteOpen: false,
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      mobileNavOpen: false,
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
    }),
    {
      name: 'aj-shell',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, lastAssetId: s.lastAssetId, assetAiOpen: s.assetAiOpen }),
    },
  ),
)
```

```ts
// file: apps/web/src/stores/event-sheet-store.ts
import { create } from 'zustand'

export interface OpenEvent {
  assetId: string
  eventId: string
}

interface EventSheetState {
  current: OpenEvent | null
  openEvent: (assetId: string, eventId: string) => void
  closeEvent: () => void
}

/**
 * The app's one event sheet (spec §5 "Event sheet host"): any surface calls `openEvent`, and `EventSheetHost`
 * in AppLayout renders the sheet.
 */
export const useEventSheet = create<EventSheetState>()((set) => ({
  current: null,
  openEvent: (assetId, eventId) => set({ current: { assetId, eventId } }),
  closeEvent: () => set({ current: null }),
}))
```

```ts
// file: apps/web/src/features/jobs/steps.ts
import { isActive, type Job, type JobStep } from './api'

/**
 * Short label and expected relative duration of each crawl step (design: aj/data.js STEPS; crawler:
 * service/steps.py LABELS). The duration sizes the step's segment in the segmented bar.
 */
export const STEP_META: Record<string, { short: string; dur: number }> = {
  regulatory: { short: 'FDA · EMA', dur: 4 },
  ema_chmp: { short: 'EMA CHMP', dur: 2.5 },
  clinical: { short: 'ClinicalTrials.gov', dur: 4 },
  publications: { short: 'PubMed', dur: 4 },
  conferences: { short: 'ERS · ATS · CHEST', dur: 3 },
  company_site: { short: 'Company website', dur: 3 },
  company_news: { short: 'Newsroom', dur: 3.5 },
  news: { short: 'Newswires · Bing', dur: 4 },
  industry_news: { short: 'Industry news', dur: 3 },
  journey: { short: 'Rules engine', dur: 3.5 },
  ai_triage: { short: 'AI triage', dur: 4 },
  ai_events: { short: 'Event extraction', dur: 5 },
  index: { short: 'Search index', dur: 3 },
  competitors: { short: 'Competitors', dur: 4 },
  fda_calendar: { short: 'FDA calendar', dur: 2.5 },
  patents: { short: 'Patents', dur: 4 },
  finalize: { short: 'Finalize', dur: 3 },
}

const DEFAULT_DURATION = 3

/** "FDA · EMA" for regulatory; an unknown step uses its label without the parenthesised detail. */
export function stepShort(step: Pick<JobStep, 'name' | 'label'>): string {
  return STEP_META[step.name]?.short ?? step.label.replace(/\s*\(.*\)\s*$/, '')
}

export function stepDuration(name: string): number {
  return STEP_META[name]?.dur ?? DEFAULT_DURATION
}

/** Steps no longer pending or running (done, failed or skipped). */
export function stepsFinished(job: Pick<Job, 'steps'>): number {
  return job.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length
}

/** Share of finished steps, 0–1 (0 for a job without steps). */
export function jobProgress(job: Pick<Job, 'steps'>): number {
  return job.steps.length ? stepsFinished(job) / job.steps.length : 0
}

export function currentStep(job: Pick<Job, 'steps'>): { step: JobStep; index: number } | null {
  const index = job.steps.findIndex((s) => s.status === 'running')
  return index < 0 ? null : { step: job.steps[index], index }
}

/** What a crawl is doing now: the running step, "planning" before any step, the next step between two. */
export function jobStepLabel(job: Pick<Job, 'steps'>): string {
  const current = currentStep(job)
  if (current) return stepShort(current.step)
  if (stepsFinished(job) === 0) return 'planning'
  const next = job.steps.find((s) => s.status === 'pending')
  return next ? stepShort(next) : 'finishing'
}

/** The newest queued or running job per asset (`/jobs` lists newest first). */
export function runningByAsset(jobs: Job[] | undefined): Map<string, Job> {
  const byAsset = new Map<string, Job>()
  for (const job of jobs ?? []) if (isActive(job.status) && !byAsset.has(job.asset)) byAsset.set(job.asset, job)
  return byAsset
}

/** "42s", "3m 05s"; "—" before the job starts; a running job counts up to `now`. */
export function jobDuration(job: Pick<Job, 'started_at' | 'finished_at'>, now: number = Date.now()): string {
  if (!job.started_at) return '—'
  const end = job.finished_at ? Date.parse(job.finished_at) : now
  const secs = Math.max(0, Math.round((end - Date.parse(job.started_at)) / 1000))
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
}
```

```tsx
// file: apps/web/src/features/assets/components/asset-tile.tsx
import { cn } from '@/lib/utils'

/** Two-letter asset tile of the v3 shell ("Treprostinil" → "Tr"): primary on --primary-soft, competitors muted. */
export function AssetTile({
  name,
  kind,
  size = 28,
  className,
}: {
  name: string
  kind: 'primary' | 'competitor'
  size?: number
  className?: string
}) {
  const letters = name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[28%] font-[650] tracking-[-0.02em]',
        kind === 'competitor' ? 'bg-muted text-text-secondary' : 'bg-primary-soft text-primary',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase()}
    </span>
  )
}
```

In `apps/web/src/index.css`, inside the second `@theme {` block:

Before:
```css
    --animate-fade: fade 0.5s both;
```
After:
```css
    --animate-fade: fade 0.5s both;
    /* live dots: sidebar crawl dot, "Building" rows, collecting pills */
    --animate-blink-dot: blink-dot 1.2s ease-in-out infinite;
```

Before:
```css
    @keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
    }
}
```
After:
```css
    @keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    @keyframes blink-dot {
        50% { opacity: 0.25; }
    }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && npx vitest run src/stores/stores.test.ts src/features/jobs/steps.test.ts src/features/assets/components/asset-tile.test.tsx && npx tsc -b && grep -c "blink-dot" src/index.css`
Expected: PASS (3 files, 10 tests); `tsc` silent; grep prints `2`.

---

### Task 2: Notifications, prefs and search hooks

**Files:**
- Create: `apps/web/src/features/me/api.ts`
- Create: `apps/web/src/lib/use-debounced-value.ts`
- Create: `apps/web/src/features/search/api.ts`
- Test: `apps/web/src/features/me/api.test.tsx`, `apps/web/src/features/search/api.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`@/lib/api`), `toQueryString`, `EventCategory` (`@/features/assets/api`).
- Produces:
  - `features/me/api.ts`: types `AppNotification {id,kind,title,sub,link,read,at}`, `NotificationList {items, unread}`, `Prefs {journeyView:'h'|'v', sidebarCollapsed, notify:{highEvents,crawls,weeklyDigest}}`, `PrefsPatch`; hooks `useNotifications()` (key `['notifications']`, refetch 60 s), `useMarkNotificationsRead()` (`mutate({ ids?: string[] })`, updates the cached list), `usePrefs()` (key `['me','prefs']`), `useSavePrefs()` (`mutate(patch: PrefsPatch)`, caches the response).
  - `useDebouncedValue<T>(value: T, ms: number): T`.
  - `features/search/api.ts`: types `SearchAsset`, `SearchEvent {id,asset,assetName,title,date,category,nct_id}`, `SearchResult {assets, events}`; `SEARCH_MIN_CHARS = 2`; `useSearch(q: string)` (trim, cap 120, debounce 150 ms, disabled under 2 characters, key `['search', term]`).

- [ ] **Step 1: Write the failing tests**

```tsx
// file: apps/web/src/features/me/api.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { useMarkNotificationsRead, useNotifications, usePrefs, useSavePrefs, type NotificationList, type Prefs } from './api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const LIST: NotificationList = {
  items: [
    { id: 'n1', kind: 'high_event', title: 'FDA accepts Tyvaso sNDA', sub: 'Treprostinil', link: '/assets/trep/overview', read: false, at: '2026-10-09T10:00:00Z' },
    { id: 'n2', kind: 'job_failed', title: 'Sotatercept: 1 step failed', sub: 'Patents', link: '/jobs/j2', read: false, at: '2026-10-09T09:00:00Z' },
  ],
  unread: 2,
}

describe('notifications', () => {
  it('marks one, then all, read and keeps the cached list in step', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url === '/api/notifications') return json(200, LIST)
      if (url === '/api/notifications/read') return json(200, { unread: String(init?.body).includes('ids') ? 1 : 0 })
      return json(404, { code: 'NOT_FOUND', message: url })
    })
    const { result } = renderHook(() => ({ list: useNotifications(), read: useMarkNotificationsRead() }), { wrapper })
    await waitFor(() => expect(result.current.list.data?.unread).toBe(2))

    await act(() => result.current.read.mutateAsync({ ids: ['n1'] }))
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications/read', expect.objectContaining({ method: 'POST', body: '{"ids":["n1"]}' }))
    await waitFor(() => expect(result.current.list.data).toMatchObject({ unread: 1, items: [{ id: 'n1', read: true }, { id: 'n2', read: false }] }))

    await act(() => result.current.read.mutateAsync({}))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/notifications/read', expect.objectContaining({ body: '{}' }))
    await waitFor(() => expect(result.current.list.data).toMatchObject({ unread: 0, items: [{ read: true }, { read: true }] }))
  })
})

describe('prefs', () => {
  it('reads prefs and caches what a partial PATCH returns', async () => {
    const prefs: Prefs = { journeyView: 'h', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: false } }
    fetchMock.mockImplementation(async (_url, init) => json(200, init?.method === 'PATCH' ? { ...prefs, sidebarCollapsed: true } : prefs))
    const { result } = renderHook(() => ({ prefs: usePrefs(), save: useSavePrefs() }), { wrapper })
    await waitFor(() => expect(result.current.prefs.data?.sidebarCollapsed).toBe(false))
    await act(() => result.current.save.mutateAsync({ sidebarCollapsed: true }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/me/prefs', expect.objectContaining({ method: 'PATCH', body: '{"sidebarCollapsed":true}' }))
    await waitFor(() => expect(result.current.prefs.data?.sidebarCollapsed).toBe(true))
  })
})
```

```tsx
// file: apps/web/src/features/search/api.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { useSearch, type SearchResult } from './api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const RESULT: SearchResult = {
  assets: [],
  events: [{ id: 'e1', asset: 'trep', assetName: 'Treprostinil', title: 'Phase 3 trial started: TETON-1', date: '2021-06-01', category: 'clinical', nct_id: 'NCT04708782' }],
}

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => json(200, RESULT))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('useSearch', () => {
  it('sends nothing under two characters, then debounces and encodes the term', async () => {
    const { result, rerender } = renderHook(({ q }) => useSearch(q), { wrapper, initialProps: { q: 't' } })
    await new Promise((r) => setTimeout(r, 250))
    expect(fetchMock).not.toHaveBeenCalled()
    rerender({ q: 'te' })
    rerender({ q: 'tet' })
    rerender({ q: 'teton & co ' })
    await waitFor(() => expect(result.current.data?.events).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=teton+%26+co')
  })

  it('trims and caps the query at 120 characters', async () => {
    renderHook(() => useSearch(`  ${'x'.repeat(200)}  `), { wrapper })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/search?q=${'x'.repeat(120)}`)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/features/me/api.test.tsx src/features/search/api.test.tsx`
Expected: FAIL — `Failed to resolve import "./api"` in both files.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/me/api.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

/** An in-app notification (GET /notifications); `link` is an app path. */
export interface AppNotification {
  id: string
  /** onboarding_started | onboarding_finished | job_failed | high_event | comment (more may follow). */
  kind: string
  title: string
  sub: string
  link: string
  read: boolean
  at: string
}

export interface NotificationList {
  items: AppNotification[]
  unread: number
}

export interface Prefs {
  journeyView: 'h' | 'v'
  sidebarCollapsed: boolean
  notify: { highEvents: boolean; crawls: boolean; weeklyDigest: boolean }
}

export type PrefsPatch = Partial<Pick<Prefs, 'journeyView' | 'sidebarCollapsed'>> & { notify?: Partial<Prefs['notify']> }

const NOTIFICATIONS_KEY = ['notifications'] as const
const PREFS_KEY = ['me', 'prefs'] as const

/** The signed-in user's 30 newest notifications and unread count; refreshed every minute. */
export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => apiFetch<NotificationList>('/notifications'),
    refetchInterval: 60_000,
  })
}

/** Mark `ids` read, or every notification without `ids`; the cached list follows the server's unread count. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids }: { ids?: string[] }) =>
      apiFetch<{ unread: number }>('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
    onSuccess: ({ unread }, { ids }) =>
      qc.setQueryData<NotificationList>(NOTIFICATIONS_KEY, (old) =>
        old && { unread, items: old.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) },
      ),
  })
}

/** Per-user preferences (journey orientation, sidebar, notification toggles). */
export function usePrefs() {
  return useQuery({ queryKey: PREFS_KEY, queryFn: () => apiFetch<Prefs>('/me/prefs'), staleTime: Infinity })
}

/** PATCH a partial update; the full prefs it returns replace the cache. */
export function useSavePrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: PrefsPatch) => apiFetch<Prefs>('/me/prefs', { method: 'PATCH', body: patch }),
    onSuccess: (prefs) => qc.setQueryData(PREFS_KEY, prefs),
  })
}
```

```ts
// file: apps/web/src/lib/use-debounced-value.ts
import { useEffect, useState } from 'react'

/** `value`, updated only once it has stayed the same for `ms` milliseconds. */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}
```

```ts
// file: apps/web/src/features/search/api.ts
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { toQueryString, type EventCategory } from '@/features/assets/api'
import { apiFetch } from '@/lib/api'
import { useDebouncedValue } from '@/lib/use-debounced-value'

export interface SearchAsset {
  id: string
  name: string
  kind: 'primary' | 'competitor'
  company: string | null
  competitorOf: string[]
}

export interface SearchEvent {
  id: string
  asset: string
  assetName: string
  title: string
  date: string
  category: EventCategory
  nct_id: string | null
}

export interface SearchResult {
  assets: SearchAsset[]
  events: SearchEvent[]
}

/** The API matches events (title or NCT id) from 2 characters; shorter queries aren't sent. */
export const SEARCH_MIN_CHARS = 2
/** The API rejects longer queries. */
const SEARCH_MAX_CHARS = 120

/** ⌘K search (GET /search), debounced 150 ms. */
export function useSearch(q: string) {
  const term = useDebouncedValue(q.trim().slice(0, SEARCH_MAX_CHARS), 150)
  return useQuery({
    queryKey: ['search', term],
    queryFn: () => apiFetch<SearchResult>(`/search${toQueryString({ q: term })}`),
    enabled: term.length >= SEARCH_MIN_CHARS,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && npx vitest run src/features/me/api.test.tsx src/features/search/api.test.tsx && npx tsc -b`
Expected: PASS (2 files, 4 tests); `tsc` silent.

---

### Task 3: Portfolio, event, job-progress and asset-detail hooks

**Files:**
- Modify: `apps/web/src/features/home/api.ts`
- Create: `apps/web/src/features/journey/api.ts`
- Modify: `apps/web/src/features/jobs/api.ts`
- Modify: `apps/web/src/features/assets/api.ts`
- Test: `apps/web/src/features/data-hooks.test.tsx`

**Interfaces:**
- Consumes: `JourneyEventV3`, `JobProgress` (`@/features/journey/types`, Phase 0), `apiFetch`.
- Produces:
  - `features/home/api.ts`: `PortfolioAsset {id,name,kind,company: string|null,status,progress: number|null,competitorOf: string[]}`, `PortfolioTimeline {assets, events: JourneyEventV3[]}`, `usePortfolioTimeline({ live?: boolean } = {})` (key `['portfolio','timeline',{competitors:true}]`, GET `/portfolio/timeline?competitors=true`, refetch 10 s when `live`), `eventsByAsset<T extends {asset: string}>(events: T[]): Map<string, T[]>`.
  - `features/journey/api.ts`: `EventRecord {collection,key,tab: RecordTab|null,title,date,url,record_type,source}`, `EventBrief {id,title,date}`, `EventDetail {event, records, neighbors:{prev,next}, branchStats:{index,total,prevSameBranch}}`, `useEvent(assetId: string, eventId: string | null)` (key `['asset', assetId, 'event', eventId]`, ids URL-encoded, disabled while `eventId` is null).
  - `features/jobs/api.ts`: `useJobProgress(id: string | null)` → `JobProgress` (key `['job', id]`, shared with `useJob`; 2 s while active).
  - `features/assets/api.ts`: `assetMatches(asset: AssetSummary, q: string): boolean`, `byKindThenName(a, b): number`, `useAssetDetails(ids: string[]): Record<string, AssetDetail | undefined>` (shares `['asset', id]` with `useAsset`).

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/data-hooks.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { assetMatches, byKindThenName, useAssetDetails, type AssetSummary } from './assets/api'
import { eventsByAsset, usePortfolioTimeline } from './home/api'
import { useJobProgress } from './jobs/api'
import { useEvent } from './journey/api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const BASE: AssetSummary = {
  id: 'x',
  name: 'X',
  aliases: [],
  company: { name: 'Co' },
  tags: {},
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null,
  competitorOf: [],
}
const asset = (name: string, kind: AssetSummary['kind'], extra: Partial<AssetSummary> = {}): AssetSummary => ({ ...BASE, id: name.toLowerCase(), name, kind, ...extra })

describe('asset helpers', () => {
  it('matches every word against name, brands, company, indications and mechanism', () => {
    const trep = asset('Treprostinil', 'primary', {
      aliases: ['Tyvaso'],
      company: { name: 'United Therapeutics' },
      tags: { indications: ['PAH'], investigational_indications: ['PH-ILD'], mechanism: 'Prostacyclin analogue' },
    })
    expect(assetMatches(trep, 'tyvaso')).toBe(true)
    expect(assetMatches(trep, 'united pah')).toBe(true)
    expect(assetMatches(trep, 'ph-ild prostacyclin')).toBe(true)
    expect(assetMatches(trep, 'ofev')).toBe(false)
    expect(assetMatches(trep, '   ')).toBe(true)
  })

  it('sorts primary assets first, then by name', () => {
    const list = [asset('Yutrepia', 'competitor'), asset('Treprostinil', 'primary'), asset('Nintedanib', 'competitor'), asset('Sotatercept', 'primary')]
    expect([...list].sort(byKindThenName).map((a) => a.name)).toEqual(['Sotatercept', 'Treprostinil', 'Nintedanib', 'Yutrepia'])
  })

  it('groups events by asset, keeping their order', () => {
    const groups = eventsByAsset([{ asset: 'a', n: 1 }, { asset: 'b', n: 2 }, { asset: 'a', n: 3 }])
    expect(groups.get('a')?.map((e) => e.n)).toEqual([1, 3])
    expect(groups.get('b')?.map((e) => e.n)).toEqual([2])
  })
})

describe('Phase 1b route hooks', () => {
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
  let client: QueryClient
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const EVENT_ID = 'ai:trep:https://example.com/a/b:0'

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url === '/api/portfolio/timeline?competitors=true') return json(200, { assets: [], events: [] })
      if (url === `/api/assets/trep/events/${encodeURIComponent(EVENT_ID)}`) {
        return json(200, { event: { id: EVENT_ID }, records: [], neighbors: { prev: null, next: null }, branchStats: { index: 1, total: 1, prevSameBranch: null } })
      }
      if (url === '/api/jobs/j1') return json(200, { id: 'j1', status: 'completed', steps: [], records: [{ coll: 'fda_records', count: 4 }], events_created: 2, feed_cursor: 0, record_years: [] })
      if (url === '/api/assets/trep') return json(200, { id: 'trep', kpis: { approvalRegions: ['US'] } })
      if (url === '/api/assets/nint') return json(200, { id: 'nint', kpis: { approvalRegions: [] } })
      return json(404, { code: 'NOT_FOUND', message: url })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('call the routes with encoded event ids and expose the live-build counters', async () => {
    const { result } = renderHook(
      () => ({
        portfolio: usePortfolioTimeline(),
        event: useEvent('trep', EVENT_ID),
        closed: useEvent('trep', null),
        job: useJobProgress('j1'),
        details: useAssetDetails(['trep', 'nint']),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.portfolio.isSuccess && result.current.event.isSuccess && result.current.job.isSuccess).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/events/ai%3Atrep%3Ahttps%3A%2F%2Fexample.com%2Fa%2Fb%3A0', expect.anything())
    expect(result.current.closed.fetchStatus).toBe('idle')
    expect(result.current.job.data?.records).toEqual([{ coll: 'fda_records', count: 4 }])
    await waitFor(() => expect(result.current.details.trep?.kpis.approvalRegions).toEqual(['US']))
    expect(result.current.details.nint?.kpis.approvalRegions).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/data-hooks.test.tsx`
Expected: FAIL — `Failed to resolve import "./journey/api"` (and missing exports `assetMatches`, `eventsByAsset`, `useJobProgress`).

- [ ] **Step 3: Implement**

`apps/web/src/features/home/api.ts` — add the type import and append the portfolio hook (keep `Signal` / `useSignals` for now; Task 12 removes them).

Before:
```ts
import type { EventCategory, Significance } from '@/features/assets/api'
```
After:
```ts
import type { EventCategory, Significance } from '@/features/assets/api'
import type { JourneyEventV3 } from '@/features/journey/types'
```

Append at the end of the file:
```ts
/** An asset row of the Home portfolio timeline (GET /portfolio/timeline). */
export interface PortfolioAsset {
  id: string
  name: string
  kind: 'primary' | 'competitor'
  company: string | null
  status: 'onboarding' | 'ready' | 'failed'
  /** Share of done steps of a running job, cached 60 s server-side; the UI uses the live job instead. */
  progress: number | null
  /** Primary asset ids a competitor is tracked against. */
  competitorOf: string[]
}

export interface PortfolioTimeline {
  assets: PortfolioAsset[]
  /** Key events of those assets (spec §4.1), oldest first. */
  events: JourneyEventV3[]
}

/**
 * Every tracked asset (competitors included) with its key events. One request feeds the whole Home dashboard
 * and the Asset Search sparklines; each block filters it. `live` refetches every 10 s while a crawl runs.
 */
export function usePortfolioTimeline({ live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ['portfolio', 'timeline', { competitors: true }],
    queryFn: () => apiFetch<PortfolioTimeline>('/portfolio/timeline?competitors=true'),
    refetchInterval: live ? 10_000 : false,
  })
}

/** Events grouped by asset id, keeping their order. */
export function eventsByAsset<T extends { asset: string }>(events: T[]): Map<string, T[]> {
  const byAsset = new Map<string, T[]>()
  for (const e of events) {
    const list = byAsset.get(e.asset)
    if (list) list.push(e)
    else byAsset.set(e.asset, [e])
  }
  return byAsset
}
```

```ts
// file: apps/web/src/features/journey/api.ts
import { useQuery } from '@tanstack/react-query'
import type { RecordTab } from '@/features/assets/api'
import { apiFetch } from '@/lib/api'
import type { JourneyEventV3 } from './types'

/** A source record of an event, resolved for the evidence list. */
export interface EventRecord {
  collection: string
  key: string
  /** The asset tab the record opens in; null for sources without a tab (web pages). */
  tab: RecordTab | null
  title: string
  date: string
  url: string | null
  record_type: string | null
  source: string | null
}

export interface EventBrief {
  id: string
  title: string
  date: string
}

/** GET /assets/:id/events/:eventId (DATA_CONTRACTS §B.1). */
export interface EventDetail {
  event: JourneyEventV3
  records: EventRecord[]
  neighbors: { prev: EventBrief | null; next: EventBrief | null }
  branchStats: { index: number; total: number; prevSameBranch: EventBrief | null }
}

/** One journey event with its evidence. Event ids contain ':' and '/', so they are URL-encoded. Idle while `eventId` is null. */
export function useEvent(assetId: string, eventId: string | null) {
  return useQuery({
    queryKey: ['asset', assetId, 'event', eventId],
    queryFn: () => apiFetch<EventDetail>(`/assets/${encodeURIComponent(assetId)}/events/${encodeURIComponent(eventId!)}`),
    enabled: eventId !== null,
  })
}
```

`apps/web/src/features/jobs/api.ts`:

Before:
```ts
import { toQueryString } from '@/features/assets/api'
```
After:
```ts
import { toQueryString } from '@/features/assets/api'
import type { JobProgress } from '@/features/journey/types'
```

Append at the end of the file:
```ts
/**
 * A job with its live-build counters (GET /jobs/:id: records per collection, events created, record years).
 * Shares the ['job', id] cache with useJob; polls every 2 s while active. Idle while `id` is null.
 */
export function useJobProgress(id: string | null) {
  return useQuery({
    queryKey: ['job', id],
    queryFn: () => apiFetch<JobProgress>(`/jobs/${encodeURIComponent(id!)}`),
    enabled: id !== null,
    refetchInterval: (q) => (q.state.data && !isActive(q.state.data.status) ? false : 2000),
  })
}
```

`apps/web/src/features/assets/api.ts`:

Before:
```ts
import { keepPreviousData, useQuery } from '@tanstack/react-query'
```
After:
```ts
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
```

Append at the end of the file:
```ts
/** Every word of `q` appears in the asset's name, brands, company, indications or mechanism (Asset Search, ⌘K). */
export function assetMatches(asset: AssetSummary, q: string): boolean {
  const haystack = [
    asset.name,
    ...asset.aliases,
    asset.company.name,
    ...(asset.tags.indications ?? []),
    ...(asset.tags.investigational_indications ?? []),
    asset.tags.mechanism ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word))
}

/** Primary assets first, then by name. */
export const byKindThenName = (a: Pick<AssetSummary, 'kind' | 'name'>, b: Pick<AssetSummary, 'kind' | 'name'>) =>
  Number(a.kind === 'competitor') - Number(b.kind === 'competitor') || a.name.localeCompare(b.name)

/** Details of several assets (approval regions for cards and tables), sharing the ['asset', id] cache; undefined until loaded. */
export function useAssetDetails(ids: string[]): Record<string, AssetDetail | undefined> {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['asset', id],
      queryFn: () => apiFetch<AssetDetail>(`/assets/${encodeURIComponent(id)}`),
    })),
    combine: (results) => Object.fromEntries(results.map((r, i) => [ids[i], r.data])) as Record<string, AssetDetail | undefined>,
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/data-hooks.test.tsx && npx tsc -b`
Expected: PASS (4 tests); `tsc` silent.

---

### Task 4: Command palette (cmdk via shadcn `command`)

**Files:**
- Modify (via CLI): `apps/web/package.json` (+ `"cmdk": "^1.1.1"`), `package-lock.json`
- Create (via CLI): `apps/web/src/components/ui/command.tsx`, `apps/web/src/components/ui/input-group.tsx`, `apps/web/src/components/ui/textarea.tsx`
- Modify: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/components/layout/command-palette.tsx`
- Test: `apps/web/src/components/layout/command-palette.test.tsx`

**Interfaces:**
- Consumes: `useShellStore` `paletteOpen`/`setPaletteOpen` (Task 1); `useEventSheet.openEvent` (Task 1); `AssetTile` (Task 1); `useSearch`, `SEARCH_MIN_CHARS` (Task 2); `useAssets`, `assetMatches`, `byKindThenName` (Task 3); `CATEGORY_META` (Phase 0); `formatDay` (`@/lib/dates`).
- Produces: `CommandPalette()` — no props; renders a `Dialog` named "Search PharmaEdge" while `paletteOpen`; the input is a combobox named "Search PharmaEdge"; rows are `role="option"`. Task 15 mounts it.

- [ ] **Step 1: Add the shadcn command component**

Run:
```bash
cd apps/web && npx shadcn add command --yes --overwrite && git checkout -- src/components/ui/dialog.tsx && git -C ../.. status --short
```
`--overwrite` keeps the CLI from prompting; the only existing file it would change is `dialog.tsx` (it drops the `"use client"` line), which the `git checkout` restores. `button.tsx` and `input.tsx` are identical and skipped. The CLI runs `npm install cmdk cn` in the workspace, which updates the root lockfile.
Expected `git status` (plus whatever earlier Phase 2 tasks left uncommitted in this worktree): ` M apps/web/package.json`, ` M package-lock.json`, `?? apps/web/src/components/ui/command.tsx`, `?? apps/web/src/components/ui/input-group.tsx`, `?? apps/web/src/components/ui/textarea.tsx`. `git diff package.json` shows one added line `"cmdk": "^1.1.1",` (`cn` stays `^0.4.0`). `ls ../../node_modules/cmdk/package.json` exists.

- [ ] **Step 2: Let jsdom scroll (cmdk scrolls the selected row into view)**

In `apps/web/src/test/setup.ts`, append:
```ts

// jsdom has no scrollIntoView; cmdk (⌘K palette) scrolls the highlighted row into view.
Element.prototype.scrollIntoView ??= function scrollIntoView() {}
```

- [ ] **Step 3: Write the failing test**

```tsx
// file: apps/web/src/components/layout/command-palette.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import type { AssetSummary } from '@/features/assets/api'
import type { SearchResult } from '@/features/search/api'
import { useEventSheet } from '@/stores/event-sheet-store'
import { useShellStore } from '@/stores/shell-store'
import { CommandPalette } from './command-palette'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const asset = (id: string, name: string, kind: AssetSummary['kind'], aliases: string[], company: string): AssetSummary => ({
  id,
  name,
  aliases,
  company: { name: company },
  tags: {},
  kind,
  status: 'ready',
  updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null,
  competitorOf: [],
})

const ASSETS = [asset('yutrepia', 'Yutrepia', 'competitor', ['Yutrepia'], 'Liquidia'), asset('trep', 'Treprostinil', 'primary', ['Tyvaso', 'Remodulin'], 'United Therapeutics')]
const TETON: SearchResult = {
  assets: [],
  events: [{ id: 'rule:start:NCT04708782', asset: 'trep', assetName: 'Treprostinil', title: 'Phase 3 trial started: TETON-1', date: '2021-06-01', category: 'clinical', nct_id: 'NCT04708782' }],
}

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>

function renderPalette() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <>
            <CommandPalette />
            <Outlet />
          </>
        ),
        children: [
          { index: true, element: <p>Home</p> },
          { path: 'assets/:id/overview', element: <p>Overview</p> },
          { path: 'settings', element: <p>Settings page</p> },
          { path: 'chat', element: <p>Chat</p> },
        ],
      },
    ],
    { initialEntries: ['/'] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  act(() => useShellStore.getState().setPaletteOpen(true))
  return router
}

const searchBox = () => screen.findByRole('combobox', { name: 'Search PharmaEdge' })

beforeEach(() => {
  useShellStore.setState({ paletteOpen: false })
  useEventSheet.setState({ current: null })
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === '/api/assets') return json(200, ASSETS)
    if (url.startsWith('/api/search?q=')) {
      const q = decodeURIComponent(url.slice('/api/search?q='.length).replace(/\+/g, ' ')).toLowerCase()
      return json(200, q.includes('teton') || q.includes('nct04708782') ? TETON : { assets: [], events: [] })
    }
    return json(404, { code: 'NOT_FOUND', message: url })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('CommandPalette', () => {
  it('lists primary assets first with their brands; Enter opens the highlighted asset', async () => {
    const router = renderPalette()
    const trep = await screen.findByRole('option', { name: /Treprostinil/ })
    const options = screen.getAllByRole('option')
    expect(options[0]).toBe(trep)
    expect(trep).toHaveTextContent('Tyvaso · Remodulin · United Therapeutics')
    expect(options[1]).toHaveTextContent('Yutrepia · Liquidia · competitor')
    await waitFor(() => expect(trep).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/assets/trep/overview')
    expect(useShellStore.getState().paletteOpen).toBe(false)
  })

  it('moves the highlight with the arrow keys and the pointer', async () => {
    const router = renderPalette()
    await waitFor(() => expect(screen.getByRole('option', { name: /Treprostinil/ })).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(screen.getByRole('option', { name: /Yutrepia/ })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('option', { name: /Treprostinil/ })).toHaveAttribute('aria-selected', 'false')
    await userEvent.hover(screen.getByRole('option', { name: /Settings/ }))
    await waitFor(() => expect(screen.getByRole('option', { name: /Settings/ })).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/settings')
  })

  it('finds events by title and by NCT id, highlights the first one and opens it in the event sheet', async () => {
    renderPalette()
    await userEvent.type(await searchBox(), 'TETON')
    const event = await screen.findByRole('option', { name: /Phase 3 trial started: TETON-1/ })
    expect(event).toHaveTextContent('Treprostinil · Jun 1, 2021 · NCT04708782')
    await waitFor(() => expect(event).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Enter}')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'rule:start:NCT04708782' })
    expect(useShellStore.getState().paletteOpen).toBe(false)

    act(() => useShellStore.getState().setPaletteOpen(true))
    await userEvent.type(await searchBox(), 'NCT04708782')
    expect(await screen.findByRole('option', { name: /TETON-1/ })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/search?q=NCT04708782', expect.anything())
  })

  it('offers pages and actions, and asks Asset AI about the query', async () => {
    const router = renderPalette()
    await userEvent.type(await searchBox(), 'sett')
    await waitFor(() => expect(screen.getByRole('option', { name: /Settings/ })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.queryByRole('option', { name: /Add an asset/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Ask Asset AI: “sett”/ })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(router.state.location.pathname).toBe('/chat')
    expect(router.state.location.search).toBe('?ask=sett')
  })

  it('does not search events for a single character', async () => {
    renderPalette()
    await userEvent.type(await searchBox(), 't')
    await new Promise((r) => setTimeout(r, 300))
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/search'))).toBe(false)
    expect(screen.queryByRole('group', { name: 'Events' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/components/layout/command-palette.test.tsx`
Expected: FAIL — `Failed to resolve import "./command-palette"`.

- [ ] **Step 5: Implement**

```tsx
// file: apps/web/src/components/layout/command-palette.tsx
import { Command as CommandPrimitive } from 'cmdk'
import { Activity, ArrowRight, Home, Plus, Route, Search, Settings, Sparkles, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Command, CommandGroup, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { assetMatches, byKindThenName, useAssets } from '@/features/assets/api'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { CATEGORY_META } from '@/features/journey/constants'
import { SEARCH_MIN_CHARS, useSearch } from '@/features/search/api'
import { formatDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useEventSheet } from '@/stores/event-sheet-store'
import { useShellStore } from '@/stores/shell-store'

interface PaletteItem {
  /** Unique cmdk value; the palette filters its own rows (shouldFilter is off). */
  value: string
  label: string
  sub: string
  icon?: LucideIcon
  asset?: { name: string; kind: 'primary' | 'competitor' }
  run: () => void
}

const PAGES: { label: string; to: string; icon: LucideIcon }[] = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'Asset Search', to: '/assets', icon: Search },
  { label: 'Asset AI', to: '/chat', icon: Sparkles },
  { label: 'Crawl jobs', to: '/jobs', icon: Activity },
  { label: 'Settings', to: '/settings', icon: Settings },
]

const GROUP_HEADING =
  '**:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:tracking-[0.06em] **:[[cmdk-group-heading]]:text-muted-foreground **:[[cmdk-group-heading]]:uppercase'

/** ⌘K palette (README §5.1): assets, events (from 2 characters, via /search), pages and actions. */
export function CommandPalette() {
  const open = useShellStore((s) => s.paletteOpen)
  const setOpen = useShellStore((s) => s.setPaletteOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden rounded-[14px] p-0 shadow-dialog sm:max-w-[620px]"
      >
        <DialogTitle className="sr-only">Search PharmaEdge</DialogTitle>
        <DialogDescription className="sr-only">Search assets, events, NCT IDs and pages, or run an action.</DialogDescription>
        <PaletteBody onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** Mounted only while the palette is open, so every opening starts with an empty query. */
function PaletteBody({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate()
  const openEvent = useEventSheet((s) => s.openEvent)
  const assets = useAssets()
  const [q, setQ] = useState('')
  /** Row the user moved to (arrows or pointer) since the last keystroke; null = the first row. */
  const [picked, setPicked] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())
  const term = q.trim()
  const lower = term.toLowerCase()
  const search = useSearch(term)

  const go = (to: string) => {
    onDone()
    navigate(to)
  }

  const assetItems: PaletteItem[] = (assets.data ?? [])
    .filter((a) => !term || assetMatches(a, term))
    .sort(byKindThenName)
    .slice(0, 6)
    .map((a) => ({
      value: `asset:${a.id}`,
      label: a.name,
      sub: [...a.aliases, a.company.name].filter(Boolean).join(' · ') + (a.kind === 'competitor' ? ' · competitor' : ''),
      asset: { name: a.name, kind: a.kind },
      run: () => go(`/assets/${encodeURIComponent(a.id)}/overview`),
    }))
  const eventItems: PaletteItem[] =
    term.length < SEARCH_MIN_CHARS
      ? []
      : (search.data?.events ?? []).map((e) => ({
          value: `event:${e.asset}:${e.id}`,
          label: e.title,
          sub: [e.assetName, formatDay(e.date), e.nct_id].filter(Boolean).join(' · '),
          icon: CATEGORY_META[e.category]?.icon ?? Route,
          run: () => {
            onDone()
            openEvent(e.asset, e.id)
          },
        }))
  const pageItems: PaletteItem[] = PAGES.filter((p) => !term || p.label.toLowerCase().includes(lower)).map((p) => ({
    value: `page:${p.to}`,
    label: p.label,
    sub: 'Page',
    icon: p.icon,
    run: () => go(p.to),
  }))
  const actionItems: PaletteItem[] = [
    { value: 'action:add', label: 'Add an asset', sub: 'Action', icon: Plus, run: () => go('/chat?intent=add') },
    {
      value: 'action:ask',
      label: term ? `Ask Asset AI: “${term}”` : 'Ask Asset AI',
      sub: 'Action',
      icon: Sparkles,
      run: () => go(term ? `/chat?ask=${encodeURIComponent(term)}` : '/chat'),
    },
  ].filter((a) => !term || a.value === 'action:ask' || a.label.toLowerCase().includes(lower))

  const groups: [string, PaletteItem[]][] = [
    ['Assets', assetItems],
    ['Events', eventItems],
    ['Pages', pageItems],
    ['Actions', actionItems],
  ]
  const visible = groups.filter(([, items]) => items.length > 0)
  const values = visible.flatMap(([, items]) => items.map((i) => i.value))
  // The first row stays highlighted until the user moves, also when /search results arrive after the debounce.
  const selected = picked !== null && values.includes(picked) ? picked : (values[0] ?? '')

  useEffect(() => {
    itemRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // cmdk skips its own arrow handling when the event is already handled here.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!values.length) return
    const i = values.indexOf(selected)
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? values.length - 1 : null
    if (to === null) return
    e.preventDefault()
    setPicked(values[(to + values.length) % values.length])
  }

  return (
    <Command
      label="Search PharmaEdge"
      shouldFilter={false}
      disablePointerSelection
      vimBindings={false}
      value={selected}
      onKeyDown={onKeyDown}
      className="rounded-none! bg-card p-0"
    >
      <div className="flex items-center gap-2.5 border-b border-hair px-4 py-3.5 text-muted-foreground">
        <Search className="size-[17px] shrink-0" />
        <CommandPrimitive.Input
          autoFocus
          value={q}
          onValueChange={(v) => {
            setQ(v)
            setPicked(null)
          }}
          placeholder="Search assets, events, NCT IDs, pages…"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Kbd>esc</Kbd>
      </div>
      <CommandList className="max-h-[min(420px,56vh)] p-1.5">
        {visible.map(([heading, items]) => (
          <CommandGroup key={heading} heading={heading} className={cn('p-0', GROUP_HEADING)}>
            {items.map((it) => (
              <CommandPrimitive.Item
                key={it.value}
                value={it.value}
                onSelect={() => it.run()}
                onMouseEnter={() => setPicked(it.value)}
                ref={(el) => {
                  if (el) itemRefs.current.set(it.value, el)
                  else itemRefs.current.delete(it.value)
                }}
                className="group flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 outline-none data-[selected=true]:bg-primary-soft"
              >
                {it.asset ? (
                  <AssetTile name={it.asset.name} kind={it.asset.kind} size={24} />
                ) : (
                  <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-muted text-text-secondary">
                    {it.icon && <it.icon className="size-3.5" />}
                  </span>
                )}
                <span className="min-w-0 truncate font-medium">{it.label}</span>
                <span className="ml-auto max-w-[45%] shrink-0 truncate text-[12px] text-muted-foreground">{it.sub}</span>
                <ArrowRight aria-hidden="true" className="size-[13px] shrink-0 text-primary opacity-0 group-data-[selected=true]:opacity-100" />
              </CommandPrimitive.Item>
            ))}
          </CommandGroup>
        ))}
        {term.length >= SEARCH_MIN_CHARS && search.isFetching && eventItems.length === 0 && (
          <p className="px-2.5 py-2 text-[12px] text-muted-foreground">Searching events…</p>
        )}
      </CommandList>
      <div className="flex gap-4 border-t border-hair px-4 py-2.5 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd> close
        </span>
      </div>
    </Command>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-card px-1.5 font-mono text-[11px] text-muted-foreground">{children}</kbd>
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/components/layout/command-palette.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (5 tests); `tsc` silent; oxlint 0 errors.

---

### Task 5: Event sheet host and Phase 2 stub sheet

**Files:**
- Create: `apps/web/src/features/journey/event-sheet-stub.tsx`
- Create: `apps/web/src/features/journey/event-sheet-host.tsx`
- Test: `apps/web/src/features/journey/event-sheet-host.test.tsx`

**Interfaces:**
- Consumes: `useEventSheet` (`current`, `closeEvent`) (Task 1); `useEvent`, `EventRecord`, `EventDetail` (Task 3); `CATEGORY_META`, `collectionMeta` (Phase 0); `CategoryIcon`, `SignificanceBadge`, `RecordSheet` (existing); `formatDay`, `relativeFuture` (`@/lib/dates`).
- Produces:
  - `EventSheetHost()` — no props; mounted once in `AppLayout` by Task 15. Phase 4 replaces the `EventSheetStub` render inside it with `EventDetailSheet` and deletes `event-sheet-stub.tsx`.
  - `EventSheetStub({ assetId: string | null; eventId: string | null; onClose(): void })` — a right sheet (560px) named by the event title: category, branch chip, significance, date ("Expected … · in …" for milestones), "Show on the journey timeline" (→ `/assets/:id/overview?focus=<encoded id>`, closes the sheet), summary, "Why it matters", evidence list (rows with a tab open the existing `RecordSheet`; rows without one link to `url`).

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
  neighbors: { prev: null, next: null },
  branchStats: { index: 1, total: 1, prevSameBranch: null },
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
      if (url === '/api/assets/trep/record/company-ir?key=pr%3A1') return json(200, { key: 'pr:1', title: 'UT announces FDA approval of Tyvaso', date: '2021-03-31' })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
}

beforeEach(() => useEventSheet.setState({ current: null }))
afterEach(() => vi.unstubAllGlobals())

describe('EventSheetHost', () => {
  it('opens from the store with the event, why it matters and its evidence', async () => {
    serve(DETAIL)
    renderHost()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))

    const sheet = await screen.findByRole('dialog', { name: 'Tyvaso approved for PH-ILD' })
    expect(within(sheet).getByText('Mar 31, 2021')).toBeInTheDocument()
    expect(within(sheet).getByText('PH-ILD')).toBeInTheDocument()
    expect(within(sheet).getByText('First approved therapy for PH-ILD.')).toBeInTheDocument()
    expect(within(sheet).getByText('Evidence · 2 sources')).toBeInTheDocument()
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
    expect(within(sheet).getByText(/^Expected Jan 15, 2099 · in /)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useEventSheet.getState().current).toBeNull()
  })

  it('says so when the event cannot be loaded', async () => {
    serve(null)
    renderHost()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    expect(await screen.findByText("This event couldn't be loaded.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/event-sheet-host.test.tsx`
Expected: FAIL — `Failed to resolve import "./event-sheet-host"`.

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/journey/event-sheet-stub.tsx
import { ArrowUpRight, Loader2, MapPin } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { RecordTab } from '@/features/assets/api'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { RecordSheet } from '@/features/assets/components/record-sheet'
import { formatDay, relativeFuture } from '@/lib/dates'
import { useEvent, type EventRecord } from './api'
import { CATEGORY_META, collectionMeta } from './constants'

const LABEL = 'mb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'

/**
 * Phase 2 event sheet: enough to answer "what is this dot?" from Home and ⌘K until Phase 4's EventDetailSheet
 * (position strip, lineage, term bars, comments, prev/next) replaces it in EventSheetHost.
 */
export function EventSheetStub({ assetId, eventId, onClose }: { assetId: string | null; eventId: string | null; onClose: () => void }) {
  const navigate = useNavigate()
  const detail = useEvent(assetId ?? '', eventId)
  const [record, setRecord] = useState<{ tab: RecordTab; key: string } | null>(null)
  const open = assetId !== null && eventId !== null
  const event = detail.data?.event

  const locate = () => {
    if (!assetId || !eventId) return
    onClose()
    navigate(`/assets/${encodeURIComponent(assetId)}/overview?focus=${encodeURIComponent(eventId)}`)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent className="overflow-y-auto shadow-sheet data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
          <SheetHeader className="gap-2 pr-12">
            {event && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-secondary">
                <CategoryIcon category={event.category} />
                <span className="font-medium">{CATEGORY_META[event.category].label}</span>
                {event.branch && <span className="rounded-md border px-1.5 text-[11.5px] font-semibold text-secondary-foreground">{event.branch}</span>}
                <SignificanceBadge value={event.significance} />
              </div>
            )}
            <SheetTitle className="text-[20px] leading-snug font-semibold">{event?.title ?? 'Loading…'}</SheetTitle>
            <SheetDescription>
              {event ? (event.is_milestone ? `Expected ${formatDay(event.date)} · ${relativeFuture(event.date)}` : formatDay(event.date)) : ' '}
            </SheetDescription>
          </SheetHeader>
          {open && detail.isPending && (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          {detail.isError && <p className="px-4 text-destructive">This event couldn't be loaded.</p>}
          {detail.data && event && (
            <div className="space-y-5 px-4 pb-6">
              <Button variant="outline" size="sm" onClick={locate}>
                <MapPin /> Show on the journey timeline
              </Button>
              {event.summary && <p className="leading-relaxed text-text-secondary">{event.summary}</p>}
              {event.impact && (
                <section aria-label="Why it matters">
                  <p className={LABEL}>Why it matters</p>
                  <p>{event.impact}</p>
                </section>
              )}
              <Evidence records={detail.data.records} onOpen={setRecord} />
            </div>
          )}
        </SheetContent>
      </Sheet>
      <RecordSheet assetId={assetId ?? ''} tab={record?.tab ?? 'clinical'} recordKey={record?.key ?? null} onClose={() => setRecord(null)} />
    </>
  )
}

function Evidence({ records, onOpen }: { records: EventRecord[]; onOpen: (record: { tab: RecordTab; key: string }) => void }) {
  if (!records.length) return null
  return (
    <section aria-label="Evidence">
      <p className={LABEL}>
        Evidence · {records.length} source{records.length === 1 ? '' : 's'}
      </p>
      <ul className="divide-y divide-hair rounded-xl border">
        {records.map((r) => {
          const meta = collectionMeta(r.collection)
          return (
            <li key={`${r.collection}|${r.key}`} className="flex items-center gap-3 px-3 py-2.5">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.title}</p>
                <p className="text-[12px] text-muted-foreground">
                  {meta.label}
                  {r.date && ` · ${formatDay(r.date)}`}
                </p>
              </div>
              {r.tab ? (
                <Button variant="ghost" size="sm" aria-label={`Open ${r.title}`} onClick={() => onOpen({ tab: r.tab as RecordTab, key: r.key })}>
                  Open
                </Button>
              ) : (
                r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Open ${r.title}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    Open <ArrowUpRight className="size-3.5" />
                  </a>
                )
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

```tsx
// file: apps/web/src/features/journey/event-sheet-host.tsx
import { useEventSheet } from '@/stores/event-sheet-store'
import { EventSheetStub } from './event-sheet-stub'

/**
 * The app's one event sheet (spec §5 "Event sheet host"), mounted in AppLayout. Any surface opens it with
 * `useEventSheet.getState().openEvent(assetId, eventId)`. Phase 4 renders EventDetailSheet here instead of the stub.
 */
export function EventSheetHost() {
  const current = useEventSheet((s) => s.current)
  const close = useEventSheet((s) => s.closeEvent)
  return <EventSheetStub assetId={current?.assetId ?? null} eventId={current?.eventId ?? null} onClose={close} />
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/event-sheet-host.test.tsx && npx tsc -b`
Expected: PASS (4 tests); `tsc` silent.

---

### Task 6: Sidebar — "Your assets", live crawl dot, collapse saved to prefs, mobile drawer

**Files:**
- Modify: `apps/web/src/components/layout/app-sidebar.tsx` (Replace)
- Test: `apps/web/src/components/layout/app-sidebar.test.tsx`

**Interfaces:**
- Consumes: `useShellStore` (`sidebarCollapsed`, `toggleSidebar`, `setSidebarCollapsed`, `mobileNavOpen`, `setMobileNavOpen`, `lastAssetId`) and `AssetTile`, `jobProgress`, `runningByAsset` (Task 1); `usePrefs`, `useSavePrefs` (Task 2); `useAssets` (existing); `useJobs` (existing, `{ status: 'running' }`); `NAV_GROUPS`, `SETTINGS_ITEM` (existing).
- Produces: `AppSidebar()` (same export, same mount point). Desktop `<aside>` hidden below 900px; drawer = Radix Dialog named "Navigation" driven by `mobileNavOpen` (Task 7's hamburger opens it). Crawl jobs link contains `role="img"` "A crawl is running" while a job runs.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/components/layout/app-sidebar.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AssetSummary } from '@/features/assets/api'
import type { Job, JobStep } from '@/features/jobs/api'
import type { Prefs } from '@/features/me/api'
import { useShellStore } from '@/stores/shell-store'
import { AppSidebar } from './app-sidebar'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const asset = (id: string, name: string, kind: AssetSummary['kind']): AssetSummary => ({
  id,
  name,
  aliases: [],
  company: { name: 'Co' },
  tags: {},
  kind,
  status: 'ready',
  updatedAt: null,
  counts: { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 },
  latestEvent: null,
  competitorOf: [],
})
const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const RUNNING: Job = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'onboard',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: null,
  finished_at: null,
}
const PREFS: Prefs = { journeyView: 'h', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: false } }
const ASSETS = [asset('trep', 'Treprostinil', 'primary'), asset('sota', 'Sotatercept', 'primary'), asset('nint', 'Nintedanib', 'competitor')]

let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>

function fakeApi({ jobs = [RUNNING], prefs = PREFS }: { jobs?: Job[]; prefs?: Prefs } = {}) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assets') return json(200, ASSETS)
    if (url === '/api/jobs?status=running') return json(200, jobs)
    if (url === '/api/me/prefs') return json(200, init?.method === 'PATCH' ? { ...prefs, ...JSON.parse(String(init.body)) } : prefs)
    return json(404, { code: 'NOT_FOUND', message: url })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function renderSidebar(path = '/') {
  const router = createMemoryRouter([{ path: '*', element: <AppSidebar /> }], { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => useShellStore.setState({ sidebarCollapsed: false, lastAssetId: null, mobileNavOpen: false }))
afterEach(() => vi.unstubAllGlobals())

describe('AppSidebar', () => {
  it('lists primary assets under "Your assets" with build progress, and marks Crawl jobs live', async () => {
    fakeApi()
    renderSidebar('/assets/sota/clinical')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const trep = await within(nav).findByRole('link', { name: /Treprostinil/ })
    expect(within(nav).getByText('Your assets')).toBeInTheDocument()
    expect(trep).toHaveAttribute('href', '/assets/trep/overview')
    expect(trep).toHaveTextContent('50%')
    expect(within(nav).getByRole('link', { name: /Sotatercept/ })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).queryByRole('link', { name: /Nintedanib/ })).not.toBeInTheDocument()
    const live = await within(nav).findByRole('img', { name: 'A crawl is running' })
    expect(within(nav).getByRole('link', { name: /Crawl jobs/ })).toContainElement(live)
  })

  it('shows no live dot or progress when nothing runs', async () => {
    fakeApi({ jobs: [] })
    renderSidebar()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const trep = await within(nav).findByRole('link', { name: /Treprostinil/ })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/jobs?status=running', expect.anything()))
    expect(trep).not.toHaveTextContent('%')
    expect(within(nav).queryByRole('img', { name: 'A crawl is running' })).not.toBeInTheDocument()
  })

  it('navigates from every item', async () => {
    fakeApi()
    useShellStore.setState({ lastAssetId: 'trep' })
    const router = renderSidebar()
    await screen.findByRole('link', { name: /^Treprostinil/ })
    const expected: [RegExp, string][] = [
      [/^Home$/, '/'],
      [/^Asset Search$/, '/assets'],
      [/^Asset AI$/, '/chat'],
      [/^Asset Journey$/, '/assets/trep/overview'],
      [/^Company IR$/, '/assets/trep/company-ir'],
      [/^Conferences$/, '/assets/trep/conferences'],
      [/^Uploads/, '/uploads'],
      [/^Crawl jobs/, '/jobs'],
      [/^Treprostinil/, '/assets/trep/overview'],
      [/^Sotatercept/, '/assets/sota/overview'],
      [/^Settings$/, '/settings'],
    ]
    for (const [name, path] of expected) {
      await userEvent.click(screen.getByRole('link', { name }))
      expect(router.state.location.pathname).toBe(path)
    }
  })

  it('applies the saved collapsed preference and saves each toggle', async () => {
    fakeApi({ prefs: { ...PREFS, sidebarCollapsed: true } })
    renderSidebar()
    const expand = await screen.findByRole('button', { name: 'Expand sidebar' })
    expect(screen.queryByText('Your assets')).not.toBeInTheDocument()
    await userEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/me/prefs', expect.objectContaining({ method: 'PATCH', body: '{"sidebarCollapsed":false}' })),
    )
  })

  it('keeps working when prefs and jobs cannot be loaded', async () => {
    fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => (url === '/api/assets' ? json(200, ASSETS) : json(500, { code: 'ERROR', message: 'down' })))
    vi.stubGlobal('fetch', fetchMock)
    renderSidebar()
    expect(await screen.findByRole('link', { name: /^Treprostinil/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(useShellStore.getState().sidebarCollapsed).toBe(true)
  })

  it('opens as a drawer from the store and closes when a link is followed', async () => {
    fakeApi()
    const router = renderSidebar()
    act(() => useShellStore.getState().setMobileNavOpen(true))
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })
    expect(within(drawer).queryByRole('button', { name: /sidebar/ })).not.toBeInTheDocument()
    await userEvent.click(within(drawer).getByRole('link', { name: /^Asset Search$/ }))
    expect(router.state.location.pathname).toBe('/assets')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useShellStore.getState().mobileNavOpen).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/components/layout/app-sidebar.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "link" and name /Treprostinil/` (and no "Navigation" dialog).

- [ ] **Step 3: Implement** — **Replace** the sidebar:

```tsx
// file: apps/web/src/components/layout/app-sidebar.tsx
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAssets } from '@/features/assets/api'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { useJobs } from '@/features/jobs/api'
import { jobProgress, runningByAsset } from '@/features/jobs/steps'
import { usePrefs, useSavePrefs } from '@/features/me/api'
import { cn } from '@/lib/utils'
import { useShellStore } from '@/stores/shell-store'
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from './nav-config'

const SECTION_TABS = new Set(
  NAV_GROUPS.flatMap((g) => g.items)
    .map((i) => i.assetTab)
    .filter((t): t is string => !!t && t !== 'overview'),
)

const ITEM =
  'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
const ITEM_ACTIVE = 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
const GROUP_LABEL = 'px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground'

/** Where a nav item points, and whether it's the current section. */
function useNavTarget(item: NavItem): { to: string; active: boolean } {
  const { pathname } = useLocation()
  const lastAssetId = useShellStore((s) => s.lastAssetId)
  if (!item.assetTab) {
    const active = item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`)
    // Asset pages belong to the asset-scoped items, not to Asset Search.
    return { to: item.to, active: active && !(item.to === '/assets' && pathname !== '/assets') }
  }
  const tab = pathname.match(/^\/assets\/[^/]+\/([^/]+)/)?.[1]
  // A section with its own nav item (Company IR, Conferences) lights that item; every other tab is the journey.
  const active = tab !== undefined && (item.assetTab === 'overview' ? !SECTION_TABS.has(tab) : tab === item.assetTab)
  return { to: lastAssetId ? `/assets/${encodeURIComponent(lastAssetId)}/${item.assetTab}` : '/assets', active }
}

function NavEntry({ item, collapsed, live = false, onNavigate }: { item: NavItem; collapsed: boolean; live?: boolean; onNavigate?: () => void }) {
  const target = useNavTarget(item)
  const link = (
    <Link
      to={target.to}
      onClick={onNavigate}
      aria-current={target.active ? 'page' : undefined}
      className={cn(ITEM, target.active && ITEM_ACTIVE, collapsed && 'justify-center px-0')}
    >
      <item.icon className="size-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {!item.ready && <span className="ml-auto rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">Soon</span>}
          {live && <span role="img" aria-label="A crawl is running" className="ml-auto size-[7px] shrink-0 animate-blink-dot rounded-full bg-primary" />}
        </>
      )}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

/** Primary assets (README §5.1): 20px tile, name, build % in warning colour while a crawl runs. */
function YourAssets({ onNavigate }: { onNavigate?: () => void }) {
  const assets = useAssets()
  const running = runningByAsset(useJobs({ status: 'running' }).data)
  const { pathname } = useLocation()
  const primary = (assets.data ?? []).filter((a) => a.kind === 'primary')
  if (!primary.length) return null
  return (
    <div className="space-y-0.5">
      <p className={GROUP_LABEL}>Your assets</p>
      {primary.map((a) => {
        const base = `/assets/${encodeURIComponent(a.id)}`
        const active = pathname.startsWith(`${base}/`)
        const job = running.get(a.id)
        return (
          <Link key={a.id} to={`${base}/overview`} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cn(ITEM, 'gap-2', active && ITEM_ACTIVE)}>
            <AssetTile name={a.name} kind={a.kind} size={20} />
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            {job && <span className="font-mono text-[11px] text-warning tabular-nums">{Math.round(jobProgress(job) * 100)}%</span>}
          </Link>
        )
      })}
    </div>
  )
}

function SidebarBody({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const crawling = (useJobs({ status: 'running' }).data?.length ?? 0) > 0
  return (
    <>
      <div className={cn('flex h-14 shrink-0 items-center px-4', collapsed && 'justify-center px-0')}>
        <span className="text-lg font-semibold tracking-tight">
          {collapsed ? (
            <span className="text-primary">PE</span>
          ) : (
            <>
              Pharma<span className="text-primary">Edge</span>
            </>
          )}
        </span>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-2" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-0.5">
            {!collapsed && <p className={GROUP_LABEL}>{group.label}</p>}
            {group.items.map((item) => (
              <NavEntry key={item.label} item={item} collapsed={collapsed} live={item.to === '/jobs' && crawling} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
        {!collapsed && <YourAssets onNavigate={onNavigate} />}
      </nav>
      <div className="space-y-0.5 border-t px-2.5 py-2">
        <NavEntry item={SETTINGS_ITEM} collapsed={collapsed} onNavigate={onNavigate} />
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-muted-foreground hover:bg-sidebar-accent', collapsed && 'justify-center px-0')}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        )}
      </div>
    </>
  )
}

/** Collapse state saved per user in /me/prefs: applied once when prefs load; localStorage keeps it otherwise. */
function useCollapsedPref() {
  const prefs = usePrefs()
  const save = useSavePrefs()
  const collapsed = useShellStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useShellStore((s) => s.toggleSidebar)
  const setCollapsed = useShellStore((s) => s.setSidebarCollapsed)
  const synced = useRef(false)
  useEffect(() => {
    if (!prefs.data || synced.current) return
    synced.current = true
    setCollapsed(prefs.data.sidebarCollapsed)
  }, [prefs.data, setCollapsed])
  const toggle = () => {
    synced.current = true
    toggleSidebar()
    save.mutate({ sidebarCollapsed: !collapsed })
  }
  return { collapsed, toggle }
}

export function AppSidebar() {
  const { collapsed, toggle } = useCollapsedPref()
  const mobileOpen = useShellStore((s) => s.mobileNavOpen)
  const setMobileOpen = useShellStore((s) => s.setMobileNavOpen)

  return (
    <>
      <aside
        className={cn(
          'flex h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 max-[899px]:hidden',
          collapsed ? 'w-[60px]' : 'w-[232px]',
        )}
      >
        <SidebarBody collapsed={collapsed} onToggle={toggle} />
      </aside>
      {/* Below 900px: off-canvas drawer opened from the top bar's menu button. */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(16,24,40,0.3)] data-[state=open]:animate-fade" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r bg-sidebar shadow-[16px_0_40px_rgba(16,24,40,0.18)] outline-none"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <SidebarBody collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/components/layout/app-sidebar.test.tsx src/features/auth/auth-flow.test.tsx && npx tsc -b`
Expected: PASS (6 sidebar tests; `auth-flow` unchanged and green); `tsc` silent.

---

### Task 7: Top bar — search trigger, crawl chip, Add asset, notifications, mobile menu

**Files:**
- Modify: `apps/web/src/components/layout/app-header.tsx` (Replace)
- Create: `apps/web/src/components/layout/crawl-chip.tsx`
- Create: `apps/web/src/components/layout/notifications-popover.tsx`
- Modify: `apps/web/src/lib/dates.ts` (add `timeAgo`), `apps/web/src/lib/dates.test.ts`
- Test: `apps/web/src/components/layout/app-header.test.tsx`

**Interfaces:**
- Consumes: `useShellStore` `setPaletteOpen`, `setMobileNavOpen`, and `jobProgress`, `jobStepLabel` (Task 1); `useNotifications`, `useMarkNotificationsRead`, `AppNotification` (Task 2); `useJobs` (existing); `useAuth` (existing).
- Produces: `AppHeader()` (same export; keeps the "Account menu" button and `initials`); `CrawlChip()`; `ProgressRing({ value: number; size?: number })`; `NotificationsPopover()`; `timeAgo(iso: string, now?: number): string` in `lib/dates.ts`. Search trigger button named "Search (⌘K)"; hamburger "Open navigation"; bell "Notifications" / "Notifications, N unread"; crawl chip link named "<asset> crawl: <step>, <n>%. Open the live build" → `/assets/:id/overview?build=1`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/dates.test.ts`:

Before:
```ts
import { clampDay, daysBetween, formatDay, fromYearFraction, interpolateDate, relativeFuture, yearFraction } from './dates'
```
After:
```ts
import { clampDay, daysBetween, formatDay, fromYearFraction, interpolateDate, relativeFuture, timeAgo, yearFraction } from './dates'
```

Append at the end of the file:
```ts

describe('timeAgo', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  it('reads minutes, hours and days, then the date', () => {
    expect(timeAgo('2026-10-09T11:59:40Z', now)).toBe('just now')
    expect(timeAgo('2026-10-09T11:55:00Z', now)).toBe('5m ago')
    expect(timeAgo('2026-10-09T09:00:00Z', now)).toBe('3h ago')
    expect(timeAgo('2026-10-07T12:00:00Z', now)).toBe('2d ago')
    expect(timeAgo('2026-09-01T10:00:00Z', now)).toBe('Sep 1, 2026')
    expect(timeAgo('garbage', now)).toBe('')
  })
})
```

```tsx
// file: apps/web/src/components/layout/app-header.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import type { Job, JobStep } from '@/features/jobs/api'
import type { NotificationList } from '@/features/me/api'
import { useShellStore } from '@/stores/shell-store'
import { AppHeader } from './app-header'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const RUNNING: Job = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'onboard',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: null,
  finished_at: null,
}
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const NOTES: NotificationList = {
  items: [
    { id: 'n1', kind: 'high_event', title: 'FDA accepts Tyvaso sNDA', sub: 'Treprostinil', link: '/assets/trep/overview?focus=e1', read: false, at: minutesAgo(5) },
    { id: 'n2', kind: 'job_failed', title: 'Sotatercept: 1 step failed', sub: 'Patents', link: 'https://evil.example/x', read: false, at: minutesAgo(180) },
    { id: 'n3', kind: 'onboarding_finished', title: 'Ensifentrine journey is ready', sub: '41 journey events', link: '/assets/ensi/overview', read: true, at: '2026-09-01T10:00:00Z' },
  ],
  unread: 2,
}

type Calls = { url: string; init?: RequestInit }[]

function fakeApi(overrides: Record<string, () => Response> = {}): Calls {
  const calls: Calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const override = overrides[url]
      if (override) return override()
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/jobs?status=running') return json(200, [RUNNING])
      if (url === '/api/notifications') return json(200, NOTES)
      if (url === '/api/notifications/read') return json(200, { unread: String(init?.body).includes('ids') ? 1 : 0 })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  return calls
}

function renderHeader() {
  const router = createMemoryRouter([{ path: '*', element: <AppHeader /> }], { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => useShellStore.setState({ paletteOpen: false, mobileNavOpen: false }))
afterEach(() => vi.unstubAllGlobals())

describe('AppHeader', () => {
  it('opens the palette and the mobile navigation, and links Add asset to Asset AI', async () => {
    fakeApi()
    renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Search (⌘K)' }))
    expect(useShellStore.getState().paletteOpen).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(useShellStore.getState().mobileNavOpen).toBe(true)
    expect(screen.getByRole('link', { name: /Add asset/ })).toHaveAttribute('href', '/chat?intent=add')
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
  })

  it('shows the running crawl with its step and progress, linking to the live build', async () => {
    fakeApi()
    renderHeader()
    const chip = await screen.findByRole('link', { name: /Treprostinil crawl: Rules engine, 50%/ })
    expect(chip).toHaveAttribute('href', '/assets/trep/overview?build=1')
    expect(chip).toHaveTextContent('50%')
  })

  it('says all crawls finished when nothing runs', async () => {
    fakeApi({ '/api/jobs?status=running': () => json(200, []) })
    renderHeader()
    expect(await screen.findByText('All crawls finished')).toBeInTheDocument()
  })

  it('lists notifications, follows an in-app link and marks it read, then marks all read', async () => {
    const calls = fakeApi()
    const router = renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))
    const first = await screen.findByRole('button', { name: /FDA accepts Tyvaso sNDA/ })
    expect(first).toHaveTextContent('5m ago')
    expect(screen.getByRole('button', { name: /Sotatercept: 1 step failed/ })).toHaveTextContent('3h ago')
    expect(screen.getAllByRole('img', { name: 'Unread' })).toHaveLength(2)
    await userEvent.click(first)
    expect(router.state.location.pathname).toBe('/assets/trep/overview')
    expect(router.state.location.search).toBe('?focus=e1')
    await waitFor(() => expect(calls.find((c) => c.url === '/api/notifications/read')?.init?.body).toBe('{"ids":["n1"]}'))

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/notifications/read').at(-1)?.init?.body).toBe('{}'))
  })

  it('does not follow links that leave the app', async () => {
    fakeApi()
    const router = renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))
    await userEvent.click(await screen.findByRole('button', { name: /Sotatercept: 1 step failed/ }))
    expect(router.state.location.pathname).toBe('/')
  })

  it('keeps the bell usable when notifications cannot load', async () => {
    fakeApi({ '/api/notifications': () => json(500, { code: 'ERROR', message: 'down' }) })
    renderHeader()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText("Notifications couldn't be loaded.")).toBeInTheDocument()
  })

  it('shows no crawl status, rather than a false "All crawls finished", when jobs cannot load', async () => {
    const calls = fakeApi({ '/api/jobs?status=running': () => json(500, { code: 'ERROR', message: 'down' }) })
    renderHeader()
    await screen.findByRole('button', { name: 'Notifications, 2 unread' })
    await waitFor(() => expect(calls.some((c) => c.url === '/api/jobs?status=running')).toBe(true))
    expect(screen.queryByText('All crawls finished')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /crawl:/ })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/lib/dates.test.ts src/components/layout/app-header.test.tsx`
Expected: FAIL — `timeAgo` is not exported (`TypeError: timeAgo is not a function` / `does not provide an export named 'timeAgo'`); header tests can't find "Search (⌘K)".

- [ ] **Step 3: Implement**

Append to `apps/web/src/lib/dates.ts`:
```ts

/** Notification times: "just now", "5m ago", "3h ago", "2d ago", then the date; "" when not a date. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000)
  if (Number.isNaN(mins)) return ''
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d ago` : formatDay(iso.slice(0, 10))
}
```

```tsx
// file: apps/web/src/components/layout/crawl-chip.tsx
import { Check } from 'lucide-react'
import { Link } from 'react-router'
import { useJobs } from '@/features/jobs/api'
import { jobProgress, jobStepLabel } from '@/features/jobs/steps'

/** Circular progress (0–1), 18px in the crawl chip. */
export function ProgressRing({ value, size = 18 }: { value: number; size?: number }) {
  const r = (size - 4) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#d5ddfa" strokeWidth={2.5} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={2.5}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value)}
        strokeLinecap="round"
        className="stroke-primary transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  )
}

/** Top-bar crawl status: the running crawl (→ its live build) or "All crawls finished"; nothing while unknown. */
export function CrawlChip() {
  const jobs = useJobs({ status: 'running' })
  if (!jobs.data) return null
  const job = jobs.data[0]
  if (!job) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-success max-[899px]:hidden">
        <Check className="size-[13px]" strokeWidth={2.6} />
        All crawls finished
      </span>
    )
  }
  const name = job.assetName ?? job.asset
  const step = jobStepLabel(job)
  const pct = Math.round(jobProgress(job) * 100)
  const more = jobs.data.length - 1
  return (
    <Link
      to={`/assets/${encodeURIComponent(job.asset)}/overview?build=1`}
      title="Open the live build"
      aria-label={`${name} crawl: ${step}, ${pct}%. Open the live build`}
      className="inline-flex h-8 items-center gap-2 rounded-full border border-[#d5ddfa] bg-primary-soft pr-2.5 pl-[7px] text-[12.5px] whitespace-nowrap text-secondary-foreground transition-colors hover:border-primary"
    >
      <ProgressRing value={jobProgress(job)} />
      <span className="max-[899px]:hidden">
        <b className="font-semibold text-foreground">{name}</b> · {step}
        {more > 0 && ` · +${more} more`}
      </span>
      <span className="font-mono text-[11.5px] font-semibold text-primary">{pct}%</span>
    </Link>
  )
}
```

```tsx
// file: apps/web/src/components/layout/notifications-popover.tsx
import { Activity, Bell, Check, Flag, MessageCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMarkNotificationsRead, useNotifications, type AppNotification } from '@/features/me/api'
import { timeAgo } from '@/lib/dates'
import { cn } from '@/lib/utils'

const KIND: Record<string, { icon: LucideIcon; tone: string }> = {
  onboarding_started: { icon: Activity, tone: 'bg-primary-soft text-primary' },
  onboarding_finished: { icon: Check, tone: 'bg-success-soft text-success' },
  job_failed: { icon: TriangleAlert, tone: 'bg-danger-soft text-destructive' },
  high_event: { icon: Flag, tone: 'bg-warning-soft text-warning' },
  comment: { icon: MessageCircle, tone: 'bg-violet-soft text-violet' },
}
const OTHER = { icon: Bell, tone: 'bg-muted text-text-secondary' }

/** Notification links come from the crawler and the API: only paths inside the app are followed. */
const isInternal = (link: string) => link.startsWith('/') && !link.startsWith('//')

/** Bell with unread badge and a 350px list (README §5.1). */
export function NotificationsPopover() {
  const list = useNotifications()
  const markRead = useMarkNotificationsRead()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const unread = list.data?.unread ?? 0
  const items = list.data?.items ?? []

  const follow = (n: AppNotification) => {
    setOpen(false)
    if (!n.read) markRead.mutate({ ids: [n.id] })
    if (isInternal(n.link)) navigate(n.link)
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex size-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-accent"
      >
        <Bell className="size-[17px]" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-2 border-card bg-destructive px-1 text-[10px] font-semibold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[350px] overflow-hidden rounded-xl border bg-popover shadow-popover outline-none data-[state=open]:animate-fade-up"
        >
          <div className="flex items-center justify-between border-b border-hair px-3.5 py-3">
            <p className="font-semibold">Notifications</p>
            <button
              type="button"
              disabled={!unread}
              onClick={() => markRead.mutate({})}
              className="text-[12.5px] font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          {list.isError && <p className="px-3.5 py-6 text-center text-muted-foreground">Notifications couldn't be loaded.</p>}
          {list.data && items.length === 0 && (
            <div className="px-6 py-8 text-center">
              <p className="font-medium">You're all caught up</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">Finished and failed crawls and new high-significance events show up here.</p>
            </div>
          )}
          <ul className="max-h-[420px] divide-y divide-hair overflow-y-auto">
            {items.map((n) => {
              const kind = KIND[n.kind] ?? OTHER
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => follow(n)} className="flex w-full items-start gap-2.5 px-3.5 py-[11px] text-left transition-colors hover:bg-background">
                    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', kind.tone)}>
                      <kind.icon className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-semibold">
                        {!n.read && <span role="img" aria-label="Unread" className="mr-1.5 inline-block size-1.5 rounded-full bg-primary align-[2px]" />}
                        {n.title}
                      </span>
                      <span className="truncate text-[12px] text-muted-foreground">{n.sub}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] whitespace-nowrap text-faint">{timeAgo(n.at)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
```

**Replace** the header:

```tsx
// file: apps/web/src/components/layout/app-header.tsx
import { LogOut, Menu, Plus, Search, Settings } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/features/auth/auth-context'
import { useShellStore } from '@/stores/shell-store'
import { CrawlChip } from './crawl-chip'
import { NotificationsPopover } from './notifications-popover'

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')

/** Top bar (README §5.1): menu (<900px), ⌘K search, crawl status, Add asset, notifications, account. */
export function AppHeader() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen)
  const setMobileNavOpen = useShellStore((s) => s.setMobileNavOpen)
  if (!user) return null

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b bg-card px-3 min-[900px]:gap-4 min-[900px]:px-5">
      <Button variant="ghost" size="icon" className="min-[900px]:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
        <Menu className="size-[18px]" />
      </Button>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search (⌘K)"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-8 shrink-0 items-center gap-2 rounded-md border bg-background px-2.5 text-muted-foreground transition-colors hover:border-input min-[900px]:w-full min-[900px]:max-w-[440px] min-[900px]:shrink"
      >
        <Search className="size-[15px] shrink-0" />
        <span className="flex-1 truncate text-left max-[899px]:hidden">Search assets, events, trials…</span>
        <kbd className="rounded border bg-card px-1.5 font-mono text-[11px] max-[899px]:hidden">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2.5">
        <CrawlChip />
        <Button asChild size="sm" className="max-[899px]:hidden">
          <Link to="/chat?intent=add">
            <Plus /> Add asset
          </Link>
        </Button>
        <NotificationsPopover />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent" aria-label="Account menu">
            <Avatar className="size-7">
              <AvatarFallback className="bg-primary text-[11px] text-primary-foreground">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <span className="hidden font-medium sm:inline">{user.name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="truncate font-medium">{user.name}</p>
              <p className="truncate font-normal text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/settings')}>
              <Settings /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && npx vitest run src/lib/dates.test.ts src/components/layout/app-header.test.tsx src/features/auth/auth-flow.test.tsx && npx tsc -b`
Expected: PASS (dates + 7 header tests; `auth-flow` still green, including "signs out from the account menu"); `tsc` silent.

---

### Task 8: Portfolio timeline

**Files:**
- Create: `apps/web/src/features/home/portfolio-scale.ts`
- Create: `apps/web/src/features/home/components/portfolio-timeline.tsx`
- Test: `apps/web/src/features/home/portfolio-scale.test.ts`, `apps/web/src/features/home/components/portfolio-timeline.test.tsx`

**Interfaces:**
- Consumes: `usePortfolioTimeline`, `eventsByAsset`, `PortfolioAsset`, `PortfolioTimeline` (Task 3); `useJobProgress` (Task 3); `useJobs` (existing); `jobProgress`, `runningByAsset`, `AssetTile`, `useEventSheet.openEvent` (Task 1); `CATEGORIES`, `CATEGORY_META`, `COLLECTION_META`, `collectionMeta`, `Significance` (Phase 0); `yearFraction`, `todayIso`, `formatDay`, `formatMonth` (`@/lib/dates`); `useElementWidth`; `Panel`, `EmptyState`, `Segmented`, `Switch`, `Skeleton` (existing).
- Produces:
  - `portfolio-scale.ts`: `type PortfolioRange = '1y' | '3y' | 'all'`, `RANGE_OPTIONS`, `DOT_RADIUS: Record<Significance, number>`, `rangeBounds(range, today: number, dates: number[]): [number, number]`, `rangeTicks(range, y0, y1): { v: number; label: string }[]`.
  - `PortfolioTimeline()` — no props; each dot is `role="button"` named `"<title>, <asset>, <date | expected Mon YYYY>"`; click/Enter → `openEvent(asset, id)`; rows are links to `/assets/:id/overview`; `rect[data-record-tick]` for onboarding rows.

- [ ] **Step 1: Write the failing tests**

```ts
// file: apps/web/src/features/home/portfolio-scale.test.ts
import { DOT_RADIUS, rangeBounds, rangeTicks } from './portfolio-scale'

const T = 2026.774

describe('rangeBounds', () => {
  it('spans ±1 year and 3 years around today', () => {
    expect(rangeBounds('1y', T, [])).toEqual([T - 1, T + 1.15])
    expect(rangeBounds('3y', T, [])).toEqual([T - 3, T + 1.6])
  })

  it('covers every dated event for all time, from 2000 at the latest and two years ahead at least', () => {
    expect(rangeBounds('all', T, [])).toEqual([2000, 2029])
    expect(rangeBounds('all', T, [1995.4, 2031.2, Number.NaN])).toEqual([1995, 2032])
  })
})

describe('rangeTicks', () => {
  it('labels quarters for ±1 year', () => {
    expect(rangeTicks('1y', 2025.774, 2027.924).map((t) => t.label)).toEqual([
      'Jan ’26', 'Apr ’26', 'Jul ’26', 'Oct ’26', 'Jan ’27', 'Apr ’27', 'Jul ’27', 'Oct ’27',
    ])
    expect(rangeTicks('1y', 2025.774, 2027.924)[0]).toEqual({ v: 2026, label: 'Jan ’26' })
  })

  it('steps yearly for 3 years, and every 2 or 4 years for all time', () => {
    expect(rangeTicks('3y', 2023.774, 2028.374).map((t) => t.label)).toEqual(['2024', '2025', '2026', '2027', '2028'])
    expect(rangeTicks('all', 1995, 2032).map((t) => t.v)).toEqual([1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024, 2028, 2032])
    expect(rangeTicks('all', 2010, 2029).map((t) => t.v)).toEqual([2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026, 2028])
  })

  it('sizes dots by significance', () => {
    expect(DOT_RADIUS).toEqual({ High: 6.5, Medium: 5, Low: 3.6 })
  })
})
```

```tsx
// file: apps/web/src/features/home/components/portfolio-timeline.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { Job, JobStep } from '@/features/jobs/api'
import type { JourneyEventV3 } from '@/features/journey/types'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { PortfolioTimeline as Portfolio } from '../api'
import { PortfolioTimeline } from './portfolio-timeline'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ev = (id: string, asset: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset,
  date,
  type: 'approval',
  category: 'regulatory',
  title: id,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
  key: true,
  ...extra,
})
const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const RUNNING: Job = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'onboard',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: null,
  finished_at: null,
}

const PORTFOLIO: Portfolio = {
  assets: [
    { id: 'trep', name: 'Treprostinil', kind: 'primary', company: 'United Therapeutics', status: 'onboarding', progress: 0.1, competitorOf: [] },
    { id: 'sota', name: 'Sotatercept', kind: 'primary', company: 'Merck', status: 'ready', progress: null, competitorOf: [] },
    { id: 'nint', name: 'Nintedanib', kind: 'competitor', company: 'Boehringer Ingelheim', status: 'ready', progress: null, competitorOf: ['trep'] },
  ],
  events: [
    ev('e1', 'trep', '2025-03-01', { title: 'Phase 3 trial started: TETON-1', category: 'clinical' }),
    ev('e2', 'trep', '2027-03-31', { title: 'TETON-2 readout expected', category: 'clinical', is_milestone: true, significance: 'Medium' }),
    ev('e3', 'nint', '2026-03-09', { title: 'Ofev approved for PPF' }),
    ev('e4', 'sota', '2005-05-21', { title: 'First patent filed', category: 'ip', significance: 'Low' }),
    ev('e5', 'trep', '', { title: 'Undated event' }),
  ],
}

function serve(portfolio: Response = json(200, PORTFOLIO)) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/portfolio/timeline?competitors=true') return portfolio.clone()
      if (url === '/api/jobs?status=running') return json(200, [RUNNING])
      if (url === '/api/jobs/j1') {
        return json(200, {
          ...RUNNING,
          records: [],
          events_created: 0,
          feed_cursor: 0,
          record_years: [
            { coll: 'fda_records', year: 2024, n: 4 },
            { coll: 'trial_records', year: 2025, n: 9 },
            { coll: 'fda_records', year: 2010, n: 2 },
          ],
        })
      }
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
}

function renderTimeline() {
  const router = createMemoryRouter([{ path: '*', element: <PortfolioTimeline /> }], { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T09:00:00'))
  useEventSheet.setState({ current: null })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PortfolioTimeline', () => {
  it('shows primary rows with live build progress, and competitors on demand', async () => {
    serve()
    renderTimeline()
    const trep = await screen.findByRole('link', { name: /Treprostinil/ })
    await waitFor(() => expect(trep).toHaveTextContent('Building · 50%'))
    expect(trep).toHaveAttribute('href', '/assets/trep/overview')
    expect(screen.getByRole('link', { name: /Sotatercept/ })).toHaveTextContent('Merck')
    expect(screen.queryByRole('link', { name: /Nintedanib/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Show competitors' }))
    expect(screen.getByRole('link', { name: /Nintedanib/ })).toHaveTextContent('vs Treprostinil')
    expect(screen.getByRole('button', { name: /Ofev approved for PPF/ })).toBeInTheDocument()
  })

  it('filters dots by range: 3 years by default, ±1 year, all time; undated events are never drawn', async () => {
    serve()
    renderTimeline()
    expect(await screen.findByRole('button', { name: /Phase 3 trial started: TETON-1, Treprostinil, Mar 1, 2025/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TETON-2 readout expected, Treprostinil, expected Mar 2027/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /First patent filed/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '±1 year' }))
    expect(screen.queryByRole('button', { name: /TETON-1/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TETON-2/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'All time' }))
    expect(screen.getByRole('button', { name: /First patent filed, Sotatercept, May 21, 2005/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TETON-1/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Undated event/ })).not.toBeInTheDocument()
    expect(document.querySelector('[cx="NaN"]')).toBeNull()
  })

  it('shows a tooltip on hover and opens the event sheet on click or Enter', async () => {
    serve()
    renderTimeline()
    const dot = await screen.findByRole('button', { name: /Phase 3 trial started: TETON-1/ })
    await userEvent.hover(dot)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Treprostinil · Mar 1, 2025')
    await userEvent.click(dot)
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'e1' })
    act(() => useEventSheet.getState().closeEvent())
    fireEvent.keyDown(screen.getByRole('button', { name: /TETON-2/ }), { key: 'Enter' })
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'e2' })
  })

  it('fills the row of an asset being built with record ticks by year', async () => {
    serve()
    renderTimeline()
    await waitFor(() => expect(document.querySelectorAll('rect[data-record-tick]')).toHaveLength(2))
  })

  it('shows the empty and error states', async () => {
    serve(json(200, { assets: [], events: [] }))
    renderTimeline()
    expect(await screen.findByText('No assets yet')).toBeInTheDocument()
  })

  it('says when the timeline cannot be loaded', async () => {
    serve(json(500, { code: 'ERROR', message: 'down' }))
    renderTimeline()
    expect(await screen.findByText("The portfolio timeline couldn't be loaded.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/features/home/portfolio-scale.test.ts src/features/home/components/portfolio-timeline.test.tsx`
Expected: FAIL — `Failed to resolve import "./portfolio-scale"` and `"./portfolio-timeline"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/home/portfolio-scale.ts
import type { Significance } from '@/features/journey/types'

export type PortfolioRange = '1y' | '3y' | 'all'

export const RANGE_OPTIONS: { value: PortfolioRange; label: string }[] = [
  { value: '1y', label: '±1 year' },
  { value: '3y', label: '3 years' },
  { value: 'all', label: 'All time' },
]

/** Dot radius by significance (README §5.2). */
export const DOT_RADIUS: Record<Significance, number> = { High: 6.5, Medium: 5, Low: 3.6 }

const QUARTERS = ['Jan', 'Apr', 'Jul', 'Oct']

/**
 * Visible span in year fractions around `today`: ±1 year → [T−1, T+1.15], 3 years → [T−3, T+1.6] (the design's
 * windows); all time → every dated event, starting in 2000 at the latest and ending at least two years ahead.
 */
export function rangeBounds(range: PortfolioRange, today: number, dates: number[]): [number, number] {
  if (range === '1y') return [today - 1, today + 1.15]
  if (range === '3y') return [today - 3, today + 1.6]
  const finite = dates.filter(Number.isFinite)
  const from = Math.min(2000, ...finite.map((d) => Math.floor(d)))
  const to = Math.max(Math.ceil(today + 2), ...finite.map((d) => Math.ceil(d + 0.5)))
  return [from, to]
}

/** Axis ticks: quarters ("Jan ’26") for ±1 year, years for 3 years, every 2 or 4 years for all time. */
export function rangeTicks(range: PortfolioRange, y0: number, y1: number): { v: number; label: string }[] {
  const ticks: { v: number; label: string }[] = []
  if (range === '1y') {
    for (let q = Math.ceil(y0 * 4); q / 4 <= y1; q++) {
      ticks.push({ v: q / 4, label: `${QUARTERS[((q % 4) + 4) % 4]} ’${String(Math.floor(q / 4)).slice(2)}` })
    }
    return ticks
  }
  const step = range === '3y' ? 1 : y1 - y0 > 24 ? 4 : 2
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) ticks.push({ v: y, label: String(y) })
  return ticks
}
```

```tsx
// file: apps/web/src/features/home/components/portfolio-timeline.tsx
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { Segmented } from '@/features/assets/components/segmented'
import { useJobProgress, useJobs, type Job } from '@/features/jobs/api'
import { jobProgress, runningByAsset } from '@/features/jobs/steps'
import { CATEGORIES, CATEGORY_META, COLLECTION_META, collectionMeta } from '@/features/journey/constants'
import type { JourneyEventV3 } from '@/features/journey/types'
import { formatDay, formatMonth, todayIso, yearFraction } from '@/lib/dates'
import { useElementWidth } from '@/lib/use-element-width'
import { useEventSheet } from '@/stores/event-sheet-store'
import { eventsByAsset, usePortfolioTimeline, type PortfolioAsset } from '../api'
import { DOT_RADIUS, RANGE_OPTIONS, rangeBounds, rangeTicks, type PortfolioRange } from '../portfolio-scale'

const ROW = 46
const RIGHT_PAD = 14
const MIN_WIDTH = 300
const COLLECTIONS = Object.keys(COLLECTION_META)

const keyOf = (e: JourneyEventV3) => `${e.asset}|${e.id}`
const whenLabel = (e: JourneyEventV3) => (e.is_milestone ? `expected ${formatMonth(e.date)}` : formatDay(e.date))

/** Home "Portfolio timeline" (README §5.2): every tracked journey on one axis; a dot opens the event sheet. */
export function PortfolioTimeline() {
  const running = runningByAsset(useJobs({ status: 'running' }).data)
  const portfolio = usePortfolioTimeline({ live: running.size > 0 })
  const [range, setRange] = useState<PortfolioRange>('3y')
  const [showCompetitors, setShowCompetitors] = useState(false)
  const data = portfolio.data
  const rows = (data?.assets ?? []).filter((a) => a.kind === 'primary' || showCompetitors)

  return (
    <Panel
      title="Portfolio timeline"
      description="Every journey on one axis. Hollow markers are expected milestones; select one to see its evidence."
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
            <Switch checked={showCompetitors} onCheckedChange={setShowCompetitors} aria-label="Show competitors" />
            Show competitors
          </label>
          <Segmented label="Range" value={range} options={RANGE_OPTIONS} onChange={setRange} />
        </div>
      }
    >
      {portfolio.isPending && (
        <div className="space-y-2 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {portfolio.isError && <p className="p-5 text-destructive">The portfolio timeline couldn't be loaded.</p>}
      {data && rows.length === 0 && <EmptyState title="No assets yet">Add a drug by name with Asset AI to see its journey here.</EmptyState>}
      {data && rows.length > 0 && (
        <>
          <PortfolioPlot assets={data.assets} rows={rows} events={data.events} range={range} running={running} />
          <Legend />
        </>
      )}
    </Panel>
  )
}

/** Mounted with data, so the width is measured on the element that is actually drawn. */
function PortfolioPlot({
  assets,
  rows,
  events,
  range,
  running,
}: {
  assets: PortfolioAsset[]
  rows: PortfolioAsset[]
  events: JourneyEventV3[]
  range: PortfolioRange
  running: Map<string, Job>
}) {
  const openEvent = useEventSheet((s) => s.openEvent)
  const [hover, setHover] = useState<string | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(plotRef)

  const names = new Map(assets.map((a) => [a.id, a.name]))
  const today = yearFraction(todayIso())
  const dated = events.filter((e) => Number.isFinite(yearFraction(e.date)))
  const [y0, y1] = rangeBounds(range, today, dated.map((e) => yearFraction(e.date)))
  const inView = eventsByAsset(
    dated.filter((e) => {
      const v = yearFraction(e.date)
      return v >= y0 && v <= y1
    }),
  )
  const ticks = rangeTicks(range, y0, y1)
  const W = Math.max(width, MIN_WIDTH)
  const plotH = rows.length * ROW
  const x = (v: number) => ((v - y0) / (y1 - y0)) * (W - RIGHT_PAD)
  const tx = x(today)
  const hovered = hover ? dated.find((e) => keyOf(e) === hover) : undefined
  const hoveredRow = hovered ? rows.findIndex((a) => a.id === hovered.asset) : -1

  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] py-3 pr-4 pl-1 sm:grid-cols-[210px_minmax(0,1fr)]">
      <div className="flex flex-col pb-6">
        {rows.map((a) => (
          <RowLabel key={a.id} asset={a} job={running.get(a.id)} names={names} />
        ))}
      </div>
      <div ref={plotRef} className="relative min-w-0">
        <svg width={W} height={plotH + 24} className="block overflow-visible" role="group" aria-label="Portfolio events">
          <defs>
            <pattern id="portfolio-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#eef0f3" strokeWidth="2" />
            </pattern>
          </defs>
          {rows.map((a, i) => (
            <rect key={a.id} x={0} y={i * ROW} width={W - RIGHT_PAD} height={ROW} fill={i % 2 ? '#fff' : '#fafbfc'} />
          ))}
          <rect x={tx} y={0} width={Math.max(0, W - RIGHT_PAD - tx)} height={plotH} fill="url(#portfolio-hatch)" />
          {ticks.map((t) => (
            <line key={t.v} x1={x(t.v)} x2={x(t.v)} y1={0} y2={plotH} stroke="#eef0f3" />
          ))}
          {rows.map((a, i) => {
            const cy = i * ROW + ROW / 2
            const job = running.get(a.id)
            return (
              <g key={a.id}>
                <line x1={0} x2={W - RIGHT_PAD} y1={cy} y2={cy} stroke="#e4e7ec" strokeDasharray={a.kind === 'competitor' ? '2 3' : undefined} />
                {job && <RecordTicks jobId={job.id} cy={cy} x={x} y0={y0} y1={y1} />}
                {(inView.get(a.id) ?? []).map((e) => (
                  <Dot
                    key={keyOf(e)}
                    event={e}
                    assetName={a.name}
                    cx={x(yearFraction(e.date))}
                    cy={cy}
                    active={hover === keyOf(e)}
                    onHover={setHover}
                    onOpen={() => openEvent(e.asset, e.id)}
                  />
                ))}
              </g>
            )
          })}
          <line x1={tx} x2={tx} y1={0} y2={plotH + 4} stroke="#101828" strokeDasharray="3 3" />
          {ticks
            .filter((t) => Math.abs(x(t.v) - tx) > 34)
            .map((t) => (
              <text key={t.v} x={x(t.v)} y={plotH + 18} textAnchor="middle" className="fill-muted-foreground font-mono text-[10.5px]">
                {t.label}
              </text>
            ))}
          <text x={tx} y={plotH + 18} textAnchor="middle" className="fill-foreground text-[10.5px] font-semibold">
            Today
          </text>
        </svg>
        {hovered && hoveredRow >= 0 && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-20 flex w-max max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+8px)] flex-col rounded-lg bg-foreground px-2.5 py-[7px] text-[12px] leading-snug text-white"
            style={{ left: x(yearFraction(hovered.date)), top: hoveredRow * ROW + ROW / 2 - 8 }}
          >
            <b className="font-medium">{hovered.title}</b>
            <span className="text-[11.5px] text-[#c3c9d4]">
              {names.get(hovered.asset) ?? hovered.asset} · {whenLabel(hovered)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function RowLabel({ asset, job, names }: { asset: PortfolioAsset; job?: Job; names: Map<string, string> }) {
  const sub =
    asset.kind === 'competitor'
      ? asset.competitorOf.length
        ? `vs ${asset.competitorOf.map((id) => names.get(id) ?? id).join(', ')}`
        : 'Competitor'
      : (asset.company ?? '')
  return (
    <Link to={`/assets/${encodeURIComponent(asset.id)}/overview`} style={{ height: ROW }} className="flex items-center gap-2.5 rounded-lg px-3 transition-colors hover:bg-accent">
      <AssetTile name={asset.name} kind={asset.kind} size={26} />
      <span className="flex min-w-0 flex-col">
        <b className="truncate font-semibold">{asset.name}</b>
        <span className="truncate text-[12px] text-muted-foreground max-sm:hidden">
          {job ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-warning">
              <i aria-hidden="true" className="size-1.5 animate-blink-dot rounded-full bg-current" />
              Building · {Math.round(jobProgress(job) * 100)}%
            </span>
          ) : (
            sub
          )}
        </span>
      </span>
    </Link>
  )
}

function Dot({
  event: e,
  assetName,
  cx,
  cy,
  active,
  onHover,
  onOpen,
}: {
  event: JourneyEventV3
  assetName: string
  cx: number
  cy: number
  active: boolean
  onHover: (key: string | null) => void
  onOpen: () => void
}) {
  const color = CATEGORY_META[e.category]?.color ?? '#98a2b3'
  const r = DOT_RADIUS[e.significance] ?? DOT_RADIUS.Low
  const key = keyOf(e)
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${e.title}, ${assetName}, ${whenLabel(e)}`}
      className="cursor-pointer outline-none"
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(key)}
      onBlur={() => onHover(null)}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          onOpen()
        }
      }}
    >
      <circle
        cx={cx}
        cy={cy}
        r={active ? r + 2 : r}
        fill={e.is_milestone ? '#fff' : color}
        stroke={active ? '#101828' : e.is_milestone ? color : '#fff'}
        strokeWidth={e.is_milestone ? 1.8 : 1.5}
        strokeDasharray={e.is_milestone ? '2.4 1.8' : undefined}
      />
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
    </g>
  )
}

/**
 * Key events only exist once a crawl's finalize step has run, so while an asset is being built its row shows the
 * records collected so far, by year and collection (GET /jobs/:id `record_years`), refreshed every 2 s.
 */
function RecordTicks({ jobId, cy, x, y0, y1 }: { jobId: string; cy: number; x: (v: number) => number; y0: number; y1: number }) {
  const job = useJobProgress(jobId)
  const years = (job.data?.record_years ?? []).filter((r) => r.year + 0.5 >= y0 && r.year + 0.5 <= y1)
  const max = Math.max(1, ...years.map((r) => r.n))
  return (
    <g aria-hidden="true">
      {years.map((r) => {
        const h = 4 + (r.n / max) * 14
        const slot = Math.max(0, COLLECTIONS.indexOf(r.coll))
        return (
          <rect
            key={`${r.coll}-${r.year}`}
            data-record-tick=""
            x={x(r.year + 0.5) + (slot - 4) * 2.2}
            y={cy - h / 2}
            width={1.6}
            height={h}
            fill={collectionMeta(r.coll).color}
            opacity={0.55}
            className="animate-fade"
          />
        )
      })}
    </g>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3.5 px-5 pt-1 pb-3.5 text-[12px] text-text-secondary sm:pl-[226px]">
      {CATEGORIES.map((c) => (
        <span key={c} className="flex items-center gap-1.5">
          <i aria-hidden="true" className="size-2 rounded-full" style={{ background: CATEGORY_META[c].color }} />
          {CATEGORY_META[c].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <i aria-hidden="true" className="size-2 rounded-full border-[1.5px] border-dashed border-text-secondary bg-card" />
        Expected
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && npx vitest run src/features/home/portfolio-scale.test.ts src/features/home/components/portfolio-timeline.test.tsx && npx tsc -b`
Expected: PASS (5 scale tests, 6 timeline tests); `tsc` silent.

---

### Task 9: Home lists — What changed, Next milestones, Competitive signals

**Files:**
- Create: `apps/web/src/features/home/home-data.ts`
- Create: `apps/web/src/features/home/components/list-skeleton.tsx`
- Create: `apps/web/src/features/home/components/what-changed.tsx`
- Create: `apps/web/src/features/home/components/next-milestones.tsx`
- Create: `apps/web/src/features/home/components/competitive-signals.tsx`
- Test: `apps/web/src/features/home/home-data.test.ts`, `apps/web/src/features/home/components/home-lists.test.tsx`

**Interfaces:**
- Consumes: `usePortfolioTimeline` (Task 3); `useEventSheet.openEvent`, `AssetTile` (Task 1); `CATEGORY_META`, `JourneyEventV3` (Phase 0); `daysBetween`, `formatDay`, `formatMonth`, `relativeFuture`, `todayIso` (`@/lib/dates`); `CategoryIcon`, `SignificanceBadge`, `Panel`, `EmptyState`, `Skeleton` (existing).
- Produces:
  - `home-data.ts`: `interface EventGroup { label: string; events: JourneyEventV3[] }`, `interface HomeCounts { new30; high30; new90; next6m; next12m }`, `whatChanged(events, today: string): EventGroup[]`, `upcomingMilestones(events, today, limit = 6)`, `homeCounts(events, today): HomeCounts`, `competitorMoves(events, isCompetitor: (assetId: string) => boolean, limit = 8)`, `proximity(days: number): number` (bar width %).
  - Components `WhatChanged()`, `NextMilestones()`, `CompetitiveSignals()`, `ListSkeleton({ rows?: number })` — no props otherwise; each reads the portfolio query.

- [ ] **Step 1: Write the failing tests**

```ts
// file: apps/web/src/features/home/home-data.test.ts
import type { JourneyEventV3 } from '@/features/journey/types'
import { competitorMoves, homeCounts, proximity, upcomingMilestones, whatChanged } from './home-data'

const TODAY = '2026-10-09'
const ev = (id: string, asset: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset,
  date,
  type: 'approval',
  category: 'regulatory',
  title: id,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
  ...extra,
})

const EVENTS = [
  ev('d1', 'trep', '2026-10-05'),
  ev('d2', 'sota', '2026-09-20', { significance: 'Medium' }),
  ev('d3', 'nint', '2026-08-01', { significance: 'Medium' }),
  ev('old', 'trep', '2026-01-01'),
  ev('low', 'trep', '2026-10-01', { significance: 'Low' }),
  ev('m1', 'trep', '2026-12-01', { is_milestone: true, significance: 'Medium' }),
  ev('m2', 'sota', '2027-03-31', { is_milestone: true }),
  ev('m3', 'nint', '2028-01-01', { is_milestone: true }),
  ev('stale', 'sota', '2026-09-01', { is_milestone: true }),
  ev('undated', 'trep', ''),
  ev('partial', 'trep', '2026-10'),
]

describe('home data', () => {
  it('groups the last 90 days of High and Medium events by recency, newest first', () => {
    expect(whatChanged(EVENTS, TODAY).map((g) => [g.label, g.events.map((e) => e.id)])).toEqual([
      ['Last 7 days', ['d1']],
      ['Last 30 days', ['partial', 'd2']],
      ['Last 90 days', ['d3']],
    ])
  })

  it('lists expected milestones from today on, soonest first', () => {
    expect(upcomingMilestones(EVENTS, TODAY).map((e) => e.id)).toEqual(['m1', 'm2', 'm3'])
    expect(upcomingMilestones(EVENTS, TODAY, 2).map((e) => e.id)).toEqual(['m1', 'm2'])
  })

  it('counts new events and upcoming milestones, ignoring undated events and past milestones', () => {
    expect(homeCounts(EVENTS, TODAY)).toEqual({ new30: 4, high30: 2, new90: 5, next6m: 2, next12m: 2 })
  })

  it('lists competitor moves newest first', () => {
    expect(competitorMoves(EVENTS, (id) => id === 'nint').map((e) => e.id)).toEqual(['m3', 'd3'])
  })

  it('turns days to go into a proximity bar width', () => {
    expect(proximity(0)).toBe(100)
    expect(proximity(274)).toBe(50)
    expect(proximity(548)).toBe(4)
    expect(proximity(-10)).toBe(100)
  })
})
```

The `partial` event (`2026-10`, parsed as Oct 1) is 8 days old and High: it lands in "Last 30 days" and counts in `new30`/`high30`/`new90`.

```tsx
// file: apps/web/src/features/home/components/home-lists.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { JourneyEventV3 } from '@/features/journey/types'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { PortfolioTimeline } from '../api'
import { CompetitiveSignals } from './competitive-signals'
import { NextMilestones } from './next-milestones'
import { WhatChanged } from './what-changed'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const src = (n: number) => ({ collection: 'articles', record_key: `https://news.example/${n}` })
const ev = (id: string, asset: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset,
  date,
  type: 'approval',
  category: 'regulatory',
  title: id,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
  key: true,
  ...extra,
})

const PORTFOLIO: PortfolioTimeline = {
  assets: [
    { id: 'trep', name: 'Treprostinil', kind: 'primary', company: 'United Therapeutics', status: 'ready', progress: null, competitorOf: [] },
    { id: 'sota', name: 'Sotatercept', kind: 'primary', company: 'Merck', status: 'ready', progress: null, competitorOf: [] },
    { id: 'nint', name: 'Nintedanib', kind: 'competitor', company: 'Boehringer Ingelheim', status: 'ready', progress: null, competitorOf: ['trep'] },
  ],
  events: [
    ev('d1', 'trep', '2026-10-05', { title: 'FDA accepts Tyvaso sNDA for IPF', via: 'ai_events', sources: [src(1), src(2), src(3), src(4)] }),
    ev('d2', 'sota', '2026-09-20', { title: 'HYPERION results presented', significance: 'Medium', category: 'clinical' }),
    ev('d3', 'nint', '2026-08-01', { title: 'Ofev included in Medicare negotiation', significance: 'Medium', category: 'company' }),
    ev('old', 'trep', '2026-01-01', { title: 'Old news' }),
    ev('m1', 'trep', '2026-12-01', { title: 'TETON-2 readout', is_milestone: true, significance: 'Medium', category: 'clinical' }),
    ev('m2', 'sota', '2027-03-31', { title: 'EU decision expected', is_milestone: true }),
    ev('m3', 'nint', '2028-01-01', { title: 'Ofev patent expiry', is_milestone: true, category: 'ip' }),
  ],
}

function renderWith(ui: ReactElement, portfolio: PortfolioTimeline = PORTFOLIO) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url === '/api/portfolio/timeline?competitors=true' ? json(200, portfolio) : json(404, { code: 'NOT_FOUND', message: url }))),
  )
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T09:00:00'))
  useEventSheet.setState({ current: null })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('WhatChanged', () => {
  it('groups key events by recency, tags competitors and AI events, and opens the sheet', async () => {
    renderWith(<WhatChanged />)
    const week = await screen.findByRole('region', { name: 'Last 7 days' })
    const title = within(week).getByRole('button', { name: 'FDA accepts Tyvaso sNDA for IPF' })
    expect(week).toHaveTextContent('AI · 4 sources')
    expect(week).toHaveTextContent('Oct 5, 2026')
    expect(within(week).getByRole('link', { name: 'Treprostinil' })).toHaveAttribute('href', '/assets/trep/overview')
    expect(within(screen.getByRole('region', { name: 'Last 30 days' })).getByText('HYPERION results presented')).toBeInTheDocument()
    const quarter = screen.getByRole('region', { name: 'Last 90 days' })
    expect(quarter).toHaveTextContent('Ofev included in Medicare negotiation')
    expect(within(quarter).getByText('Competitor')).toBeInTheDocument()
    expect(screen.queryByText('Old news')).not.toBeInTheDocument()
    await userEvent.click(title)
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'd1' })
  })

  it('reads "Quiet quarter" when nothing changed', async () => {
    renderWith(<WhatChanged />, { ...PORTFOLIO, events: [] })
    expect(await screen.findByText('Quiet quarter')).toBeInTheDocument()
    expect(screen.getByText('No new key events in the last 90 days.')).toBeInTheDocument()
  })
})

describe('NextMilestones', () => {
  it('lists milestones soonest first with a countdown, and opens the sheet', async () => {
    renderWith(<NextMilestones />)
    const items = await screen.findAllByRole('button', { name: /readout|decision|expiry/ })
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringContaining('TETON-2 readout'),
      expect.stringContaining('EU decision expected'),
      expect.stringContaining('Ofev patent expiry'),
    ])
    expect(items[0]).toHaveTextContent('Dec2026')
    expect(items[0]).toHaveTextContent('in 2 months')
    await userEvent.click(items[1])
    expect(useEventSheet.getState().current).toEqual({ assetId: 'sota', eventId: 'm2' })
  })
})

describe('CompetitiveSignals', () => {
  it('lists competitor moves newest first with the primaries they compete with', async () => {
    renderWith(<CompetitiveSignals />)
    const rows = await screen.findAllByRole('button', { name: /Ofev/ })
    expect(rows[0]).toHaveTextContent('Ofev patent expiry')
    expect(rows[0]).toHaveTextContent('expected Jan 2028')
    expect(rows[1]).toHaveTextContent('Ofev included in Medicare negotiation')
    expect(rows[1]).toHaveTextContent('vs Treprostinil')
    expect(rows[1]).toHaveTextContent('Aug 1, 2026')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/features/home/home-data.test.ts src/features/home/components/home-lists.test.tsx`
Expected: FAIL — `Failed to resolve import "./home-data"`, `"./competitive-signals"`.

- [ ] **Step 3: Implement**

```ts
// file: apps/web/src/features/home/home-data.ts
import type { JourneyEventV3 } from '@/features/journey/types'
import { daysBetween } from '@/lib/dates'

export interface EventGroup {
  label: string
  events: JourneyEventV3[]
}

export interface HomeCounts {
  /** Events dated in the last 30 days, and how many of them are High. */
  new30: number
  high30: number
  new90: number
  /** Expected milestones in the next 6 and 12 months. */
  next6m: number
  next12m: number
}

const BANDS: [label: string, from: number, to: number][] = [
  ['Last 7 days', 0, 7],
  ['Last 30 days', 8, 30],
  ['Last 90 days', 31, 90],
]

/** Days from `today` to the event (negative = past); NaN when undated, so every comparison is false. */
const offset = (e: { date: string }, today: string) => daysBetween(today, e.date)

/** "What changed": past High and Medium events of the last 90 days, newest first, grouped Last 7 / 30 / 90 days. */
export function whatChanged(events: JourneyEventV3[], today: string): EventGroup[] {
  const recent = events
    .map((e) => ({ e, ago: -offset(e, today) }))
    .filter(({ e, ago }) => ago >= 0 && ago <= 90 && !e.is_milestone && e.significance !== 'Low')
    .sort((a, b) => a.ago - b.ago)
  return BANDS.map(([label, from, to]) => ({ label, events: recent.filter((r) => r.ago >= from && r.ago <= to).map((r) => r.e) })).filter(
    (g) => g.events.length > 0,
  )
}

/** Expected milestones from today on, soonest first. */
export function upcomingMilestones(events: JourneyEventV3[], today: string, limit = 6): JourneyEventV3[] {
  return events
    .filter((e) => e.is_milestone && offset(e, today) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
}

/** The hero sentence and KPI strip numbers, over the same events the Home timeline shows. */
export function homeCounts(events: JourneyEventV3[], today: string): HomeCounts {
  const counts: HomeCounts = { new30: 0, high30: 0, new90: 0, next6m: 0, next12m: 0 }
  for (const e of events) {
    const d = offset(e, today)
    if (!Number.isFinite(d)) continue
    if (e.is_milestone) {
      if (d >= 0 && d <= 183) counts.next6m++
      if (d >= 0 && d <= 365) counts.next12m++
    } else if (d <= 0) {
      if (d >= -30) {
        counts.new30++
        if (e.significance === 'High') counts.high30++
      }
      if (d >= -90) counts.new90++
    }
  }
  return counts
}

/** Dated events of competitor assets, newest first. */
export function competitorMoves(events: JourneyEventV3[], isCompetitor: (assetId: string) => boolean, limit = 8): JourneyEventV3[] {
  return events
    .filter((e) => isCompetitor(e.asset) && /^\d{4}/.test(e.date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}

/** Width (%) of a milestone's proximity bar: full today, 4% at 18 months or more. */
export function proximity(days: number): number {
  return Math.min(100, Math.max(4, 100 - (days / 548) * 100))
}
```

```tsx
// file: apps/web/src/features/home/components/list-skeleton.tsx
import { Skeleton } from '@/components/ui/skeleton'

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}
```

```tsx
// file: apps/web/src/features/home/components/what-changed.tsx
import { Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import type { JourneyEventV3 } from '@/features/journey/types'
import { formatDay, todayIso } from '@/lib/dates'
import { useEventSheet } from '@/stores/event-sheet-store'
import { usePortfolioTimeline, type PortfolioAsset } from '../api'
import { whatChanged } from '../home-data'
import { ListSkeleton } from './list-skeleton'

/** Home "What changed" (README §5.2): key High/Medium events of the last 90 days across assets and competitors. */
export function WhatChanged() {
  const portfolio = usePortfolioTimeline()
  const openEvent = useEventSheet((s) => s.openEvent)
  const assets = new Map((portfolio.data?.assets ?? []).map((a) => [a.id, a]))
  const groups = portfolio.data ? whatChanged(portfolio.data.events, todayIso()) : []

  return (
    <Panel title="What changed" description="High- and medium-significance events across your assets and their competitors" bodyClassName="py-1">
      {portfolio.isPending && <ListSkeleton />}
      {portfolio.isError && <p className="p-5 text-destructive">Recent events couldn't be loaded.</p>}
      {portfolio.data && groups.length === 0 && <EmptyState title="Quiet quarter">No new key events in the last 90 days.</EmptyState>}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="py-1">
          <p className="mx-5 mt-2.5 mb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{g.label}</p>
          <ul>
            {g.events.map((e) => (
              <ChangeRow key={`${e.asset}|${e.id}`} event={e} asset={assets.get(e.asset)} onOpen={() => openEvent(e.asset, e.id)} />
            ))}
          </ul>
        </section>
      ))}
    </Panel>
  )
}

function ChangeRow({ event: e, asset, onOpen }: { event: JourneyEventV3; asset?: PortfolioAsset; onOpen: () => void }) {
  return (
    <li className="flex animate-fade-up items-center gap-3 px-5 py-2.5 transition-colors hover:bg-background">
      <CategoryIcon category={e.category} className="size-[30px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <button type="button" onClick={onOpen} className="text-left font-medium text-pretty hover:text-primary">
          {e.title}
        </button>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
          {asset && (
            <Link to={`/assets/${encodeURIComponent(asset.id)}/overview`} className="inline-flex items-center gap-1.5 font-medium text-secondary-foreground hover:text-primary">
              <AssetTile name={asset.name} kind={asset.kind} size={16} />
              {asset.name}
            </Link>
          )}
          {asset?.kind === 'competitor' && <span className="rounded-[5px] bg-muted px-1.5 py-px text-[11px] text-secondary-foreground">Competitor</span>}
          <span className="font-mono">{formatDay(e.date)}</span>
          {e.via === 'ai_events' && (
            <span className="inline-flex items-center gap-1 text-violet">
              <Sparkles className="size-[11px]" />
              AI · {e.sources.length} source{e.sources.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      <SignificanceBadge value={e.significance} />
    </li>
  )
}
```

```tsx
// file: apps/web/src/features/home/components/next-milestones.tsx
import { AssetTile } from '@/features/assets/components/asset-tile'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { CATEGORY_META } from '@/features/journey/constants'
import { daysBetween, relativeFuture, todayIso } from '@/lib/dates'
import { useEventSheet } from '@/stores/event-sheet-store'
import { usePortfolioTimeline } from '../api'
import { proximity, upcomingMilestones } from '../home-data'
import { ListSkeleton } from './list-skeleton'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Home "Next milestones" (README §5.2): date block, title, asset, countdown and a proximity bar. */
export function NextMilestones() {
  const portfolio = usePortfolioTimeline()
  const openEvent = useEventSheet((s) => s.openEvent)
  const today = todayIso()
  const assets = new Map((portfolio.data?.assets ?? []).map((a) => [a.id, a]))
  const items = portfolio.data ? upcomingMilestones(portfolio.data.events, today) : []

  return (
    <Panel title="Next milestones" description="Readouts, regulatory decisions and patent expiries" bodyClassName="py-1">
      {portfolio.isPending && <ListSkeleton rows={3} />}
      {portfolio.isError && <p className="p-5 text-destructive">Milestones couldn't be loaded.</p>}
      {portfolio.data && items.length === 0 && (
        <EmptyState title="No upcoming milestones">Expected readouts and decisions appear here once they are in a journey.</EmptyState>
      )}
      <ul>
        {items.map((e) => {
          const asset = assets.get(e.asset)
          return (
            <li key={`${e.asset}|${e.id}`}>
              <button type="button" onClick={() => openEvent(e.asset, e.id)} className="flex w-full items-start gap-3.5 px-5 py-2.5 text-left transition-colors hover:bg-background">
                <span className="flex w-[46px] shrink-0 flex-col items-center rounded-[10px] border bg-card py-1">
                  <span className="text-[11px] font-semibold text-primary uppercase">{MONTHS[Number(e.date.slice(5, 7)) - 1] ?? ''}</span>
                  <b className="text-[14px] font-semibold tracking-tight">{e.date.slice(0, 4)}</b>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium text-pretty">{e.title}</span>
                  <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    {asset && <AssetTile name={asset.name} kind={asset.kind} size={16} />}
                    {asset?.name ?? e.asset}
                    <span className="ml-auto font-semibold text-primary">{relativeFuture(e.date, today)}</span>
                  </span>
                  <span className="h-[3px] overflow-hidden rounded-sm bg-accent">
                    <i
                      className="block h-full rounded-sm opacity-75"
                      style={{ width: `${proximity(daysBetween(today, e.date))}%`, background: CATEGORY_META[e.category]?.color }}
                    />
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
```

```tsx
// file: apps/web/src/features/home/components/competitive-signals.tsx
import { AssetTile } from '@/features/assets/components/asset-tile'
import { SignificanceBadge } from '@/features/assets/components/badges'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { formatDay, formatMonth } from '@/lib/dates'
import { useEventSheet } from '@/stores/event-sheet-store'
import { usePortfolioTimeline } from '../api'
import { competitorMoves } from '../home-data'
import { ListSkeleton } from './list-skeleton'

/** Home "Competitive signals" (README §5.2): competitor events with the primaries they compete with. */
export function CompetitiveSignals() {
  const portfolio = usePortfolioTimeline()
  const openEvent = useEventSheet((s) => s.openEvent)
  const assets = new Map((portfolio.data?.assets ?? []).map((a) => [a.id, a]))
  const moves = portfolio.data ? competitorMoves(portfolio.data.events, (id) => assets.get(id)?.kind === 'competitor') : []

  return (
    <Panel title="Competitive signals" description="Moves by competitors of your assets" bodyClassName="py-1">
      {portfolio.isPending && <ListSkeleton />}
      {portfolio.isError && <p className="p-5 text-destructive">Competitor events couldn't be loaded.</p>}
      {portfolio.data && moves.length === 0 && (
        <EmptyState title="No competitor moves yet">Competitors are tracked once Asset AI identifies them for one of your assets.</EmptyState>
      )}
      <ul>
        {moves.map((e) => {
          const asset = assets.get(e.asset)
          const name = asset?.name ?? e.asset
          const vs = (asset?.competitorOf ?? []).map((id) => assets.get(id)?.name ?? id).join(', ')
          return (
            <li key={`${e.asset}|${e.id}`}>
              <button type="button" onClick={() => openEvent(e.asset, e.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-background">
                <AssetTile name={name} kind="competitor" size={30} />
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="font-medium text-pretty">{e.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
                    <b className="font-medium text-secondary-foreground">{name}</b>
                    {vs && <span>vs {vs}</span>}
                    <span className="font-mono">{e.is_milestone ? `expected ${formatMonth(e.date)}` : formatDay(e.date)}</span>
                  </span>
                </span>
                <SignificanceBadge value={e.significance} />
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && npx vitest run src/features/home/home-data.test.ts src/features/home/components/home-lists.test.tsx && npx tsc -b`
Expected: PASS (5 data tests, 4 component tests); `tsc` silent.

---

### Task 10: Crawls card and segmented step bar

**Files:**
- Create: `apps/web/src/features/jobs/components/step-bar.tsx`
- Create: `apps/web/src/features/home/components/crawls-card.tsx`
- Test: `apps/web/src/features/home/components/crawls-card.test.tsx`

**Interfaces:**
- Consumes: `useJobs`, `isActive`, `Job` (existing); `useJobProgress` (Task 3); `JobProgress` (Phase 0 types); `jobProgress`, `jobStepLabel`, `stepsFinished`, `stepDuration`, `jobDuration`, `AssetTile` (Task 1); `JobStatusBadge` (existing, `features/jobs/jobs-pages.tsx`); `Panel`, `EmptyState`, `Button`, `Skeleton`, `formatNumber` (existing).
- Produces: `StepBar({ steps: JobStep[]; className?: string })` — `role="progressbar"` "Crawl steps", `aria-valuenow` = finished steps, one `<i data-status>` per step with `flex-grow` = `stepDuration(name)` (Phase 3 reuses it for the chat job card and build strip); `CrawlsCard()` — no props.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/home/components/crawls-card.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { Job, JobStep } from '@/features/jobs/api'
import { StepBar } from '@/features/jobs/components/step-bar'
import { CrawlsCard } from './crawls-card'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const job = (id: string, status: Job['status'], extra: Partial<Job> = {}): Job => ({
  id,
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status,
  steps: [],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: '2026-10-09T10:00:00Z',
  finished_at: '2026-10-09T10:00:42Z',
  ...extra,
})
const RUNNING = job('j1', 'running', {
  type: 'onboard',
  finished_at: null,
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running'), step('finalize', 'pending')],
})
const RECENT = [
  RUNNING,
  job('j2', 'completed', { asset: 'sota', assetName: 'Sotatercept' }),
  job('j3', 'failed', { asset: 'ensi', assetName: 'Ensifentrine' }),
  job('j4', 'completed_with_errors', { asset: 'dupi', assetName: 'Dupilumab', finished_at: '2026-10-09T10:03:05Z' }),
  job('j5', 'completed', { asset: 'old', assetName: 'Oldest' }),
]

function renderCard(running: Job[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/jobs?status=running') return json(200, running)
      if (url === '/api/jobs') return json(200, running.length ? RECENT : RECENT.slice(1))
      if (url === '/api/jobs/j1') {
        return json(200, { ...RUNNING, records: [{ coll: 'fda_records', count: 1000 }, { coll: 'trial_records', count: 234 }], events_created: 7, feed_cursor: 0, record_years: [] })
      }
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const router = createMemoryRouter([{ path: '*', element: <CrawlsCard /> }], { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('CrawlsCard', () => {
  it('shows the running crawl with its step, progress and counters, linking to the live build', async () => {
    renderCard([RUNNING])
    const live = await screen.findByRole('link', { name: /Watch the live build/ })
    expect(live).toHaveAttribute('href', '/assets/trep/overview?build=1')
    expect(live).toHaveTextContent('Treprostinil · onboarding')
    expect(live).toHaveTextContent('Step 3 of 4 · Rules engine')
    expect(live).toHaveTextContent('50%')
    expect(within(live).getByRole('progressbar', { name: 'Crawl steps' })).toHaveAttribute('aria-valuenow', '2')
    expect(await within(live).findByText('1,234')).toBeInTheDocument()
    expect(live).toHaveTextContent('1,234 records')
    expect(live).toHaveTextContent('7 events')
    expect(screen.getByText('Data collection running now')).toBeInTheDocument()
  })

  it('lists the last three finished jobs with their status and duration', async () => {
    renderCard([RUNNING])
    const sota = await screen.findByRole('link', { name: /Sotatercept/ })
    expect(sota).toHaveAttribute('href', '/jobs/j2')
    expect(sota).toHaveTextContent('Completed')
    expect(sota).toHaveTextContent('42s')
    expect(screen.getByRole('link', { name: /Ensifentrine/ })).toHaveTextContent('Failed')
    expect(screen.getByRole('link', { name: /Dupilumab/ })).toHaveTextContent('3m 05s')
    expect(screen.queryByRole('link', { name: /Oldest/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All jobs' })).toHaveAttribute('href', '/jobs')
  })

  it('says nothing is running when no crawl is active', async () => {
    renderCard([])
    expect(await screen.findByText('Nothing running right now')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Watch the live build/ })).not.toBeInTheDocument()
  })
})

describe('StepBar', () => {
  it('draws one segment per step, sized by its expected duration', () => {
    render(<StepBar steps={[step('regulatory', 'done'), step('ai_events', 'running'), step('finalize', 'pending')]} />)
    const bar = screen.getByRole('progressbar', { name: 'Crawl steps' })
    const segments = [...bar.querySelectorAll<HTMLElement>('[data-status]')]
    expect(segments.map((s) => s.dataset.status)).toEqual(['done', 'running', 'pending'])
    expect(segments.map((s) => s.style.flexGrow)).toEqual(['4', '5', '3'])
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '3')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/home/components/crawls-card.test.tsx`
Expected: FAIL — `Failed to resolve import "@/features/jobs/components/step-bar"`.

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/jobs/components/step-bar.tsx
import { cn } from '@/lib/utils'
import type { JobStep } from '../api'
import { stepDuration, stepsFinished } from '../steps'

const TONE: Record<JobStep['status'], string> = {
  pending: 'bg-accent',
  running: 'animate-blink-dot bg-primary/45',
  done: 'bg-primary',
  failed: 'bg-[#dc8a35]',
  skipped: 'bg-[#d0d5dd]',
}

/**
 * The design's segmented crawl bar: one segment per step, as wide as the step's expected duration. Jobs carry no
 * per-step progress, so the running segment blinks instead of filling.
 */
export function StepBar({ steps, className }: { steps: JobStep[]; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Crawl steps"
      aria-valuemin={0}
      aria-valuemax={steps.length}
      aria-valuenow={stepsFinished({ steps })}
      className={cn('flex h-1.5 gap-0.5', className)}
    >
      {steps.map((s, i) => (
        <i
          key={`${i}-${s.name}`}
          title={`${s.label}: ${s.status}`}
          data-status={s.status}
          className={cn('block min-w-[3px] rounded-[2px]', TONE[s.status])}
          style={{ flexGrow: stepDuration(s.name), flexBasis: 0 }}
        />
      ))}
    </div>
  )
}
```

```tsx
// file: apps/web/src/features/home/components/crawls-card.tsx
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { isActive, useJobProgress, useJobs, type Job } from '@/features/jobs/api'
import { StepBar } from '@/features/jobs/components/step-bar'
import { JobStatusBadge } from '@/features/jobs/jobs-pages'
import { jobDuration, jobProgress, jobStepLabel, stepsFinished } from '@/features/jobs/steps'
import type { JobProgress } from '@/features/journey/types'
import { formatNumber } from '@/lib/format'

const JOB_TYPE: Record<Job['type'], string> = { onboard: 'onboarding', refresh: 'refresh', competitor: 'competitor crawl' }

/** Home "Crawls" (README §5.2): the running crawl, live, and the last three finished jobs. */
export function CrawlsCard() {
  const running = useJobs({ status: 'running' })
  const recent = useJobs()
  const live = running.data?.[0]
  const progress = useJobProgress(live?.id ?? null)
  const finished = (recent.data ?? []).filter((j) => !isActive(j.status)).slice(0, 3)

  return (
    <Panel
      title="Crawls"
      description={live ? 'Data collection running now' : 'Nothing running right now'}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/jobs">All jobs</Link>
        </Button>
      }
      bodyClassName="p-3"
    >
      {live && <LiveJob job={live} progress={progress.data} />}
      {recent.isPending && <Skeleton className="h-9 w-full" />}
      {recent.isError && <p className="p-2 text-destructive">Crawl jobs couldn't be loaded.</p>}
      {recent.data && !live && finished.length === 0 && <EmptyState title="No crawls yet">Add an asset to start collecting its data.</EmptyState>}
      {finished.length > 0 && (
        <ul>
          {finished.map((j) => (
            <li key={j.id}>
              <Link to={`/jobs/${encodeURIComponent(j.id)}`} className="flex items-center gap-2.5 rounded-lg px-1 py-2 text-[12.5px] transition-colors hover:bg-background">
                <JobStatusBadge status={j.status} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {j.assetName ?? j.asset}
                  <span className="font-normal text-muted-foreground"> · {j.type}</span>
                </span>
                <span className="font-mono text-[11.5px] text-muted-foreground">{jobDuration(j)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function LiveJob({ job, progress }: { job: Job; progress?: JobProgress }) {
  const j = progress ?? job
  const n = j.steps.length
  const label = jobStepLabel(j)
  const name = j.assetName ?? j.asset
  const records = progress?.records.reduce((sum, r) => sum + r.count, 0) ?? 0
  return (
    <Link
      to={`/assets/${encodeURIComponent(j.asset)}/overview?build=1`}
      className="mb-1.5 flex flex-col gap-2.5 rounded-xl border border-[#d5ddfa] bg-linear-to-b from-[#f6f8fe] to-card px-3.5 py-3 transition-colors hover:border-primary"
    >
      <span className="flex items-center gap-2.5">
        <AssetTile name={name} kind={j.type === 'competitor' ? 'competitor' : 'primary'} size={26} />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="font-semibold">
            {name} · {JOB_TYPE[j.type]}
          </b>
          <span className="truncate text-[12px] text-text-secondary">
            {label === 'planning' ? `Planning ${n} steps` : `Step ${Math.min(n, stepsFinished(j) + 1)} of ${n} · ${label}`}
          </span>
        </span>
        <span className="font-mono text-[15px] font-semibold text-primary">{Math.round(jobProgress(j) * 100)}%</span>
      </span>
      <StepBar steps={j.steps} />
      {progress && (
        <span className="flex gap-4 text-[12px] text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground tabular-nums">{formatNumber(records)}</b> records
          </span>
          <span>
            <b className="font-semibold text-foreground tabular-nums">{formatNumber(progress.events_created)}</b> events
          </span>
        </span>
      )}
      <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary">
        Watch the live build <ArrowRight className="size-[13px]" />
      </span>
    </Link>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/home/components/crawls-card.test.tsx && npx tsc -b`
Expected: PASS (4 tests); `tsc` silent.

---

### Task 11: Asset card (sparkline) and Tracked assets

**Files:**
- Create: `apps/web/src/features/assets/components/sparkline.tsx`
- Create: `apps/web/src/features/assets/components/asset-card.tsx`
- Create: `apps/web/src/features/home/components/tracked-assets.tsx`
- Test: `apps/web/src/features/assets/components/asset-card.test.tsx`, `apps/web/src/features/home/components/tracked-assets.test.tsx`

**Interfaces:**
- Consumes: `AssetTile`, `jobProgress`, `runningByAsset` (Task 1); `useAssets`, `useAssetDetails`, `AssetSummary` (Task 3 / existing); `usePortfolioTimeline`, `eventsByAsset` (Task 3); `KindBadge` (Phase 0); `JourneyEventV3`; `daysBetween`, `relativeFuture`, `todayIso`, `formatNumber`; `useJobs`, `EmptyState`, `Button`, `Skeleton`.
- Produces:
  - `Sparkline({ events: { date: string }[]; thisYear: number })` — `role="img"` "Key events per year, <from>–<to>", 13 bars `thisYear−11 … thisYear+1`, `rect[data-year][data-count]`.
  - `AssetStatusPill({ asset: Pick<AssetSummary,'status'>; progress: number | null; regions?: string[]; variant: 'home' | 'search' })` — "Collecting · n%" (search) / "n%" (home) while a crawl runs, "Collecting", "Collection failed", regions (home) or "Ready".
  - `AssetCard({ asset; events: JourneyEventV3[]; progress: number | null; regions?: string[]; competitors?: number; variant: 'home' | 'search'; index?: number })` — a link to `/assets/:id/overview`. Task 13 uses `variant="search"`.
  - `TrackedAssets()` — Home section with heading "Tracked assets".

- [ ] **Step 1: Write the failing tests**

```tsx
// file: apps/web/src/features/assets/components/asset-card.test.tsx
import { render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { JourneyEventV3 } from '@/features/journey/types'
import type { AssetSummary } from '../api'
import { AssetCard, AssetStatusPill } from './asset-card'

const ZERO = { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 }
const TREP: AssetSummary = {
  id: 'trep',
  name: 'Treprostinil',
  aliases: ['Tyvaso', 'Remodulin'],
  company: { name: 'United Therapeutics' },
  tags: { indications: ['PAH'], investigational_indications: ['IPF'] },
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: { ...ZERO, trials: 74, events: 909 },
  latestEvent: { date: '2026-10-05', title: 'Study highlights inhaled treprostinil in IPF', type: 'publication' },
  competitorOf: [],
}
const NINT: AssetSummary = {
  ...TREP,
  id: 'nint',
  name: 'Nintedanib',
  aliases: ['Ofev'],
  company: { name: 'Boehringer Ingelheim' },
  tags: { indications: ['IPF', 'PPF'] },
  kind: 'competitor',
  counts: ZERO,
  latestEvent: null,
  competitorOf: [{ id: 'trep', name: 'Treprostinil' }],
}
const ev = (id: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date,
  type: 'approval',
  category: 'regulatory',
  title: id,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
  ...extra,
})
const EVENTS = [ev('a', '2026-02-01'), ev('b', '2026-05-01'), ev('c', '2024-03-01'), ev('m', '2026-12-01', { is_milestone: true }), ev('n', '2027-06-01', { is_milestone: true })]

const wrap = (ui: ReactElement) =>
  render(
    <TooltipProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </TooltipProvider>,
  )

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T09:00:00'))
})
afterEach(() => vi.useRealTimers())

describe('AssetCard', () => {
  it('home: brand and company, regions, indications, sparkline, latest event and footer', () => {
    wrap(<AssetCard asset={TREP} events={EVENTS} progress={null} regions={['US', 'EU']} competitors={1} variant="home" />)
    const card = screen.getByRole('link', { name: /Treprostinil/ })
    expect(card).toHaveAttribute('href', '/assets/trep/overview')
    expect(card).toHaveTextContent('Tyvaso · United Therapeutics')
    expect(card).toHaveTextContent('US, EU')
    expect(within(card).getByText('IPF')).toHaveClass('border-dashed')
    expect(card).toHaveTextContent('Study highlights inhaled treprostinil in IPF')
    expect(card).toHaveTextContent('909 events')
    expect(card).toHaveTextContent('74 trials')
    expect(card).toHaveTextContent('1 competitor')
    expect(card).toHaveTextContent('in 2 months')
    const spark = within(card).getByRole('img', { name: 'Key events per year, 2015–2027' })
    expect(spark.querySelectorAll('rect')).toHaveLength(13)
    expect(spark.querySelector('[data-year="2026"]')).toHaveAttribute('data-count', '3')
    expect(spark.querySelector('[data-year="2024"]')).toHaveAttribute('data-count', '1')
    expect(spark.querySelector('[data-year="2027"]')).toHaveAttribute('data-count', '1')
  })

  it('search: kind badge, rivals, company only, Ready', () => {
    wrap(<AssetCard asset={NINT} events={[]} progress={null} variant="search" />)
    const card = screen.getByRole('link', { name: /Nintedanib/ })
    expect(within(card).getByText('Competitor')).toBeInTheDocument()
    expect(card).toHaveTextContent('vs Treprostinil')
    expect(card).toHaveTextContent('Boehringer Ingelheim')
    expect(card).not.toHaveTextContent('Ofev ·')
    expect(card).toHaveTextContent('Ready')
    expect(card).toHaveTextContent('Latest—')
  })
})

describe('AssetStatusPill', () => {
  it('reads the crawl state', () => {
    const { rerender } = wrap(<AssetStatusPill asset={{ status: 'ready' }} progress={0.5} variant="search" />)
    expect(screen.getByText('Collecting · 50%')).toBeInTheDocument()
    rerender(<AssetStatusPill asset={{ status: 'ready' }} progress={0.5} variant="home" />)
    expect(screen.getByText('50%')).toBeInTheDocument()
    rerender(<AssetStatusPill asset={{ status: 'onboarding' }} progress={null} variant="search" />)
    expect(screen.getByText('Collecting')).toBeInTheDocument()
    rerender(<AssetStatusPill asset={{ status: 'failed' }} progress={null} variant="search" />)
    expect(screen.getByText('Collection failed')).toBeInTheDocument()
    rerender(<AssetStatusPill asset={{ status: 'ready' }} progress={null} regions={[]} variant="home" />)
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })
})
```

```tsx
// file: apps/web/src/features/home/components/tracked-assets.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AssetSummary } from '@/features/assets/api'
import { TrackedAssets } from './tracked-assets'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ZERO = { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 }
const asset = (id: string, name: string, kind: AssetSummary['kind'], competitorOf: AssetSummary['competitorOf'] = []): AssetSummary => ({
  id,
  name,
  aliases: [],
  company: { name: 'Co' },
  tags: {},
  kind,
  status: 'ready',
  updatedAt: null,
  counts: ZERO,
  latestEvent: null,
  competitorOf,
})

function renderSection(assets: AssetSummary[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/assets') return json(200, assets)
      if (url === '/api/portfolio/timeline?competitors=true') return json(200, { assets: [], events: [] })
      if (url === '/api/jobs?status=running') return json(200, [])
      if (url === '/api/assets/trep') return json(200, { id: 'trep', kpis: { approvalRegions: ['US', 'EU'] } })
      if (url === '/api/assets/sota') return json(200, { id: 'sota', kpis: { approvalRegions: ['US'] } })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const router = createMemoryRouter([{ path: '*', element: <TrackedAssets /> }], { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('TrackedAssets', () => {
  it('shows one card per primary asset with its regions and competitor count', async () => {
    renderSection([asset('trep', 'Treprostinil', 'primary'), asset('sota', 'Sotatercept', 'primary'), asset('nint', 'Nintedanib', 'competitor', [{ id: 'trep', name: 'Treprostinil' }])])
    expect(screen.getByRole('heading', { name: 'Tracked assets' })).toBeInTheDocument()
    expect(await screen.findByText('2 primary · 1 competitor')).toBeInTheDocument()
    const trep = screen.getByRole('link', { name: /Treprostinil/ })
    await waitFor(() => expect(trep).toHaveTextContent('US, EU'))
    expect(trep).toHaveTextContent('1 competitor')
    expect(screen.getByRole('link', { name: /Sotatercept/ })).toHaveTextContent('0 competitors')
    expect(screen.queryByRole('link', { name: /Nintedanib/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Asset Search/ })).toHaveAttribute('href', '/assets')
  })

  it('invites to add an asset when none is tracked', async () => {
    renderSection([])
    expect(await screen.findByText('No assets yet')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/features/assets/components/asset-card.test.tsx src/features/home/components/tracked-assets.test.tsx`
Expected: FAIL — `Failed to resolve import "./asset-card"` and `"./tracked-assets"`.

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/assets/components/sparkline.tsx
/** Key events per year from `thisYear − 11` to `thisYear + 1` (README §5.2): this year in primary, next year dashed. */
export function Sparkline({ events, thisYear }: { events: { date: string }[]; thisYear: number }) {
  const from = thisYear - 11
  const counts = new Map<number, number>()
  for (const e of events) {
    const year = Number(e.date.slice(0, 4))
    if (year >= from && year <= thisYear + 1) counts.set(year, (counts.get(year) ?? 0) + 1)
  }
  const years = Array.from({ length: 13 }, (_, i) => from + i)
  const max = Math.max(3, ...years.map((y) => counts.get(y) ?? 0))
  return (
    <svg
      width="100%"
      height="30"
      viewBox={`0 0 ${years.length * 10} 30`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Key events per year, ${from}–${thisYear + 1}`}
      className="block"
    >
      {years.map((y, i) => {
        const n = counts.get(y) ?? 0
        const h = Math.max(1.5, (n / max) * 28)
        const future = y > thisYear
        return (
          <rect
            key={y}
            data-year={y}
            data-count={n}
            x={i * 10 + 1.5}
            y={30 - h}
            width={7}
            height={h}
            rx={1.5}
            fill={future ? '#fff' : y === thisYear ? '#2347d9' : '#c7d1f4'}
            stroke={future ? '#98a2b3' : 'none'}
            strokeWidth={0.8}
            strokeDasharray={future ? '2 1.5' : undefined}
          />
        )
      })}
    </svg>
  )
}
```

```tsx
// file: apps/web/src/features/assets/components/asset-card.tsx
import { Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { JourneyEventV3 } from '@/features/journey/types'
import { daysBetween, relativeFuture, todayIso } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AssetSummary } from '../api'
import { AssetTile } from './asset-tile'
import { KindBadge } from './badges'
import { Sparkline } from './sparkline'

const PILL = {
  building: 'bg-warning-soft text-warning',
  ok: 'bg-[#ecfdf3] text-[#067647]',
  failed: 'bg-danger-soft text-destructive',
}

function Pill({ tone, children }: { tone: keyof typeof PILL; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold whitespace-nowrap', PILL[tone])}>
      <i aria-hidden="true" className={cn('size-1.5 rounded-full', tone === 'building' ? 'animate-blink-dot bg-current' : tone === 'ok' ? 'bg-[#17b26a]' : 'bg-current')} />
      {children}
    </span>
  )
}

/** "Collecting · n%" while a crawl runs; otherwise Ready (Asset Search) or the approval regions (Home). */
export function AssetStatusPill({
  asset,
  progress,
  regions,
  variant,
}: {
  asset: Pick<AssetSummary, 'status'>
  progress: number | null
  regions?: string[]
  variant: 'home' | 'search'
}) {
  if (progress !== null) {
    const pct = Math.round(progress * 100)
    return <Pill tone="building">{variant === 'search' ? `Collecting · ${pct}%` : `${pct}%`}</Pill>
  }
  if (asset.status === 'onboarding') return <Pill tone="building">Collecting</Pill>
  if (asset.status === 'failed') return <Pill tone="failed">Collection failed</Pill>
  if (variant === 'home' && regions?.length) return <Pill tone="ok">{regions.join(', ')}</Pill>
  return <Pill tone="ok">Ready</Pill>
}

function Tag({ dashed = false, children }: { dashed?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-[5px] px-1.5 py-px text-[11px] whitespace-nowrap',
        dashed ? 'border border-dashed bg-card text-muted-foreground' : 'bg-muted text-secondary-foreground',
      )}
    >
      {children}
    </span>
  )
}

/** Tracked-asset card (README §5.2 Home; §5.3 Asset Search grid with the kind badge). */
export function AssetCard({
  asset,
  events,
  progress,
  regions,
  competitors = 0,
  variant,
  index = 0,
}: {
  asset: AssetSummary
  /** Key events of this asset: sparkline and next milestone. */
  events: JourneyEventV3[]
  /** 0–1 while a crawl runs, else null. */
  progress: number | null
  /** Approved regions (Home), undefined while loading. */
  regions?: string[]
  /** Home footer: tracked competitors of this asset. */
  competitors?: number
  variant: 'home' | 'search'
  index?: number
}) {
  const today = todayIso()
  const brand = asset.aliases.find((a) => a.toLowerCase() !== asset.name.toLowerCase())
  const rivals = asset.competitorOf.map((p) => p.name)
  const next = events.filter((e) => e.is_milestone && daysBetween(today, e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0]

  return (
    <Link
      to={`/assets/${encodeURIComponent(asset.id)}/overview`}
      className="flex animate-fade-up flex-col gap-3 rounded-[14px] border bg-card p-4 text-left shadow-panel transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[#c4ccda] hover:shadow-card-hover"
      style={{ animationDelay: `${index * (variant === 'home' ? 70 : 50)}ms` }}
    >
      <span className="flex items-center gap-2.5">
        <AssetTile name={asset.name} kind={asset.kind} size={36} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-1.5">
            <b className="text-[15px] font-semibold tracking-[-0.01em]">{asset.name}</b>
            {variant === 'search' && <KindBadge kind={asset.kind} competitorOf={rivals} />}
          </span>
          <span className="truncate text-[12px] text-muted-foreground">
            {variant === 'home' && brand ? `${brand} · ` : ''}
            {asset.company.name}
          </span>
        </span>
        <AssetStatusPill asset={asset} progress={progress} regions={regions} variant={variant} />
      </span>
      <span className="flex flex-wrap gap-1">
        {(asset.tags.indications ?? []).map((x) => (
          <Tag key={x}>{x}</Tag>
        ))}
        {variant === 'home' &&
          (asset.tags.investigational_indications ?? []).map((x) => (
            <Tag key={`i-${x}`} dashed>
              {x}
            </Tag>
          ))}
        {variant === 'search' && asset.kind === 'competitor' && rivals.length > 0 && <Tag>vs {rivals.join(', ')}</Tag>}
      </span>
      <Sparkline events={events} thisYear={Number(today.slice(0, 4))} />
      <span className="flex min-w-0 gap-2 text-[12.5px] text-secondary-foreground">
        <span className="shrink-0 text-muted-foreground">Latest</span>
        <span className="truncate">{asset.latestEvent?.title ?? (progress !== null ? 'Collecting records…' : '—')}</span>
      </span>
      {variant === 'home' && (
        <span className="flex flex-wrap gap-x-3 gap-y-1 border-t border-hair pt-2.5 text-[12px] text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground">{formatNumber(asset.counts.events)}</b> events
          </span>
          <span>
            <b className="font-semibold text-foreground">{formatNumber(asset.counts.trials)}</b> trials
          </span>
          <span>
            <b className="font-semibold text-foreground">{competitors}</b> competitor{competitors === 1 ? '' : 's'}
          </span>
          {next && (
            <span className="ml-auto inline-flex items-center gap-1 font-semibold text-primary">
              <Clock className="size-[11px]" />
              {relativeFuture(next.date, today)}
            </span>
          )}
        </span>
      )}
    </Link>
  )
}
```

```tsx
// file: apps/web/src/features/home/components/tracked-assets.tsx
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAssetDetails, useAssets } from '@/features/assets/api'
import { AssetCard } from '@/features/assets/components/asset-card'
import { EmptyState } from '@/features/assets/components/panel'
import { useJobs } from '@/features/jobs/api'
import { jobProgress, runningByAsset } from '@/features/jobs/steps'
import { eventsByAsset, usePortfolioTimeline } from '../api'

/** Home "Tracked assets" (README §5.2): one card per primary asset. */
export function TrackedAssets() {
  const assets = useAssets()
  const portfolio = usePortfolioTimeline()
  const running = runningByAsset(useJobs({ status: 'running' }).data)
  const all = assets.data ?? []
  const primary = all.filter((a) => a.kind === 'primary')
  const competitors = all.length - primary.length
  const details = useAssetDetails(primary.map((a) => a.id))
  const byAsset = eventsByAsset(portfolio.data?.events ?? [])

  return (
    <section aria-labelledby="tracked-assets-title" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="tracked-assets-title" className="text-[15px] font-semibold">
            Tracked assets
          </h2>
          {assets.data && (
            <p className="text-text-secondary">
              {primary.length} primary · {competitors} competitor{competitors === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/assets">
            Asset Search <ArrowRight />
          </Link>
        </Button>
      </div>
      {assets.isPending && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[230px] rounded-[14px]" />
          ))}
        </div>
      )}
      {assets.isError && <p className="text-destructive">Assets couldn't be loaded.</p>}
      {assets.data && primary.length === 0 && (
        <div className="rounded-[14px] border bg-card">
          <EmptyState title="No assets yet">Add a drug by name with Asset AI.</EmptyState>
        </div>
      )}
      {primary.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
          {primary.map((a, i) => {
            const job = running.get(a.id)
            return (
              <AssetCard
                key={a.id}
                asset={a}
                variant="home"
                index={i}
                events={byAsset.get(a.id) ?? []}
                progress={job ? jobProgress(job) : null}
                regions={details[a.id]?.kpis.approvalRegions}
                competitors={all.filter((c) => c.competitorOf.some((p) => p.id === a.id)).length}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && npx vitest run src/features/assets/components/asset-card.test.tsx src/features/home/components/tracked-assets.test.tsx && npx tsc -b`
Expected: PASS (3 card tests, 2 section tests); `tsc` silent.

---

### Task 12: Home page — hero, KPI strip, Asset AI starters, composition

**Files:**
- Create: `apps/web/src/features/home/components/home-hero.tsx`
- Create: `apps/web/src/features/home/components/ask-card.tsx`
- Modify: `apps/web/src/features/home/home-page.tsx` (Replace)
- Modify: `apps/web/src/features/home/api.ts` (remove `Signal`/`useSignals`, now unused)
- Modify: `apps/web/src/features/auth/auth-flow.test.tsx` (greeting)
- Test: `apps/web/src/features/home/home-page.test.tsx`

**Interfaces:**
- Consumes: `PortfolioTimeline` (Task 8), `WhatChanged`, `NextMilestones`, `CompetitiveSignals`, `homeCounts`, `HomeCounts` (Task 9), `CrawlsCard` (Task 10), `TrackedAssets` (Task 11), `usePortfolioTimeline` (Task 3), `jobProgress` (Task 1), `useAssets`, `useJobs`, `useAuth`, `KpiStrip`/`Kpi` (existing), `todayIso`, `formatNumber`.
- Produces: `HomePage()` (same export, same route); `HomeHero({ firstName: string; counts: HomeCounts | null; building: { name: string; pct: number } | null })`; `AskCard({ compare: [string, string] | null })`. Hero input labelled "Ask Asset AI about your assets" → `/chat?ask=<q>`.

- [ ] **Step 1: Write the failing test and update the greeting assertion**

```tsx
// file: apps/web/src/features/home/home-page.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AssetSummary } from '@/features/assets/api'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import type { Job, JobStep } from '@/features/jobs/api'
import type { JourneyEventV3 } from '@/features/journey/types'
import type { PortfolioTimeline } from './api'
import { HomePage } from './home-page'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
const ZERO = { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 }
const asset = (id: string, name: string, kind: AssetSummary['kind'], extra: Partial<AssetSummary> = {}): AssetSummary => ({
  id,
  name,
  aliases: [],
  company: { name: 'Co' },
  tags: {},
  kind,
  status: 'ready',
  updatedAt: null,
  counts: ZERO,
  latestEvent: null,
  competitorOf: [],
  ...extra,
})
const ASSETS = [
  asset('trep', 'Treprostinil', 'primary', {
    counts: { trials: 74, regulatory: 56, pressReleases: 112, documents: 26, news: 95, publications: 210, conferences: 38, patents: 18, events: 909 },
  }),
  asset('sota', 'Sotatercept', 'primary', { counts: { ...ZERO, trials: 10, events: 9 } }),
  asset('nint', 'Nintedanib', 'competitor', { competitorOf: [{ id: 'trep', name: 'Treprostinil' }] }),
]
const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const RUNNING: Job = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'onboard',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: null,
  finished_at: null,
}
const ev = (id: string, assetId: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset: assetId,
  date,
  type: 'approval',
  category: 'regulatory',
  title: `Event ${id}`,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
  key: true,
  ...extra,
})
const PORTFOLIO: PortfolioTimeline = {
  assets: [
    { id: 'trep', name: 'Treprostinil', kind: 'primary', company: 'Co', status: 'onboarding', progress: 0.5, competitorOf: [] },
    { id: 'sota', name: 'Sotatercept', kind: 'primary', company: 'Co', status: 'ready', progress: null, competitorOf: [] },
    { id: 'nint', name: 'Nintedanib', kind: 'competitor', company: 'Co', status: 'ready', progress: null, competitorOf: ['trep'] },
  ],
  events: [
    ev('d1', 'trep', '2026-10-05'),
    ev('d2', 'sota', '2026-09-20', { significance: 'Medium' }),
    ev('d3', 'nint', '2026-08-01', { significance: 'Medium' }),
    ev('m1', 'trep', '2026-12-01', { is_milestone: true }),
    ev('m2', 'sota', '2027-03-31', { is_milestone: true }),
    ev('m3', 'nint', '2028-01-01', { is_milestone: true }),
  ],
}

function renderHome() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/assets') return json(200, ASSETS)
      if (url === '/api/portfolio/timeline?competitors=true') return json(200, PORTFOLIO)
      if (url === '/api/jobs?status=running') return json(200, [RUNNING])
      if (url === '/api/jobs') return json(200, [RUNNING])
      if (url === '/api/jobs/j1') return json(200, { ...RUNNING, records: [], events_created: 0, feed_cursor: 0, record_years: [] })
      if (url === '/api/assets/trep' || url === '/api/assets/sota') return json(200, { kpis: { approvalRegions: ['US'] } })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const router = createMemoryRouter(
    [
      { path: '/', element: <HomePage /> },
      { path: '/chat', element: <p>Chat</p> },
      { path: '/assets/:id/overview', element: <p>Overview</p> },
    ],
    { initialEntries: ['/'] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T09:00:00'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HomePage', () => {
  it('greets the user with the date and a summary that matches the data', async () => {
    renderHome()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Good morning, Ana' })
    const hero = heading.parentElement!
    expect(hero).toHaveTextContent('Friday, October 9, 2026')
    await waitFor(() =>
      expect(hero).toHaveTextContent('2 new events in the last 30 days (1 high-significance) · 2 milestones in the next 6 months · Treprostinil journey 50% built'),
    )
  })

  it('fills the KPI strip from assets, key events and running crawls', async () => {
    renderHome()
    const kpis = await screen.findByRole('region', { name: 'Key metrics' })
    await waitFor(() => expect(kpis).toHaveTextContent('Tracked assets21 competitor monitored'))
    await waitFor(() => expect(kpis).toHaveTextContent('New events3Last 90 days, across all assets'))
    expect(kpis).toHaveTextContent('Upcoming milestones2Next 12 months')
    expect(kpis).toHaveTextContent('Records collected639FDA, EMA, trials, PubMed, news')
    await waitFor(() => expect(kpis).toHaveTextContent('Crawls running1Treprostinil · 50%'))
  })

  it('lays out every Home block', async () => {
    renderHome()
    for (const name of ['Portfolio timeline', 'What changed', 'Next milestones', 'Crawls', 'Tracked assets', 'Competitive signals', 'Asset AI']) {
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument()
    }
  })

  it('asks Asset AI from the hero', async () => {
    const router = renderHome()
    await userEvent.type(await screen.findByRole('textbox', { name: 'Ask Asset AI about your assets' }), 'What changed for Yutrepia?{Enter}')
    expect(router.state.location.pathname).toBe('/chat')
    expect(new URLSearchParams(router.state.location.search).get('ask')).toBe('What changed for Yutrepia?')
  })

  it('offers starter questions, including a comparison with a tracked competitor', async () => {
    renderHome()
    const compare = await screen.findByRole('link', { name: /Compare Treprostinil with Nintedanib/ })
    expect(compare).toHaveAttribute('href', `/chat?ask=${encodeURIComponent('Compare Treprostinil with Nintedanib')}`)
    expect(screen.getByRole('link', { name: /Add an asset by chatting/ })).toHaveAttribute('href', '/chat?intent=add')
  })
})
```

In `apps/web/src/features/auth/auth-flow.test.tsx`:

Before:
```tsx
    await screen.findByRole('heading', { name: /Welcome, Ana/ })
```
After:
```tsx
    await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Ana$/ })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/home/home-page.test.tsx src/features/auth/auth-flow.test.tsx`
Expected: FAIL — no heading "Good morning, Ana" (the old page says "Welcome, Ana"); `auth-flow` "keeps analysts out of user management" fails the same way.

- [ ] **Step 3: Implement**

```tsx
// file: apps/web/src/features/home/components/home-hero.tsx
import { Send, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import type { HomeCounts } from '../home-data'

const greeting = (hour: number) => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Home hero (README §5.2): date, greeting, summary sentence and the Ask Asset AI input. */
export function HomeHero({
  firstName,
  counts,
  building,
}: {
  firstName: string
  counts: HomeCounts | null
  building: { name: string; pct: number } | null
}) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  // Read once per mount (react purity: no Date calls during render).
  const [now] = useState(() => new Date())
  const ask = q.trim()

  return (
    <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pt-1 pb-0.5">
      <div className="min-w-0 flex-[1_1_420px]">
        <p className="text-[12.5px] text-muted-foreground">
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
        <h1 className="mt-1 text-[30px] leading-9 font-[650] tracking-[-0.025em]">
          {greeting(now.getHours())}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        {counts && (
          <p className="mt-1.5 text-[14px] text-pretty text-text-secondary">
            <b className="font-semibold text-foreground">{plural(counts.new30, 'new event')}</b> in the last 30 days
            {counts.high30 > 0 && ` (${counts.high30} high-significance)`} · <b className="font-semibold text-foreground">{plural(counts.next6m, 'milestone')}</b> in the
            next 6 months
            {building && (
              <>
                {' '}
                · {building.name} journey <b className="font-semibold text-foreground">{building.pct}% built</b>
              </>
            )}
          </p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          navigate(ask ? `/chat?ask=${encodeURIComponent(ask)}` : '/chat')
        }}
        className="flex h-[46px] min-w-[280px] flex-[0_1_460px] items-center gap-2 rounded-xl border bg-card pr-1.5 pl-3.5 shadow-panel transition-[border-color,box-shadow] focus-within:border-primary focus-within:shadow-focus"
      >
        <Sparkles className="size-4 shrink-0 text-violet" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about your assets, competitors and evidence…"
          aria-label="Ask Asset AI about your assets"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
        />
        <Button type="submit" size="icon" className="size-[34px]" aria-label="Ask">
          <Send className="size-3.5" />
        </Button>
      </form>
    </section>
  )
}
```

```tsx
// file: apps/web/src/features/home/components/ask-card.tsx
import { ArrowRight, Plus, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

/** Home "Asset AI" starters (README §5.2); `compare` = [primary, competitor] names when a competitor is tracked. */
export function AskCard({ compare }: { compare: [string, string] | null }) {
  const questions = [
    'Which assets have milestones in the next six months?',
    'What changed across my assets this month?',
    compare ? `Compare ${compare[0]} with ${compare[1]}` : 'Compare my assets with their closest competitors',
    'Summarize the latest Phase 3 readouts',
  ]
  return (
    <section aria-labelledby="ask-card-title" className="flex flex-col gap-3 rounded-[14px] border bg-card px-5 py-[18px] shadow-panel">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-violet-soft text-violet">
          <Sparkles className="size-4" />
        </span>
        <div>
          <h3 id="ask-card-title" className="text-[15px] font-semibold">
            Asset AI
          </h3>
          <p className="text-text-secondary">Answers cite the records behind them.</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {questions.map((q) => (
          <Link
            key={q}
            to={`/chat?ask=${encodeURIComponent(q)}`}
            className="flex items-center justify-between gap-2.5 rounded-[10px] border bg-card px-3 py-2.5 text-secondary-foreground transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
          >
            {q}
            <ArrowRight className="size-[13px] shrink-0" />
          </Link>
        ))}
      </div>
      <Button asChild variant="outline" size="sm" className="self-start">
        <Link to="/chat?intent=add">
          <Plus /> Add an asset by chatting
        </Link>
      </Button>
    </section>
  )
}
```

**Replace** the Home page:

```tsx
// file: apps/web/src/features/home/home-page.tsx
import { Activity, CalendarDays, Database, Pill, Route } from 'lucide-react'
import { useAssets } from '@/features/assets/api'
import { KpiStrip, type Kpi } from '@/features/assets/components/panel'
import { useAuth } from '@/features/auth/auth-context'
import { useJobs, type Job } from '@/features/jobs/api'
import { jobProgress } from '@/features/jobs/steps'
import { todayIso } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { usePortfolioTimeline } from './api'
import { AskCard } from './components/ask-card'
import { CompetitiveSignals } from './components/competitive-signals'
import { CrawlsCard } from './components/crawls-card'
import { HomeHero } from './components/home-hero'
import { NextMilestones } from './components/next-milestones'
import { PortfolioTimeline } from './components/portfolio-timeline'
import { TrackedAssets } from './components/tracked-assets'
import { WhatChanged } from './components/what-changed'
import { homeCounts } from './home-data'

const pct = (job: Job) => Math.round(jobProgress(job) * 100)

/** Home dashboard (README §5.2). */
export function HomePage() {
  const { user } = useAuth()
  const assets = useAssets()
  const portfolio = usePortfolioTimeline()
  const runningJobs = useJobs({ status: 'running' })

  const firstName = user?.name.split(' ')[0] ?? ''
  const all = assets.data ?? []
  const primary = all.filter((a) => a.kind === 'primary').length
  const competitors = all.length - primary
  const counts = portfolio.data ? homeCounts(portfolio.data.events, todayIso()) : null
  const running = runningJobs.data ?? []
  const onboarding = running.find((j) => j.type === 'onboard')
  const records = all.reduce(
    (sum, a) => sum + a.counts.trials + a.counts.regulatory + a.counts.pressReleases + a.counts.documents + a.counts.news + a.counts.publications + a.counts.conferences + a.counts.patents,
    0,
  )
  const rival = all.find((a) => a.kind === 'competitor' && a.competitorOf.length > 0)

  const kpis: Kpi[] = [
    { label: 'Tracked assets', icon: Pill, value: assets.data ? primary : '—', hint: assets.data ? `${competitors} competitor${competitors === 1 ? '' : 's'} monitored` : undefined },
    { label: 'New events', icon: Route, value: counts ? counts.new90 : '—', hint: 'Last 90 days, across all assets' },
    { label: 'Upcoming milestones', icon: CalendarDays, value: counts ? counts.next12m : '—', hint: 'Next 12 months' },
    { label: 'Records collected', icon: Database, value: assets.data ? formatNumber(records) : '—', hint: 'FDA, EMA, trials, PubMed, news' },
    {
      label: 'Crawls running',
      icon: Activity,
      value: runningJobs.data ? running.length : '—',
      hint: running[0] ? `${running[0].assetName ?? running[0].asset} · ${pct(running[0])}%` : 'Nothing running',
    },
  ]

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-6 py-6">
      <HomeHero firstName={firstName} counts={counts} building={onboarding ? { name: onboarding.assetName ?? onboarding.asset, pct: pct(onboarding) } : null} />
      <KpiStrip items={kpis} />
      <PortfolioTimeline />
      <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <WhatChanged />
        <div className="flex min-w-0 flex-col gap-5">
          <NextMilestones />
          <CrawlsCard />
        </div>
      </div>
      <TrackedAssets />
      <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <CompetitiveSignals />
        <AskCard compare={rival ? [rival.competitorOf[0].name, rival.name] : null} />
      </div>
    </div>
  )
}
```

**Replace** `apps/web/src/features/home/api.ts` (drops `Signal`/`useSignals`, whose only user was the old Home page; the portfolio code from Task 3 is unchanged):

```ts
// file: apps/web/src/features/home/api.ts
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { JourneyEventV3 } from '@/features/journey/types'

/** An asset row of the Home portfolio timeline (GET /portfolio/timeline). */
export interface PortfolioAsset {
  id: string
  name: string
  kind: 'primary' | 'competitor'
  company: string | null
  status: 'onboarding' | 'ready' | 'failed'
  /** Share of done steps of a running job, cached 60 s server-side; the UI uses the live job instead. */
  progress: number | null
  /** Primary asset ids a competitor is tracked against. */
  competitorOf: string[]
}

export interface PortfolioTimeline {
  assets: PortfolioAsset[]
  /** Key events of those assets (spec §4.1), oldest first. */
  events: JourneyEventV3[]
}

/**
 * Every tracked asset (competitors included) with its key events. One request feeds the whole Home dashboard
 * and the Asset Search sparklines; each block filters it. `live` refetches every 10 s while a crawl runs.
 */
export function usePortfolioTimeline({ live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ['portfolio', 'timeline', { competitors: true }],
    queryFn: () => apiFetch<PortfolioTimeline>('/portfolio/timeline?competitors=true'),
    refetchInterval: live ? 10_000 : false,
  })
}

/** Events grouped by asset id, keeping their order. */
export function eventsByAsset<T extends { asset: string }>(events: T[]): Map<string, T[]> {
  const byAsset = new Map<string, T[]>()
  for (const e of events) {
    const list = byAsset.get(e.asset)
    if (list) list.push(e)
    else byAsset.set(e.asset, [e])
  }
  return byAsset
}
```

Check nothing else used the removed code: `grep -rn "useSignals\|from '@/features/home/api'" apps/web/src` → only the new Home files and tests import `@/features/home/api`; no `useSignals`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/home src/features/auth/auth-flow.test.tsx && npx tsc -b && npm run lint`
Expected: PASS (every `features/home` test file, 5 Home page tests, `auth-flow` green); `tsc` silent; oxlint 0 errors.

---

### Task 13: Asset Search — kind badges, kind switch with counts, table/grid, URL state

**Files:**
- Modify: `apps/web/src/features/assets/pages/asset-search-page.tsx` (Replace)
- Test: `apps/web/src/features/assets/pages/asset-search-page.test.tsx`

**Interfaces:**
- Consumes: `useAssets`, `assetMatches`, `byKindThenName`, `useAssetDetails` (Task 3); `usePortfolioTimeline`, `eventsByAsset` (Task 3); `AssetCard`, `AssetStatusPill` (Task 11); `AssetTile`, `jobProgress`, `runningByAsset` (Task 1); `KindBadge` (Phase 0); `Segmented`, `EmptyState`, `Page`, `Table*`, `Button`, `Skeleton`, `formatDay`, `formatNumber` (existing).
- Produces: `AssetSearchPage()` (same export/route). URL params: `q`, `kind=primary|competitor` (absent = all), `view=grid` (absent = table). Kind buttons "All N" / "Primary N" / "Competitors N" (counts over all assets). View buttons "Table view" / "Grid view".

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/features/assets/pages/asset-search-page.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Job, JobStep } from '@/features/jobs/api'
import type { AssetSummary } from '../api'
import { AssetSearchPage } from './asset-search-page'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ZERO = { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 }
const TREP: AssetSummary = {
  id: 'trep',
  name: 'Treprostinil',
  aliases: ['Tyvaso', 'Remodulin'],
  company: { name: 'United Therapeutics' },
  tags: { indications: ['PAH'], investigational_indications: ['PH-ILD'] },
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: { ...ZERO, events: 909 },
  latestEvent: { date: '2026-10-05', title: 'Study highlights inhaled treprostinil in IPF', type: 'publication' },
  competitorOf: [],
}
const SOTA: AssetSummary = { ...TREP, id: 'sota', name: 'Sotatercept', aliases: ['Winrevair'], company: { name: 'Merck' }, tags: { indications: ['PAH'] }, counts: { ...ZERO, events: 9 }, latestEvent: null }
const NINT: AssetSummary = {
  ...TREP,
  id: 'nint',
  name: 'Nintedanib',
  aliases: ['Ofev'],
  company: { name: 'Boehringer Ingelheim' },
  tags: { indications: ['IPF', 'PPF'] },
  kind: 'competitor',
  counts: { ...ZERO, events: 1 },
  latestEvent: null,
  competitorOf: [{ id: 'trep', name: 'Treprostinil' }],
}
const step = (name: string, status: JobStep['status']): JobStep => ({ name, label: name, status, counts: {}, error: null, started_at: null, finished_at: null })
const RUNNING: Job = {
  id: 'j1',
  asset: 'trep',
  assetName: 'Treprostinil',
  type: 'refresh',
  status: 'running',
  steps: [step('regulatory', 'done'), step('clinical', 'done'), step('journey', 'running'), step('finalize', 'pending')],
  cancel_requested: false,
  requested_by: null,
  created_at: '',
  started_at: null,
  finished_at: null,
}
const REGIONS: Record<string, string[]> = { trep: ['US', 'EU'], sota: ['US'], nint: ['US', 'EU'] }

function renderSearch(path = '/assets') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/assets') return json(200, [NINT, TREP, SOTA])
      if (url === '/api/portfolio/timeline?competitors=true') return json(200, { assets: [], events: [] })
      if (url === '/api/jobs?status=running') return json(200, [RUNNING])
      const detail = url.match(/^\/api\/assets\/(\w+)$/)?.[1]
      if (detail && REGIONS[detail]) return json(200, { id: detail, kpis: { approvalRegions: REGIONS[detail] } })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
  const router = createMemoryRouter(
    [
      { path: '/assets', element: <AssetSearchPage /> },
      { path: '/assets/:id/overview', element: <p>Overview</p> },
      { path: '/chat', element: <p>Chat</p> },
    ],
    { initialEntries: [path] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return router
}

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr')!

afterEach(() => vi.unstubAllGlobals())

describe('AssetSearchPage', () => {
  it('table: primary first, kind badges, counts in the kind switch, regions, status and latest update', async () => {
    renderSearch()
    await screen.findByRole('link', { name: 'Treprostinil' })
    expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Primary 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Competitors 1' })).toBeInTheDocument()
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0].textContent)
    expect(names).toEqual(['Sotatercept', 'Treprostinil', 'Nintedanib'])

    const trep = rowOf('Treprostinil')
    expect(within(trep).getByText('Primary')).toBeInTheDocument()
    expect(trep).toHaveTextContent('Tyvaso · United Therapeutics')
    expect(trep).toHaveTextContent('Collecting · 50%')
    expect(trep).toHaveTextContent('909')
    expect(trep).toHaveTextContent('Study highlights inhaled treprostinil in IPF')
    expect(trep).toHaveTextContent('Oct 5, 2026')
    await waitFor(() => expect(trep).toHaveTextContent('US, EU'))

    const nint = rowOf('Nintedanib')
    expect(within(nint).getByText('Competitor')).toBeInTheDocument()
    expect(nint).toHaveTextContent('Ofev · Boehringer Ingelheim · vs Treprostinil')
    expect(nint).toHaveTextContent('Ready')
  })

  it('filters by kind with badges on every view, and keeps the filter in the URL', async () => {
    const router = renderSearch()
    await screen.findByRole('link', { name: 'Treprostinil' })
    await userEvent.click(screen.getByRole('button', { name: 'Primary 2' }))
    expect(router.state.location.search).toBe('?kind=primary')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3))
    expect(screen.getAllByText('Primary', { selector: 'span' })).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Competitors 1' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(within(rowOf('Nintedanib')).getByText('Competitor')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'All 3' }))
    expect(router.state.location.search).toBe('')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4))
  })

  it('searches by brand and shows an empty state that points to Asset AI', async () => {
    const router = renderSearch()
    const input = await screen.findByRole('textbox', { name: 'Search assets' })
    await userEvent.type(input, 'ofev')
    expect(router.state.location.search).toBe('?q=ofev')
    expect(screen.getAllByRole('row')).toHaveLength(2)
    await userEvent.clear(input)
    await userEvent.type(input, 'zzz')
    expect(screen.getByText('No assets match “zzz”')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add it with Asset AI' })).toHaveAttribute('href', '/chat?intent=add')
  })

  it('shows the grid from the URL with kind badges and rivals, and toggles back to the table', async () => {
    const router = renderSearch('/assets?view=grid')
    const card = await screen.findByRole('link', { name: /Nintedanib/ })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(within(card).getByText('Competitor')).toBeInTheDocument()
    expect(card).toHaveTextContent('vs Treprostinil')
    expect(within(card).getByRole('img', { name: /Key events per year/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('opens an asset from anywhere on its row', async () => {
    const router = renderSearch()
    await userEvent.click(await screen.findByText('Winrevair · Merck'))
    expect(router.state.location.pathname).toBe('/assets/sota/overview')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/assets/pages/asset-search-page.test.tsx`
Expected: FAIL — no button "All 3" (the old page has no kind switch).

- [ ] **Step 3: Implement** — **Replace** the page:

```tsx
// file: apps/web/src/features/assets/pages/asset-search-page.tsx
import { LayoutGrid, List, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { eventsByAsset, usePortfolioTimeline } from '@/features/home/api'
import { useJobs } from '@/features/jobs/api'
import { jobProgress, runningByAsset } from '@/features/jobs/steps'
import { formatDay } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { assetMatches, byKindThenName, useAssetDetails, useAssets, type AssetSummary } from '../api'
import { AssetCard, AssetStatusPill } from '../components/asset-card'
import { AssetTile } from '../components/asset-tile'
import { KindBadge } from '../components/badges'
import { EmptyState } from '../components/panel'
import { Segmented } from '../components/segmented'

type Kind = 'all' | 'primary' | 'competitor'
type View = 'table' | 'grid'

const KINDS: Kind[] = ['all', 'primary', 'competitor']
const VIEWS: { value: View; label: string; icon: typeof List }[] = [
  { value: 'table', label: 'Table view', icon: List },
  { value: 'grid', label: 'Grid view', icon: LayoutGrid },
]

/** "Tyvaso · United Therapeutics · vs Treprostinil" */
function subline(a: AssetSummary): string {
  const brand = a.aliases.find((x) => x.toLowerCase() !== a.name.toLowerCase())
  const vs = a.kind === 'competitor' && a.competitorOf.length ? `vs ${a.competitorOf.map((p) => p.name).join(', ')}` : ''
  return [brand, a.company.name, vs].filter(Boolean).join(' · ')
}

function IndicationTags({ asset }: { asset: AssetSummary }) {
  return (
    <div className="flex flex-wrap gap-1">
      {(asset.tags.indications ?? []).map((x) => (
        <span key={x} className="rounded-[5px] bg-muted px-1.5 py-px text-[11px] whitespace-nowrap text-secondary-foreground">
          {x}
        </span>
      ))}
      {(asset.tags.investigational_indications ?? []).map((x) => (
        <span key={`i-${x}`} className="rounded-[5px] border border-dashed bg-card px-1.5 py-px text-[11px] whitespace-nowrap text-muted-foreground">
          {x}
        </span>
      ))}
    </div>
  )
}

/** Asset Search (README §5.3): every tracked asset, primary or competitor, as a table or cards. */
export function AssetSearchPage() {
  const navigate = useNavigate()
  const assets = useAssets()
  const portfolio = usePortfolioTimeline()
  const running = runningByAsset(useJobs({ status: 'running' }).data)
  const [params, setParams] = useSearchParams()
  // The query is typed into local state (URL updates may render later) and mirrored to ?q= for sharing.
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const kind: Kind = KINDS.find((k) => k === params.get('kind')) ?? 'all'
  const view: View = params.get('view') === 'grid' ? 'grid' : 'table'

  /** Set a URL param; its default removes it, so plain /assets stays clean. */
  const setParam = (key: string, value: string, fallback: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === fallback) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )

  const all = [...(assets.data ?? [])].sort(byKindThenName)
  const primaries = all.filter((a) => a.kind === 'primary').length
  const shown = all.filter((a) => (kind === 'all' || a.kind === kind) && assetMatches(a, q.trim()))
  const details = useAssetDetails(shown.map((a) => a.id))
  const byAsset = eventsByAsset(portfolio.data?.events ?? [])
  const progressOf = (id: string) => {
    const job = running.get(id)
    return job ? jobProgress(job) : null
  }
  const assetPath = (id: string) => `/assets/${encodeURIComponent(id)}/overview`

  return (
    <Page
      title="Asset Search"
      description="Every tracked asset journey."
      actions={
        <Button asChild className="h-9 rounded-[10px] px-3.5">
          <Link to="/chat?intent=add">
            <Plus /> Add asset
          </Link>
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <label className="flex h-[38px] flex-[1_1_320px] items-center gap-2 rounded-[10px] border bg-card px-3 text-muted-foreground focus-within:border-primary focus-within:shadow-focus">
          <Search className="size-[15px] shrink-0" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setParam('q', e.target.value, '')
            }}
            placeholder="Search by name, brand, company, indication or mechanism"
            aria-label="Search assets"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
          />
        </label>
        <Segmented<Kind>
          label="Kind"
          value={kind}
          onChange={(v) => setParam('kind', v, 'all')}
          options={[
            { value: 'all', label: `All ${all.length}` },
            { value: 'primary', label: `Primary ${primaries}` },
            { value: 'competitor', label: `Competitors ${all.length - primaries}` },
          ]}
        />
        <div role="group" aria-label="View" className="inline-flex rounded-[10px] bg-muted p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={view === v.value}
              aria-label={v.label}
              onClick={() => setParam('view', v.value, 'table')}
              className={cn('flex h-7 w-8 items-center justify-center rounded-lg text-text-secondary', view === v.value && 'bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)]')}
            >
              <v.icon className="size-[13px]" />
            </button>
          ))}
        </div>
      </div>

      {assets.isPending && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}
      {assets.isError && <p className="text-destructive">Assets couldn't be loaded.</p>}
      {assets.data && shown.length === 0 && (
        <section className="rounded-[14px] border bg-card">
          {all.length === 0 ? (
            <EmptyState title="No assets yet">
              <Link to="/chat?intent=add" className="font-medium text-primary hover:underline">
                Add an asset
              </Link>{' '}
              with Asset AI to start building its journey.
            </EmptyState>
          ) : q.trim() ? (
            <EmptyState title={`No assets match “${q.trim()}”`}>
              <Link to="/chat?intent=add" className="font-medium text-primary hover:underline">
                Add it with Asset AI
              </Link>{' '}
              to start building its journey.
            </EmptyState>
          ) : (
            <EmptyState title={`No ${kind === 'primary' ? 'primary' : 'competitor'} assets yet`} />
          )}
        </section>
      )}

      {shown.length > 0 && view === 'table' && (
        <section className="overflow-hidden rounded-[14px] border bg-card shadow-panel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Indications</TableHead>
                <TableHead>Approved in</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Latest update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((a) => (
                <TableRow key={a.id} onClick={() => navigate(assetPath(a.id))} className="cursor-pointer">
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <AssetTile name={a.name} kind={a.kind} size={30} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link to={assetPath(a.id)} onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-primary">
                            {a.name}
                          </Link>
                          <KindBadge kind={a.kind} competitorOf={a.competitorOf.map((p) => p.name)} />
                        </div>
                        <p className="truncate text-[12px] text-muted-foreground">{subline(a)}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <IndicationTags asset={a} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{details[a.id]?.kpis.approvalRegions.join(', ') || '—'}</TableCell>
                  <TableCell>
                    <AssetStatusPill asset={a} progress={progressOf(a.id)} variant="search" />
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">{formatNumber(a.counts.events)}</TableCell>
                  <TableCell className="max-w-[280px]">
                    {a.latestEvent ? (
                      <>
                        <p className="truncate">{a.latestEvent.title}</p>
                        <p className="font-mono text-[11.5px] text-muted-foreground">{formatDay(a.latestEvent.date)}</p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {shown.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
          {shown.map((a, i) => (
            <AssetCard key={a.id} asset={a} variant="search" index={i} events={byAsset.get(a.id) ?? []} progress={progressOf(a.id)} />
          ))}
        </div>
      )}
    </Page>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/assets/pages/asset-search-page.test.tsx && npx tsc -b`
Expected: PASS (5 tests); `tsc` silent.

---

### Task 14: Asset AI — `?ask=` sends the question once

**Files:**
- Modify: `apps/web/src/features/chat/chat-page.tsx`
- Modify: `apps/web/src/features/chat/components/chat-conversation.tsx`
- Test: `apps/web/src/features/chat/chat-turn.test.tsx` (append)

**Interfaces:**
- Consumes: nothing new (existing chat API and turn store).
- Produces: `ChatConversation` prop `initialQuestion?: string` (asked once on mount, as if typed); `/chat?ask=<q>` (only without a session id) passes it. Used by Task 4 (palette action), Task 12 (hero, starters).

- [ ] **Step 1: Write the failing test** — append inside `describe('Asset AI chat', …)` in `apps/web/src/features/chat/chat-turn.test.tsx`, after the last `it(…)`:

```tsx
  it('asks the question from ?ask= once, in a new session', async () => {
    const api = fakeApi()
    const router = renderAt(`/chat?ask=${encodeURIComponent('What changed this month?')}`)

    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/s2'))
    expect(await screen.findByText('What changed this month?')).toBeInTheDocument()
    expect(api.calls.filter((c) => c.url === '/api/chat/sessions' && c.init?.method === 'POST')).toHaveLength(1)
    expect(api.calls.filter((c) => c.url === '/api/chat/sessions/s2/turn')).toHaveLength(1)
    expect(api.calls.find((c) => c.url === '/api/chat/sessions/s2/turn')?.init?.body).toBe('{"message":"What changed this month?"}')
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/features/chat/chat-turn.test.tsx`
Expected: FAIL — the new test times out waiting for `/chat/s2` (pathname stays `/chat`).

- [ ] **Step 3: Implement**

`apps/web/src/features/chat/chat-page.tsx`:

Before:
```tsx
/** Full-page Asset AI (`/chat`, `/chat/:sessionId`); `?intent=add` starts with "Add " in the composer. */
```
After:
```tsx
/**
 * Full-page Asset AI (`/chat`, `/chat/:sessionId`); `?intent=add` starts with "Add " in the composer and
 * `?ask=<question>` sends the question in a new chat (Home, ⌘K and the starter questions link here).
 */
```

Before:
```tsx
  const addIntent = sessionId === null && params.get('intent') === 'add'
```
After:
```tsx
  const addIntent = sessionId === null && params.get('intent') === 'add'
  const askParam = sessionId === null ? (params.get('ask')?.trim() ?? '') : ''
```

Before:
```tsx
          key={`${sessionId ?? 'new'}${addIntent ? ':add' : ''}`}
```
After:
```tsx
          key={`${sessionId ?? 'new'}${addIntent ? ':add' : ''}${askParam ? `:ask:${askParam}` : ''}`}
```

Before:
```tsx
          initialDraft={addIntent ? ADD_ASSET_DRAFT : ''}
```
After:
```tsx
          initialDraft={addIntent ? ADD_ASSET_DRAFT : ''}
          initialQuestion={askParam || undefined}
```

`apps/web/src/features/chat/components/chat-conversation.tsx`:

Before:
```tsx
  initialDraft = '',
  autoFocus = false,
  contentClassName,
}: {
```
After:
```tsx
  initialDraft = '',
  initialQuestion,
  autoFocus = false,
  contentClassName,
}: {
```

Before:
```tsx
  initialDraft?: string
  autoFocus?: boolean
```
After:
```tsx
  initialDraft?: string
  /** Asked once when the conversation mounts, as if typed (`/chat?ask=`). */
  initialQuestion?: string
  autoFocus?: boolean
```

Before:
```tsx
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])
```
After:
```tsx
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // The ref keeps React's dev double-mount from asking twice; the effect event always calls the current `ask`.
  const asked = useRef(false)
  const askInitial = useEffectEvent((question: string) => void ask(question))
  useEffect(() => {
    if (!initialQuestion || asked.current) return
    asked.current = true
    askInitial(initialQuestion)
  }, [initialQuestion])
```

Before:
```tsx
import { useEffect, useRef, useState, type ComponentType } from 'react'
```
After:
```tsx
import { useEffect, useEffectEvent, useRef, useState, type ComponentType } from 'react'
```

(`ask` is the component's existing `async function ask(text)`, hoisted; `useEffectEvent` is stable in React 19.2+ (the app runs 19.3) and keeps oxlint's `exhaustive-deps` quiet without re-running the effect.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/features/chat && npx tsc -b`
Expected: PASS (all chat test files, 4 tests in `chat-turn`); `tsc` silent.

---

### Task 15: App layout — ⌘K / Ctrl+K, palette and event sheet mounted once

**Files:**
- Modify: `apps/web/src/components/layout/app-layout.tsx` (Replace)
- Test: `apps/web/src/components/layout/app-layout.test.tsx`

**Interfaces:**
- Consumes: `CommandPalette` (Task 4), `EventSheetHost` (Task 5), `useShellStore` (Task 1).
- Produces: `AppLayout()` (same export): global `keydown` listener — ⌘K or Ctrl+K (no Alt/Shift) toggles `paletteOpen` and prevents the browser default; renders `<CommandPalette />` and `<EventSheetHost />` once for every page.

- [ ] **Step 1: Write the failing test**

```tsx
// file: apps/web/src/components/layout/app-layout.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import type { EventDetail } from '@/features/journey/api'
import { routes } from '@/routes'
import { useEventSheet } from '@/stores/event-sheet-store'
import { useShellStore } from '@/stores/shell-store'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
const EVENT_ID = 'rule:start:NCT04708782'
const DETAIL: EventDetail = {
  event: {
    id: EVENT_ID,
    asset: 'trep',
    date: '2021-06-01',
    type: 'trial_start',
    category: 'clinical',
    title: 'Phase 3 trial started: TETON-1',
    significance: 'High',
    is_milestone: false,
    sources: [],
    via: 'journey',
  },
  records: [],
  neighbors: { prev: null, next: null },
  branchStats: { index: 1, total: 1, prevSameBranch: null },
}

function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/assets') return json(200, [])
      if (url.startsWith('/api/search?q=')) {
        return json(200, { assets: [], events: [{ id: EVENT_ID, asset: 'trep', assetName: 'Treprostinil', title: DETAIL.event.title, date: '2021-06-01', category: 'clinical', nct_id: 'NCT04708782' }] })
      }
      if (url === `/api/assets/trep/events/${encodeURIComponent(EVENT_ID)}`) return json(200, DETAIL)
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  useShellStore.setState({ paletteOpen: false, mobileNavOpen: false })
  useEventSheet.setState({ current: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('AppLayout', () => {
  it('toggles the command palette with ⌘K and Ctrl+K on any page', async () => {
    fakeApi()
    renderAt('/uploads')
    await screen.findByText('Coming soon')
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: 'Search PharmaEdge' })).toBeInTheDocument()
    await userEvent.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search PharmaEdge' })).not.toBeInTheDocument())
    expect(useShellStore.getState().paletteOpen).toBe(false)
  })

  it('opens the event sheet for an event picked in the palette', async () => {
    fakeApi()
    renderAt('/uploads')
    await screen.findByText('Coming soon')
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.type(await screen.findByRole('combobox', { name: 'Search PharmaEdge' }), 'TETON')
    await screen.findByRole('option', { name: /Phase 3 trial started: TETON-1/ })
    await userEvent.keyboard('{Enter}')
    const sheet = await screen.findByRole('dialog', { name: 'Phase 3 trial started: TETON-1' })
    expect(within(sheet).getByRole('button', { name: 'Show on the journey timeline' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run src/components/layout/app-layout.test.tsx`
Expected: FAIL — no dialog "Search PharmaEdge" after ⌘K (nothing listens yet).

- [ ] **Step 3: Implement** — **Replace** the layout:

```tsx
// file: apps/web/src/components/layout/app-layout.tsx
import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { EventSheetHost } from '@/features/journey/event-sheet-host'
import { useShellStore } from '@/stores/shell-store'
import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'
import { CommandPalette } from './command-palette'

/** ⌘K / Ctrl+K anywhere toggles the command palette (README §5.1). */
function usePaletteShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      const { paletteOpen, setPaletteOpen } = useShellStore.getState()
      setPaletteOpen(!paletteOpen)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function AppLayout() {
  usePaletteShortcut()
  return (
    <div className="flex h-dvh overflow-hidden">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <EventSheetHost />
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx vitest run src/components/layout src/features/auth src/features/chat && npx tsc -b`
Expected: PASS (layout, sidebar, header, palette tests; `auth-flow`, `chat-turn`, `asset-panel` stay green with the shell's extra requests answered 404); `tsc` silent.

---

### Task 16: Phase gate, container rebuild, live verification, commit

All steps run in the main checkout `/Users/abhisheksharma/Work/Hackathon-Mavericks/Pharmaedge-Hackathon_maverics` on `main`, after every task above is merged. Phase 1b must already be live in the `api` container (its gate rebuilt it).

**Files:** none new.

- [ ] **Step 1: Lint, typecheck, full test suite, build**

Run: `cd apps/web && npm run lint && npx tsc -b && npm test && npx vite build 2>&1 | tail -3`
Expected: oxlint 0 errors (pre-existing `only-export-components` warnings may remain; no new warnings from Phase 2 files except those shadcn generated in `components/ui/`); `tsc` silent; vitest: all files pass — 33 files, 182 tests (99 baseline + 83 new); build succeeds.

- [ ] **Step 2: Rebuild and restart the web container**

Run: `docker compose build web && docker compose up -d web && sleep 3 && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/`
Expected: image builds (`npm ci -w apps/web` installs cmdk from the lockfile), container recreated, `200`.

- [ ] **Step 3: API sanity checks behind the UI** (admin session via cookies)

```bash
EMAIL=$(grep '^ADMIN_EMAIL=' apps/api/.env | cut -d= -f2-) PASSWORD=$(grep '^ADMIN_PASSWORD=' apps/api/.env | cut -d= -f2-)
curl -s -c /tmp/pe2.cookies -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" http://localhost:8080/api/auth/login >/dev/null
curl -s -b /tmp/pe2.cookies 'http://localhost:8080/api/search?q=TETON' | jq '[.events[].title]'
curl -s -b /tmp/pe2.cookies 'http://localhost:8080/api/search?q=NCT04708782' | jq '[.events[] | {title, nct_id}]'
curl -s -b /tmp/pe2.cookies 'http://localhost:8080/api/portfolio/timeline?competitors=true' | jq '{assets: [.assets[].name], events: (.events | length)}'
curl -s -b /tmp/pe2.cookies http://localhost:8080/api/notifications | jq '{unread, n: (.items | length)}'
curl -s -b /tmp/pe2.cookies http://localhost:8080/api/me/prefs | jq .
```
Expected: TETON events listed; the NCT04708782 query returns its trial event; the portfolio lists the tracked assets with key events (> 0); notifications and prefs return JSON (no 404).

- [ ] **Step 4: Live checks in a browser** (Playwright MCP or Chrome at 1440 wide, signed in as the admin at http://localhost:8080) — one per "Done when" / acceptance item:
  1. **Every sidebar item navigates:** Home, Asset Search, Asset AI, Asset Journey, Company IR, Conferences, Uploads, Crawl jobs, Settings and each "Your assets" entry change the URL to the expected page. Collapse → reload → still collapsed (saved in `/me/prefs`); expand again.
  2. **⌘K finds "TETON" and "NCT04708782":** ⌘K opens the 620px palette; typing `TETON` lists TETON events under Events (first one highlighted); `NCT04708782` lists the trial event; ↑/↓ move, hover selects, ↵ on an event opens the event sheet, esc closes. Ctrl+K toggles too.
  3. **Home portfolio dots open the event sheet:** Home shows the hero (greeting, date, summary), the KPI strip, the portfolio timeline (range ±1 year / 3 years / All time, Show competitors), What changed, Next milestones, Crawls, Tracked assets, Competitive signals and Asset AI. Clicking a dot (including an AI event whose id contains `https://…`) opens the sheet with title, date and evidence; "Show on the journey timeline" lands on `/assets/<id>/overview?focus=<id>`.
  4. **Badges show on All / Primary / Competitors:** Asset Search table shows Primary/Competitor badges under each kind button with counts ("All N / Primary N / Competitors N"); `?view=grid` shows cards with badges and sparklines; the URL keeps `q`, `kind`, `view`.
  5. **Notifications and crawl chip (acceptance 11):** the bell shows the unread count; the popover lists notifications and "Mark all read" clears the badge. Start a short refresh — `curl -s -b /tmp/pe2.cookies -H 'Content-Type: application/json' -d '{"steps":["regulatory","journey","finalize"]}' http://localhost:8080/api/assets/treprostinil/refresh` — then within 15 s the top bar shows "Treprostinil · FDA · EMA n%", the sidebar shows the Crawl jobs live dot and Treprostinil's %, Home's Crawls card shows the live job; when it ends the chip reads "All crawls finished".
  6. **Mobile and Asset AI hand-off:** at 390px the hamburger opens the 260px drawer and a link closes it; the Home "Ask" input sends its question in a new chat (`/chat?ask=` → `/chat/<id>` with the question asked).

- [ ] **Step 5: Commit on `main`**

```bash
git status --short   # only the paths below; never infra/mongo/*
git add package-lock.json apps/web/package.json apps/web/src/index.css apps/web/src/test/setup.ts \
  apps/web/src/stores apps/web/src/lib \
  apps/web/src/components/ui/command.tsx apps/web/src/components/ui/input-group.tsx apps/web/src/components/ui/textarea.tsx \
  apps/web/src/components/layout \
  apps/web/src/features/assets apps/web/src/features/home apps/web/src/features/jobs apps/web/src/features/journey \
  apps/web/src/features/me apps/web/src/features/search apps/web/src/features/chat apps/web/src/features/data-hooks.test.tsx \
  apps/web/src/features/auth/auth-flow.test.tsx \
  docs/superpowers/plans/2026-10-09-v3-phase-2-shell-home-search.md
git commit -m "v3 phase 2: shell (Your assets, crawl chip, notifications, ⌘K palette), Home dashboard, Asset Search badges and grid"
```

(The commit message body ends with the `Co-Authored-By` line required by the session.)
