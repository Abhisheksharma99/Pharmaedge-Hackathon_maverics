# v3 Phase 0: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the v3 design tokens, journey types/constants, date helpers, the SVG chart primitives and `KindBadge` that every later phase builds on.

**Architecture:** Pure presentational code in `apps/web` only. Tokens live in `src/index.css` (CSS vars + `@theme` mappings, motion keyframes, a global reduced-motion rule). Charts are small pure-SVG/HTML React components under `src/components/charts/`, sized by a `ResizeObserver` hook, ported from `docs/design/asset-journey-v3/design_files/pe/analytics.jsx` and `aj/sheet.jsx`. Data colours come from `features/journey/constants.ts`.

**Tech Stack:** React 19, TypeScript 6, Tailwind v4 (`@theme`), lucide-react, shadcn Tooltip (Radix), vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-09-asset-journey-v3-design.md`; screen/token source `docs/design/asset-journey-v3/README.md` §4, `PHASE_DETAILS.md` Phase 0.

## Global Constraints

- Colours, type, radii, shadows and motion values are exactly those in handoff README §4 (copied into Task 1).
- Every animation respects `prefers-reduced-motion: reduce` (no transforms, instant opacity).
- Animate with CSS keyframes on mount only (`transform-box: fill-box`); never animate on re-render.
- Chart cards use `container-type: inline-size` (Tailwind `@container`).
- No new UI libraries (cmdk arrives in Phase 2, not here). No Recharts in new charts.
- Lint (`oxlint`), `tsc -b`, vitest all pass; tests produce no `console.error`/`console.warn`.
- Commit once at the end of the phase, on `main`, never staging `infra/mongo/*`.

## Review Focus

- **Empty data** (a newly onboarding asset has no events/records): every chart renders without `NaN`, crash or a bogus total; a donut over no data shows `0`, not `1` (the prototype bug). Tests in Tasks 5–7.
- **Zero denominators**: a funnel step after a `0` step shows `—`, not `NaN%`/`Infinity%`. Test in Task 6.
- **Partial or missing dates** (`""`, `"2021"`, `"2021-03"`): `yearFraction("")` is `NaN`, partial dates resolve to the start of the period, `formatDay("")` is `Undated`. Test in Task 2.
- **Past dates in countdowns** (stale milestones): `relativeFuture` of a past date reads "… ago", never "in -30 days". Test in Task 2.
- **Out-of-range bars** (end before start, patent expiry beyond the axis): Gantt clamps to the axis and keeps a minimum width; a "Today" marker outside the range is not drawn. Test in Task 7.

---

### Task 1: Design tokens and motion

**Files:**
- Modify: `apps/web/src/index.css`

**Interfaces:**
- Produces (Tailwind utilities used by later tasks): `bg-primary-soft`, `text-competitor`, `bg-hair`/`border-hair`, `text-faint`, `bg-cat-<category>`/`bg-cat-<category>-soft`/`text-cat-<category>` (category ∈ regulatory, clinical, safety, company, ip), `bg-tag-<tag>`/`text-tag-<tag>` (important, missed, question, risk, opportunity), `text-star`, `shadow-panel`, `shadow-card-hover`, `shadow-card-active`, `shadow-popover`, `shadow-sheet`, `shadow-dialog`, `shadow-focus`, `animate-grow`, `animate-grow-x`, `animate-fade-up`, `animate-fade`, easing `ease-out-soft`, `ease-spring`.

- [ ] **Step 1: Add the token mappings to the existing `@theme inline` block**

In `apps/web/src/index.css`, inside `@theme inline { … }`, add after `--color-text-secondary: var(--text-secondary);`:

```css
    --color-hair: var(--hair);
    --color-faint: var(--faint);
    --color-primary-soft: var(--primary-soft);
    --color-competitor: var(--competitor);
    --color-cat-regulatory: var(--cat-regulatory);
    --color-cat-regulatory-soft: var(--cat-regulatory-soft);
    --color-cat-clinical: var(--cat-clinical);
    --color-cat-clinical-soft: var(--cat-clinical-soft);
    --color-cat-safety: var(--cat-safety);
    --color-cat-safety-soft: var(--cat-safety-soft);
    --color-cat-company: var(--cat-company);
    --color-cat-company-soft: var(--cat-company-soft);
    --color-cat-ip: var(--cat-ip);
    --color-cat-ip-soft: var(--cat-ip-soft);
    --color-tag-important: var(--tag-important);
    --color-tag-missed: var(--tag-missed);
    --color-tag-question: var(--tag-question);
    --color-tag-risk: var(--tag-risk);
    --color-tag-opportunity: var(--tag-opportunity);
    --color-star: var(--star);
    --color-star-stroke: var(--star-stroke);
```

- [ ] **Step 2: Add a non-inline `@theme` block for shadows, easing and motion**

Directly after the closing `}` of `@theme inline`, add:

```css
/* v3 shadows, easing and motion (docs/design/asset-journey-v3/README.md §4) */
@theme {
    --shadow-panel: 0 1px 2px rgba(16, 24, 40, 0.04);
    --shadow-card-hover: 0 10px 24px rgba(16, 24, 40, 0.08);
    --shadow-card-active: 0 16px 40px rgba(35, 71, 217, 0.1);
    --shadow-popover: 0 12px 32px rgba(16, 24, 40, 0.14);
    --shadow-sheet: -16px 0 40px rgba(16, 24, 40, 0.16);
    --shadow-dialog: 0 24px 60px rgba(16, 24, 40, 0.25);
    --shadow-focus: 0 0 0 3px rgba(35, 71, 217, 0.12);
    --ease-out-soft: cubic-bezier(0.2, 0.8, 0.2, 1);
    --ease-spring: cubic-bezier(0.2, 1.6, 0.4, 1);
    --animate-grow: grow 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    --animate-grow-x: grow-x 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    --animate-fade-up: fade-up 0.45s both;
    --animate-fade: fade 0.5s both;

    @keyframes grow {
        from { transform: scaleY(0); }
        to { transform: none; }
    }
    @keyframes grow-x {
        from { transform: scaleX(0); }
        to { transform: none; }
    }
    @keyframes fade-up {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: none; }
    }
    @keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
    }
}
```

- [ ] **Step 3: Add the CSS variables to `:root`**

In `:root { … }`, after `--text-secondary: #475467;`, add:

```css
    /* v3 tokens (docs/design/asset-journey-v3/README.md §4) */
    --hair: #eef0f3;
    --faint: #98a2b3;
    --primary-soft: #eef2fd;
    --competitor: #9a3f06;
    --cat-regulatory: #2347d9;
    --cat-regulatory-soft: #eef2fd;
    --cat-clinical: #0b7a6f;
    --cat-clinical-soft: #e6f4f2;
    --cat-safety: #b42318;
    --cat-safety-soft: #fef3f2;
    --cat-company: #e0620f;
    --cat-company-soft: #fdeee4;
    --cat-ip: #6941c6;
    --cat-ip-soft: #f4f3ff;
    --coll-fda: #2347d9;
    --coll-ema: #5873e8;
    --coll-trial: #0b7a6f;
    --coll-publication: #475467;
    --coll-conference: #7a5af8;
    --coll-patent: #6941c6;
    --coll-company: #e0620f;
    --coll-articles: #98a2b3;
    --branch-1: #2347d9;
    --branch-2: #0b7a6f;
    --branch-3: #6941c6;
    --branch-4: #e0620f;
    --branch-5: #0e7490;
    --branch-6: #b54708;
    --tag-important: #b42318;
    --tag-missed: #6941c6;
    --tag-question: #2347d9;
    --tag-risk: #b54708;
    --tag-opportunity: #0b7a6f;
    --star: #fdb022;
    --star-stroke: #dc8a0e;
    --phase-1: #98a2b3;
    --phase-2: #7a5af8;
    --phase-3: #2347d9;
    --phase-4: #0b7a6f;
```

- [ ] **Step 4: Add the global reduced-motion rule**

At the end of the existing `@layer base { … }` block (before its closing `}`), add:

```css
  /* Reduced motion: no transforms, instant opacity (README §4 "Motion"). */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
```

- [ ] **Step 5: Verify the CSS compiles**

