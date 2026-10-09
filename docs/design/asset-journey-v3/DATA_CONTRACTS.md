# Data contracts: types, API, Mongo, crawler

Everything the web app needs that doesn't exist today. Existing shapes are in `apps/web/src/features/assets/api.ts` (`AssetSummary`, `AssetDetail`, `JourneyEvent`, `SourceRecord`), `features/jobs/api.ts` (`Job`, `JobStep`) and the crawler's `service/steps.py` (`STEPS`, `LABELS`, `PLANS`). **Extend, don't fork**: add optional fields so current screens keep working.

---

## A. Shared TypeScript types (`apps/web/src/features/journey/types.ts`; mirror the DTOs in `apps/api`)

```ts
export type EventCategory = 'regulatory' | 'clinical' | 'safety' | 'company' | 'ip'
export type Significance = 'High' | 'Medium' | 'Low'
export type NoteTag = 'Important' | 'Missed by AI' | 'Question' | 'Risk' | 'Opportunity'

/** JourneyEvent v3: existing fields + optional enrichment. */
export interface JourneyEventV3 extends JourneyEvent {
  via: 'journey' | 'ai_events' | 'finalize' | 'user'   // rule / AI consolidation / rebuild / team member
  indications?: string[]          // e.g. ['PH-ILD (WHO Group 3)']; shown as "Targets"
  product?: string | null         // 'Tyvaso DPI'
  details?: Record<string, string> // ordered key facts: Application, Trial, Phase, Enrollment, Primary endpoint, Status, Sponsor …
  impact?: string | null          // "Why it matters" (one sentence)
  branch?: string                 // branch id; defaults to the trunk
  span?: string[]                 // extra branch ids the event also covers (dotted bridge)
  links?: string[]                // related event ids (subtree + detail "Linked events")
  user?: NoteMeta                 // only when via === 'user'
}
export interface NoteMeta { tag: NoteTag; by: { id: string; name: string }; created_at: string; mode: 'manual' | 'ai' }

export interface Branch {
  id: string                      // 'PH-ILD'
  label: string                   // short label on chips/lanes
  full: string                    // 'PH due to interstitial lung disease'
  color: string                   // from the branch palette, stable per asset
  off: number                     // lane offset: 0 = trunk, negative = left of trunk (vertical) / above (horizontal)
  trunk?: boolean
  from?: string                   // parent branch id
  why?: string                    // fork rationale shown on the "New branch" row
  status: string                  // 'Approved · US', 'sNDA under review', 'Closed · PERFECT terminated'
  ended?: 'Terminated' | 'Withdrawn' | null
  origin: 'rule' | 'ai' | 'user'
}

export interface Annotations {
  stars: string[]                                     // event ids starred by the current user
  comments: Record<string, Comment[]>                 // by event id (team-visible)
  notes: JourneyEventV3[]                             // via: 'user'
}
export interface Comment { id: string; by: { id: string; name: string }; at: string; text: string }

export interface JobFeedItem {                        // live build log
  id: number; t: string                               // ISO time
  step: string                                        // step name or 'plan'
  kind: 'info' | 'done' | 'warn' | 'ai' | 'event'
  text: string
  verdict?: 'Ingest' | 'Headline' | 'Skip'            // ai triage lines
  event_id?: string; merged?: number                  // event lines
}
export interface JobProgress extends Job {
  records: { coll: string; count: number }[]          // per collection so far
  events_created: number
  feed_cursor: number
}

export interface AnalyticsPin { key?: string; custom?: AnalyticsSpec }
export interface AnalyticsSpec {
  id: string; title: string
  chart: 'bars' | 'hbar' | 'stack' | 'donut' | 'gantt' | 'heat' | 'list' | 'none'
  data?: unknown; cols?: (string | number)[]; series?: { k: string; l: string; c: string; vals: number[] }[]
  unit?: string; note?: string
  method: 'index' | 'web' | 'none'
  sources: string[]                                   // record keys or URLs; never empty unless method === 'none'
  refreshed_at: string
}
```

---

## B. API (NestJS, `apps/api/src`)

All routes are behind the existing auth guard; `:id` is the asset id. Validate with class-validator DTOs as in `assets/dto`.

### B.1 Journey
| Method | Path | Notes |
|---|---|---|
| GET | `/assets/:id/timeline` | **Extend** the existing response items to `JourneyEventV3` (optional fields). Keep the query params. Add `include=notes` to merge the asset's team notes (`via:'user'`). |
| GET | `/assets/:id/branches` | `Branch[]`, ordered trunk-first. Empty array means a single trunk; the UI draws one lane. |
| GET | `/assets/:id/events/:eventId` | Single event + `records` (resolved source records, same shape as `/record/:tab`) + `neighbors {prev,next}` + `branchStats {index,total,prevSameBranch}`. Used by the detail sheet's deep link. |
| GET | `/portfolio/timeline?from&to&competitors=bool` | `{ assets: {id,name,kind,company,status,progress?}[], events: JourneyEventV3[] }` for the Home portfolio timeline. Cache 60 s in Valkey. |

