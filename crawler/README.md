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

## Notes / known gaps

- **RSS articles are not keyword-filtered.** Every item in a feed is stored and tagged
  with `--asset`, so use asset-specific feeds (search feeds, Alerts), not general news feeds.
- The 48h age window from production is off (`RSS_MAX_ARTICLE_AGE_HOURS=0`) so feeds keep
  everything they return. Alerts/RSS still only hold *recent* items; history comes from FDA/EMA.
- Without the residential proxy (`RESIDENTIAL_PROXY`), some publishers return 403, and
  bot-check pages can slip through extraction as content.
- The crawler code is carried over largely unchanged and is not optimised.