Run: `cd apps/web && npx vite build 2>&1 | tail -5`
Expected: build succeeds (`✓ built in …`), no CSS errors.

---

### Task 2: Date helpers

**Files:**
- Create: `apps/web/src/lib/dates.ts`
- Test: `apps/web/src/lib/dates.test.ts`

**Interfaces:**
- Consumes: `formatDate`, `formatMonth` from `apps/web/src/lib/format.ts`.
- Produces:
  - `todayIso(): string` — local today `YYYY-MM-DD`.
  - `yearFraction(iso: string | null | undefined): number` — `y + ((m-1)*30.4 + d)/365`; `NaN` if not a date.
  - `fromYearFraction(f: number): string` — inverse used by hover-to-add (month 1–12, day clamped 1–28).
  - `interpolateDate(fa: number, fb: number, t: number): string` — date at fraction `t` (clamped 0–1) between two year fractions.
  - `clampDay(d: number): number` — 1–28.
  - `daysBetween(a: string, b: string): number` — whole days from `a` to `b`.
  - `relativeFuture(iso: string, today?: string): string` — "in 9 months", "in 12 days", "in 1.6 years", "today", "3 months ago".
  - `formatDay(iso: string | null | undefined): string` — "May 21, 2002"; "Mar 2021"; "Undated".
  - re-exports `formatDate`, `formatMonth`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/dates.test.ts`:

```ts
import { clampDay, daysBetween, formatDay, fromYearFraction, interpolateDate, relativeFuture, yearFraction } from './dates'

describe('yearFraction', () => {
  it('maps a full date with the design formula', () => {
    expect(yearFraction('2002-05-21')).toBeCloseTo(2002 + (4 * 30.4 + 21) / 365, 6)
  })
  it('treats partial dates as the start of the period', () => {
    expect(yearFraction('2021')).toBeCloseTo(2021 + 1 / 365, 6)
    expect(yearFraction('2021-03')).toBeCloseTo(2021 + (2 * 30.4 + 1) / 365, 6)
  })
  it('is NaN for missing or invalid dates', () => {
    expect(yearFraction('')).toBeNaN()
    expect(yearFraction(null)).toBeNaN()
    expect(yearFraction('soon')).toBeNaN()
  })
})

describe('fromYearFraction / interpolateDate', () => {
  it('round-trips a mid-month date to the same month', () => {
    expect(fromYearFraction(yearFraction('2005-04-15'))).toMatch(/^2005-04-/)
  })
  it('never produces a day above 28 or below 1', () => {
    for (let f = 2000; f < 2001; f += 0.013) {
      const day = Number(fromYearFraction(f).slice(8))
      expect(day).toBeGreaterThanOrEqual(1)
      expect(day).toBeLessThanOrEqual(28)
    }
  })
  it('interpolates halfway between two dates and clamps t', () => {
    const a = yearFraction('2004-01-01')
    const b = yearFraction('2006-01-01')
    expect(interpolateDate(a, b, 0.5)).toMatch(/^2005-0[01]-/)
    expect(interpolateDate(a, b, -1)).toBe(fromYearFraction(a))
    expect(interpolateDate(a, b, 9)).toBe(fromYearFraction(b))
  })
  it('clampDay keeps days within 1–28', () => {
    expect(clampDay(0)).toBe(1)
    expect(clampDay(31)).toBe(28)
    expect(clampDay(14)).toBe(14)
  })
})

describe('relativeFuture', () => {
  const today = '2026-10-09'
  it('counts days under 45 days', () => {
    expect(relativeFuture('2026-10-21', today)).toBe('in 12 days')
    expect(relativeFuture('2026-10-10', today)).toBe('in 1 day')
  })
  it('counts months under 18 months, then years', () => {
    expect(relativeFuture('2027-07-09', today)).toBe('in 9 months')
    expect(relativeFuture('2028-05-30', today)).toBe('in 1.6 years')
  })
  it('handles today and past dates', () => {
    expect(relativeFuture(today, today)).toBe('today')
    expect(relativeFuture('2026-09-29', today)).toBe('10 days ago')
    expect(relativeFuture('2026-07-09', today)).toBe('3 months ago')
    expect(relativeFuture('2023-10-09', today)).toBe('3.0 years ago')
  })
  it('is empty for an invalid date', () => {
    expect(relativeFuture('', today)).toBe('')
  })
})