### B.2 Jobs (live build)
| Method | Path | Notes |
|---|---|---|
| GET | `/jobs/:id` | **Extend** to `JobProgress` (records per collection, events_created). |
| GET | `/jobs/:id/feed?since=<cursor>` | `{ items: JobFeedItem[], cursor }`. Poll every 2 s while running. Optional SSE at `/jobs/:id/stream`. |

### B.3 Annotations
| Method | Path | Body / notes |
|---|---|---|
| GET | `/assets/:id/annotations` | `Annotations` for the current user (stars are per user; comments and notes are team-wide). |
| PUT | `/assets/:id/events/:eventId/star` | Idempotent. DELETE to unstar. |
| POST | `/assets/:id/events/:eventId/comments` | `{ text }` → `Comment`. Max 2,000 chars. |
| DELETE | `/assets/:id/comments/:commentId` | Author or admin. |
| POST | `/assets/:id/notes` | `{ date, branch, category, tag, title, text, mode, sources? }` → `JourneyEventV3` (`via:'user'`). |
| PATCH / DELETE | `/assets/:id/notes/:noteId` | Author or admin. |
| POST | `/assets/:id/notes/find` | `{ title, text, date?, branch? }` → `{ kind:'found'|'exists'|'none', event?, note }`. Pipeline: (1) structured search across record collections + `journey_events` (title/summary text index, date window ±18 months); (2) vector search over `record_chunks`; (3) optional web fallback (see `ANALYTICS_PIPELINE.md` §2, same allow-list). `exists` when a journey event matches with score ≥ threshold. Persist fetched web pages as `web_records` so they are indexed. |

### B.4 Analytics
| Method | Path | Notes |
|---|---|---|
| GET | `/assets/:id/analytics` | Precomputed blocks: `pipeline` (per branch: stage index, next milestone), `activityByYear`, `trials` (rows for gantt/phase/enrolment), `recordsByYear` (by collection), `sourceMix`, `triageFunnel`, `patents` (grant/expiry/status), `landscape` (competitor × indication coverage), `significance`, `stats` (approvedIndications, inDevelopment, activeTrials, phase3, patients, nextCatalyst, patentRunwayYears, evidenceRecords). Recompute at `finalize`; cache in Valkey keyed by asset + `last_crawled_at`. |
| GET | `/assets/:id/records/:tab/insights` | Aggregates for the TabInsights row (counts by facet, by year). Same facets as the table filters. |
| GET / PUT | `/assets/:id/analytics/pins` | Per user `AnalyticsPin[]`. |
| GET | `/assets/:id/analytics/suggestions` | `{ id, title, why, src:'index'|'web'|'limited', records, sources? }[]` from the heuristics table in `ANALYTICS_PIPELINE.md`. |
| POST | `/assets/:id/analytics/build` | `{ request: string } | { suggestion: id }` → `AnalyticsSpec`. Index first; web fallback; never return values without sources. Long-running: return `{ runId }` and poll `/analytics/build/:runId` → `{ steps: {label,status}[], result? }` so the UI can render the step list. |

