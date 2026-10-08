# Asset Journey Platform — Design

**Date:** 2026-10-08
**Status:** Draft for review
**Repo:** `Pharmaedge-Hackathon_maverics`

## 1. Purpose and scope

PharmaEdge users need to see an asset's (drug's) journey — how it has performed and
where it is heading — and its competitive context, without assembling the evidence by
hand. The platform crawls public sources for a drug, uses AI to keep only what matters,
turns it into a dated journey of events and milestones, and lets users explore it in a
dashboard and ask questions of it through an AI copilot ("Asset AI").

**Delivery stance:** hackathon demo now, product later. The happy path must be polished
and work end to end; module boundaries, auth and data contracts are built to last.

**In scope (this build):**
- App shell, login, protected routes; users with `admin` / `analyst` roles.
- Asset list and asset page with tabs: Overview, Evidence, Clinical, Regulatory,
  Publications, Documents, Company IR, Competitors (the reference mockup's screen).
- Asset AI: side panel on asset pages and full-page chat; Q&A grounded in our data with
  citations; adding a new asset through chat.
- Crawl service: onboarding and refresh jobs over the existing crawlers (FDA, EMA,
  ClinicalTrials.gov, RSS/Bing, wires, Google News, company sites) plus a ported PubMed
  crawler and a generic company-site crawler; AI-driven planning and triage.
- Competitor identification (top 5) with lighter crawls per competitor.
- Crawl operations page (jobs, steps, triage decisions, cancel/retry/refresh).

**Out of scope (later):** Patents, Conferences, Uploads (shown as "coming soon"; their
crawlers are being built separately and integrate via the data contract in §3.2),
self-signup, SSO, dark theme, mobile layouts, notifications delivery.

**Reference design:** the PharmaEdge mockup (Dupilumab / Competitors tab with Asset AI
panel) supplied by the user on 2026-10-08.

## 2. Architecture

```
 Browser (React SPA)
     │  same origin via nginx; JWT in httpOnly cookies
     ▼
 NestJS API (apps/api) ── global auth guard on every route except @Public()
  │   │   └── OpenAI / Azure OpenAI (chat, tools, embeddings)
  │   └────── Valkey (API cache, refresh tokens, job queue)
  │                               │ jobs (arq)
  ▼                               ▼
 MongoDB Atlas  ◄──────────── Python crawl service (crawler/: FastAPI + arq worker)
 (asset_journey)                AI planning/triage/enrichment + crawlers
```

- **NestJS serves; Python acquires.** The browser talks only to NestJS. NestJS calls the
  crawl service only to resolve an asset, start a job or cancel one (internal network,
  shared service key; the crawl service is never public). The crawl service writes only
  to MongoDB (and bumps cache versions in Valkey). NestJS reads job progress from MongoDB.
- **Repo layout:**
  - `apps/web` — React app
  - `apps/api` — NestJS (Fastify adapter, official MongoDB driver)
  - `crawler/` — existing Python crawlers + new `api.py` (FastAPI) and `worker.py` (arq)
  - `docker-compose.yml` — `web` (nginx + SPA), `api`, `crawler-api`, `crawler-worker`,
    `valkey`. MongoDB stays on Atlas.
- **Patterns reused from admin-console:** global guards with `@Public()`/`@Roles()`,
  ioredis cache service that degrades gracefully when Valkey is down, class-validator DTOs
  with a global ValidationPipe, Swagger outside production, feature-module layout,
  polling for job progress, SSE written to the raw Fastify response.
  **Not reused:** admin-console's Keycloak-based login; this app issues and verifies its
  own JWTs.
- **Pattern reused from pharmaedge-frontend-react:** Pico's streamed chat turn (POST that
  streams typed events) and its shadcn/Tailwind v4 setup.

## 3. Data

### 3.1 Database `asset_journey` (MongoDB Atlas)

