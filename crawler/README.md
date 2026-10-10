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
- **Job types:** `onboard` (new primary asset: fast sources first, then competitors, FDA calendar, SEC filings, patents, finalize), `refresh` (every step, then competitors and finalize), `competitor` (light: regulatory, FDA calendar, SEC filings, CHMP opinions, clinical, the 300 newest publications, conferences, newswires for the first 3 names, patents, journey/AI steps, finalize). `finalize` rebuilds the rule events, writes suggested questions and marks the asset `ready`; an onboard / competitor job that ends without it leaves the asset `failed`.
- **The plan:** a job runs the steps in `service/steps.py` in order. Each step writes records in the shared contract and is tagged with the asset id; a failed step doesn't stop the others.
- **Running a subset:** pass `{"steps": [...]}` to run only some steps. `GET /sources` lists the plan of each job type.

| Step | Crawler | Writes |
|---|---|---|
| regulatory | ours: `regulatory/fda.py` (openFDA, live); EMA reports from the EMA corpus (`corpus/ema.py`), downloaded live from EMA until it is complete | `fda_records`, `ema_records` |
| fda_calendar | team `patent_intel/fdacal.py` (FDA Tracker PDUFA / AdCom calendar), events naming the asset (`integrations/fda_calendar.py`) | `fda_records` (`fda_calendar_event`) |
| sec_regulatory | team `patent_intel/regulatory.py`, SEC EDGAR only: PDUFA target dates and complete response letters the asset's company reported in its filings (`integrations/sec_regulatory.py`); skipped without `SEC_USER_AGENT` | `fda_records` (`sec_fda_action`) |
| market | team `patent_intel/market` (`integrations/market.py`): the asset company's listing (exact name match, else its listed parent for known subsidiaries: MSD -> MRK, Actelion/Janssen -> JNJ, Hoffmann-La Roche/Genentech -> RHHBY) plus tickers on its FDA calendar events, and split-adjusted daily closes (Yahoo: local testing only). Private companies are skipped. Read by the app's Market tab and Asset AI's `get_market_reaction` | `market_listings`, `market_prices` |
| presentations | team `patent_intel/presentations` (investor decks, vision-read slides) for the asset's company (`integrations/presentations.py`) | `company_records` (`presentation_slide`) |
| ema_chmp | team `ema/chmp_highlights.py` (CHMP monthly meeting highlights) corpus, matched to the asset (`integrations/chmp.py`); crawled here only until the corpus is complete | `ema_records` (`ema_chmp_opinion`, `ema_chmp_highlight`) |
| clinical | team `clinicalTrialgov/` client, our mapping (`regulatory/clinicaltrials.py`) | `trial_records` |
| publications | team `pubmed/` (`regulatory/pubmed_source.py`) | `publication_records` |
| conferences | team `conference/` corpus (ERS, ATS, CHEST), matched with its keyword rules (`integrations/conferences.py`) | `conference_records` |
| patents | team `patent_intel/` (AdisInsight, PubChem, Google Patents) (`integrations/patents.py`) | `patent_records` |
| company_site | ours: site adapter when there is one (`company/unither.py`), else the generic crawler (`company/generic.py`: sitemap / homepage pages named after the drug and product pages, the PDFs they link, and IR-page press releases when the company has no newsroom spider) | `company_records` |
| company_news | team `company_pr/` newsroom spider picked by company domain (`integrations/newsroom.py`): from the company_pr corpus once that spider's history is in it, else crawled live | `company_records` (press releases) |
| news | ours: PR Newswire, BioSpace, GlobeNewswire search, AI-screened before fetching | `articles` |
| industry_news | team `company_pr/` news and agency spiders (from the company_pr corpus once in it, else live) plus Google News (live: it searches the asset's names), kept when they mention the asset | `articles` |
| journey, ai_triage, ai_events, index | rules (approvals, PDUFA dates and AdComs, CHMP opinions and the EC decision they lead to, trials, patent expiries), then AI triage, event extraction and the vector index over news, press releases, publications, conference abstracts and CHMP highlights | `journey_events`, `crawl_ledger`, `record_chunks` |
| competitors | ours (`onboarding/competitors.py`): drugs in recent phase 2–4 trials for the asset's indications plus FDA same-class drugs, top 5 ranked by the reasoning model with per-indication coverage; each becomes a `competitor` asset with its own light job (scan reused for 30 days, competitor recrawled at most daily) | `assets` |
| finalize | AI catch-up on records stored after the AI steps, rule events rebuilt (FDA events flag other sponsors), cross-source checks, confirmed duplicate approvals folded into the regulator event, suggested questions, status `ready` | `assets`, `journey_events`, `journey_changes` |

**Change log and checks (journey):**
- `journey_changes` records what each job changed: `{_id, asset, event_id, origin (rule|ai), kind (added|changed|removed), field?, before, after, title, category, event_date, at, baseline}`. Rule events are diffed in `replace_rule_events` (watched fields: date, expected_date, type, significance, title, is_milestone; an id respelling is not a change); new AI events are logged by `extract_events` (consolidation merges are not). `baseline: true` marks the asset's first build / first extraction. Ids are hashes of the change, so a retried step adds no duplicates. Events also get `first_seen`.
- `journey/checks.py` (run by `finalize`) sets `verification: {status: unconfirmed|conflict|confirmed, note, against}` on events: an AI approval / label expansion with no FDA / EMA record within 45 days (only when the asset has regulator records in that region; labeling-only updates confirm nothing; device clearances such as 510(k) are not checked), and PDUFA / decision dates 1-120 days apart about the same subject (same application, or shared product words in the titles). Cleared when no longer true.

**Rules for the team packages:**
- They are used unchanged; adapters live in `integrations/`.
- Scrapy spiders run in a child process (its reactor starts once per process). URLs already stored are passed in as a seen list, so a refresh fetches only new articles.
- The conference crawler needs about 10–12 hours per conference for a full crawl, so its output is kept as a corpus collection (`CONFERENCE_CORPUS`, default `pharmaedge.conference_abstracts`), filled by the corpus worker (below).
- The patent crawler takes about 10 minutes per asset (`PATENT_MAX_PAGES`). It keeps a page cache in `cache/patents`, which is the `crawler-cache` volume in Docker.
- SEC filings (`sec_regulatory`) are the only source of complete response letters (openFDA publishes approvals, the FDA calendar goal dates and meetings). A PDUFA date stated in a filing and listed on the FDA calendar for the same day becomes one journey event citing both. SEC requires `SEC_USER_AGENT` ("Company contact@email") in `crawler/.env`; without it the step is skipped, never guessed.
- The FDA calendar crawler reads the source document of every calendar event whose text doesn't name a drug, so its first run takes a while; documents are cached for 30 days in `cache/fda_calendar` (same volume) and shared by every asset. The patent step runs patents only (`regulatory=False, fda_calendar=False, market=False`): it reads back only patents, so those steps would be work thrown away; their data comes from `fda_calendar`, `sec_regulatory` and `regulatory`. Only events matched to the asset are stored; `unresolved` ones are counted in the step result.
- The CHMP meetings are kept as a corpus collection (`CHMP_CORPUS`, default `pharmaedge.ema_chmp_meetings`), filled by the corpus worker (below). Its first full crawl takes ~30 min; to skip it, load an existing crawl with `python -m scripts.load_chmp_corpus [../ema/output/chmp_meeting_highlights.json]`.

## Corpus worker: all the shared data, as soon as the server is up

`service/corpus_worker.py` (Docker service `crawler-corpus`; locally `../.venv/bin/arq service.corpus_worker.WorkerSettings`) crawls the full history of the sources every asset shares into the database when it starts, then refreshes them daily at 02:00. Asset jobs match each asset against these collections instead of crawling the sources again (`corpus/`).

| Source | Crawler | Collection (`pharmaedge.`) | First run | Daily |
|---|---|---|---|---|
| `company_pr` | every `company_pr/` spider but `google_news` (it searches the asset's names, so it stays per asset) | `company_pr_news` (by URL) | each spider's full history, one spider at a time | newest 100 articles per spider; full history of spiders added since |
| `ema_reports` | EMA JSON reports: EPAR, post-authorisation opinions, DHPC letters, orphan designations, referrals | `ema_reports` (by record_key) | every row | downloaded again (EMA refreshes them daily) |
| `designations` | `designations/`: FDA expedited-program approvals (Accelerated Approval, Breakthrough, Fast Track, Priority) parsed from the PDFs in `designations/Designation_data/` | `fda_designations` (by record id) | every PDF (~6 s, no network) | never: once only (`python -m corpus designations --full` after adding a PDF) |
| `ema_chmp` | `ema/chmp_highlights.py` | `ema_chmp_meetings` | every meeting since 2006 | meetings since the newest stored |
| `conference_ers` / `_ats` / `_chest` | `conference/` crawlers | `conference_abstracts` (by abstract id) | every year, one at a time (~10–12 h for ERS and CHEST) | the newest year, and years not done yet |

- **Groups** run in parallel as one arq job each (`ema` runs its two sources one after another: they share EMA's rate limit), in a child process `python -m corpus <group>`. Run one by hand with `python -m corpus ema` (or a single source; `--full` to crawl in full again).
- **State** per source in `pharmaedge.corpus_sources`: status, heartbeat, progress (spiders / years done, errors), `full_done_at`, `last_success_at`, the last run's counts. A restart resumes where the last run stopped; a source another worker is running is skipped until its heartbeat is 5 min old.
- **Per-asset steps** use a corpus once its full crawl has completed (`full_done_at`), and crawl live until then: `company_news` / `industry_news` per spider, `regulatory` (EMA reports), `ema_chmp`. The designations are in the database for asset matching (each record's `names`) but no asset step reads them yet. openFDA and the FDA calendar are not part of the corpus.
- **Settings:** `CORPUS_GROUPS=ema,company_pr` limits the worker to some groups; `CORPUS_DB`, `COMPANY_PR_CORPUS`, `EMA_CORPUS`, `CHMP_CORPUS`, `CONFERENCE_CORPUS`, `DESIGNATIONS_CORPUS` move the collections; `CORPUS_SPIDER_TIMEOUT_MIN` (720) caps one spider's full-history run; `CONFERENCE_WORKERS` (6) sets parallel abstract downloads; `CORPUS_JOB_TIMEOUT_H` (24) caps one group's run (the next daily run continues it).

## Notes / known gaps

- **RSS articles are not keyword-filtered.** Every item in a feed is stored and tagged
  with `--asset`, so use asset-specific feeds (search feeds, Alerts), not general news feeds.
- The 48h age window from production is off (`RSS_MAX_ARTICLE_AGE_HOURS=0`) so feeds keep
  everything they return. Alerts/RSS still only hold *recent* items; history comes from FDA/EMA.
- Without the residential proxy (`RESIDENTIAL_PROXY`), some publishers return 403, and
  bot-check pages can slip through extraction as content.
- The crawler code is carried over largely unchanged and is not optimised.

**Extraction quality:** `python -m scripts.extraction_report` (read-only) reports per asset how AI event dates were set
(`date_basis`: stated in the text / the document's date / legacy), how many AI regulatory claims a regulator record could
check and how many it does not confirm, date conflicts, literature background and other-sponsor events. Triage decisions
record `PROMPT_VERSION` (`ai/triage.py`); raise it to re-judge older decisions.
