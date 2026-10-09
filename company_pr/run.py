#!/usr/bin/env python
"""Run all (or some) company press-release spiders with one command.

    python run.py                       # every spider, 25 newest articles each
    python run.py -s abbvie gsk         # only these spiders
    python run.py -x reuters fierce     # everything except these
    python run.py --limit 100 --since 2025-01-01
    python run.py --limit 0             # full history: every article each source has
    python run.py --new-only            # skip URLs scraped in earlier runs (also resumes
                                        # an interrupted full-history run)
    python run.py -g company --limit 0  # full history of all company newsrooms
    python run.py --list                # show available spiders and their group

Results go to output/run_<timestamp>/:
    spiders/<name>.jsonl   one file per spider
    all_news.jsonl         everything combined
    all_news.csv           same, as CSV
    summary.json           per-spider stats (items, errors, duration)
"""

import argparse
import csv
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
os.environ.setdefault("SCRAPY_SETTINGS_MODULE", "crawler.settings")

from scrapy.crawler import CrawlerProcess  # noqa: E402
from scrapy.spiderloader import SpiderLoader  # noqa: E402
from scrapy.utils.project import get_project_settings  # noqa: E402

GROUPS = ["company", "news", "agency", "wire"]

CSV_FIELDS = [
    "news_url_id", "news_date", "news_modified_date", "news_url", "title",
    "content", "tags", "channel", "aggregator_source", "spider", "scraped_at",
]


def parse_args(available):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-s", "--spiders", nargs="+", metavar="NAME", help="spiders to run (default: all)")
    p.add_argument("-x", "--exclude", nargs="+", metavar="NAME", default=[], help="spiders to skip")
    p.add_argument("-g", "--group", nargs="+", choices=GROUPS, metavar="GROUP",
                   help=f"only spiders of these categories: {', '.join(GROUPS)}")
    p.add_argument("--limit", type=int, default=None, help="max articles per spider (0 = full history, default 25)")
    p.add_argument("--timeout", type=float, default=None,
                   help="minutes before a spider is stopped (0 = never; default 15, or never with --limit 0)")
    p.add_argument("--since", help="drop articles published before YYYY-MM-DD")
    p.add_argument("--new-only", action="store_true", help="skip URLs saved by previous runs")
    p.add_argument("--output", help="output directory (default: output/run_<timestamp>)")
    p.add_argument("--log-level", default="INFO", help="Scrapy log level (default INFO)")
    p.add_argument("--list", action="store_true", help="list spiders and exit")
    args = p.parse_args()

    def norm(names):
        out = []
        for n in names or []:
            n = n.removesuffix(".py").removesuffix("_spider")
            if n not in available:
                p.error(f"unknown spider '{n}'. Use --list to see available spiders.")
            out.append(n)
        return out

    args.spiders = norm(args.spiders) or list(available)
    args.exclude = set(norm(args.exclude))
    return args


def main():
    settings = get_project_settings()
    loader = SpiderLoader.from_settings(settings)
    category = {name: getattr(loader.load(name), "category", "company") for name in loader.list()}
    available = sorted(category)
    args = parse_args(available)
    if args.list:
        for name in available:
            print(f"{name:<24} {category[name]}")
        return 0

    out_dir = Path(args.output or ROOT / "output" / f"run_{datetime.now():%Y%m%d_%H%M%S}")
    (out_dir / "spiders").mkdir(parents=True, exist_ok=True)

    if args.limit is not None:
        settings.set("PR_LIMIT", args.limit)
    if args.since:
        datetime.strptime(args.since, "%Y-%m-%d")
        settings.set("PR_SINCE", args.since)
    timeout = args.timeout
    if timeout is None:
        timeout = 0 if settings.getint("PR_LIMIT") == 0 else settings.getint("CLOSESPIDER_TIMEOUT") / 60
    settings.set("CLOSESPIDER_TIMEOUT", int(timeout * 60))
    settings.set("PR_NEW_ONLY", args.new_only)
    settings.set("PR_SEEN_FILE", str(out_dir.parent / "seen_urls.txt"))
    settings.set("LOG_LEVEL", args.log_level.upper())
    settings.set("LOG_FILE", str(out_dir / "crawl.log"))
    settings.set("LOG_FILE_APPEND", False)
    settings.set(
        "FEEDS",
        {str(out_dir / "spiders" / "%(name)s.jsonl"): {"format": "jsonlines", "overwrite": True}},
    )

    names = [
        n for n in args.spiders
        if n not in args.exclude and (not args.group or category[n] in args.group)
    ]
    limit = settings.getint("PR_LIMIT") or "full history"
    print(f"Running {len(names)} spiders (limit={limit}) -> {out_dir}")
    print(f"Live log: tail -f {out_dir / 'crawl.log'}")

    process = CrawlerProcess(settings)
    crawlers = {}
    for name in names:
        crawler = process.create_crawler(name)
        crawlers[name] = crawler
        process.crawl(crawler)
    errors = ErrorCounter()
    logging.getLogger().addHandler(errors)
    process.start()

    return write_results(out_dir, crawlers, errors.counts)


