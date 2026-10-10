# PharmaEdge — Asset Journey

**Competitive intelligence for drug assets: every public signal about a drug, collected, triaged, placed on a
dated journey, and answerable through a cited AI assistant.**

For each drug ("asset") the platform crawls regulators, trial registries, literature, conferences, company
newsrooms, news and patents; uses LLMs to keep what matters; builds a timeline of events and upcoming milestones;
tracks the asset's closest competitors; and lets analysts ask questions in **Asset AI**, which answers only from
the collected records and cites every fact.

| | |
|---|---|
| **Sources** | openFDA (Drugs@FDA, FAERS, enforcement), FDA Tracker PDUFA/AdCom calendar, EMA (EPAR, CHMP, orphan, DHPC), ClinicalTrials.gov v2, PubMed, ERS/ATS/CHEST abstracts, 86 company newsrooms and newswires, news RSS, Google Patents, SEC EDGAR |
| **Outputs** | per-asset records, journey events (rule + AI), milestones, competitor set, vector index for evidence search, chat with citations |
| **Stack** | NestJS 12 · React 19 · Python 3.11 (FastAPI, arq, Scrapy) · MongoDB 9 + MongoDB Search (vector) · Valkey · OpenAI |

---

## Contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [How data flows](#how-data-flows)
- [Data model](#data-model)
- [Asset AI](#asset-ai)
- [Security](#security)
- [Operations](#operations)
- [Testing](#testing)
- [Component documentation](#component-documentation)
- [Known limitations](#known-limitations)

---

## Architecture

```
 Browser ── apps/web (React, served by nginx :8080) ──/api──► apps/api (NestJS, :3000)
                                                               │  auth · assets · timeline · chat (NDJSON stream)
                                                               ├──► Valkey      cache, refresh tokens, version keys
                                                               ├──► MongoDB     asset_journey (read/write)
                                                               ├──► OpenAI      chat, follow-ups, query embeddings
                                                               └──► crawler-api (FastAPI, :8100, X-Service-Key)
                                                                       │ enqueue
                                    crawler-worker (arq, per-asset jobs) ◄┘   crawler-corpus (arq, shared corpora)
                                       │ steps: regulatory · fda_calendar · clinical · publications · conferences ·
                                       │ patents (patent_intel) · company site/news · news · AI triage → events → index
                                       ▼
                         MongoDB 9 replica set (TLS) + mongot (MongoDB Search: vector index)
                           asset_journey · pharmaedge (shared corpora) · patent_intel
```

| Service (`docker-compose.yml`) | Image / build | Role | Exposure |
|---|---|---|---|
| `web` | `apps/web` → nginx 1.29 | SPA + reverse proxy for `/api` (buffering off for streaming) | `127.0.0.1:8080` |
| `api` | `apps/api` (Node 24) | REST + streaming chat API, auth | internal |
| `crawler-api` | `crawler/` (Python 3.11) | resolve drugs, accept crawl jobs | `127.0.0.1:8100` |
| `crawler-worker` | same image | runs per-asset crawl jobs (2 concurrent, 4 h timeout) | internal |
| `crawler-corpus` | same image | builds shared corpora (daily, resumable) | internal |
| `mongo` | MongoDB Community 9.0.2 | single-node replica set, TLS + auth | `127.0.0.1:27017` by default |
| `mongot` | MongoDB Community Search 1.70.5 | vector / full-text search engine | internal |
| `valkey` | Valkey 8 | cache and token store (no persistence) | `127.0.0.1:6380` |

---

## Repository layout

| Path | Contents |
|---|---|
| `apps/api` | NestJS API: auth, users, assets, timeline, competitors, evidence, jobs, chat (Asset AI) |
| `apps/web` | React app: home signals, asset pages, chat, crawl jobs, settings |
| `crawler/` | crawl service and workers, per-asset steps, AI triage / event extraction / indexing, corpora |
| `patent_intel/` | drug → patent portfolio, regulatory timeline, FDA calendar (used by the `patents` and `fda_calendar` steps; also runs standalone with its own API) |
| `company_pr/`, `conference/`, `ema/`, `designations/`, `pubmed/`, `clinicalTrialgov/` | source crawlers that feed the shared corpora |
| `infra/mongo/` | self-hosted MongoDB: secrets/TLS setup, users, backup, restore, Atlas migration |
| `e2e/` | Playwright end-to-end tests |
| `docs/superpowers/specs/` | product and platform design specification |

---

## Getting started

**Prerequisites:** Docker with Compose, Node.js 24 + npm (development), Python 3.11 (crawler/patent_intel
development), an OpenAI API key (chat, triage, embeddings — the rest works without it).

```bash
# 1. MongoDB secrets, private CA and TLS certificates (once per environment)
infra/mongo/setup.sh

# 2. Configuration (see Configuration below)
cp apps/api/.env.example apps/api/.env
cp crawler/.env.example crawler/.env

# 3a. Full stack in Docker
docker compose up -d --build                  # http://localhost:8080

# 3b. Or development with hot reload
docker compose up -d mongo mongot valkey crawler-api crawler-worker crawler-corpus
npm install
npm run dev:api                               # http://localhost:3000/api  (Swagger: /api/docs, non-production)
npm run dev:web                               # http://localhost:5173      (proxies /api to :3000)
```

The first admin user is created on first start from `ADMIN_EMAIL` / `ADMIN_PASSWORD`; add further users under
**Settings → Users** (no self-signup). Then add an asset from the chat ("Add treprostinil"), confirm the identity
card, and follow the crawl under **Crawl jobs**.

---

## Configuration

Every secret comes from environment files that are git-ignored. Never commit `.env` files or
`infra/mongo/secrets/`.

| File | Used by | Key settings |
|---|---|---|
| `infra/mongo/secrets/*` | mongo, mongot, api, crawler | generated by `setup.sh`: root/app/team passwords, replica-set keyfile, CA + server certificate, `app.env` (MongoDB URI) |
| `apps/api/.env` | api | `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COOKIE_SECURE`, `VALKEY_URL`, `OPENAI_API_KEY`, `LLM_CHAT_MODEL`, `LLM_FOLLOWUP_MODEL`, `LLM_EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `CRAWLER_API_URL`, `CRAWLER_SERVICE_KEY` |
| `crawler/.env` | crawler-api, workers | `MONGODB_URI`, corpus DB, OpenAI key and model overrides, crawl limits, service key |
| `.env` (repo root) | patent_intel | `MONGO_URI`, `MONGO_DB`, `MONGO_TLS_CA_FILE`, `API_KEYS`, `SEC_USER_AGENT`, regulatory window, presentation and market settings — see `.env.example` |

`EMBEDDING_DIMENSIONS` and the embedding model must be identical in the API and the crawler (the vector index is
built for 1536-dimensional `text-embedding-3-small` vectors). `SEC_USER_AGENT` ("Company contact@email") is
required for SEC EDGAR; without it the regulatory and calendar steps skip SEC sources.

---

## How data flows

1. **Add an asset.** In chat, `resolve_asset` returns an identity card (name, company, aliases, crawl plan). The
   assistant never starts crawls; the analyst's **Confirm & start crawl** calls `POST /api/assets`.
2. **Crawl job.** The API enqueues an `onboard` job (one active job per asset). The worker runs the plan's steps in
   order; a failed step is recorded and the job continues (`completed_with_errors`). Records are upserted by a
   stable `record_key` and tagged with the assets they belong to.
3. **AI triage.** News, press releases, publications, conference abstracts and CHMP items are classified per asset
   as `ingest`, `headline` or `skip`; decisions are stored in `crawl_ledger` and reused.
4. **Journey.** Rule-based events (FDA, EMA, trials, patents) plus AI-extracted events from `ingest` items, then
   AI consolidation of duplicates within a 10-day window. Each event carries significance, milestone flag and
   source references.
5. **Index.** `ingest` items, prescribing information and annual reports are chunked (1,500 chars, 200 overlap),
   embedded and stored in `record_chunks`; unchanged text is never re-embedded.
6. **Competitors.** A reasoning model proposes the top competitors; each gets a lighter crawl.
7. **Finalize.** Suggested questions are generated, the asset becomes `ready`, caches are invalidated.

Shared corpora (newsrooms, conference abstracts, EMA reports, CHMP meetings, FDA designations) are crawled once
into the `pharmaedge` database by `crawler-corpus` and matched to assets by the steps.

---

## Data model

| Database | Collections (main) | Written by |
|---|---|---|
| `asset_journey` | `assets`, `journey_events`, `fda_records`, `ema_records`, `trial_records`, `publication_records`, `conference_records`, `company_records`, `articles`, `patent_records`, `record_chunks` (+ vector index `record_chunks_vector`), `crawl_ledger`, `llm_cache`, `jobs`, `runs`, `logs`, `users`, `chat_sessions`, `chat_messages` | crawler, api |
| `pharmaedge` | `company_pr_news`, `conference_abstracts`, `ema_reports`, `ema_chmp_meetings`, `fda_designations`, `corpus_sources` | crawler-corpus, source crawlers |
| `patent_intel` | `drugs`, `patents`, `drug_patents`, `regulatory_events`, `fda_calendar_events`, `crawl_runs`, `crawl_jobs` | patent_intel (standalone) |

Conventions: every record has `record_key` (stable id), `date` (ISO), `assets[]`; events reference their sources
as `{collection, record_key}`; re-runs update in place (`first_seen` / `last_seen`), never duplicate.

---

## Asset AI

`POST /api/chat/sessions/:id/turn` streams NDJSON events: `tool_call`, `tool_result`, `card`, `navigate`,
`story_start` / `story_layer` (a journey story drawn layer by layer), `canvas_start` / `canvas_nodes`, `token`,
`answer`, `error`, `done`.

- **Tools** (`apps/api/src/chat/chat-tools.ts`): asset search and overview, timeline, trials, regulatory history,
  patents, milestones, competitors, comparison, evidence search (hybrid keyword + vector `$rankFusion` over
  `record_chunks`, scoped server-side to the assets the user may read), source records, share-price reaction,
  journey story (`build_journey_story`, `annotate_story`, `get_changes`, `compare_journeys`), journey canvas,
  navigation (`open_view`, `open_record`), drug resolution, crawl status.
- **Journey story:** answers "what changed in an asset's evidence, and what does it mean?" as a timeline in the canvas
  area: approvals staircase, five evidence lanes, share price, what changed since a date (new developments,
  pipeline-detected changes from `journey_changes`, cross-source checks, label and trial changes, slide-chart
  conflicts, evidence first seen), a comparison asset and chapters, with the model's notes pinned to the events they
  cite. Spec: `docs/superpowers/specs/2026-10-10-journey-story-design.md`.
- **Grounding:** facts come only from tool results; every statement cites `[n]`; invented references are removed,
  numbers and dates are checked against the cited evidence (`verify.ts`), crawled text is fenced as untrusted.
- **Models:** `LLM_CHAT_MODEL`, `LLM_FOLLOWUP_MODEL`, `LLM_RAG_MODEL` (default `gpt-6-luna`), embeddings
  `text-embedding-3-small` (1536). `RAG_STAGES` turns on retrieval stages after hybrid search (`rerank`, `judge`,
  `hyde`). Without `OPENAI_API_KEY` chat returns `LLM_UNAVAILABLE`; everything else works.

Details: [apps/README.md](apps/README.md).

---

## Security

- **Authentication:** JWT access token (HS256, 15 min) and rotating refresh token (7 days, stored hashed, replay
  revokes the session), both in `httpOnly`, `SameSite=Strict` cookies (`Secure` in production). Login is
  rate-limited (5/min per IP + email); chat is rate-limited per user.
- **Authorization:** global guard on every route; roles `admin` (user management, asset deletion) and `analyst`.
  Chat sessions are private to their user; asset data is shared across the organisation.
- **Input validation:** whitelisting DTO validation on every API request (unknown fields rejected); patent_intel
  validates all inputs with strict schemas.
- **Service boundaries:** API → crawler calls carry `X-Service-Key` (constant-time comparison); crawler and
  patent_intel fetch only allow-listed hosts, and links found in data go through an SSRF guard (public IPs only,
  every redirect checked).
- **Database:** TLS required with a private CA, authentication on, keyfile for the replica set, ports bound to
  localhost by default. Open MongoDB to the network only behind a firewall allowlist (Docker-published ports
  bypass `ufw`).
- **Secrets:** environment files and `infra/mongo/secrets/` only; never in code, images, logs or client bundles.
- **Production checklist:** `COOKIE_SECURE=true` behind HTTPS, strong `JWT_SECRET`, a dedicated read-only database
  role for analytics/agents, Swagger disabled (`NODE_ENV=production`), licensed data sources where terms require it.

---

## Operations

- **Health:** `GET /api/health` (api), `GET /health` (crawler-api), container healthchecks for mongo, mongot and
  valkey.
- **Jobs:** one active crawl per asset; interrupted jobs are marked failed on worker start; cancel from the UI or
  `POST /jobs/{id}/cancel`.
- **Backups:** `infra/mongo/backup.sh` (`mongodump --oplog`, 7 days kept; schedule with cron);
  `infra/mongo/restore.sh`. Search indexes are not in dumps — they are recreated by the crawler
  (`ensure_vector_index`).
- **Caching:** Valkey version keys per asset; the crawler bumps them after a job, so the UI never shows stale
  data. Valkey loss is safe (reads fall back to MongoDB; users re-authenticate).
- **Cost control:** LLM responses in the crawler are cached (`llm_cache`); triage decisions are reused; unchanged
  text is never re-embedded. Per-job LLM call and token counts are stored on the job.

---

## Testing

```bash
npm test                                 # API e2e (in-memory MongoDB + Valkey) and web unit/UI tests
npm run test:e2e                         # Playwright against the running stack (http://localhost:8080)
python -m pytest crawler -q              # crawler (in its own Python environment)
python -m pytest tests -q                # patent_intel
```

API e2e tests need Valkey running (`docker compose up -d valkey`).

---

## Component documentation

| Component | Document |
|---|---|
| API and web app, Asset AI, auth | [apps/README.md](apps/README.md) |
| Crawlers and data sources | [crawler/README.md](crawler/README.md) |
| Patent Intel (patents, regulatory timeline, FDA calendar, presentations, stock impact) | [patent_intel/README.md](patent_intel/README.md) |
| MongoDB setup, TLS, backups, team access | [infra/mongo/README.md](infra/mongo/README.md) |
| Company newsroom spiders | [company_pr/README.md](company_pr/README.md) |
| Conference abstracts | [conference/README.md](conference/README.md) |
| EMA CHMP highlights / FDA designations | [ema/README.md](ema/README.md) · [designations/README.md](designations/README.md) |
| Product design | [docs/superpowers/specs/2026-10-08-asset-journey-platform-design.md](docs/superpowers/specs/2026-10-08-asset-journey-platform-design.md) |

---

## Known limitations

- Asset data is shared by all users (no tenant or project isolation).
- Only triaged `ingest` items, prescribing information, annual reports and investor slides are embedded; trials,
  regulatory records and patents are reached through structured tools.
- Crawled text is fenced and marked untrusted in every prompt; that limits prompt injection, it does not rule it out.
- Citations guarantee the cited record exists and that its numbers and dates appear in it, not that it fully supports
  every sentence.
- Evidence history (`journey_changes`) starts with the first crawl after it was added; cross-source checks are
  heuristics that flag what to look at, not verdicts.
- Market prices come from Yahoo Finance's keyless endpoint: unofficial, for local testing only. A licensed price
  source must be wired into `patent_intel/market/prices.py` before production use.
- Some sources block automated clients (bot protection); such items are recorded as unavailable, never bypassed.