describe('daysBetween / formatDay', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-10-01', '2026-10-09')).toBe(8)
    expect(daysBetween('2026-10-09', '2026-10-01')).toBe(-8)
  })
  it('formats like the design', () => {
    expect(formatDay('2002-05-21')).toBe('May 21, 2002')
    expect(formatDay('2021-03')).toBe('Mar 2021')
    expect(formatDay('2021')).toBe('2021')
    expect(formatDay('')).toBe('Undated')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/lib/dates.test.ts`
Expected: FAIL — `Failed to resolve import "./dates"`.

- [ ] **Step 3: Implement `apps/web/src/lib/dates.ts`**

```ts
export { formatDate, formatMonth } from './format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000
const ISO = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/

/** Today in local time, `YYYY-MM-DD`. */
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "2002-05-21" → 2002.39 (the design's formula: `y + ((m-1)·30.4 + d)/365`). Partial dates start the period; NaN when not a date. */
export function yearFraction(iso: string | null | undefined): number {
  const m = ISO.exec(iso ?? '')
  if (!m) return NaN
  const month = Number(m[2] ?? 1)
  const day = Number(m[3] ?? 1)
  return Number(m[1]) + ((month - 1) * 30.4 + day) / 365
}

export const clampDay = (d: number) => Math.min(28, Math.max(1, d))

/** Inverse of `yearFraction` for hover-to-add: the day is clamped to 1–28 so every month is valid. */
export function fromYearFraction(f: number): string {
  const year = Math.floor(f)
  const mf = (f - year) * 12
  const month = Math.min(12, Math.max(1, Math.floor(mf) + 1))
  const day = clampDay(Math.round((mf - (month - 1)) * 28) + 1)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The date a fraction `t` (0–1) of the way from year fraction `fa` to `fb`. */
export function interpolateDate(fa: number, fb: number, t: number): string {
  const k = Math.min(1, Math.max(0, t))
  return fromYearFraction(fa + k * (fb - fa))
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY_MS)
}

/** Countdown copy: "in 12 days", "in 9 months", "in 1.6 years"; past dates read "… ago". */
export function relativeFuture(iso: string, today: string = todayIso()): string {
  if (!ISO.test(iso)) return ''
  const days = daysBetween(today, iso)
  if (Number.isNaN(days)) return ''
  if (days === 0) return 'today'
  const n = Math.abs(days)
  const months = Math.round(n / 30.4)
  const span = n < 45 ? `${n} day${n === 1 ? '' : 's'}` : months < 18 ? `${months} months` : `${(n / 365).toFixed(1)} years`
  return days > 0 ? `in ${span}` : `${span} ago`
}

/** "2002-05-21" → "May 21, 2002"; "2021-03" → "Mar 2021"; "" → "Undated". Never shifts by timezone. */
export function formatDay(iso: string | null | undefined): string {
  const m = ISO.exec(iso ?? '')
  if (!m) return 'Undated'
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : undefined
  if (!month) return m[1]!
  return m[3] ? `${month} ${Number(m[3])}, ${m[1]}` : `${month} ${m[1]}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run src/lib/dates.test.ts`
Expected: PASS (all tests).

---

### Task 3: Journey types and constants

**Files:**
- Create: `apps/web/src/features/journey/types.ts`
- Create: `apps/web/src/features/journey/constants.ts`
- Test: `apps/web/src/features/journey/constants.test.ts`

**Interfaces:**
- Consumes: `JourneyEvent`, `EventCategory`, `Significance`, `RecordTab` from `@/features/assets/api`; `Job` from `@/features/jobs/api`; `CATEGORY_META` from `@/features/assets/components/badges`.
- Produces (types): `NoteTag`, `EventVia`, `NoteMeta`, `JourneyEventV3`, `Branch`, `EventComment`, `Annotations`, `JobFeedItem`, `JobProgress`, `AnalyticsPin`, `AnalyticsSpec`, `SourceRef`.
- Produces (constants): `CATEGORIES: EventCategory[]`, `CATEGORY_META: Record<EventCategory, {label, icon, tone, color, soft}>`, `COLLECTION_META: Record<string, {label, color, tab}>`, `collectionMeta(coll)`, `BRANCH_PALETTE: string[]`, `NOTE_TAGS: Record<NoteTag, {color}>`, `NOTE_TAG_LIST: NoteTag[]`, `PHASE_COLORS`, `STAGES`, `SIGNIFICANCE_COLORS`, `STAR`, `trialStatusColor(status)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/journey/constants.test.ts`:

```ts
import { BRANCH_PALETTE, CATEGORIES, CATEGORY_META, collectionMeta, NOTE_TAG_LIST, NOTE_TAGS, STAGES, trialStatusColor } from './constants'

describe('journey constants', () => {
  it('orders the branch palette trunk-first, as in the design', () => {
    expect(BRANCH_PALETTE).toEqual(['#2347d9', '#0b7a6f', '#6941c6', '#e0620f', '#0e7490', '#b54708'])
  })
  it('gives every category a colour, a soft colour and an icon', () => {
    for (const c of CATEGORIES) {
      expect(CATEGORY_META[c].color).toMatch(/^#[0-9a-f]{6}$/)
      expect(CATEGORY_META[c].soft).toMatch(/^#[0-9a-f]{6}$/)
      expect(CATEGORY_META[c].icon).toBeTruthy()
    }
  })
  it('lists note tags in design order with their colours', () => {
    expect(NOTE_TAG_LIST).toEqual(['Important', 'Missed by AI', 'Question', 'Risk', 'Opportunity'])
    expect(NOTE_TAGS['Missed by AI'].color).toBe('#6941c6')
  })
  it('has the five pipeline stages', () => {
    expect(STAGES).toEqual(['Phase 1', 'Phase 2', 'Phase 3', 'Filed', 'Approved'])
  })
  it('maps trial statuses to colours', () => {
    expect(trialStatusColor('RECRUITING')).toBe('#2347d9')
    expect(trialStatusColor('Active, not recruiting')).toBe('#5873e8')
    expect(trialStatusColor('COMPLETED')).toBe('#0b7a6f')
    expect(trialStatusColor('TERMINATED')).toBe('#b42318')
    expect(trialStatusColor('')).toBe('#98a2b3')
  })
  it('falls back for unknown collections', () => {
    expect(collectionMeta('trial_records').tab).toBe('clinical')
    expect(collectionMeta('mystery_records')).toEqual({ label: 'mystery', color: '#98a2b3', tab: null })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/features/journey/constants.test.ts`
Expected: FAIL — cannot resolve `./constants`.

- [ ] **Step 3: Create `apps/web/src/features/journey/types.ts`**

```ts
import type { EventCategory, JourneyEvent, Significance } from '@/features/assets/api'
import type { Job } from '@/features/jobs/api'

export type { EventCategory, Significance }

export type NoteTag = 'Important' | 'Missed by AI' | 'Question' | 'Risk' | 'Opportunity'
/** How an event entered the journey: rule / AI consolidation / rebuild / team member. */
export type EventVia = 'journey' | 'ai_events' | 'finalize' | 'user'

export interface SourceRef {
  collection: string
  record_key: string
}

export interface NoteMeta {
  tag: NoteTag
  by: { id: string; name: string }
  created_at: string
  mode: 'manual' | 'ai'
}

/** JourneyEvent v3: existing fields + optional enrichment (DATA_CONTRACTS §A). */
export interface JourneyEventV3 extends JourneyEvent {
  via: EventVia
  /** e.g. ['PH-ILD (WHO Group 3)']; shown as "Targets". */
  indications?: string[]
  product?: string | null
  /** Ordered key facts: Application, Trial, Phase, Enrollment, Primary endpoint, Status, Sponsor, … */
  details?: Record<string, string>
  /** "Why it matters" (one sentence). */
  impact?: string | null
  /** Branch id; the trunk when absent. */
  branch?: string
  /** Extra branch ids the event also covers (dotted bridge). */
  span?: string[]
  /** Related event ids (subtree + detail "Linked events"). */
  links?: string[]
  /** Only when via === 'user'. */
  user?: NoteMeta
  /** In the "Key events" scope (spec §4.1). */
  key?: boolean
  /** Evidence folded in by AI consolidation. */
  merged_sources?: SourceRef[]
}

export interface Branch {
  id: string
  label: string
  full: string
  color: string
  /** Lane offset: 0 = trunk, negative = left of trunk (vertical) / above (horizontal). */
  off: number
  trunk?: boolean
  from?: string
  why?: string
  status: string
  ended?: 'Terminated' | 'Withdrawn' | null
  origin: 'rule' | 'ai' | 'user'
}

export interface EventComment {
  id: string
  by: { id: string; name: string }
  at: string
  text: string
}

export interface Annotations {
  /** Event ids starred by the current user. */
  stars: string[]
  /** By event id (team-visible). */
  comments: Record<string, EventComment[]>
  /** Team notes (via: 'user'). */
  notes: JourneyEventV3[]
}

export interface JobFeedItem {
  id: number
  t: string
  /** Step name or 'plan'. */
  step: string
  kind: 'info' | 'done' | 'warn' | 'ai' | 'event'
  text: string
  verdict?: 'Ingest' | 'Headline' | 'Skip'
  event_id?: string
  merged?: number
}

export interface JobProgress extends Job {
  /** Records per collection so far. */
  records: { coll: string; count: number }[]
  events_created: number
  feed_cursor: number
  /** Asset records per collection and year, for the forming timeline. */
  record_years: { coll: string; year: number; n: number }[]
}

export interface AnalyticsSpec {
  id: string
  title: string
  chart: 'bars' | 'hbar' | 'stack' | 'donut' | 'gantt' | 'heat' | 'list' | 'none'
  data?: unknown
  cols?: (string | number)[]
  series?: { k: string; l: string; c: string; vals: number[] }[]
  unit?: string
  note?: string
  method: 'index' | 'web' | 'none'
  /** Record keys or URLs; never empty unless method === 'none'. */
  sources: string[]
  refreshed_at: string
}

export interface AnalyticsPin {
  key?: string
  custom?: AnalyticsSpec
}
```

- [ ] **Step 4: Create `apps/web/src/features/journey/constants.ts`**

```ts
import type { RecordTab } from '@/features/assets/api'
import { CATEGORY_META as BASE_CATEGORY_META } from '@/features/assets/components/badges'
import type { EventCategory, NoteTag } from './types'

export const CATEGORIES: EventCategory[] = ['regulatory', 'clinical', 'safety', 'company', 'ip']

const CATEGORY_COLORS: Record<EventCategory, { color: string; soft: string }> = {
  regulatory: { color: '#2347d9', soft: '#eef2fd' },
  clinical: { color: '#0b7a6f', soft: '#e6f4f2' },
  safety: { color: '#b42318', soft: '#fef3f2' },
  company: { color: '#e0620f', soft: '#fdeee4' },
  ip: { color: '#6941c6', soft: '#f4f3ff' },
}

/** Label, icon and tone from the existing badges, plus the v3 hex colours for SVG. */
export const CATEGORY_META = Object.fromEntries(
  CATEGORIES.map((c) => [c, { ...BASE_CATEGORY_META[c], ...CATEGORY_COLORS[c] }]),
) as Record<EventCategory, (typeof BASE_CATEGORY_META)[EventCategory] & { color: string; soft: string }>

export interface CollectionMeta {
  label: string
  color: string
  tab: RecordTab | null
}

export const COLLECTION_META: Record<string, CollectionMeta> = {
  fda_records: { label: 'FDA', color: '#2347d9', tab: 'regulatory' },
  ema_records: { label: 'EMA', color: '#5873e8', tab: 'regulatory' },
  trial_records: { label: 'ClinicalTrials.gov', color: '#0b7a6f', tab: 'clinical' },
  publication_records: { label: 'PubMed', color: '#475467', tab: 'publications' },
  conference_records: { label: 'Conferences', color: '#7a5af8', tab: 'conferences' },
  patent_records: { label: 'Patents', color: '#6941c6', tab: 'patents' },
  company_records: { label: 'Company', color: '#e0620f', tab: 'company-ir' },
  articles: { label: 'News', color: '#98a2b3', tab: 'news' },
  web_records: { label: 'Web', color: '#98a2b3', tab: null },
}

export function collectionMeta(coll: string): CollectionMeta {
  return COLLECTION_META[coll] ?? { label: coll.replace(/_records$/, ''), color: '#98a2b3', tab: null }
}

/** Indication branches, trunk first; assigned by branch order and persisted on the branch doc. */
export const BRANCH_PALETTE = ['#2347d9', '#0b7a6f', '#6941c6', '#e0620f', '#0e7490', '#b54708']

export const NOTE_TAG_LIST: NoteTag[] = ['Important', 'Missed by AI', 'Question', 'Risk', 'Opportunity']
export const NOTE_TAGS: Record<NoteTag, { color: string }> = {
  Important: { color: '#b42318' },
  'Missed by AI': { color: '#6941c6' },
  Question: { color: '#2347d9' },
  Risk: { color: '#b54708' },
  Opportunity: { color: '#0b7a6f' },
}

export const STAR = { fill: '#fdb022', stroke: '#dc8a0e' }

export const PHASE_COLORS: Record<string, string> = {
  'Phase 1': '#98a2b3',
  'Phase 2': '#7a5af8',
  'Phase 3': '#2347d9',
  'Phase 4': '#0b7a6f',
}

export const STAGES = ['Phase 1', 'Phase 2', 'Phase 3', 'Filed', 'Approved'] as const

export const SIGNIFICANCE_COLORS = { High: '#b42318', Medium: '#dc8a0e', Low: '#98a2b3' } as const

/** Trial status → chart colour (recruiting, active, completed, terminated, other). */
export function trialStatusColor(status: string): string {
  if (/recruit/i.test(status) && !/not.recruiting/i.test(status)) return '#2347d9'
  if (/active/i.test(status)) return '#5873e8'
  if (/complet/i.test(status)) return '#0b7a6f'
  if (/terminat/i.test(status)) return '#b42318'
  return '#98a2b3'
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/features/journey/constants.test.ts`
Expected: PASS.

---

### Task 4: Chart frame — width hook, ChartGrid/ChartCard, Legend, Stat

**Files:**
- Create: `apps/web/src/lib/use-element-width.ts`
- Create: `apps/web/src/components/charts/chart-card.tsx`
- Create: `apps/web/src/components/charts/legend.tsx`
- Create: `apps/web/src/components/charts/stat.tsx`
- Test: `apps/web/src/components/charts/charts.test.tsx`

**Interfaces:**
- Produces:
  - `useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>): number` (0 until measured; jsdom has no ResizeObserver → stays at the measured rect width, 0).
  - `ChartGrid({ children, className? })` — 4 columns, 2 at ≤1180px, 1 at ≤700px.
  - `ChartCard({ title, description?, span?: 1|2|3|4, actions?, children, className? })`.
  - `Legend({ items: LegendItem[], className? })`, `LegendItem = { l: string; c: string; v?: number }`.
  - `Stat({ icon: LucideIcon, label, value: ReactNode, sub?, color? })`, `StatRow({ children })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/charts/charts.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import { Landmark } from 'lucide-react'
import { ChartCard, ChartGrid } from './chart-card'
import { Legend } from './legend'
import { Stat, StatRow } from './stat'

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error')
  warnSpy = vi.spyOn(console, 'warn')
})
afterEach(() => {
  expect(errorSpy).not.toHaveBeenCalled()
  expect(warnSpy).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

describe('ChartCard / ChartGrid', () => {
  it('renders title, description and content, spanning columns', () => {
    render(
      <ChartGrid>
        <ChartCard title="Source mix" description="Records by collection" span={2}>
          <p>body</p>
        </ChartCard>
      </ChartGrid>,
    )
    const card = screen.getByRole('region', { name: 'Source mix' })
    expect(within(card).getByText('Records by collection')).toBeInTheDocument()
    expect(within(card).getByText('body')).toBeInTheDocument()
    expect(card.className).toMatch(/col-span-2/)
  })
})

describe('Legend', () => {
  it('lists items with formatted values', () => {
    render(<Legend items={[{ l: 'fda', c: '#2347d9', v: 1240 }, { l: 'ema', c: '#5873e8' }]} />)
    expect(screen.getByText('fda')).toBeInTheDocument()
    expect(screen.getByText('1,240')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('Stat', () => {
  it('shows label, value and sub line', () => {
    render(
      <StatRow>
        <Stat icon={Landmark} label="Approved indications" value={2} sub="US, EU" color="#0b7a6f" />
      </StatRow>,
    )
    expect(screen.getByText('Approved indications')).toBeInTheDocument()
    expect(screen.getByText('2')).toHaveStyle({ color: '#0b7a6f' })
    expect(screen.getByText('US, EU')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/components/charts/charts.test.tsx`
Expected: FAIL — cannot resolve `./chart-card`.

- [ ] **Step 3: Create `apps/web/src/lib/use-element-width.ts`**

```ts
import { useLayoutEffect, useState, type RefObject } from 'react'

/** Live width of an element (ResizeObserver); 0 until measured. */
export function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}
```

- [ ] **Step 4: Create `apps/web/src/components/charts/chart-card.tsx`**

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const SPAN: Record<1 | 2 | 3 | 4, string> = {
  1: '',
  2: 'min-[701px]:col-span-2',
  3: 'min-[701px]:col-span-2 min-[1181px]:col-span-3',
  4: 'min-[701px]:col-span-2 min-[1181px]:col-span-4',
}

/** Chart grid: 4 columns, 2 at ≤1180px, 1 at ≤700px. */
export function ChartGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 min-[701px]:grid-cols-2 min-[1181px]:grid-cols-4', className)}>{children}</div>
  )
}

/** White chart card; a container-query context so charts adapt to the card, not the viewport. */
export function ChartCard({
  title,
  description,
  span = 1,
  actions,
  children,
  className,
}: {
  title: string
  description?: string
  span?: 1 | 2 | 3 | 4
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        '@container flex min-w-0 animate-fade-up flex-col rounded-[14px] border bg-card shadow-panel',
        SPAN[span],
        className,
      )}
    >
      <div className="flex justify-between gap-2.5 px-4 pt-3.5 pb-1">
        <div className="min-w-0">
          <h4 className="text-[13.5px] font-semibold">{title}</h4>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="relative flex-1 px-4 pt-2 pb-3.5">{children}</div>
    </section>
  )
}
```

- [ ] **Step 5: Create `apps/web/src/components/charts/legend.tsx`**

```tsx
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface LegendItem {
  l: string
  c: string
  v?: number
}

