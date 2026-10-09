# Pharmaedge – Asset Journey data crawlers

Gathers the raw data for an asset's journey (past performance and current trajectory)
into MongoDB. RSS and Google Alerts crawlers are reused from `universal-crawler`;
FDA and EMA fetchers are new.

| Source | Code | Collection | What you get |
|---|---|---|---|
| RSS feeds | `crawler/services/rss_crawler_service.py` | `articles` | Full article text from any RSS/Atom/hexML feed |
| Google Alerts | `crawler/services/google_alerts_crawler.py` (+ `google_alerts_service.py` to create alerts) | `articles` | Full news-crawler pipeline: discovery → classify → resolve → extract (HTTP, Playwright fallback) |
| FDA | `crawler/regulatory/fda.py` | `fda_records` | Drugs@FDA submissions (approval + supplement timeline), recalls, FAERS adverse-event counts per month |
| EMA | `crawler/regulatory/ema.py` | `ema_records` | EPAR (authorisation), post-authorisation opinions, DHPC safety letters, orphan designations, referrals |

Every record carries `date` (ISO `YYYY-MM-DD`) and `assets` (the asset names it was
gathered for), so an asset's journey is `find({"assets": X}).sort("date")` across the
three collections. `runs` and `logs` hold crawl bookkeeping.

## Setup

Python 3.10+ (production used 3.11).

```bash
uv venv --python 3.11 .venv && uv pip install --python .venv/bin/python -r crawler/requirements.txt
.venv/bin/python -m playwright install chromium
cp crawler/.env.example crawler/.env   # then fill in MONGODB_URI
```

## Run (from `crawler/`)

```bash
cd crawler
../.venv/bin/python main.py --asset Keytruda --alias pembrolizumab \
    --rss "https://www.bing.com/news/search?q=Keytruda&format=rss" \
    --alerts-rss "https://www.google.com/alerts/feeds/<user>/<id>"
```

- `--keyword "PH-ILD"` (repeatable) builds two feeds per keyword with no time filter: a Bing
  News archive feed through the RSS crawler and a Google News search feed through the Alerts
  pipeline. Each article records the `keyword` that found it.
- `--output json` writes `data/<asset>/{articles,fda_records,ema_records,runs}.json` (+ `logs.jsonl`)
  for review instead of MongoDB; nothing touches the database.
- `--sources fda,ema` to run only some sources; FDA/EMA need nothing but the asset name.
- `--alias` adds names to match (INN, code name, other brands).
- No Alerts feed yet? `--alerts-cookies cookies.json` (your Google login cookies) creates one.
- Re-running is safe: articles dedupe on `url`, regulatory records on `record_key`.

## Crawl service: every crawler under one endpoint

The app collects data through the crawl service (`service/`: FastAPI `api.py` + arq `worker.py`), not this CLI.

- **Adding an asset:** `POST /resolve {"query": "sotatercept"}` turns a typed name into an identity card in ~10–20 s (`onboarding/resolve.py`): openFDA, EMA and ClinicalTrials.gov facts in parallel (each best effort), merged by the reasoning model; the company website and press-release page are verified by fetching them; the onboard plan comes with a note per step. 404 `ASSET_NOT_RESOLVED` when the model doesn't know the drug. After the user confirms, NestJS creates the asset and starts an `onboard` job.
- **Starting a job:** `POST /jobs {"asset_id", "type"}` (NestJS calls it for refresh and onboarding). One active job per asset (409 `JOB_ALREADY_RUNNING`).
- **Job types:** `onboard` (new primary asset: fast sources first, then competitors, patents, finalize), `refresh` (every step, then competitors and finalize), `competitor` (light: regulatory, clinical, the 300 newest publications, conferences, newswires for the first 3 names, patents, journey/AI steps, finalize). `finalize` rebuilds the rule events, writes suggested questions and marks the asset `ready`; an onboard / competitor job that ends without it leaves the asset `failed`.
- **The plan:** a job runs the steps in `service/steps.py` in order. Each step writes records in the shared contract and is tagged with the asset id; a failed step doesn't stop the others.
- **Running a subset:** pass `{"steps": [...]}` to run only some steps. `GET /sources` lists the plan of each job type.

| Step | Crawler | Writes |
|---|---|---|
| regulatory | ours: `regulatory/fda.py`, `regulatory/ema.py` | `fda_records`, `ema_records` |
| clinical | team `clinicalTrialgov/` client, our mapping (`regulatory/clinicaltrials.py`) | `trial_records` |
| publications | team `pubmed/` (`regulatory/pubmed_source.py`) | `publication_records` |
| conferences | team `conference/` corpus (ERS, ATS, CHEST), matched with its keyword rules (`integrations/conferences.py`) | `conference_records` |
| patents | team `patent_intel/` (AdisInsight, PubChem, Google Patents) (`integrations/patents.py`) | `patent_records` |
| company_site | ours: site adapter when there is one (`company/unither.py`), else the generic crawler (`company/generic.py`: sitemap / homepage pages named after the drug and product pages, the PDFs they link, and IR-page press releases when the company has no newsroom spider) | `company_records` |
| company_news | team `company_pr/` newsroom spider picked by company domain (`integrations/newsroom.py`) | `company_records` (press releases) |
| news | ours: PR Newswire, BioSpace, GlobeNewswire search, AI-screened before fetching | `articles` |
| industry_news | team `company_pr/` news and agency spiders plus Google News, kept when they mention the asset | `articles` |
| journey, ai_triage, ai_events, index | rules (approvals, trials, patent expiries), then AI triage, event extraction and the vector index | `journey_events`, `crawl_ledger`, `record_chunks` |
| competitors | ours (`onboarding/competitors.py`): drugs in recent phase 2–4 trials for the asset's indications plus FDA same-class drugs, top 5 ranked by the reasoning model with per-indication coverage; each becomes a `competitor` asset with its own light job (scan reused for 30 days, competitor recrawled at most daily) | `assets` |
| finalize | rule events rebuilt, suggested questions, status `ready` | `assets`, `journey_events` |

**Rules for the team packages:**
- They are used unchanged; adapters live in `integrations/`.
- Scrapy spiders run in a child process (its reactor starts once per process). URLs already stored are passed in as a seen list, so a refresh fetches only new articles.
- The conference crawler needs about 10–12 hours per conference for a full crawl, so its output is kept as a corpus collection (`CONFERENCE_CORPUS`, default `pharmaedge.conference_abstracts`).
- The patent crawler takes about 10 minutes per asset (`PATENT_MAX_PAGES`). It keeps a page cache in `cache/patents`, which is the `crawler-cache` volume in Docker.

## Notes / known gaps

- **RSS articles are not keyword-filtered.** Every item in a feed is stored and tagged
  with `--asset`, so use asset-specific feeds (search feeds, Alerts), not general news feeds.
- The 48h age window from production is off (`RSS_MAX_ARTICLE_AGE_HOURS=0`) so feeds keep
  everything they return. Alerts/RSS still only hold *recent* items; history comes from FDA/EMA.
- Without the residential proxy (`RESIDENTIAL_PROXY`), some publishers return 403, and
  bot-check pages can slip through extraction as content.
- The crawler code is carried over largely unchanged and is not optimised.
