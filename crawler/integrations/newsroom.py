"""
Company newsrooms and industry news from the team's Scrapy spiders (company_pr/).

Scrapy's reactor starts only once per process, so the spiders run in a child
process (company_pr/run.py) that writes JSONL into a temp dir. URLs we already
store go in as its seen list (--new-only), so a refresh fetches only new
articles. Keyword spiders (google_news) search the asset's names via
SEARCH_KEYWORDS; feed spiders (Fierce, Reuters, EMA, ...) return their latest
articles, which are kept only when they mention the asset.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Tuple

from . import TEAM_ROOT
from conference.common import compile_keywords, matched_keywords

PR_ROOT = TEAM_ROOT / "company_pr"
# Industry news for every asset: the news sites and agencies, plus Google News keyword search. PR Newswire and
# GlobeNewswire are searched by our own `news` step, which AI-screens results before fetching them.
NEWS_SPIDERS = [s for s in os.getenv("NEWS_SPIDERS", "").split(",") if s]

_CATALOG = """
import json, os, sys
sys.path.insert(0, os.getcwd())
os.environ.setdefault("SCRAPY_SETTINGS_MODULE", "crawler.settings")
from urllib.parse import urlparse
from scrapy.spiderloader import SpiderLoader
from scrapy.utils.project import get_project_settings
loader = SpiderLoader.from_settings(get_project_settings())

def domains(s):
    # Feed/sitemap spiders declare only their feed URLs, so hostnames come from those too.
    urls = list(getattr(s, "feed_urls", None) or []) + list(getattr(s, "start_urls", None) or [])
    return sorted(set(getattr(s, "allowed_domains", None) or []) | {urlparse(u).hostname for u in urls if urlparse(u).hostname})

spiders = [loader.load(n) for n in loader.list()]
print(json.dumps([{"name": s.name, "category": getattr(s, "category", "company"), "domains": domains(s)}
                  for s in spiders]))
"""


@lru_cache(maxsize=1)
def catalog() -> Tuple[Dict[str, Any], ...]:
    """Every spider's name, category (company / news / agency / wire) and allowed domains."""
    out = subprocess.run([sys.executable, "-c", _CATALOG], cwd=PR_ROOT, capture_output=True, text=True,
                         timeout=120, check=True)
    return tuple(json.loads(out.stdout.strip().splitlines()[-1]))


def spiders_for_domain(domain: str) -> List[str]:
    """Company newsroom spiders for a company website domain (unither.com -> united_therapeutics)."""
    if not domain:
        return []
    return [s["name"] for s in catalog() if s["category"] == "company"
            and any(d == domain or d.endswith("." + domain) for d in s["domains"])]


def news_spiders() -> List[str]:
    return NEWS_SPIDERS or [s["name"] for s in catalog() if s["category"] in ("news", "agency")] + ["google_news"]


def run(spiders: List[str], *, known_urls: Iterable[str], keywords: List[str] = (), limit: int = 25,
        timeout_min: int = 10, is_cancelled: Callable[[], bool] = lambda: False) -> Tuple[List[Dict], List[Dict]]:
    """Run spiders in a child process; returns (items, per-spider summary). Cancelling stops the spiders
    gracefully, keeping what they collected."""
    with tempfile.TemporaryDirectory(prefix="company_pr-") as tmp:
        tmp = Path(tmp)
        (tmp / "seen_urls.txt").write_text("\n".join(known_urls))  # run.py reads <output>/../seen_urls.txt
        out = tmp / "run"
        cmd = [sys.executable, str(PR_ROOT / "run.py"), "-s", *spiders, "--limit", str(limit),
               "--timeout", str(timeout_min), "--new-only", "--output", str(out), "--log-level", "WARNING"]
        env = {**os.environ, "SEARCH_KEYWORDS": ",".join(keywords)} if keywords else None
        with open(tmp / "stderr.log", "w") as err:
            proc = subprocess.Popen(cmd, cwd=PR_ROOT, env=env, stdout=subprocess.DEVNULL, stderr=err)
            deadline = time.monotonic() + timeout_min * 60 + 180
            while proc.poll() is None:
                if is_cancelled() or time.monotonic() > deadline:
                    proc.terminate()  # Scrapy shuts down gracefully on SIGTERM and still writes its results
                    try:
                        proc.wait(90)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    break
                time.sleep(2)
        news = out / "all_news.jsonl"
        if not news.exists():
            tail = (tmp / "stderr.log").read_text()[-800:]
            raise RuntimeError(f"company_pr/run.py exited with {proc.returncode}: {tail}")
        # split("\n"), not splitlines(): U+2028 can appear inside JSON strings.
        items = [json.loads(line) for line in news.read_text(encoding="utf-8").split("\n") if line.strip()]
        summary = json.loads((out / "summary.json").read_text())
        return items, summary


def mentions(item: Dict[str, Any], names: List[str]) -> List[str]:
    """The asset's names found in the item, with the conference crawler's rules (whole words)."""
    return matched_keywords({"title": item.get("title"), "abstract": item.get("content")}, compile_keywords(names))


def press_release(item: Dict[str, Any], company: str, names: List[str]) -> Dict[str, Any]:
    """A newsroom item as a company_records press release (same key scheme as our site adapters)."""
    return {
        "record_key": f"{item['spider']}:press_release:{item['news_url']}",
        "record_type": "press_release",
        "source": item["spider"],
        "company": company,
        "date": item.get("news_date") or "",
        "url": item["news_url"],
        "title": item.get("title"),
        "content": item.get("content"),
        "tags": item.get("tags") or [],
        "mentions": mentions(item, names),
    }


def article(item: Dict[str, Any], found: List[str]) -> Dict[str, Any]:
    """A news item as an `articles` document (keyed by url)."""
    return {
        "url": item["news_url"],
        "title": item.get("title"),
        "content": item.get("content"),
        "date": item.get("news_date") or "",
        "company": item.get("channel") or item.get("aggregator_source"),
        "source": item["spider"],
        "aggregator_source": item.get("aggregator_source"),
        "keyword": found[0] if found else None,
        "mentions": found,
        "tags": item.get("tags") or [],
        "scraped_at": item.get("scraped_at"),
    }
