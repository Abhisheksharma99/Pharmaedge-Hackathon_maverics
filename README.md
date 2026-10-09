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
| `GET` | `/healthz` | liveness check |

`drug_id` is the AdisInsight id (`800010447`) or `name:<slug>` (`name:treprostinil`); it is returned in the job.

**Start a crawl** — either form:

```json
{ "adis": "800010447" }
{ "adis": "https://adisinsight.springer.com/drugs/800010447", "all_developers": true }
{ "drug_name": "treprostinil", "companies": ["United Therapeutics Corporation"], "max_pages": 400 }
```

**Status codes:** `202` accepted · `401` missing/invalid key · `409` a crawl for this drug is already running
· `413` request body too large · `422` invalid input · `429` queue full.

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
