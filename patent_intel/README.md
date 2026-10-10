# Patent Intel

**Drug → developer → worldwide patent portfolio, collected automatically into MongoDB.**

Patent Intel takes a drug, identifies the company developing it, discovers that company's patents for the
drug across patent offices, and stores clean, de-duplicated bibliographic records — publication and
application numbers, dates, assignees, inventors, CPC classes, priority claims, patent family, legal status
and legal events. It needs no paid services or API credentials, and it only uses sources and pages that
permit automated access.

```
AdisInsight drug profile ──► drug name, brand/code names, developer company
PubChem (public API)     ──► patent publications linked to the compound
Google Patents pages     ──► patent family + same-company citations ──► classify ──► MongoDB
SEC EDGAR + openFDA      ──► PDUFA dates, CRLs, approvals ─────────────► timeline ──► MongoDB
FDA Tracker calendar     ──► PDUFA / AdCom events ──► drug from text, link, document ──► MongoDB
```

**Example — treprostinil (United Therapeutics):** 711 publications in 42 patent families across 12 offices
(US, EP, WO, JP, KR, CA, AU, ES, CN, IL, DE, AT), each with full bibliographic data and legal status.

---

## Contents

- [How it works](#how-it-works)
- [Requirements and setup](#requirements-and-setup)
- [Choosing drugs](#choosing-drugs)
- [Regulatory timeline (PDUFA dates, CRLs, approvals)](#regulatory-timeline-pdufa-dates-crls-approvals)
- [FDA calendar (PDUFA dates and advisory committees)](#fda-calendar-pdufa-dates-and-advisory-committees)
- [Corporate presentations](#corporate-presentations)
- [Stock impact of drug events](#stock-impact-of-drug-events)
- [REST API](#rest-api)
- [Data model](#data-model)
- [Reliability: duplicates, re-runs, performance](#reliability-duplicates-re-runs-performance)
- [Security](#security)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Design decisions](#design-decisions)
- [Limitations](#limitations)

---

## How it works

1. **Identify the drug and company.** The AdisInsight profile (`/drugs/<id>`) provides the drug name, its
   alternative names (brands, development codes) and its developers. By default the **primary** company —
   the one named in the profile heading — is used; `all_developers` uses every listed developer in a single
   combined crawl. Without an AdisInsight id, a drug name and company can be supplied directly.
2. **Find relevant documents.** PubChem's public API returns every patent publication linked to the compound.
3. **Crawl.** Only Google Patents `/patent/<number>` pages are fetched. Each page contains the document's
   bibliographic data, its patent family, and its citations *with their owners*. Starting from documents that
   the company owns and that concern the drug, the crawler follows family members and same-company,
   drug-related citations until nothing new appears or the page budget is reached.
4. **Classify** — deterministic rules, no guessing:

   | decision | rule |
   |---|---|
   | `include` | owner matches the company (exact, after removing legal suffixes such as Inc/Ltd/Corp) **and** the document concerns the drug — or it belongs to the patent family of such a document (e.g. Japanese/Korean members with owner names in local script) |
   | `uncertain` | near matches (e.g. "United Therapeutics Europe") — stored for human review, never included automatically |
   | `reject` | other companies' patents that merely mention the drug (an audit sample is kept) |

5. **Store.** Records are upserted by stable identifiers, together with a per-run coverage report.

---

## Requirements and setup

- Python **3.11+**
- MongoDB 6+ (e.g. MongoDB Atlas) — optional: without it, results are written as JSON files

```bash
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` (it is git-ignored — never commit real values):

| variable | purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string. Empty → JSON files in `DATA_DIR` |
| `MONGO_DB` | database name (default `patent_intel`) |
| `MONGO_TLS_CA_FILE` | CA used to verify MongoDB: unset = `certifi` bundle (Atlas), `system` = the server's OS trust store, or a path to a CA file |
| `DATA_DIR` | cache and JSON output directory (default `Patents_Data`) |
| `API_KEYS` | comma-separated API keys, each ≥ 32 characters — `python -c "import secrets;print(secrets.token_urlsafe(32))"` |
| `CORS_ORIGINS` | comma-separated frontend origins (`https://…`; `http://` only for localhost) |
| `ENABLE_DOCS` | `true` exposes interactive docs at `/docs` (keep `false` in production) |
| `MAX_CONCURRENT_JOBS` / `MAX_QUEUED_JOBS` | API job concurrency and queue size |
| `JOB_TIMEOUT_S` | hard time limit for one crawl job (default 7200) |
| `REG_START` / `REG_END_MONTHS` | regulatory & FDA-calendar window: start date, and months after today for the end (default 2013-01-01, 19) |
| `MAX_PAGES` / `PROBE_PAGES` | crawl budgets; API requests may lower but never raise them |

**MongoDB Atlas notes**

- Add the IP address(es) of every machine that connects under *Network Access*. Networks that load-balance
  across several internet lines need **each** public IP listed; otherwise connections fail intermittently with
  `TLSV1_ALERT_INTERNAL_ERROR`.
- Certificate verification is always on. By default MongoDB's certificate is checked against the `certifi`
  public CA bundle, so python.org builds on macOS (which ship without system certificates) connect without extra
  setup. See [TLS certificates on servers](#tls-certificates-on-servers) for private or corporate CAs.
- Indexes, including the unique constraints, are created automatically on first connect.

---

## Choosing drugs

The drug is selected at run time — nothing is hard-coded.

**Command line**

```bash
python -m patent_intel 800010447                           # one drug (treprostinil)
python -m patent_intel 800010447 800000002                 # several drugs, one after another
python -m patent_intel 800010447 --all-developers          # all developers listed on the profile
python -m patent_intel --name treprostinil --company "United Therapeutics Corporation"
python -m patent_intel 800010447 --max-pages 1500          # larger crawl budget
python -m patent_intel 800010447 --seed US9604901B2        # add known publications as starting points
```

The AdisInsight id is the number at the end of the profile URL, e.g.
`https://adisinsight.springer.com/drugs/800010447`. AdisInsight does not permit automated use of its search,
so a drug is identified by this id — or by a drug name plus company.

**Frontend** — use the REST API below with `adis`, or `drug_name` + `companies`.

---

## Regulatory timeline (PDUFA dates, CRLs, approvals)

Each crawl also builds a de-duplicated regulatory timeline for the drug. Date window: **2013-01-01 to today + 19
months**, computed at the start of every run so it moves forward automatically (`REG_START`, `REG_END_MONTHS`;
`REG_END` pins a fixed end date):

| source | what it provides |
|---|---|
| SEC EDGAR full-text search + filing archive | PDUFA target dates and complete response letters stated in company filings (8-K press releases, 10-K, 10-Q, 6-K, 20-F) — the sentence and the filing link are kept as evidence |
| openFDA `drugsfda` | FDA submissions and approvals, categorized `original`, `efficacy`, `labeling`, `manufacturing` |

Only the given drug is kept:

- the drug name or one of its brand names must appear in the dated sentence or the sentence immediately before it
  (filings name the product, then state the date);
- the filer/sponsor must be the drug's company — competitors' products of the same molecule and generics are
  excluded, as are sentences that describe another company's event;
- complete response letters count only when actually received/issued (not requested or hypothetical).

The same PDUFA date reported in many filings becomes **one** event with all its sources. Events no longer
confirmed by a later run are flagged `stale` and hidden by default.

The SEC requires a declared contact: set `SEC_USER_AGENT="Company Name contact@email.com"` in `.env`
(without it, only openFDA is used). Filings are searched from two years before the window, since PDUFA dates
are announced months in advance.

---

## FDA calendar (PDUFA dates and advisory committees)

Events from the FDA Tracker calendar (<https://www.fdatracker.com/fda-calendar/>) are matched to the drug for the
same date window (2013-01-01 to today + 19 months).

**Acquisition.** The page embeds two public Google Calendars (*PDUFA*, *Adcom*). Their public iCal exports return
every event — date, title (`TICKER Company TYPE`), description and source link — in one HTTP request each; no
browser automation is needed.

**Identifying the drug** — an event is kept only when one of the drug's names (generic, brand, code names) is found
in, in order of preference:

| evidence | example |
|---|---|
| `calendar_text` | the event description names the drug |
| `link_url` | the source link's URL slug: `…New-Drug-Application-for-Ralinepag-to-Treat-…` |
| `link_document` | the linked document (SEC filing / press release): the sentence stating the event date and the sentence before it, or a press release's lead |
| `sec_copy` | when the link cannot be fetched: the same announcement filed by the company on SEC EDGAR (ticker → CIK, event date) |

Each stored event carries the matched names, the evidence text and URLs, whether the sponsor is the drug's
developer (`is_company`), and full provenance (feed URL, event UID, source last-modified, retrieval time and method).

**Unresolved events.** Some press-release hosts reset connections from automated clients (bot protection). Such
blocks are not bypassed: the host is recorded in `blocked_hosts`, the SEC copy is tried, and events of the drug's own
company that still cannot be verified are stored as `status: unresolved` with the exact problem — never guessed.

Links found in third-party data point to arbitrary websites, so they are fetched through an SSRF-guarded client:
`http`/`https` on default ports only, no embedded credentials, and every redirect hop must resolve exclusively to
public IP addresses.

---

## Corporate presentations

An isolated, resource-bounded subsystem (`patent_intel/presentations/`) that turns a company's latest investor
presentations into queryable, evidence-linked facts.

```
company ─► discovery (IR "events & presentations" page; SEC 8-K slide decks as fallback) ─► latest N distinct decks
        ─► safe download (SSRF guard, %PDF/image magic check, size cap, SHA-256, content-addressed store)
        ─► worker process: render, text + bboxes, embedded images, tables, vector bar charts (geometry → values)
        ─► OpenAI vision for selected slides (charts, tables, scans, clinical) within a page budget
        ─► validation (ranges, model vs. chart geometry) ─► MongoDB facts + on-disk artifacts
```

```bash
python -m patent_intel.presentations crawl --company "United Therapeutics" --ticker UTHR \
       --ir-url https://ir.unither.com/events-and-presentations
python -m patent_intel.presentations benchmark --company-key uthr --models gpt-5.6-luna gpt-6-luna --pages 20
python -m patent_intel.presentations gc            # report reclaimable disk; add --delete to reclaim (see Storage)
```

API: `POST /v1/presentations/crawls` `{"company", "ticker"?, "ir_url"?}` → `202 {job_id}`;
`GET /v1/presentations/crawls/{job_id}`, `GET /v1/presentations/{presentation_id}`,
`GET /v1/presentations/{presentation_id}/metrics`.

**Isolation.** All PDF work runs in a separate worker process per document (own process group, minimal
environment) supervised for page timeout, job timeout and process-tree memory (`PRESENTATION_MEMORY_LIMIT_MB`);
any breach kills and reaps the worker, the deck is marked `failed`, everything else continues. Pages are processed
one at a time; only file paths and capped JSON cross the process boundary (2 MB per page message, 16 MB per document,
page text and table count capped), so a hostile PDF cannot exhaust the API process either. A failing source (IR page,
SEC filing), download, page or vision call fails only itself. Separate HTTP pools and job queue; MongoDB writes are
bounded (2 concurrent, batched). If the subsystem cannot load (missing optional dependency, invalid
`PRESENTATION_*` value) its endpoints are disabled with an error log and the patent API still starts.
Defaults: one worker process, 8 concurrent vision calls.

**Network.** All public-web fetches (IR pages, decks, slide images) check the address actually connected to, not
just a separate DNS lookup, so DNS rebinding cannot reach internal hosts; redirects are checked on every hop.
Requests are paced process-wide: SEC gets one shared budget (8 req/s across all `*.sec.gov` hosts) whether the patent
pipeline, presentation discovery or downloads are asking. Downloads have an overall 300 s deadline.

**Jobs.** One active job per company (unique index; the company key comes from the normalized name, so a request with
or without ticker is the same company). Running jobs heartbeat every 30 s; a job whose process died (OOM, SIGKILL,
hard deploy) is marked `failed` and unlocked once its heartbeat is 2 min old — when the next request for that
company or that job arrives. Jobs of live processes, including other instances on the same database, are never
reset.

**Vision.** Off until `OPENAI_API_KEY` is set — then the selected slide images are sent to OpenAI. Per
presentation budget (`PRESENTATION_VISION_MAX_PAGES`); pages beyond it are stored as `deferred`. Results are
cached by everything that shapes the answer (image hash, slide text, model, prompt + schema, output budgets), so a
model change re-runs only this stage; identical slides are asked once. **Re-runs never lose facts:** metric and claim
ids come from what the fact is (metric/arm/trial/timepoint…, or the chart bar), and a page's model facts are only
replaced or marked stale when its new vision result is authoritative — a failed, disabled or deferred vision stage
keeps the previous run's facts. Compare models with the `benchmark` command (real token use and cost, agreement with
chart geometry and between models).

**Storage.** MongoDB: `presentations`, `presentation_pages`, `presentation_metrics` (value, unit, arm, trial,
evidence bbox + page image hash, validation status), `presentation_claims`, `presentation_jobs`. Files under
`Patents_Data/presentations/`: `objects/` (every PDF/page/image once, by SHA-256), `<company>/<presentation>/`
(`manifest.json`, `extraction/*.json.zst` — lossless zstd). Re-runs revalidate known files with a conditional GET
(ETag / Last-Modified) and skip cached stages; a file replaced at the same URL becomes a new presentation and the old
one is kept with `superseded_by`. `gc` deletes objects no manifest or cache entry references, plus stale temp/work
files, only when older than `--grace-hours` (default 48, protects running jobs); `--cache-days` also expires stage
cache entries (they hold paid vision results, so this is opt-in).

**Engines.** pypdfium2 (render, text) + pdfplumber (tables, vector geometry): BSD/Apache/MIT. PyMuPDF (AGPL) is
not used by default.

---

## Stock impact of drug events

How a listed company's share price moved after each stored event of a drug (`patent_intel/market/`). Part of every
crawl (step `market`, after the FDA calendar; skip with `--no-market` / `"market": false`).

**Which companies.** For each crawl:

| linked as | how |
|---|---|
| `drug_company` | each of the run's companies (Adis primary company, or the looked-up/explicit ones) is searched by name; a listing is kept only when its listed name **is** that company (same matcher as the regulatory timeline — "United Health" never stands in for "United Therapeutics") |
| `fda_calendar_event` | every ticker on the drug's matched FDA calendar events, e.g. Liquidia (`LQDA`) for treprostinil |

Companies without a listing (private, renamed) are reported in the run, not guessed. Daily closes for each listed
ticker are stored from `REG_START` (the event window) to today.

**Which events belong to a listing** — the same rules the events were collected with:

| source | belongs to the listing when |
|---|---|
| FDA calendar | the event's ticker is the listing's ticker |
| regulatory timeline | the sponsor is the listing's company |
| investor presentations | the company's deck has statements about the drug: its name or any alternative name, brand or code (Tyvaso, Remodulin, UT-15C …), never another substance that merely contains the name (`treprostinil palmitil`) |
| patents (`patent_granted`, `patent_expiry`) | the drug's included patents assigned to the company: grant date and expiry date (adjusted, else anticipated) of granted **US** documents (B1/B2/reissue); patents sharing a date form one event listing every patent. Litigation entries have no dates on Google Patents and are not used |

**The measurement.** Day 0 is the first trading day on or after the event date (a weekend PDUFA date counts from
Monday). Every move is the % change of a close against the **last close before day 0**: day 0, after 5 and 20
trading days, the deepest dip and the highest peak within 20 days (with the day each happened). Events before the
price history or not yet traded are listed with the reason, not measured. Moves show timing only — never that the
event caused them.

**Prices.** Yahoo Finance's keyless chart endpoint — **unofficial, for local testing only**, not licensed for
production. Closes are split/dividend-adjusted; the latest bar may be today's, still moving. Prices are reused for
`MARKET_PRICE_TTL_S` (6 h) and refreshed on read when older; if the source is down the last stored prices are served
with a warning.

**Filters.** `kinds` (event types, e.g. `approval,pdufa`; omitted = all, empty = none) and `start`/`end` dates are
applied on the server; `kind_counts` are counted before filtering so a client can offer every type the data has.

**Chart page.** `GET /market` (served by the API; a test page — the product UI is `apps/web`) — search a company,
tick its drugs and event types (patent types start unticked), pick a date range, see the price line with ▲/▼
markers per event; click an event to zoom in with its pre-event close, dip and peak drawn. Built on TradingView
Lightweight Charts™ (Apache-2.0; attribution shown on the page). The page asks for the API key and keeps it in the
browser tab only.

---

## REST API

```bash
uvicorn patent_intel.api:app --host 127.0.0.1 --port 8000
```

All endpoints except `/healthz` require the header `X-API-Key`.

| method | path | description |
|---|---|---|
| `POST` | `/v1/crawls` | start a crawl → `202` with `job_id` |
| `GET` | `/v1/crawls/{job_id}` | job status (`queued`, `running`, `done`, `failed`) and summary |
| `GET` | `/v1/drugs/{drug_id}` | drug profile |
| `GET` | `/v1/drugs/{drug_id}/patents` | patents; query: `decision=include\|uncertain`, `stale=false`, `skip`, `limit` (≤ 200) |
| `GET` | `/v1/drugs/{drug_id}/regulatory` | timeline sorted by date; query: `type`, `category`, `stale=false`, `skip`, `limit` |
| `GET` | `/v1/drugs/{drug_id}/fda-calendar` | FDA calendar events for the drug; query: `status=matched\|unresolved`, `stale=false`, `skip`, `limit` |
| `GET` | `/v1/market/search?q=` | listed companies matching a name or ticker (any exchange) |
| `GET` | `/v1/market/{ticker}/drugs` | drugs in our data whose events belong to this company |
| `GET` | `/v1/market/{ticker}/impact?drug_ids=a,b` | daily closes + those drugs' events for this company, each with its measured move; optional `kinds=approval,pdufa`, `start`, `end` (YYYY-MM-DD); returns `kind_counts` |
| `GET` | `/market` | stock-impact chart page (static; calls the endpoints above) |
| `GET` | `/healthz` | liveness check |

`drug_id` is the AdisInsight id (`800010447`) or `name:<slug>` (`name:treprostinil`); it is returned in the job.

**Start a crawl** — either form:

```json
{ "adis": "800010447" }
{ "adis": "https://adisinsight.springer.com/drugs/800010447", "all_developers": true }
{ "drug_name": "treprostinil", "companies": ["United Therapeutics Corporation"], "max_pages": 400 }
```

**Status codes:** `202` accepted · `401` missing/invalid key · `409` a crawl for this drug is already running
· `413` request body too large · `422` invalid input · `429` queue full
· `503` database unavailable (retryable; details stay in server logs).

**Client example** (run server-side — see [Deployment](#deployment)):

```js
const headers = { "Content-Type": "application/json", "X-API-Key": process.env.PATENT_API_KEY };

const { job_id } = await (await fetch(`${API}/v1/crawls`, {
  method: "POST", headers, body: JSON.stringify({ adis: "800010447" }),
})).json();

let job;
do {
  await new Promise((r) => setTimeout(r, 5000));
  job = await (await fetch(`${API}/v1/crawls/${job_id}`, { headers })).json();
} while (job.status === "queued" || job.status === "running");

const page = await (await fetch(`${API}/v1/drugs/${job.drug_id}/patents?limit=50`, { headers })).json();
// page.total, page.items[i]: publication_number, title, assignee_original, filing_date, cpc,
//                            family_id, legal_status, legal_events, match, ...
```

A first crawl of a drug typically takes 5–15 minutes because requests are paced politely; repeat crawls are
served largely from cache.

---

## Data model

| collection | `_id` | content |
|---|---|---|
| `drugs` | AdisInsight id or `name:<slug>` | drug name, alternative names, developers |
| `patents` | `GP:<publication>`, e.g. `GP:EP2026816B1` | publication and application numbers, kind, filing/priority/publication dates, original and current assignees, inventors, CPC, priority applications, family id and members, legal status, events, legal events, provenance, content hash, `first_seen`, `last_seen` |
| `drug_patents` | `<drug_id>:<publication>` | decision (`include` / `uncertain`), match evidence (score, how it was found, which family it came through), `stale` flag |
| `crawl_runs` | `<drug_id>:<timestamp>` | coverage report: pages fetched, included/uncertain/rejected, families, offices, legal-status distribution, budget status, errors |
| `regulatory_events` | hash of drug, type, date, sponsor | type (`pdufa_date`, `complete_response_letter`, `approval`, …), date, category, sponsor, status (`upcoming`/`past`), first/last reported, evidence (sentence, context, filing link) |
| `fda_calendar_events` | `<drug_id>:<event uid>` | date, event type (`pdufa`, `adcom`), ticker, company, `is_company`, status (`matched`/`unresolved`), matched names, evidence, links, provenance |
| `drug_listings` | `<drug_id>:<ticker>` | listed company linked to the drug's events: ticker, company, listed name, exchange, roles (`drug_company`, `fda_calendar_event`), `stale` flag |
| `market_prices` | ticker | adjusted daily closes (`bars: [{date, close}]`), source, currency, exchange, `as_of`, `fetched_at` |
| `crawl_jobs` | job id | API job status |

A patent shared by several drugs is stored once in `patents` and linked from each drug in `drug_patents`.

---

## Reliability: duplicates, re-runs, performance

| layer | guarantee |
|---|---|
| crawl | each publication number is fetched at most once per run; numbers that resolve to an already-crawled document are discarded |
| `patents` | exactly one document per publication — stable `_id` plus a **unique index** on `publication_number`; re-runs update in place, keeping `first_seen` and refreshing `last_seen` |
| `drug_patents` | one link per drug and publication; links not confirmed by the latest run are flagged `stale` rather than deleted, so a smaller crawl never erases earlier findings |
| jobs | at most one active crawl per drug, enforced by a unique partial index in MongoDB (holds across API processes) |
| network | responses are cached on disk (1 day for patent pages, 7 days for AdisInsight/PubChem) |

**Performance.** The service is asynchronous end to end: `httpx` for HTTP, PyMongo's native async client
for MongoDB, and HTML parsing and file I/O in worker threads so the event loop never blocks. The crawler
runs four concurrent workers over one shared frontier. Each source is still limited to about one request per
second with one request in flight, so a **first** crawl is paced by that limit, while repeat crawls are fast
(858 pages in about 17 seconds from cache).

**Fault tolerance.** Retries with exponential backoff and `Retry-After` on 429/5xx; per-host circuit breaker;
per-job timeout; parsers that detect page-layout changes and never cache a broken page; atomic file writes;
interrupted jobs are marked on restart. One failing drug does not stop the next.

---

## Security

- **Authentication:** API key on every request (constant-time comparison); the server refuses to start
  without keys of at least 32 characters.
- **Input validation:** unknown fields rejected, restricted character set and lengths, validated path
  parameters; database reads use exact matches on validated values only — no query operators from clients.
- **Outbound requests:** HTTPS only, to an allow-list of hosts (AdisInsight, PubChem, Google Patents),
  re-checked on every redirect; response size caps and timeouts.
- **Resource limits:** 8 KB request bodies (counted as received, before authentication, including chunked
  uploads); server-side crawl budgets; bounded concurrency and queue; per-job timeout.
- **Responses:** CORS allow-list (no wildcard), `nosniff`, `no-store`, `X-Frame-Options: DENY`; generic error
  messages to clients with details kept in server logs; interactive docs disabled by default.
- **Secrets:** only in `.env` / environment; never logged or returned.

---

## Deployment

- Run a **single** uvicorn worker; scale by running separate instances per workload if needed.
- Place an HTTPS reverse proxy in front: TLS with HSTS, `client_max_body_size 8k`, per-IP and per-key rate
  limits, idle and slow-request timeouts.
- **Keep the API key server-side.** Call this API from your frontend's backend (BFF) after your own user
  authentication — a key embedded in browser code is visible to every visitor.
- **Render patent text as plain text** (`textContent` or framework escaping, never `innerHTML`) and use a
  Content-Security-Policy such as `script-src 'self'`. Titles and abstracts originate from external pages.
  Build links only from `publication_number`.
- Use MongoDB in production (JSON mode is for local use) and prune `Patents_Data/.cache` periodically.

### TLS certificates on servers

Certificate verification is never disabled. Which certificate authorities are trusted:

| connection | default | override |
|---|---|---|
| MongoDB | `certifi` public CA bundle (MongoDB Atlas) | `MONGO_TLS_CA_FILE=system` (OS trust store, e.g. a private CA installed on the server) or `MONGO_TLS_CA_FILE=/path/ca.pem`. If the connection string itself sets `tlsCAFile` / `tlsInsecure` / `tlsAllowInvalidCertificates`, the connection string decides and nothing is added. |
| outbound HTTP (sources) | `certifi` public CA bundle | standard `SSL_CERT_FILE` / `SSL_CERT_DIR` environment variables — needed when the server sits behind a proxy that inspects TLS with a corporate CA |

Self-hosted MongoDB with a private CA: either install the CA in the server's trust store and set
`MONGO_TLS_CA_FILE=system`, or point `MONGO_TLS_CA_FILE` at the CA file.

---

## Architecture

| module | responsibility |
|---|---|
| `patent_intel/adis.py` | AdisInsight profile → drug, alternative names, developers |
| `patent_intel/pubchem.py` | drug name → PubChem patent links |
| `patent_intel/google_patents.py` | parsing of one Google Patents page |
| `patent_intel/crawler.py` | concurrent crawl frontier and final classification |
| `patent_intel/matching.py` | company-name normalization and scoring |
| `patent_intel/regulatory.py` | SEC EDGAR + openFDA regulatory timeline |
| `patent_intel/fdacal.py` | FDA Tracker calendar events matched to the drug |
| `patent_intel/pipeline.py` | orchestration for one drug and the coverage report |
| `patent_intel/store.py` | MongoDB or JSON storage behind one async interface |
| `patent_intel/net.py` | HTTP client: host allow-list, size limits, pacing, retries, disk cache |
| `patent_intel/api.py` | REST API |
| `patent_intel/presentations/` | isolated presentation subsystem (discovery, downloader, worker, supervisor, vision, artifacts, storage, pipeline, api, CLI) |
| `patent_intel/config.py` | configuration from `.env` |

```
CLI / API ─► pipeline.run_drug
               ├─ adis.fetch_drug ──────────► AdisInsight
               ├─ pubchem.patent_ids ───────► PubChem
               ├─ crawler.crawl (4 workers) ► Google Patents /patent/ pages
               ├─ crawler.classify
               └─ store.upsert ─────────────► MongoDB | JSON
```

---

## Design decisions

- **Permitted sources only.** WIPO PATENTSCOPE's terms prohibit automated queries and scraping, and its paid
  API covers PCT applications only; Google Patents' search endpoints are disallowed by robots.txt. The crawler
  therefore uses only Google Patents document pages, PubChem's documented API and AdisInsight profile pages.
  The FDA calendar is read through its public iCal exports, and technical access controls (bot protection) are
  never bypassed — blocked sources are reported and the SEC copy of the announcement is used instead.
- **No credentials required.** Google's BigQuery patent dataset was evaluated but needs a cloud account; the
  family/citation crawl achieves comparable discovery without one.
- **Deterministic matching.** Company ownership is decided by normalized-name rules with recorded evidence;
  uncertain cases are kept for review rather than guessed.
- **Existing open-source tools were evaluated** (Google Patents scrapers, PubChemPy, Orange Book parsers).
  None was both maintained and compliant with the constraints above while offering family and citation
  traversal, so a compact purpose-built parser and crawler were written.

---

## Limitations

- Coverage is what is reachable from PubChem's compound links plus the family and citation graph on Google
  Patents. A patent family that is neither cited by the company's other families nor linked by PubChem can be
  missed. Each run records pages fetched and whether the budget was exhausted; results are never presented
  as "all patents".
- Legal status is as reported by Google Patents, which describes it as an assumption rather than a legal
  conclusion.
- Biologics without a PubChem compound record have no PubChem links; provide starting points with `--seed`.