class ErrorCounter(logging.Handler):
    """Counts ERROR records per spider (Scrapy's log_count/ERROR is process-wide)."""

    def __init__(self):
        super().__init__(level=logging.ERROR)
        self.counts = {}

    def emit(self, record):
        spider = getattr(record, "spider", None)
        name = getattr(spider, "name", None) or "_unattributed"
        self.counts[name] = self.counts.get(name, 0) + 1


def write_results(out_dir, crawlers, error_counts):
    """Write summary.json and the combined all_news.jsonl/csv (newest first).

    Streams the per-spider files: only a small index (date, spider, file,
    byte offset) is held in memory, so full-history runs with millions of
    articles merge fine. The same release found by several spiders (e.g. two
    wire searches) is written once.
    """
    summary, index, files, seen = [], [], [], set()
    for name, crawler in crawlers.items():
        stats = crawler.stats.get_stats() if crawler.stats else {}
        path = out_dir / "spiders" / f"{name}.jsonl"
        count = 0
        if path.exists():
            files.append(path)
            offset = 0
            # Binary lines split on b"\n" only (U+2028 may appear inside JSON strings).
            with open(path, "rb") as f:
                for line in f:
                    if line.strip():
                        count += 1
                        r = json.loads(line)
                        key = r.get("news_url_id") or r["news_url"]
                        if key not in seen:
                            seen.add(key)
                            index.append((r.get("news_date") or "", name, len(files) - 1, offset, len(line)))
                    offset += len(line)
            if not count:  # no index entries point at it
                files.pop()
                path.unlink()
        start, end = stats.get("start_time"), stats.get("finish_time")
        summary.append({
            "spider": name,
            "items": count,
            "errors": error_counts.get(name, 0),
            "http_errors": sum(v for k, v in stats.items() if k.startswith("downloader/response_status_count/") and k[-3] in "45"),
            "dropped": {k.split("/")[-1]: v for k, v in stats.items() if k.startswith("pr/dropped/")},
            "fallbacks": {k.split("/")[-1]: v for k, v in stats.items() if k.startswith("pr/fallback/")},
            "finish_reason": stats.get("finish_reason"),
            "seconds": round((end - start).total_seconds(), 1) if start and end else None,
        })

    index.sort(key=lambda e: (e[0], e[1]), reverse=True)
    handles = [open(p, "rb") for p in files]
    try:
        with open(out_dir / "all_news.jsonl", "wb") as out_jsonl, \
                open(out_dir / "all_news.csv", "w", newline="", encoding="utf-8") as out_csv:
            w = csv.DictWriter(out_csv, fieldnames=CSV_FIELDS, extrasaction="ignore")
            w.writeheader()
            for _, _, file_no, offset, length in index:
                handles[file_no].seek(offset)
                line = handles[file_no].read(length)
                out_jsonl.write(line.rstrip(b"\n") + b"\n")
                r = json.loads(line)
                w.writerow({**r, "tags": "; ".join(r.get("tags") or [])})
    finally:
        for h in handles:
            h.close()
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))

    width = max(len(s["spider"]) for s in summary) if summary else 10
    print(f"\n{'spider':<{width}}  items  errors  status")
    for s in sorted(summary, key=lambda s: s["spider"]):
        flag = "" if s["items"] else "  <-- no items"
        print(f"{s['spider']:<{width}}  {s['items']:>5}  {s['errors']:>6}  {s['finish_reason']}{flag}")
    ok = sum(1 for s in summary if s["items"])
    print(f"\n{len(index)} articles from {ok}/{len(summary)} spiders -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
