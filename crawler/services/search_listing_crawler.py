"""
News-site search pages as article sources, for sites with a keyword search but
no keyword RSS feed (PR Newswire, BioSpace).

Discovery is the only new part: each search page is turned into the same entry
dicts RSSCrawlerService._parse_rss_feed returns, so dedup, extraction and saving
all run through the RSS crawler unchanged. A "feed URL" here is the search page.

Not covered (bot protection rejects requests without a residential proxy):
Fierce Pharma / Fierce Biotech (Cloudflare), Business Wire (Akamai),
pulmonaryhypertensionnews.com (Cloudflare).
"""

import re
import time
from typing import Any, Dict, List
from urllib.parse import quote_plus, urljoin

from bs4 import BeautifulSoup
from curl_cffi import requests

from services.rss_crawler_service import RSSCrawlerService

MAX_PAGES = 10


def prnewswire_search_url(keyword: str) -> str:
    return f"https://www.prnewswire.com/search/news/?keyword={quote_plus(keyword)}&pagesize=100"


def biospace_search_url(keyword: str) -> str:
    return f"https://www.biospace.com/search?q={quote_plus(keyword)}"


def globenewswire_feed_url(keyword: str) -> str:
    """GlobeNewswire has real keyword RSS - this goes to the plain RSS crawler."""
    return f"https://www.globenewswire.com/RssFeed/keyword/{quote_plus(keyword)}"


def _fetch(url: str) -> str:
    resp = requests.get(url, impersonate="chrome110", timeout=30)
    return resp.text if resp.status_code == 200 else ""


def _entries(html: str, base: str, href_pattern: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    entries: Dict[str, Dict[str, Any]] = {}
    for a in soup.select("a[href]"):
        if not re.search(href_pattern, a["href"]):
            continue
        url = urljoin(base, a["href"]).split("?")[0]
        title = a.get_text(" ", strip=True)
        # Result cards often link the same release twice (image + headline)
        if url not in entries or len(title) > len(entries[url]["title"]):
            entries[url] = {"title": title, "url": url, "description": "",
                            "published": None, "publisher": ""}
    return list(entries.values())


def discover_prnewswire(search_url: str) -> List[Dict[str, Any]]:
    # Only page 1 (top 10 by relevance) is server-rendered; later pages come back
    # empty without a browser, so the loop normally stops after one page.
    results: Dict[str, Dict[str, Any]] = {}
    for page in range(1, MAX_PAGES + 1):
        found = _entries(_fetch(f"{search_url}&page={page}"), "https://www.prnewswire.com",
                         r"/news-releases/.+-\d+\.html")
        new = [e for e in found if e["url"] not in results]
        if not new:
            break
        for e in new:
            e["publisher"] = "PR Newswire"
            results[e["url"]] = e
        time.sleep(1)
    return list(results.values())


def discover_biospace(search_url: str) -> List[Dict[str, Any]]:
    # Results are rendered server-side on one page; there is no pager.
    # Article slugs are headline-length (5+ hyphens); nav links are not.
    entries = _entries(_fetch(search_url), "https://www.biospace.com",
                       r"^(https://www\.biospace\.com)?/([a-z-]+/)?[a-z0-9]+(-[a-z0-9]+){5,}$")
    for e in entries:
        e["publisher"] = "BioSpace"
    return entries


class SearchListingCrawler(RSSCrawlerService):
    """RSSCrawlerService whose "feeds" are search result pages."""

    def _parse_rss_feed(self, feed_url: str) -> List[Dict[str, Any]]:
        try:
            if "prnewswire.com/search" in feed_url:
                entries = discover_prnewswire(feed_url)
            elif "biospace.com/search" in feed_url:
                entries = discover_biospace(feed_url)
            else:
                return super()._parse_rss_feed(feed_url)
        except Exception as e:
            self._log("error", f"Search listing failed for {feed_url}: {e}")
            return []
        self._log("info" if entries else "warning",
                  f"Discovered {len(entries)} articles from search page: {feed_url}")
        return entries
