# Company PR crawler

There are 86 Scrapy spiders, one per company newsroom, news site, agency or newswire.
They need no database or secrets.

## Setup (once)

```bash
cd company_pr
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Run all crawlers

```bash
.venv/bin/python run.py
```

This collects the 25 newest articles from every spider, in about 1–2 minutes.

## Useful options

```bash
.venv/bin/python run.py --list                    # spider names and their group
.venv/bin/python run.py -s pfizer gsk             # only these spiders
.venv/bin/python run.py -x reuters fierce         # all except these
.venv/bin/python run.py -g company                # one group: company | news | agency | wire
.venv/bin/python run.py --limit 100               # articles per spider (0 = full history)
.venv/bin/python run.py --since 2025-01-01        # skip older articles
.venv/bin/python run.py --new-only                # skip URLs saved by earlier runs
```

Full history (`--limit 0`) can take a long time. Company newsrooms (`-g company`) take
minutes to an hour each. News sites and wires hold hundreds of thousands of articles,
so combine them with `--since`. If a full run is interrupted, rerun the same command
with `--new-only` to continue.

## Output

Each run writes to `output/run_<timestamp>/`:

- `all_news.jsonl`, `all_news.csv`: all articles, newest first
- `spiders/<name>.jsonl`: one file per spider
- `summary.json`: items and errors per spider
- `crawl.log`: full log

Fields: `news_url_id`, `news_date` (YYYY-MM-DD), `news_modified_date`, `news_url`, `title`,
`content` (plain text), `tags`, `channel`, `aggregator_source`, `spider`, `scraped_at`.

## Configuration

`crawler/config.py` holds the search keywords for google_news, prnewswire and globenewswire.
`google_alerts` returns nothing until you add your Google Alerts RSS feed URLs there.

## Project layout

```
run.py         runs the spiders and merges the results
crawler/       shared code: base spider classes, browser-impersonation handler, cleaning
               pipelines, date/PDF/feed helpers, settings, keyword config
spiders/       one file per source; spiders/united_therapeutics.py is a short example
```