| Collection | Key | Written by | Purpose |
|---|---|---|---|
| `assets` | `_id` (asset id, §3.2) | API, crawler | One per drug: name, aliases, company {name, website, ir_url}, tags {indications, mechanism, modality}, competitor ids, `kind` (`primary`/`competitor`), status (`onboarding`/`ready`/`failed`), crawl timestamps, cached counts, suggested questions |
| `fda_records`, `ema_records`, `trial_records`, `company_records`, `publication_records` | `record_key` | crawler | Raw evidence (see contract §3.2) |
| `articles` | `url` | crawler | Raw news/wire evidence (legacy key; otherwise follows the contract) |
| `journey_events` | `_id` | crawler | Consolidated events and milestones: asset, date, `type`, title, summary, phase, indication, significance (High/Medium/Low), `is_milestone`, expected_date, source record refs, confidence |
| `crawl_ledger` | url hash / content hash | crawler | Every triage decision: decision (`ingest`/`headline`/`skip`), category, reason, model, asset, timestamp. Prevents re-crawl and re-judging; explains drops |
| `record_chunks` | `_id` | crawler | Text chunks of ingested records with embeddings; Atlas Vector Search index; asset ids and source refs as filters |
| `jobs` | `id` | API (create), crawler (progress) | Onboarding/refresh/competitor jobs: steps [{name, status, counts, triage counts, error, started/finished}], plan, token usage, created_by |
| `users` | `_id` | API | email, name, argon2id hash, role, active |
| `chat_sessions`, `chat_messages` | `_id` | API | Asset AI history per user |
| `runs`, `logs` | — | crawler | Existing crawl bookkeeping |

The existing Treprostinil data (1,198 records) is kept and backfilled into this model
(§5.6).

### 3.2 Record contract (integration point for separately built crawlers)

Every evidence record carries: `record_key` (unique per collection), `record_type`,
`source`, `date` (`YYYY-MM-DD` or `""`), `assets` (array of asset ids), and where
applicable `title`, `url`, `content`, plus any source-specific payload.

**Asset ids** are lowercase slugs of the canonical name (`treprostinil`); the backfill
rewrites existing `assets` values (`"Treprostinil"`) to ids.

A **source registry** (one entry per collection: label, tab, icon, date field, text
fields for indexing) lets the app pick up a new crawler's collection (e.g.
`patent_records`, `conference_records`) without UI changes. Records from external
crawlers enter the triage/enrichment/consolidation steps the next time the asset is
refreshed.

### 3.3 Caching (Valkey)

- Per-asset version counter `aj:asset:{id}:ver`, incremented by the crawl worker whenever
  it writes data for the asset; global `aj:assets:ver` for the asset list.
- API cache keys embed the version (`aj:asset:{id}:v{n}:timeline:{filterHash}`), so new
  data invalidates by construction. TTL 1 h as a safety net.
- If Valkey is unavailable the API serves uncached; the job queue is unavailable and
  "add asset" reports that clearly.

## 4. API (NestJS, `/api`)

### 4.1 Authentication and authorization

- Email + password; argon2id hashes. No self-signup; admins create users. First admin
  seeded from env on first boot.
- Access token: JWT HS256, 15 min, secret from env, **signature verified** on every
  request. Refresh token: random 256-bit, 7 days, stored hashed in Valkey, rotated on
  every refresh, deleted on logout.
- Both tokens in httpOnly, `SameSite=Strict` cookies (`Secure` in production); never
  visible to JS.
- Global `JwtAuthGuard` (APP_GUARD); `@Public()` only on login, refresh, health.
  `RolesGuard` + `@Roles('admin')` for user management and asset deletion.
- Login rate limit: 5/min per IP+email. Chat turns rate-limited per user.
- Auth isolated in `AuthModule` so Keycloak SSO can replace it later.

### 4.2 Endpoints

| Module | Endpoints |
|---|---|
| Health | `GET /health` (public) |
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| Users (admin) | `GET /users`, `POST /users`, `PATCH /users/:id` (role, active) |
| Assets | `GET /assets`, `GET /assets/:id`, `GET /assets/:id/timeline`, `GET /assets/:id/records/:tab`, `GET /assets/:id/competitors`, `POST /assets` (confirmed identity card + plan → creates asset, starts job), `POST /assets/:id/refresh`, `DELETE /assets/:id` (admin) |
| Search | `GET /search?q=` (assets, companies, indications, trials, publications) |
| Jobs | `GET /jobs?asset=&status=`, `GET /jobs/:id` (steps, triage counts), `GET /jobs/:id/ledger` (decisions, paged), `POST /jobs/:id/cancel`, `POST /jobs/:id/retry` |
| Resolve | `POST /resolve` (proxy to crawl service; used by the chat `resolve_asset` tool) |
| Chat | `GET/POST /chat/sessions`, `GET /chat/sessions/:id/messages`, `POST /chat/sessions/:id/turn` (streamed), `DELETE /chat/sessions/:id` |