### B.5 Search, notifications, prefs
| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=` | `{ assets[], events[] }` (top 6 each) for the ⌘K palette. Events match title or NCT ID. |
| GET | `/notifications` · POST `/notifications/read` | Generated on: onboarding started/finished, job failed, new High event on a primary asset, new comment on a starred event. |
| GET / PATCH | `/me/prefs` | `{ journeyView:'h'|'v', sidebarCollapsed }`. |

---

## C. Web hooks (`apps/web/src/features/*/api.ts`)

`useTimelineV3(id, filters)`, `useBranches(id)`, `useEvent(id, eventId)`, `usePortfolioTimeline(range, competitors)`, `useJobProgress(jobId)` (refetch 2 s while active), `useJobFeed(jobId)` (infinite, cursor), `useAnnotations(id)`, `useToggleStar()`, `useAddComment()`, `useAddNote()`, `useFindNote()`, `useAssetAnalytics(id)`, `useTabInsights(id, tab)`, `useAnalyticsPins(id)` + `useSavePins()`, `useAnalyticsSuggestions(id)`, `useBuildAnalytics()` + `useBuildRun(runId)`, `useSearch(q)` (debounced 150 ms), `useNotifications()`, `usePrefs()`. Mutations are optimistic where noted in the README §8.

---

## D. MongoDB

| Collection | New / changed | Shape |
|---|---|---|
| `journey_events` | **changed** | add optional `indications[]`, `product`, `details{}`, `impact`, `branch`, `span[]`, `links[]`. Indexes: `{asset:1, branch:1, date:1}`. |
| `asset_branches` | **new** | `{ _id: assetId+':'+branchId, asset, id, label, full, color, off, trunk, from, why, status, ended, origin, updated_at }`. Index `{asset:1}`. |
| `event_stars` | **new** | `{ asset, event, user, created_at }`. Unique `{user:1, event:1}`. |
| `event_comments` | **new** | `{ _id, asset, event, by:{id,name}, text, at }`. Index `{asset:1, event:1, at:1}`. |
| `journey_notes` | **new** | `JourneyEventV3` with `via:'user'`, `user{tag,by,created_at,mode}`, `branch`, `sources[]`. Index `{asset:1, date:1}`. Notes tagged *Missed by AI* are also written to `crawl_feedback` (below). |
| `crawl_feedback` | **new** | `{ asset, note_id, title, text, date, sources[], status:'open'|'resolved', created_at }`. Read by the crawler's `finalize` to re-check and by ops dashboards. |
| `analytics_pins` | **new** | `{ asset, user, items: AnalyticsPin[], updated_at }`. Unique `{asset:1, user:1}`. |
| `asset_analytics` | **new (cache)** | `{ asset, computed_at, blocks:{…} }`. Invalidated on each crawl. |
| `web_records` | **new** | `{ key, url, domain, fetched_at, title, content, assets[] }`. Chunked into `record_chunks` like other sources. |
| `jobs` | **changed** | add `feed: JobFeedItem[]` (capped at 500, or a separate `job_feed` collection with `{job, id, …}`), `records_by_coll{}`, `events_created`. |
| `notifications` | **new** | `{ user, kind, title, sub, link, read, at }`. |
| `user_prefs` | **new** | `{ user, journeyView, sidebarCollapsed }`. |

`asset-lifecycle.service.ts` delete must also remove `asset_branches`, `event_stars`, `event_comments`, `journey_notes`, `analytics_pins`, `asset_analytics` and the asset id from `web_records.assets`.

---

## E. Crawler (`crawler/`)

1. **Feed emission (`service/pipeline.py`, `service/jobs.py`).** Add `JobStore.feed(job_id, item)`. Emit: at step start (`info`), per notable sub-result (counts, failures as `warn`), at step end (`done` with counts summary), for every journey event created (`event` with `event_id` and `merged`), and for each AI triage decision on notable records (`ai` with `verdict`). Keep the text style used in the prototype (`aj/data.js` `LOG`).
2. **Records per collection.** `upsert_records` already returns counts; aggregate into `jobs.records_by_coll` after each source step.
3. **Event enrichment (`journey/rules.py`).** Populate `indications` (from the trial `conditions` / label indication text, normalised to the asset's indication list), `product` (brand from `_brand(record)`), `details` (ordered: Application/Trial, Phase, Enrollment, Primary endpoint, Status, Sponsor, Route, Class) and `links` (same NCT id, same application number, same product within ±5 years).
4. **AI enrichment (`ai_events` step).** Extend the extraction prompt to return `indications`, `product`, `impact` (≤ 25 words, factual) and `links` (ids of existing events it relates to). Reject `impact` that isn't supported by the sources.
5. **Branch derivation (new module `journey/branches.py`, run in `finalize` after the journey rebuild).**
   - Candidate branches = the asset's indications plus investigational ones plus any condition seen in company-sponsored Phase ≥2 trials (normalised: PAH, PH-ILD, IPF, PPF, CTEPH, PH-COPD, …).
   - Trunk = the indication of the first approval (fallback: the earliest company Phase 3).
   - Assign each event: trial events by condition; regulatory events by the indication in the approval/supplement text; AI events by their `indications`; otherwise the trunk. Multi-indication events → `branch` = first, `span` = the rest.
   - Parent (`from`) = the branch whose programme most directly preceded it: an LLM call with the first 3 events of the new branch and the last 5 events across other branches. Return parent + one-line `why`; default to the trunk.
   - `ended` = all branch trials terminated/withdrawn and no approval → `'Terminated'`.
   - `status` = Approved · regions | Filed / under review | Phase N recruiting | Closed · reason.
   - `off` alternates sides by fork order: approved and active branches to the right (+1, +2 …), closed or partner branches to the left (−1, −2 …). Colour = palette by order. **Never overwrite `origin:'user'` branches.**
6. **Feedback loop.** In `finalize`, read open `crawl_feedback` for the asset, re-run `notes/find` with fresh data, mark resolved when a matching record is found, and add any missing source domain to the asset's crawl plan for next time.
7. **Analytics cache.** At the end of `finalize`, call the API's analytics recompute endpoint (or compute in Python and upsert `asset_analytics`).
8. **Tests.** Extend `journey/test_rules.py` (enrichment fields), add `journey/test_branches.py` (trunk choice, assignment, ended, off/colour stability), and `service/test_pipeline.py` (feed items emitted in order).