export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn('mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-text-secondary', className)}>
      {items.map((i) => (
        <li key={i.l} className="inline-flex items-center gap-[5px]">
          <i aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: i.c }} />
          {i.l}
          {i.v != null && <span className="font-mono text-[10.5px] text-muted-foreground">{formatNumber(i.v)}</span>}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 6: Create `apps/web/src/components/charts/stat.tsx`**

```tsx
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** Analytics stat cell (label with icon, big value, one-line sub). */
export function Stat({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  sub?: string
  color?: string
}) {
  return (
    <div className="flex min-w-0 animate-fade-up flex-col gap-1 bg-card px-4 py-3.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </span>
      <span
        className="text-[26px] leading-[30px] font-[650] tracking-[-0.02em] tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
      {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
}

/** Stats separated by 1px rules inside one rounded frame (auto-fit ≥170px). */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-px overflow-hidden rounded-[14px] border bg-border">
      {children}
    </div>
  )
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run src/components/charts/charts.test.tsx`
Expected: PASS (3 describe blocks).

---

### Task 5: Bar charts — VBars, StackBars, HBars

**Files:**
- Create: `apps/web/src/components/charts/v-bars.tsx`
- Create: `apps/web/src/components/charts/stack-bars.tsx`
- Create: `apps/web/src/components/charts/h-bars.tsx`
- Test: `apps/web/src/components/charts/charts.test.tsx` (append)

**Interfaces:**
- Consumes: `useElementWidth` (Task 4), `Legend` (Task 4), `formatNumber`.
- Produces:
  - `BarDatum = { l: string; v: number; c?: string }`
  - `VBars({ data: BarDatum[]; h?: number; unit?: string })` — SVG `role="img"`, label `"<l>: <v><unit>, …"`.
  - `Series = { k: string; l: string; c: string; vals: number[] }`
  - `StackBars({ cols: (string|number)[]; series: Series[]; h?: number; every?: number })` — 4-digit year columns are labelled `’YY`; hover shows a tooltip `"<col> · <total>"`.
  - `HBars({ data: BarDatum[]; unit?: string })` — list rows, labels clamp to 2 lines.

- [ ] **Step 1: Append the failing tests**

Add to the imports of `charts.test.tsx`:

```tsx
import userEvent from '@testing-library/user-event'
import { HBars } from './h-bars'
import { StackBars } from './stack-bars'
import { VBars } from './v-bars'
```

Append:

```tsx
describe('VBars', () => {
  it('draws one bar per datum with value and label', () => {
    const { container } = render(<VBars data={[{ l: 'P1', v: 1 }, { l: 'P2', v: 3 }, { l: 'P3', v: 9, c: '#2347d9' }]} />)
    expect(screen.getByRole('img', { name: 'P1: 1, P2: 3, P3: 9' })).toBeInTheDocument()
    expect(container.querySelectorAll('rect')).toHaveLength(3)
    expect(screen.getByText('P3')).toBeInTheDocument()
  })
  it('renders empty data without NaN', () => {
    const { container } = render(<VBars data={[]} />)
    expect(container.innerHTML).not.toMatch(/NaN/)
  })
})

describe('StackBars', () => {
  const cols = [2024, 2025, 2026]
  const series = [
    { k: 'regulatory', l: 'Regulatory', c: '#2347d9', vals: [1, 0, 2] },
    { k: 'clinical', l: 'Clinical', c: '#0b7a6f', vals: [3, 1, 0] },
  ]
  it('stacks non-zero values, labels years as ’YY and totals the legend', () => {
    const { container } = render(<StackBars cols={cols} series={series} />)
    // 3 hover-band rects + 4 non-zero segments
    expect(container.querySelectorAll('rect')).toHaveLength(7)
    expect(screen.getByText('’24')).toBeInTheDocument()
    const legend = screen.getByRole('list')
    expect(within(legend).getByText('Regulatory')).toBeInTheDocument()
    expect(within(legend).getByText('3')).toBeInTheDocument() // Regulatory total (1 + 0 + 2)
  })
  it('shows a tooltip with the column breakdown on hover', async () => {
    const { container } = render(<StackBars cols={cols} series={series} />)
    await userEvent.hover(container.querySelectorAll('svg > g')[4]!) // first column group after 4 gridlines
    expect(screen.getByRole('tooltip')).toHaveTextContent('2024 · 4')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Regulatory 1 · Clinical 3')
  })
  it('renders all-zero series without NaN', () => {
    const { container } = render(<StackBars cols={cols} series={[{ k: 'x', l: 'X', c: '#000', vals: [0, 0, 0] }]} />)
    expect(container.innerHTML).not.toMatch(/NaN/)
  })
})

describe('HBars', () => {
  it('lists rows with proportional widths and units', () => {
    render(<HBars data={[{ l: 'PAH', v: 1965 }, { l: 'IPF', v: 1224, c: '#0b7a6f' }]} unit=" pts" />)
    expect(screen.getByText('PAH')).toBeInTheDocument()
    expect(screen.getByText('1,965 pts')).toBeInTheDocument()
    const bars = screen.getAllByRole('listitem').map((li) => li.querySelector('i') as HTMLElement)
    expect(bars[0]).toHaveStyle({ width: '100%' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/components/charts/charts.test.tsx`
Expected: FAIL — cannot resolve `./h-bars`.

- [ ] **Step 3: Create `apps/web/src/components/charts/v-bars.tsx`**

```tsx
import { useRef, useState } from 'react'
import { useElementWidth } from '@/lib/use-element-width'

export interface BarDatum {
  l: string
  v: number
  c?: string
}

/** Vertical bars with value labels (Trials by phase). */
export function VBars({ data, h = 150, unit = '' }: { data: BarDatum[]; h?: number; unit?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const W = Math.max(useElementWidth(ref), 200)
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.v))
  const slot = (W - 10) / Math.max(1, data.length)
  const bw = Math.max(4, Math.min(46, slot - 8))
  return (
    <div ref={ref} className="relative">
      <svg
        width={W}
        height={h + 34}
        className="block overflow-visible"
        role="img"
        aria-label={data.map((d) => `${d.l}: ${d.v}${unit}`).join(', ')}
      >
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={h - h * f + 8} y2={h - h * f + 8} stroke="#eef0f3" />
        ))}
        {data.map((d, i) => {
          const x = 5 + i * slot + (slot - bw) / 2
          const bh = Math.max(2, (d.v / max) * h)
          return (
            <g key={d.l} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect
                x={x}
                y={h - bh + 8}
                width={bw}
                height={bh}
                rx={4}
                fill={d.c ?? '#2347d9'}
                opacity={hover == null || hover === i ? 1 : 0.45}
                className="origin-bottom animate-grow [transform-box:fill-box]"
                style={{ animationDelay: `${i * 40}ms` }}
              />
              <text x={x + bw / 2} y={h - bh + 2} textAnchor="middle" className="fill-secondary-foreground font-mono text-[11px] font-semibold">
                {d.v}
                {unit}
              </text>
              <text x={x + bw / 2} y={h + 24} textAnchor="middle" className="fill-muted-foreground font-mono text-[10.5px]">
                {d.l}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
```

- [ ] **Step 4: Create `apps/web/src/components/charts/stack-bars.tsx`**

```tsx
import { useRef, useState } from 'react'
import { useElementWidth } from '@/lib/use-element-width'
import { Legend } from './legend'

export interface Series {
  k: string
  l: string
  c: string
  vals: number[]
}

/** 2024 → ’24; anything else unchanged. */
const colLabel = (c: string | number) => (/^\d{4}$/.test(String(c)) ? `’${String(c).slice(2)}` : String(c))

/** Stacked columns with a hover breakdown (activity by year, records by collection). */
export function StackBars({
  cols,
  series,
  h = 160,
  every = 1,
}: {
  cols: (string | number)[]
  series: Series[]
  h?: number
  every?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const W = Math.max(useElementWidth(ref), 260)
  const [hover, setHover] = useState<number | null>(null)
  const totals = cols.map((_, i) => series.reduce((s, x) => s + (x.vals[i] ?? 0), 0))
  const max = Math.max(1, ...totals)
  const cw = (W - 30) / Math.max(1, cols.length)
  const bw = Math.max(3, Math.min(26, cw - 3))
  return (
    <div ref={ref} className="relative">
      <svg
        width={W}
        height={h + 26}
        className="block overflow-visible"
        role="img"
        aria-label={cols.map((c, i) => `${c}: ${totals[i]}`).join(', ')}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={26} x2={W} y1={h - h * f + 4} y2={h - h * f + 4} stroke="#eef0f3" />
            <text x={22} y={h - h * f + 8} textAnchor="end" className="fill-muted-foreground font-mono text-[10.5px]">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {cols.map((c, i) => {
          let acc = 0
          const x = 28 + i * cw + (cw - bw) / 2
          return (
            <g key={String(c)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={28 + i * cw} y={0} width={cw} height={h + 4} fill={hover === i ? '#f2f4f7' : 'transparent'} />
              {series.map((s) => {
                const v = s.vals[i] ?? 0
                if (!v) return null
                const bh = (v / max) * h
                acc += bh
                return (
                  <rect
                    key={s.k}
                    x={x}
                    y={h - acc + 4}
                    width={bw}
                    height={Math.max(0, bh - 1)}
                    rx={2}
                    fill={s.c}
                    className="origin-bottom animate-grow [transform-box:fill-box]"
                    style={{ animationDelay: `${i * 18}ms` }}
                  />
                )
              })}
              {i % every === 0 && (
                <text x={x + bw / 2} y={h + 20} textAnchor="middle" className="fill-muted-foreground font-mono text-[10.5px]">
                  {colLabel(c)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hover != null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col rounded-lg bg-foreground px-2.5 py-1.5 text-xs whitespace-nowrap text-background shadow-popover"
          style={{ left: 28 + hover * cw + cw / 2, top: h - (totals[hover]! / max) * h }}
        >
          <b className="font-semibold">
            {cols[hover]} · {totals[hover]}
          </b>
          <span>
            {series
              .filter((s) => s.vals[hover])
              .map((s) => `${s.l} ${s.vals[hover]}`)
              .join(' · ')}
          </span>
        </div>
      )}
      <Legend items={series.map((s) => ({ l: s.l, c: s.c, v: s.vals.reduce((a, b) => a + b, 0) }))} />
    </div>
  )
}
```

- [ ] **Step 5: Create `apps/web/src/components/charts/h-bars.tsx`**

```tsx
import { formatNumber } from '@/lib/format'
import type { BarDatum } from './v-bars'

/** Horizontal bars with labels that clamp to two lines (enrolment by indication, journals). */
export function HBars({ data, unit = '' }: { data: BarDatum[]; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.v))
  return (
    <ul className="flex flex-col gap-[7px]">
      {data.map((d, i) => (
        <li key={d.l} className="grid grid-cols-[minmax(70px,38%)_minmax(0,1fr)_auto] items-center gap-2 text-xs">
          <span className="line-clamp-2 leading-[1.3] text-secondary-foreground">{d.l}</span>
          <span className="h-2 overflow-hidden rounded bg-background">
            <i
              className="block h-full origin-left animate-grow-x rounded"
              style={{ width: `${(d.v / max) * 100}%`, background: d.c ?? '#2347d9', animationDelay: `${i * 50}ms` }}
            />
          </span>
          <span className="font-mono text-[11px] text-text-secondary">
            {formatNumber(d.v)}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run src/components/charts/charts.test.tsx`
Expected: PASS.

---

### Task 6: Proportion charts — Donut, MiniDonut, Funnel

**Files:**
- Create: `apps/web/src/components/charts/donut.tsx`
- Create: `apps/web/src/components/charts/mini-donut.tsx`
- Create: `apps/web/src/components/charts/funnel.tsx`
- Test: `apps/web/src/components/charts/charts.test.tsx` (append)

**Interfaces:**
- Consumes: `Legend` (Task 4), `formatNumber`.
- Produces:
  - `Slice = { l: string; v: number; c: string }`
  - `Donut({ data: Slice[]; size?: number; center?: string | number; sub?: string })` — centre shows the total (or `center`), hover swaps in the slice value/label.
  - `MiniDonut({ data: Slice[]; size?: number; label?: string })` — 92px sheet donut, centre = total, label default `records`.
  - `Funnel({ steps: Slice[] })` — bars in a 62% track with a label column that is always visible; step % vs the previous step, `—` when the previous is 0.

> Deviation from the prototype (documented): the prototype's first funnel bar fills the whole row, hiding its label and truncating the rest (`screenshots/15-analytics-tab-charts.jpg`). Bars here live in a 62% track so every label and percentage stays readable.

- [ ] **Step 1: Append the failing tests**

Add imports:

```tsx
import { Donut } from './donut'
import { Funnel } from './funnel'
import { MiniDonut } from './mini-donut'
```

Append:

```tsx
describe('Donut', () => {
  const data = [
    { l: 'Ingest', v: 41, c: '#0b7a6f' },
    { l: 'Headline', v: 17, c: '#dc8a0e' },
    { l: 'Skip', v: 8, c: '#98a2b3' },
  ]
  it('shows the total in the centre and one arc per slice', () => {
    const { container } = render(<Donut data={data} sub="records" />)
    expect(container.querySelectorAll('circle')).toHaveLength(4) // track + 3 arcs
    expect(screen.getByText('66')).toBeInTheDocument()
    expect(screen.getByText('records')).toBeInTheDocument()
  })
  it('swaps the centre to the hovered slice', async () => {
    const { container } = render(<Donut data={data} />)
    await userEvent.hover(container.querySelectorAll('circle')[2]!)
    expect(screen.getAllByText('Headline').length).toBeGreaterThan(0)
    expect(screen.getAllByText('17').length).toBeGreaterThan(0)
  })
  it('shows 0, not 1, when there is no data', () => {
    render(<Donut data={[]} sub="events" />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})

describe('MiniDonut', () => {
  it('renders the total and label', () => {
    render(<MiniDonut data={[{ l: 'fda', v: 2, c: '#2347d9' }, { l: 'articles', v: 3, c: '#98a2b3' }]} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('records')).toBeInTheDocument()
  })
})

describe('Funnel', () => {
  it('shows each step with its share of the previous step', () => {
    render(
      <Funnel
        steps={[
          { l: 'Unstructured records', v: 186, c: '#98a2b3' },
          { l: 'Relevant to the asset', v: 74, c: '#5873e8' },
          { l: 'Journey events', v: 0, c: '#0b7a6f' },
          { l: 'Pinned', v: 0, c: '#2347d9' },
        ]}
      />,
    )
    expect(screen.getByText('Unstructured records')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument() // 0 → 0 has no meaningful rate
  })
  it('renders an empty funnel without NaN', () => {
    const { container } = render(<Funnel steps={[]} />)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/components/charts/charts.test.tsx`
Expected: FAIL — cannot resolve `./donut`.

- [ ] **Step 3: Create `apps/web/src/components/charts/donut.tsx`**

```tsx
import { useState } from 'react'
import { Legend } from './legend'

export interface Slice {
  l: string
  v: number
  c: string
}

/** Donut with a centre total and a hover readout (source mix, significance, statuses). */
export function Donut({
  data,
  size = 140,
  center,
  sub,
}: {
  data: Slice[]
  size?: number
  center?: string | number
  sub?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.v, 0)
  const r = size / 2 - 12
  const C = 2 * Math.PI * r
  const mid = size / 2
  let acc = 0
  const hovered = hover != null ? data[hover] : undefined
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={size}
        height={size}
        className="block"
        role="img"
        aria-label={data.map((d) => `${d.l}: ${d.v}`).join(', ') || 'No data'}
      >
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="#f2f4f7" strokeWidth={18} />
        {data.map((d, i) => {
          const len = total ? (d.v / total) * C : 0
          const arc = (
            <circle
              key={d.l}
              cx={mid}
              cy={mid}
              r={r}
              fill="none"
              stroke={d.c}
              strokeWidth={hover === i ? 22 : 18}
              strokeDasharray={`${Math.max(0, len - 2)} ${C}`}
              strokeDashoffset={-acc}
              transform={`rotate(-90 ${mid} ${mid})`}
              className="cursor-pointer transition-[stroke-width] duration-150"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          )
          acc += len
          return arc
        })}
        <text x="50%" y="47%" textAnchor="middle" className="fill-foreground text-[22px] font-[650]">
          {hovered ? hovered.v : (center ?? total)}
        </text>
        <text x="50%" y="61%" textAnchor="middle" className="fill-muted-foreground text-[10.5px]">
          {hovered ? hovered.l : (sub ?? 'total')}
        </text>
      </svg>
      <Legend items={data.map((d) => ({ l: d.l, c: d.c, v: d.v }))} className="justify-center" />
    </div>
  )
}
```

- [ ] **Step 4: Create `apps/web/src/components/charts/mini-donut.tsx`**

```tsx
import type { Slice } from './donut'

/** Small evidence donut in the event detail sheet. */
export function MiniDonut({ data, size = 92, label = 'records' }: { data: Slice[]; size?: number; label?: string }) {
  const total = data.reduce((s, d) => s + d.v, 0)
  const r = size / 2 - 7
  const C = 2 * Math.PI * r
  const mid = size / 2
  let acc = 0
  return (
    <svg width={size} height={size} role="img" aria-label={`${total} ${label}`}>
      {data.map((d) => {
        const len = total ? (d.v / total) * C : 0
        const arc = (
          <circle
            key={d.l}
            cx={mid}
            cy={mid}
            r={r}
            fill="none"
            stroke={d.c}
            strokeWidth={12}
            strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`}
            strokeDashoffset={-acc}
            transform={`rotate(-90 ${mid} ${mid})`}
          />
        )
        acc += len
        return arc
      })}
      <text x="50%" y="48%" textAnchor="middle" className="fill-foreground text-[18px] font-semibold">
        {total}
      </text>
      <text x="50%" y="64%" textAnchor="middle" className="fill-muted-foreground text-[9.5px]">
        {label}
      </text>
    </svg>
  )
}
```

- [ ] **Step 5: Create `apps/web/src/components/charts/funnel.tsx`**

```tsx
import { formatNumber } from '@/lib/format'
import type { Slice } from './donut'