`GET /assets/:id/competitors` returns everything the Competitors tab needs in one
payload: KPI cards, landscape rows, journey-comparison bars, evidence counts per
competitor, competitive signals, milestones.

Errors use one shape: `{ statusCode, code, message }` via a global exception filter.

## 5. Crawl service and AI-driven ingestion (Python, `crawler/`)

### 5.1 Service

- `crawler/api.py` (FastAPI, internal): `POST /resolve`, `POST /jobs`, `POST /jobs/:id/cancel`, `GET /health`; requires the service key.
- `crawler/worker.py` (arq on Valkey): concurrency 2 (headless browser memory).
- Two model tiers from config: **triage model** (small/fast) and **reasoning model**
  (larger). LLM results are cached by content hash. Each job has a token budget; usage is
  recorded on the job.

### 5.2 Add-asset flow

1. **Resolve** (synchronous, ~10–20 s): openFDA (brands, generic, sponsor, pharmacologic
   class), EMA (INN, MA holder, ATC, therapeutic area), ClinicalTrials.gov (sponsor,
   conditions) → reasoning model merges into an identity card: canonical name, aliases,
   company, indications, mechanism, modality, official website, IR / press-release page.
   Website: LLM proposes a domain; the service verifies ownership (fetch, company name in
   title/footer, sitemap). IR page: common URL patterns + LLM classification of homepage
   links.
2. **Plan** (reasoning model): asset-specific keywords (names, code names,
   company + indication — not broad disease terms alone), relevant sources, per-source
   caps, date windows (refresh = since last crawl), company pages to read.
3. **Confirm** (user): the chat shows the identity card and a one-line plan summary with
   **Confirm & start crawl** / **Edit**. Only the user's click calls `POST /assets`.

### 5.3 Job steps (fastest first, so the asset page fills progressively)

Each data step runs **discover → triage → fetch → enrich**:

- **Discover:** metadata only (title, snippet, URL, date, source). No page fetches.
- **Triage** (triage model, batches of ~30): decision `ingest` / `headline` (keep title
  + link, no fetch) / `skip`, with category (approval, trial readout, safety, financials,
  deal, litigation, competitor signal, market-report spam, unrelated) and one-line
  reason. Written to `crawl_ledger`; items already in the ledger are not re-judged.
- **Fetch/extract:** `ingest` items only, through the existing extractors and dedup
  (URL check before fetch; content hash after).
- **Enrich** (reasoning model, ingested items): structured event — type, actual event
  date, phase, indication, outcome, 2-sentence summary, companies/assets, significance;
  forward-looking statements become milestones with expected dates.
- **Structured sources** (FDA/EMA approvals, trial start/completion) map to events by
  rule; the LLM only tags the asset's role per trial (investigational / comparator /
  background) so phase bars count real development.

Steps:
1. Regulatory — FDA (submissions, recalls, FAERS monthly counts), EMA.
2. Clinical — ClinicalTrials.gov.
3. Publications — PubMed (ported from universal-crawler `pubmed_crawler_service.py`),
   aliases + indications, triaged on title/abstract.
4. Company site — site adapter if one exists for the domain (`unither.py`), else the
   generic company crawler: sitemap product pages + linked PDFs filtered by aliases;
   press releases from the detected listing page with detected pagination; LLM extracts
   title/date only when heuristics fail.
5. News — Bing archive, wires (PR Newswire, BioSpace, GlobeNewswire), Google News
   (best effort; decode interval and abort-on-block from the existing code).
6. Competitors (primary assets only) — candidates sharing indication (trial conditions,
   EMA therapeutic area) or mechanism (FDA EPC/MoA, ATC level 4); reasoning model ranks
   top 5 with reasons; each becomes a `competitor` asset with a lighter job (regulatory,
   clinical, publications, drug-name news; no deep company-site crawl; no recursion).
