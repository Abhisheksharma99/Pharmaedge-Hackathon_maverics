"""Google News RSS keyword search -> publisher articles.

RSS links are opaque news.google.com/rss/articles/<id> URLs. They are resolved
the way the Google News web app does it: the article page carries a signature
and timestamp (data-n-a-sg / data-n-a-ts) that are posted to the
DotsSplashUi batchexecute endpoint ("garturlreq"), which returns the publisher
URL. Publisher pages are parsed with generic body/metadata heuristics.

Each keyword's feed is processed newest first with ``quota`` entries in
flight; an entry that cannot be resolved, is excluded/already seen, or whose
publisher page fails (403 paywalls etc.) is replaced by the next one from the
same feed, so the budget is not wasted on dead links.

A query returns at most 100 (and for long periods far fewer) results, but the
``after:``/``before:`` operators work in the RSS search. Full-history runs
(--limit 0) therefore query every month since 1990 per keyword and split a
window in halves (down to single days) while it still returns >= SPLIT_AT
entries; denser windows surface more articles.
"""

import asyncio
import json
import math
import re
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import quote, quote_plus

import scrapy
from scrapy.http import TextResponse
from scrapy.spidermiddlewares.httperror import HttpError

from crawler.base import NewsSpider
from crawler.config import SEARCH_KEYWORDS
from crawler.helpers import (
    domain_name,
    fallback_date,
    fallback_title,
    html_to_text,
    parse_date,
    parse_feed,
)

LOCALE = "hl=en-US&gl=US&ceid=US:en"
BATCH_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
EARLIEST = date(1990, 1, 1)  # oldest Google News results found are from the 1990s
SPLIT_AT = 10  # full-history windows with this many entries are re-queried as halves
MIN_BODY_CHARS = 400  # shorter "bodies" are mostly paywall/cookie/citation boilerplate
# Common article-body containers on publisher sites, tried before the
# "parent with the most paragraph text" heuristic.
BODY_XPATHS = [
    '//*[@itemprop="articleBody"]',
    '//*[contains(@class,"entry-content")]',
    '//*[contains(@class,"article-body") or contains(@class,"article__body")'
    ' or contains(@class,"articleBody") or contains(@class,"article-content")'
    ' or contains(@class,"post-content") or contains(@class,"story-body")]',
]