const rate = (v: number, prev: number) => (prev > 0 ? `${Math.round((v / prev) * 100)}%` : '—')

/** Funnel (AI triage): each bar sized against the first step; labels stay visible beside the 62% track. */
export function Funnel({ steps }: { steps: Slice[] }) {
  const max = steps[0]?.v || 1
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((s, i) => (
        <li key={s.l} className="grid grid-cols-[62%_minmax(0,1fr)] items-center gap-2.5">
          <span className="flex">
            <span
              className="flex h-6 min-w-9 origin-left animate-grow-x items-center rounded-md px-2 text-xs text-white"
              style={{ width: `${Math.max(8, (s.v / max) * 100)}%`, background: s.c, animationDelay: `${i * 80}ms` }}
            >
              <b className="font-mono font-semibold">{formatNumber(s.v)}</b>
            </span>
          </span>
          <span className="min-w-0 text-xs leading-tight text-secondary-foreground">
            {s.l}
            {i > 0 && <em className="ml-1.5 font-mono text-[11px] text-muted-foreground not-italic">{rate(s.v, steps[i - 1]!.v)}</em>}
          </span>
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run src/components/charts/charts.test.tsx`
Expected: PASS.

---

### Task 7: Range charts — Gantt, Heat, TermBar

**Files:**
- Create: `apps/web/src/components/charts/gantt.tsx`
- Create: `apps/web/src/components/charts/heat.tsx`
- Create: `apps/web/src/components/charts/term-bar.tsx`
- Test: `apps/web/src/components/charts/charts.test.tsx` (append)

**Interfaces:**
- Consumes: `yearFraction`, `todayIso` (Task 2).
- Produces:
  - `GanttRow = { l: string; sub?: string; s: number; e: number; c: string; tag?: string; dash?: boolean; tip?: string }` (s/e are year fractions)
  - `Gantt({ rows: GanttRow[]; from: number; to: number; today?: string })` — tick every 2/4/8 years by range; bars clamped to `[from, to]`, min width 0.8%; Today line only when inside the range.
  - `HeatCell = { label: ReactNode; bg: string; fg: string; t?: string }`
  - `Heat<R extends { l: string; sub?: string }>({ rows: R[]; cols: string[]; cell: (row: R, col: string) => HeatCell })`
  - `TermBar({ start: string; end: string; label: string; color: string; today?: string })` — share elapsed filled; Today marker.

- [ ] **Step 1: Append the failing tests**

Add imports:

```tsx
import { Gantt } from './gantt'
import { Heat } from './heat'
import { TermBar } from './term-bar'
```

Append:

```tsx
describe('Gantt', () => {
  const rows = [
    { l: 'TRIUMPH I', sub: 'PAH · n=235', s: 2005.4, e: 2007.8, c: '#2347d9', tag: 'P3' },
    { l: 'PERFECT', sub: 'PH-COPD · n=141', s: 2018.4, e: 2022.5, c: '#7a5af8', tag: 'P2', dash: true },
    { l: 'US 11,826,327', s: 2023.9, e: 2042.3, c: '#6941c6', tag: '2042' },
  ]
  it('labels rows, ticks the axis and marks today inside the range', () => {
    render(<Gantt rows={rows} from={2004} to={2028} today="2026-10-09" />)
    expect(screen.getByText('TRIUMPH I')).toBeInTheDocument()
    expect(screen.getByText('PAH · n=235')).toBeInTheDocument()
    expect(screen.getAllByText('2008').length).toBeGreaterThan(0)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('P2').parentElement).toHaveClass('border-dashed')
  })
  it('clamps a bar that runs past the axis and hides an out-of-range today', () => {
    render(<Gantt rows={rows} from={2004} to={2020} today="2026-10-09" />)
    const bar = screen.getByText('2042').parentElement as HTMLElement
    const left = parseFloat(bar.style.left)
    const width = parseFloat(bar.style.width)
    expect(left + width).toBeLessThanOrEqual(100.0001)
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })
  it('keeps a minimum width when the end precedes the start', () => {
    render(<Gantt rows={[{ l: 'odd', s: 2010, e: 2009, c: '#000', tag: 'x' }]} from={2000} to={2020} today="2026-10-09" />)
    expect(parseFloat((screen.getByText('x').parentElement as HTMLElement).style.width)).toBeGreaterThan(0)
  })
})

describe('Heat', () => {
  it('renders a cell per row × column from the callback', () => {
    render(
      <Heat
        cols={['PAH', 'IPF']}
        rows={[{ l: 'Treprostinil', sub: 'this asset' }, { l: 'Nintedanib' }]}
        cell={(r, c) =>
          r.l === 'Treprostinil' && c === 'PAH'
            ? { label: 'Approved', bg: '#e6f4f2', fg: '#0b7a6f', t: 'approved' }
            : { label: '—', bg: '#f9fafb', fg: '#98a2b3' }
        }
      />,
    )
    expect(screen.getByText('Approved')).toHaveAttribute('title', 'approved')
    expect(screen.getAllByText('—')).toHaveLength(3)
    expect(screen.getByText('this asset')).toBeInTheDocument()
  })
})

describe('TermBar', () => {
  it('shows start, label, end and today', () => {
    render(<TermBar start="2021-06-01" end="2026-02-02" label="Phase 3 · n=576" color="#2347d9" today="2026-10-09" />)
    expect(screen.getByText('2021-06-01')).toBeInTheDocument()
    expect(screen.getByText('Phase 3 · n=576')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
  })
  it('does not divide by zero when start equals end', () => {
    const { container } = render(<TermBar start="2021-06-01" end="2021-06-01" label="x" color="#2347d9" today="2026-10-09" />)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/components/charts/charts.test.tsx`
Expected: FAIL — cannot resolve `./gantt`.

- [ ] **Step 3: Create `apps/web/src/components/charts/gantt.tsx`**

```tsx
import { todayIso, yearFraction } from '@/lib/dates'
import { cn } from '@/lib/utils'

export interface GanttRow {
  l: string
  sub?: string
  /** Start, as a year fraction. */
  s: number
  /** End, as a year fraction. */
  e: number
  c: string
  tag?: string
  dash?: boolean
  tip?: string
}

/** Start→end bars on a year axis (trial timeline, patent runway) with a Today line. */
export function Gantt({ rows, from, to, today = todayIso() }: { rows: GanttRow[]; from: number; to: number; today?: string }) {
  const span = Math.max(1e-6, to - from)
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - from) / span) * 100))
  const step = span > 36 ? 8 : span > 14 ? 4 : 2
  const ticks: number[] = []
  for (let y = Math.ceil(from / step) * step; y <= to; y += step) ticks.push(y)
  const now = yearFraction(today)
  const showNow = now >= from && now <= to
  return (
    <div className="relative text-xs [--gl:150px] @max-[520px]:[--gl:110px]">
      <div className="mb-1 grid h-5 grid-cols-[var(--gl)_minmax(0,1fr)] items-center">
        <span />
        <div className="relative h-full">
          {ticks.map((y) => (
            <span key={y} className="absolute -translate-x-1/2 font-mono text-[10.5px] text-muted-foreground" style={{ left: `${pct(y)}%` }}>
              {y}
            </span>
          ))}
        </div>
      </div>
      {rows.map((r, i) => {
        const left = pct(Math.min(r.s, r.e))
        const width = Math.max(0.8, pct(Math.max(r.s, r.e)) - left)
        return (
          <div key={`${r.l}-${i}`} className="grid h-[34px] grid-cols-[var(--gl)_minmax(0,1fr)] items-center">
            <span className="flex min-w-0 flex-col pr-2 leading-[1.15]">
              <b className="truncate text-xs font-medium">{r.l}</b>
              {r.sub && <span className="truncate text-[10.5px] text-muted-foreground">{r.sub}</span>}
            </span>
            <div className="relative h-[34px]">
              {ticks.map((y) => (
                <i key={y} className="absolute inset-y-0 border-l border-[#f2f4f7]" style={{ left: `${pct(y)}%` }} />
              ))}
              <span
                title={r.tip}
                className={cn(
                  'absolute top-2.5 flex h-3.5 min-w-1.5 origin-left animate-grow-x items-center justify-end rounded border-[1.5px]',
                  r.dash && 'border-dashed',
                )}
                style={{
                  left: `${left}%`,
                  width: `${Math.min(width, 100 - left)}%`,
                  background: r.dash ? 'transparent' : r.c,
                  borderColor: r.c,
                  animationDelay: `${i * 35}ms`,
                }}
              >
                {r.tag && (
                  <em className={cn('px-1 text-[9.5px] font-bold whitespace-nowrap not-italic', r.dash ? 'text-destructive' : 'text-white')}>
                    {r.tag}
                  </em>
                )}
              </span>
            </div>
          </div>
        )
      })}
      {showNow && (
        <div
          className="pointer-events-none absolute top-[18px] bottom-0 border-l-[1.5px] border-dashed border-foreground"
          style={{ left: `calc(var(--gl) + (100% - var(--gl)) * ${pct(now) / 100})` }}
        >
          <em className="absolute -top-4 -left-3.5 text-[10px] font-semibold not-italic">Today</em>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create `apps/web/src/components/charts/heat.tsx`**

```tsx
import { Fragment, type ReactNode } from 'react'

export interface HeatCell {
  label: ReactNode
  bg: string
  fg: string
  t?: string
}

/** Row × column matrix (competitive landscape, congress × year). */
export function Heat<R extends { l: string; sub?: string }>({
  rows,
  cols,
  cell,
}: {
  rows: R[]
  cols: string[]
  cell: (row: R, col: string) => HeatCell
}) {
  return (
    <div
      className="grid gap-[3px] text-xs"
      style={{ gridTemplateColumns: `minmax(110px,160px) repeat(${cols.length}, minmax(64px,1fr))` }}
    >
      <span />
      {cols.map((c) => (
        <span key={c} className="pb-0.5 text-center text-[11px] font-semibold text-text-secondary">
          {c}
        </span>
      ))}
      {rows.map((r) => (
        <Fragment key={r.l}>
          <span className="flex min-w-0 flex-col justify-center leading-tight">
            <b className="font-medium">{r.l}</b>
            {r.sub && <em className="truncate text-[10.5px] text-muted-foreground not-italic">{r.sub}</em>}
          </span>
          {cols.map((c) => {
            const x = cell(r, c)
            return (
              <span
                key={c}
                title={x.t}
                className="flex h-[30px] animate-fade items-center justify-center rounded-md text-[11.5px] font-semibold"
                style={{ background: x.bg, color: x.fg }}
              >
                {x.label}
              </span>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Create `apps/web/src/components/charts/term-bar.tsx`**

```tsx
import { todayIso, yearFraction } from '@/lib/dates'

/** Trial / patent term (start → end) with the elapsed share filled and a Today marker. */
export function TermBar({
  start,
  end,
  label,
  color,
  today = todayIso(),
}: {
  start: string
  end: string
  label: string
  color: string
  today?: string
}) {
  const t0 = yearFraction(start)
  const t1 = yearFraction(end)
  const now = yearFraction(today)
  const lo = Math.min(t0, now) - 0.5
  const hi = Math.max(t1, now) + 0.5
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100
  const done = t1 > t0 ? Math.min(1, Math.max(0, (now - t0) / (t1 - t0))) : now >= t1 ? 1 : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-[22px] rounded-md border border-hair bg-background">
        <span
          className="absolute top-1 bottom-1 overflow-hidden rounded border"
          style={{ left: `${pct(t0)}%`, width: `${Math.max(0.8, pct(t1) - pct(t0))}%`, background: `${color}26`, borderColor: color }}
        >
          <i className="block h-full opacity-80" style={{ width: `${done * 100}%`, background: color }} />
        </span>
        <span className="absolute -top-1 -bottom-1 w-0 border-l-[1.5px] border-dashed border-foreground" style={{ left: `${pct(now)}%` }}>
          <em className="absolute -top-3.5 -left-3.5 text-[10px] font-semibold not-italic">Today</em>
        </span>
      </div>
      <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{start}</span>
        <span>{label}</span>
        <span>{end}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run src/components/charts/charts.test.tsx`
Expected: PASS.

---

### Task 8: KindBadge

**Files:**
- Modify: `apps/web/src/features/assets/components/badges.tsx` (append `KindBadge`)
- Test: `apps/web/src/features/assets/components/badges.test.tsx`

**Interfaces:**
- Consumes: shadcn `Tooltip`, `TooltipTrigger`, `TooltipContent` (`@/components/ui/tooltip`); a `TooltipProvider` is mounted in `App.tsx`.
- Produces: `KindBadge({ kind: 'primary' | 'competitor'; competitorOf?: string[] })` — 19px pill, 10.5px 600, 5px dot; tooltip "Primary asset · full crawl" / "Competitor of X · light crawl".

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/assets/components/badges.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { KindBadge } from './badges'

const wrap = (ui: React.ReactNode) => render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>)

describe('KindBadge', () => {
  it('labels a primary asset and explains it on hover', async () => {
    wrap(<KindBadge kind="primary" />)
    const badge = screen.getByText('Primary')
    expect(badge).toHaveClass('bg-primary-soft')
    await userEvent.hover(badge)
    expect((await screen.findAllByText('Primary asset · full crawl')).length).toBeGreaterThan(0)
  })
  it('names the primaries a competitor is tracked against', async () => {
    wrap(<KindBadge kind="competitor" competitorOf={['Treprostinil']} />)
    const badge = screen.getByText('Competitor')
    expect(badge).toHaveClass('bg-orange-soft', 'text-competitor')
    await userEvent.hover(badge)
    expect((await screen.findAllByText('Competitor of Treprostinil · light crawl')).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/features/assets/components/badges.test.tsx`
Expected: FAIL — `KindBadge` is not exported.

- [ ] **Step 3: Implement `KindBadge`**

In `badges.tsx`, add to the imports:

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
```

Append at the end of the file:

```tsx
/** Primary / Competitor pill (Asset Search, cards); the tooltip says how deeply the asset is crawled. */
export function KindBadge({ kind, competitorOf }: { kind: 'primary' | 'competitor'; competitorOf?: string[] }) {
  const primary = kind === 'primary'
  const tip = primary
    ? 'Primary asset · full crawl'
    : `Competitor of ${competitorOf?.length ? competitorOf.join(', ') : 'a tracked asset'} · light crawl`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            'inline-flex h-[19px] items-center gap-1 rounded-full px-[7px] align-[1px] text-[10.5px] font-semibold tracking-[0.01em] whitespace-nowrap',
            primary ? 'bg-primary-soft text-primary' : 'bg-orange-soft text-competitor',
          )}
        >
          <i aria-hidden="true" className="size-[5px] rounded-full bg-current" />
          {primary ? 'Primary' : 'Competitor'}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/features/assets/components/badges.test.tsx`
Expected: PASS.

---

### Task 9: Phase gate and commit

**Files:** none new.

- [ ] **Step 1: Lint, typecheck, full test suite, build**

Run: `cd apps/web && npm run lint && npx tsc -b && npm test && npx vite build 2>&1 | tail -3`
Expected: oxlint reports 0 errors (the 5 pre-existing `only-export-components` warnings may remain; no new warnings from Phase 0 files); `tsc` silent; vitest all files pass (previous 51 tests + new); build succeeds.

- [ ] **Step 2: Check "Done when"**

Done when (IMPLEMENTATION_PLAN Phase 0): each chart renders with fixture data in vitest and no console warnings — confirmed by the `console.error`/`console.warn` spies in `charts.test.tsx` passing.

- [ ] **Step 3: Commit on `main`**

```bash
git add apps/web/src/index.css apps/web/src/lib/dates.ts apps/web/src/lib/dates.test.ts \
  apps/web/src/lib/use-element-width.ts apps/web/src/features/journey \
  apps/web/src/components/charts apps/web/src/features/assets/components/badges.tsx \
  apps/web/src/features/assets/components/badges.test.tsx \
  docs/superpowers/plans/2026-10-09-v3-phase-0-foundations.md
git commit -m "v3 phase 0: design tokens, journey types, date helpers, chart primitives, KindBadge"
```

(The commit message body ends with the `Co-Authored-By` line required by the session.)