7. Consolidate — reasoning model merges events about the same occurrence (same type,
   date window, overlapping entities) into one `journey_events` entry with all sources.
8. Index — runs incrementally after each step: chunks and embeds ingested records only;
   long documents only in substantive sections (e.g. PI: indications, clinical studies,
   safety).
9. Finalize — counts, tags, suggested questions, status `ready`, version bump.

### 5.4 Reliability

- A failed step does not fail the job: step `failed` with error; job
  `completed_with_errors`. Retry re-runs failed steps only.
- Cancellation checked between steps and between keywords/batches.
- Refresh re-runs the pipeline; ledger + dedup make it incremental.
- Known external limits are reported per step, not hidden: Google News rate limiting,
  proxy-only sites (Fierce, Business Wire, pulmonaryhypertensionnews.com — enabled when
  `RESIDENTIAL_PROXY` is set), JS-heavy IR sites the generic crawler cannot read (wire
  releases cover most of these).

### 5.5 Generic company crawler boundaries

`company/` holds `generic.py` (default) and per-domain adapters (`unither.py`). An adapter
registry maps domain → adapter; adapters always win. Each yields records in the §3.2
contract with `record_type` in `company_page` / `prescribing_info` / `annual_report` /
`company_document` / `press_release`.

### 5.6 Treprostinil backfill

Create the `assets` document (United Therapeutics, unither adapter), run triage +
enrichment + consolidation over the existing 1,198 records (drops the two bot-check pages
and market-report spam into `skip`), add Publications, Competitors and Index.

## 6. Asset AI

- **Surfaces:** asset-page side panel (context = asset + competitors) and full-page chat
  with history sidebar. Same backend (`ChatModule`); session has optional `asset_id`.
- **Model calls:** Chat Completions API with tools (consistent across OpenAI and Azure
  OpenAI); provider, endpoint, key, model/deployment names and embedding model in env.
- **Tools:** `search_assets`, `get_asset_overview`, `get_timeline`, `get_trials`,
  `get_regulatory`, `get_milestones`, `compare_assets`, `search_evidence` (Atlas Vector
  Search with asset/source/date filters), `resolve_asset`, `get_job_status`.
- **Grounding:** every factual claim cites a returned record or event; the answer event
  carries the citation list (title, source, date, link into the asset page). No relevant
  tool results → the assistant says so. Max 6 tool calls per turn; token budget per turn;
  last N messages + rolling summary as context.
- **Cards:** some tool results render as UI cards — comparison table, identity card
  (with Confirm & start crawl / Edit), job progress card (polls the job; Open asset when
  done), timeline snippet. Answers end with suggested follow-ups and actions (View
  evidence, Compare journeys, Open asset).
- **The model never starts crawls.** Confirm & start crawl is a user click that calls
  `POST /assets`.
- **Streaming:** `POST /chat/sessions/:id/turn` streams `token`, `tool_call`,
  `tool_result`, `answer`, `error`, `done` events (Pico pattern); the client reads the
  stream with `fetch` + `ReadableStream`.
- **Persistence:** sessions (title generated from the first message) and messages
  (content, tool calls, cards, citations, token usage); users see only their own.

## 7. Frontend (`apps/web`)

- React + Vite + TypeScript; shadcn/ui (Radix) on Tailwind v4; Inter; PharmaEdge blue;
  light theme with tokens ready for dark.
- React Router 7 (lazy routes); TanStack Query (server state; job polling every 2 s while
  running); Zustand (shell state, chat streaming draft, compare selection, tab filters);
  TanStack Table; cmdk (⌘K search); react-markdown + remark-gfm; Recharts; custom
  phase-bar component; sonner; lucide.
- Auth: `AuthProvider` (`/auth/me`), `ProtectedRoute`, admin route guard; `fetch` wrapper
  with single-flight refresh on 401, then redirect to `/login?returnTo=`.
- Folders: `features/<name>/{api,hooks,components,pages,types}`, `components/ui`,
  `components/layout`.

