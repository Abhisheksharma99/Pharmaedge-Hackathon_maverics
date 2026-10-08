"""
Gather asset-journey data for one asset into MongoDB.

    python main.py --asset Keytruda --alias pembrolizumab \
        --rss https://www.fiercebiotech.com/rss/xml \
        --alerts-rss https://www.google.com/alerts/feeds/<user>/<id>

    python main.py --asset Treprostinil --keyword "pulmonary hypertension" --output json

Sources: rss, alerts (Google Alerts RSS, full news-crawler pipeline), fda
(openFDA), ema (EMA JSON reports). Each --keyword gets a Bing News archive feed
(through the RSS crawler) and a Google News search feed (through the Alerts
pipeline), neither time-filtered so older coverage comes back too.
--output json writes data/<asset>/*.json for review instead of MongoDB.
Run from this directory.
"""

import argparse
import asyncio
import json
import os
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

from dotenv import load_dotenv

load_dotenv()

from regulatory import clinicaltrials, ema, fda  # noqa: E402
from storage.mongo_storage import upsert_records, use_json  # noqa: E402

ALL_SOURCES = ("rss", "alerts", "fda", "ema", "trials", "wires")
# Opt-in (not in the default --sources): company websites
COMPANY_SOURCES = ("unither",)


def bing_archive_feed(keyword: str) -> str:
    # No qft/sortbydate: relevance-ranked archive, which reaches back years
    phrase = quote_plus('"' + keyword + '"')
    return f"https://www.bing.com/news/search?q={phrase}&format=rss"


def google_news_feed(keyword: str) -> str:
    # No when: filter, unlike production's 1-day window
    phrase = quote_plus('"' + keyword + '"')
    return f"https://news.google.com/rss/search?q={phrase}&hl=en-US&gl=US&ceid=US:en"


async def run_rss(args, urls: List[str], keyword: Optional[str] = None) -> Dict[str, Any]:
    from services.rss_crawler_service import RSSCrawlerService
    return await RSSCrawlerService().run_rss_crawler({
        "id": f"rss:{args.asset}:{keyword or 'feeds'}",
        "name": f"RSS - {args.asset} - {keyword or 'feeds'}",
        "asset": args.asset,
        "keyword": keyword,
        "rss_feed_urls": urls,
    }, max_articles=args.max_articles)


async def run_alerts(args, url: Optional[str], keyword: str, cookies: Optional[Dict] = None) -> Dict[str, Any]:
    from services.google_alerts_crawler import run_google_alerts_crawler
    # No feed URL: create a Google Alert for the keyword (needs login cookies)
    cfg = {"google_alerts_rss_url": url} if url else {"google_alerts_cookies": cookies}
    return await run_google_alerts_crawler({
        "id": f"alerts:{args.asset}:{keyword}",
        "name": f"Google Alerts - {args.asset} - {keyword}",
        "asset": args.asset,
        "keywords": [keyword],
        **cfg,
    }, max_articles=args.max_articles)


def run_wires(args, names: List[str]) -> Dict[str, Any]:
    """PR Newswire + BioSpace search pages and GlobeNewswire keyword RSS, one run
    per search term (asset names + --keyword), through the RSS crawler pipeline."""
    from services.search_listing_crawler import (
        SearchListingCrawler, biospace_search_url, globenewswire_feed_url, prnewswire_search_url)
    report = {}
    for term in names + args.keyword:
        urls = [prnewswire_search_url(term), biospace_search_url(term), globenewswire_feed_url(term)]
        result = asyncio.run(SearchListingCrawler().run_rss_crawler({
            "id": f"wires:{args.asset}:{term}",
            "name": f"Wires - {args.asset} - {term}",
            "asset": args.asset,
            "keyword": term,
            "rss_feed_urls": urls,
        }, max_articles=args.max_articles))
        report[f"wires:{term}"] = summarize(result)
    return report


def summarize(result: Dict[str, Any]) -> Dict[str, Any]:
    keep = ("success", "error", "run_id", "articles_discovered", "articles_saved",
            "articles_duplicate", "articles_failed", "statistics")
    return {k: result[k] for k in keep if k in result}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--asset", required=True, help="Asset (drug) name; tags every stored record")
    parser.add_argument("--alias", action="append", default=[], help="Other names to match (INN, code name). Repeatable")
    parser.add_argument("--sources", default=",".join(ALL_SOURCES), help=f"Comma list of {ALL_SOURCES + COMPANY_SOURCES}")
    parser.add_argument("--rss", action="append", default=[], help="RSS feed URL. Repeatable")
    parser.add_argument("--alerts-rss", action="append", default=[], help="Google Alerts RSS feed URL. Repeatable")
    parser.add_argument("--alerts-keyword", action="append", help="Keyword(s) for the Alerts run (default: asset)")
    parser.add_argument("--alerts-cookies", help="JSON file of Google cookies, to create an alert when no --alerts-rss")
    parser.add_argument("--keyword", action="append", default=[], help="News keyword; builds Bing + Google News feeds. Repeatable")
    parser.add_argument("--max-articles", type=int, default=50, help="Per feed run")
    parser.add_argument("--output", choices=("mongo", "json"), default="mongo")
    parser.add_argument("--out-dir", help="JSON output dir (default: data/<asset>)")
    args = parser.parse_args()

    sources = [s.strip() for s in args.sources.split(",") if s.strip()]
    names = [args.asset] + args.alias
    report: Dict[str, Any] = {}
    if args.output == "json":
        out_dir = args.out_dir or os.path.join("..", "data", args.asset.lower())
        use_json(out_dir)
        print(f"Writing JSON to {os.path.abspath(out_dir)}")

    if "fda" in sources:
        report["fda"] = upsert_records("fda_records", fda.fetch_all(args.asset, names), args.asset)
    if "ema" in sources:
        report["ema"] = upsert_records("ema_records", ema.fetch_all(names), args.asset)
    if "trials" in sources:
        report["trials"] = upsert_records("trial_records", clinicaltrials.fetch_all(names), args.asset)
    if "wires" in sources:
        report.update(run_wires(args, names))
    if "unither" in sources:
        from company import unither
        report["unither_pages"] = upsert_records("company_records", unither.crawl_site_pages(names), args.asset)
        counts = {"inserted": 0, "updated": 0}
        for rec in unither.crawl_press_releases(names):  # saved one by one: ~460 releases
            for k, v in upsert_records("company_records", [rec], args.asset).items():
                counts[k] += v
        report["unither_press_releases"] = counts
    if "rss" in sources:
        if args.rss:
            report["rss"] = summarize(asyncio.run(run_rss(args, args.rss)))
        for kw in args.keyword:
            report[f"rss:{kw}"] = summarize(asyncio.run(run_rss(args, [bing_archive_feed(kw)], kw)))
    if "alerts" in sources:
        alert_keyword = (args.alerts_keyword or [args.asset])[0]
        for url in args.alerts_rss:
            report[f"alerts:{url}"] = summarize(asyncio.run(run_alerts(args, url, alert_keyword)))
        if not args.alerts_rss and args.alerts_cookies:
            with open(args.alerts_cookies) as f:
                cookies = json.load(f)
            report["alerts:created"] = summarize(asyncio.run(run_alerts(args, None, alert_keyword, cookies)))
        for kw in args.keyword:
            result = asyncio.run(run_alerts(args, google_news_feed(kw), kw))
            report[f"alerts:{kw}"] = summarize(result)
            if "rate-limit" in str(result.get("error", "")):
                print(f"Google is rate-limiting; skipping remaining keywords after {kw!r}")
                break

    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