class GoogleNewsSpider(NewsSpider):
    name = "google_news"
    category = "wire"
    aggregator_source = "google_news"
    keywords = SEARCH_KEYWORDS
    exclude_url_substrings = ["peerview", "researchgate", "twitter", "youtube", "openpr"]
    max_per_feed = 100

    async def start(self):
        self.quota = self.feed_quota(len(self.keywords))
        self.resolving = set()  # Google article ids already being resolved
        since = self.settings.get("PR_SINCE")
        for keyword in sorted(set(self.keywords)):
            if self.limit:  # newest results only
                yield self.search_request(keyword, (date.fromisoformat(since), None) if since else None)
                continue
            first = date.fromisoformat(since) if since else EARLIEST
            month = date.today().replace(day=1)
            while month + timedelta(days=31) > first:
                end = (month + timedelta(days=32)).replace(day=1)
                yield self.search_request(keyword, (max(month, first), end))
                month = (month - timedelta(days=1)).replace(day=1)

    def search_request(self, keyword, window=None):
        query = keyword
        if window:
            query += f" after:{window[0]}" + (f" before:{window[1]}" if window[1] else "")
        return scrapy.Request(
            f"https://news.google.com/rss/search?q={quote_plus(query)}&{LOCALE}",
            callback=self.parse_feed,
            errback=self.feed_failed,
            cb_kwargs={"keyword": keyword, "window": window},
            meta={"dont_retry": True},
        )

    def feed_quota(self, feeds):
        return math.ceil(self.limit / feeds) if self.limit and feeds else self.max_per_feed

    def parse_feed(self, response, keyword=None, window=None):
        try:
            _, entries = parse_feed(response.body)
        except Exception as exc:
            self.logger.error(f"Could not parse feed {response.url}: {exc}")
            return
        label = f"'{keyword}' {window[0]}..{window[1] or ''}" if window else response.url
        self.logger.info(f"{label}: {len(entries)} feed entries")
        if not self.limit and window and len(entries) >= SPLIT_AT and (window[1] - window[0]).days > 1:
            # Google returns only a sample for busy periods: also query both halves.
            mid = window[0] + (window[1] - window[0]) // 2
            yield self.search_request(keyword, (mid, window[1]))
            yield self.search_request(keyword, (window[0], mid))
        entries.sort(key=lambda e: _timestamp(e[1]), reverse=True)
        queue = iter(entries[: self.max_per_feed])
        for _ in range(self.quota):
            yield from self.next_entry(queue)

    def next_entry(self, queue):
        """Schedule the next usable entry (link, date, title) of a feed."""
        for link, pub_date, title in queue:
            if not self.budget_left:
                return
            request = self.entry_request(link, queue, (pub_date, title))
            if request:
                yield request
                return

    # ---- Google News link -> publisher URL ---------------------------------

    def entry_request(self, link, queue, feed):
        m = re.search(r"/articles/([\w-]+)", link)
        if m and m[1] not in self.resolving:  # keywords/windows overlap
            self.resolving.add(m[1])
            return scrapy.Request(
                f"https://news.google.com/rss/articles/{m[1]}?{LOCALE}",
                callback=self.parse_google_article,
                errback=self.entry_failed,
                cb_kwargs={"gid": m[1], "queue": queue, "feed": feed},
                meta={"dont_retry": True},
            )

    def parse_google_article(self, response, gid, queue, feed):
        node = response.xpath("//*[@data-n-a-sg][@data-n-a-ts]")
        if not node:
            self.logger.debug(f"No decoding params for {gid}")
            yield from self.next_entry(queue)
            return
        req = json.dumps([
            "garturlreq",
            [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None,
              None, None, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0],
            gid, int(node.attrib["data-n-a-ts"]), node.attrib["data-n-a-sg"],
        ])
        yield scrapy.Request(
            BATCH_URL,
            method="POST",
            body="f.req=" + quote(json.dumps([[["Fbv4je", req, None, "generic"]]])),
            headers={"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
            callback=self.parse_decoded,
            errback=self.entry_failed,
            cb_kwargs={"gid": gid, "queue": queue, "feed": feed},
            meta={"dont_retry": True},
            dont_filter=True,
        )

    def parse_decoded(self, response, gid, queue, feed):
        url = _decoded_url(response.text)
        request = url and self.publisher_request(url, queue, feed)
        if request:
            yield request
        else:
            self.logger.debug(f"Skipped {gid}: {url or 'not decoded'}")
            yield from self.next_entry(queue)

    async def feed_failed(self, failure):
        retry = await self.backoff(failure)
        if retry:
            yield retry
        else:
            self.logger.warning(f"Feed failed {failure.request.url}: {failure.value!r}")

    async def entry_failed(self, failure):
        retry = await self.backoff(failure)
        if retry:
            yield retry
            return
        self.logger.warning(f"Could not resolve {failure.request.url}: {failure.value!r}")
        for request in self.next_entry(failure.request.cb_kwargs["queue"]):
            yield request

    async def backoff(self, failure):
        """Retry a failed Google request later, without blocking: Google answers
        bursts with 429/503 for a while (waits 1, 2, 4, ... min). Returns the
        retry request, or None to give up."""
        request = failure.request
        tries = request.meta.get("tries", 0)
        status = failure.value.response.status if failure.check(HttpError) else None
        if tries >= (2 if self.limit else 6) or status not in (None, 429, 503):
            return None
        await asyncio.sleep(60 * 2**tries if status else 10)
        meta = {k: request.meta[k] for k in ("impersonate", "dont_retry") if k in request.meta}
        return request.replace(dont_filter=True, meta={**meta, "tries": tries + 1})

    # ---- publisher page ----------------------------------------------------

    def publisher_request(self, url, queue, feed):
        if any(x in url for x in self.exclude_url_substrings) or not self.want(url):
            return None
        return scrapy.Request(
            url,
            callback=self.parse_publisher,
            errback=self.publisher_failed,
            cb_kwargs={"queue": queue, "feed": feed},
            # Dead/blocked publisher pages are common: skip to the next entry.
            meta={"impersonate": "chrome", "dont_retry": True},
        )

    def publisher_failed(self, failure):
        self.logger.info(f"Publisher page failed {failure.request.url}: {failure.value!r}")
        yield from self.skip_entry(failure.request)

    def skip_entry(self, request):
        """Give the budget slot back and try the feed's next entry instead."""
        self.release(request.meta.get("redirect_urls", [request.url])[0])
        yield from self.next_entry(request.cb_kwargs["queue"])

    def parse_publisher(self, response, queue, feed):
        content = article_body(response) if isinstance(response, TextResponse) else None
        if not content:
            self.logger.info(f"No article body on {response.url}")
            yield from self.skip_entry(response.request)
            return
        pub_date, feed_title = feed
        yield self.make_item(
            response,
            title=fallback_title(response) or self.clean_feed_title(feed_title),
            date=parse_date(fallback_date(response)) or pub_date,
            content=content,
            channel=domain_name(response.url),
        )

    @staticmethod
    def clean_feed_title(title):
        # Google News titles look like "Headline - Publisher".
        return title and title.rsplit(" - ", 1)[0]


def article_body(response):
    """Paragraphs of the publisher's article body, or None."""
    for xp in BODY_XPATHS:
        for node in response.xpath(xp):
            paras = node.xpath(".//p").getall()
            if len(html_to_text(paras) or "") >= MIN_BODY_CHARS:
                return "\n".join(paras)
    parents = response.xpath("//body//p/..")
    if parents:
        best = max(parents, key=lambda n: len("".join(n.xpath("./p//text()").getall())))
        paras = best.xpath("./p").getall()
        if len(html_to_text(paras) or "") >= MIN_BODY_CHARS:
            return "\n".join(paras)
    return None


def _decoded_url(text):
    """Extract the publisher URL from a batchexecute response (")]}'" + JSON)."""
    try:
        for row in json.loads(text.split("\n", 1)[1]):
            if row[:2] == ["wrb.fr", "Fbv4je"] and row[2]:
                return json.loads(row[2])[1]
    except (IndexError, TypeError, ValueError):
        pass
    return None


def _timestamp(value):
    """Sort key for RSS (RFC 822) and Atom (ISO 8601) entry dates."""
    for parse in (parsedate_to_datetime, lambda v: datetime.fromisoformat(v.replace("Z", "+00:00"))):
        try:
            return parse(value).timestamp()
        except (TypeError, ValueError, AttributeError):
            pass
    return 0