| Route | Screen |
|---|---|
| `/login` | Sign-in |
| `/` | Home: tracked assets, crawls in progress, latest high-significance signals |
| `/assets` | Asset Search: all asset journeys + Add asset (opens chat) |
| `/assets/:id/:tab` | Asset page: header (name, company, tags, ⭐, Compare, Ask Asset AI); tabs Overview, Evidence, Clinical, Regulatory, Publications, Documents, Company IR, Competitors; events link to source records |
| `/chat`, `/chat/:session` | Full-page Asset AI |
| `/jobs`, `/jobs/:id` | Crawl operations: jobs, steps, triage counts and reasons, cancel / retry / refresh |
| `/settings` | Profile; Users (admin) |
| Patents, Conferences, Uploads | Coming soon |

- Left nav: Asset Journey … Conferences are sections of the current asset (same as its
  tabs); with no asset selected they go to Asset Search. Asset AI panel is a collapsible
  right drawer on asset pages; "expand" opens the session full-page.
- Every screen has loading skeletons, empty states and error states. Desktop ≥1280 px;
  tablet usable.

## 8. Error handling

- API: global exception filter, one error shape; upstream failures (crawl service, LLM,
  Valkey) mapped to clear codes (`CRAWLER_UNAVAILABLE`, `LLM_UNAVAILABLE`, ...).
- Chat: stream `error` event with a user-facing message; partial answers kept.
- Jobs: per-step errors visible on the operations page and the chat progress card.
- Frontend: query error states with retry; toasts for mutations.

## 9. Testing

- **API (Jest):** auth (login, verify, refresh rotation, revocation), guards (public vs
  protected, roles), asset endpoints against a test database, cache versioning.
- **Crawler (pytest):** each step with recorded HTTP fixtures (no live network in unit
  tests); ledger idempotency; contract validation of written records.
- **AI quality:** a labelled golden set (~50 items) drawn from the Treprostinil data for
  triage decisions and event extraction; run on prompt/model changes and report
  precision/recall.
- **E2E (Playwright):** login → asset list → asset page tabs → ask Asset AI a question
  with citations → add-asset flow up to job start.

## 10. Delivery order

Each milestone ends working and demoable, and gets its own implementation plan:

1. **Foundation:** monorepo, docker-compose, NestJS auth/guards/users, Valkey cache,
   React shell + login.
2. **Asset read side:** `assets` backfill for Treprostinil, rule-based events, asset list
   and asset page tabs (Overview, Clinical, Regulatory, Documents, Company IR).
3. **Crawl service:** FastAPI + arq, job model, existing crawlers as steps, Crawl
   operations UI, refresh.
4. **AI ingestion:** plan, triage + ledger, enrichment, consolidation, index; PubMed port
   + Publications tab; Treprostinil re-processed.
5. **Asset AI:** chat tools, streaming, side panel + full page, add-asset flow (resolve,
   website/IR discovery, generic company crawler).
6. **Competitors:** identification, light jobs, Competitors tab, Evidence tab.

## 11. Configuration

`.env` (never committed): `MONGODB_URI`, `MONGODB_DB`, `VALKEY_URL`, `JWT_SECRET`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CRAWLER_SERVICE_KEY`, `OPENAI_PROVIDER`
(`openai`/`azure`), `OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION`,
`LLM_TRIAGE_MODEL`, `LLM_REASONING_MODEL`, `LLM_EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`,
`OPENFDA_API_KEY` (optional), `NCBI_API_KEY` (optional), `RESIDENTIAL_PROXY` (optional),
`GOOGLE_DECODE_INTERVAL`.

## 12. Risks

- **Atlas tier limits:** Vector Search index count/size on the current cluster tier must
  be verified in milestone 1; fallback is a smaller embedding dimension or an upgraded tier.
- **LLM cost/latency:** bounded by triage-before-fetch, two model tiers, decision cache
  and per-job budgets; token usage is visible per job.
- **Generic company crawler coverage:** some IR sites will not yield; wires and adapters
  mitigate; failures are reported per step.
- **External blocking:** Google News rate limits and proxy-only sites reduce news
  coverage until a proxy is configured.
- **Credential hygiene:** all secrets live in `.env` only (git-ignored); rotate database
  credentials before any shared deployment.
