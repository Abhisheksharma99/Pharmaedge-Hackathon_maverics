"""Base classes every press-release spider builds on.

NewsSpider
    * ``want(url)``      -> True if the article should be fetched (not seen in
                            this run, not seen before with --new-only, and the
                            per-run ``limit`` is not exhausted). Call it before
                            yielding each article request.
    * ``budget_left``    -> False once ``limit`` article URLs were scheduled;
                            use it to stop paginating listing pages.
    * ``page_cap(n)``    -> page limit for listings: n normally, unlimited in
                            full-history runs (--limit 0).
    * ``new_on_listing(urls)`` -> links not listed on an earlier listing page
                            of this run; empty means the site is repeating
                            pages, so stop paginating. (Don't use want() for
                            that: under --new-only it also rejects URLs from
                            earlier runs, which would end a resumed crawl.)
    * ``make_item(...)`` -> builds the output item. Missing title/date/content
                            are filled from page metadata when a response is
                            given. Cleaning/validation happens in pipelines.
    * ``parse_article``  -> generic article parser driven by the class
                            attributes ``title_xpath``, ``date_xpath``,
                            ``content_xpath`` and ``tags_xpath``. PDF
                            responses are handed to ``pdf_item``.
    * ``pdf_item(...)``  -> item from a PDF-only release (text via pypdf);
                            pass the listing's title/date when known.

FeedNewsSpider
    Discovers articles from sitemaps / sitemap indexes / RSS / Atom feeds
    (``feed_urls``), filters them by ``url_filter`` / ``url_exclude``, keeps the
    newest ``limit`` ones and sends them to ``parse_article``.
"""

import html
import re
from pathlib import Path

import scrapy
from scrapy.http import TextResponse

from crawler.helpers import (
    domain_name,
    fallback_content,
    fallback_date,
    fallback_title,
    parse_date,
    parse_feed,
    pdf_to_text,
)


class NewsSpider(scrapy.Spider):
    # "company" (own press releases), "news" (trade press), "agency"
    # (regulators) or "wire" (newswires / news search); see run.py --group.
    category = "company"
    # Output labels; default to the spider name.
    channel = None
    aggregator_source = None
    # "chrome" routes every request through curl_cffi (see handlers.py).
    impersonate = None
    # Hints for parse_date(): e.g. "DMY" for 03/04/2025 meaning 3 April.
    date_order = None
    date_languages = None

    # Selectors for the generic parse_article().
    title_xpath = None
    date_xpath = None
    content_xpath = None
    tags_xpath = None

    def __init__(self, *args, limit=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._limit_arg = limit
        self._scheduled = set()
        self._seen_before = set()
        self._listed = set()

    @classmethod
    def from_crawler(cls, crawler, *args, **kwargs):
        spider = super().from_crawler(crawler, *args, **kwargs)
        settings = crawler.settings
        limit = spider._limit_arg if spider._limit_arg is not None else settings.getint("PR_LIMIT", 0)
        spider.limit = int(limit) if limit else 0
        if settings.getbool("PR_NEW_ONLY"):
            seen_file = Path(settings.get("PR_SEEN_FILE"))
            if seen_file.exists():
                spider._seen_before = set(seen_file.read_text().split())
        return spider

    # ---- crawl budget ------------------------------------------------------

    def page_cap(self, n):
        """Max listing pages to walk: ``n`` normally, unlimited for full-history
        runs (limit 0), where pagination must end on an empty/last page."""
        return n if self.limit else 10**9

    @property
    def budget_left(self):
        return not self.limit or len(self._scheduled) < self.limit

    def want(self, url):
        if not url:
            return False
        url = url.strip()
        if url in self._scheduled or url in self._seen_before:
            return False
        if not self.budget_left:
            return False
        self._scheduled.add(url)
        return True

    def release(self, url):
        """Give a want()-ed URL's budget slot back (e.g. its page failed)."""
        self._scheduled.discard((url or "").strip())

    def new_on_listing(self, urls):
        """The given listing-page links that no earlier listing page of this
        run contained. Paginate only while this is non-empty: sites often
        answer out-of-range page numbers with page 1 or the last page."""
        fresh = [u.strip() for u in urls if u and u.strip() not in self._listed]
        self._listed.update(fresh)
        return fresh

    # ---- items -------------------------------------------------------------

    def make_item(
        self,
        response=None,
        *,
        url=None,
        title=None,
        date=None,
        content=None,
        tags=None,
        channel=None,
        aggregator_source=None,
        modified_date=None,
    ):
        url = url or (response.url if response is not None else None)
        if response is not None:
            stats = self.crawler.stats
            if not title or not str(title).strip():
                title = fallback_title(response)
                stats.inc_value("pr/fallback/title")
            if not date or not parse_date(date, self.date_order, self.date_languages):
                found = fallback_date(response)
                if found and parse_date(found, self.date_order, self.date_languages):
                    date = found
                    stats.inc_value("pr/fallback/date")
            if not content or not str(content).strip():
                content = fallback_content(response)
                stats.inc_value("pr/fallback/content")
        return {
            "news_url": url,
            "title": title,
            "news_date": date,
            "news_modified_date": modified_date,
            "content": content,
            "tags": tags,
            "channel": channel or self.channel or self.name,
            "aggregator_source": aggregator_source or self.aggregator_source or self.name,
        }

    def parse_article(self, response, feed_date=None, feed_title=None):
        """Generic article page parser driven by the *_xpath class attributes."""
        if _is_pdf(response):
            item = self.pdf_item(response, title=feed_title, date=feed_date)
            if item:
                yield item
            return
        if not _is_html(response):
            return
        title = _join(response.xpath(self.title_xpath).getall()) if self.title_xpath else None
        date = _join(response.xpath(self.date_xpath).getall()) if self.date_xpath else None
        content = response.xpath(self.content_xpath).getall() if self.content_xpath else None
        tags = response.xpath(self.tags_xpath).getall() if self.tags_xpath else None
        yield self.make_item(
            response,
            title=title or feed_title,
            date=date or feed_date,
            content="\n".join(content) if content else None,
            tags=tags,
        )

    def pdf_item(self, response, *, title=None, date=None, url=None, **fields):
        """Item for a PDF-only release, or None for scanned/empty PDFs.

        Pass ``url`` when the release was want()-ed under another address
        (e.g. an article page that links to the PDF), so --new-only matches."""
        text = pdf_to_text(response.body)
        if not text:
            self.logger.info(f"No extractable text in PDF {response.url}")
            self.crawler.stats.inc_value("pr/dropped/pdf_no_text")
            return None
        self.crawler.stats.inc_value("pr/pdf_parsed")
        lines = text.splitlines()
        if not title:
            # First substantial line that is not boilerplate.
            title = next(
                (l for l in lines[:15] if 15 < len(l) < 250 and "release" not in l.lower()),
                None,
            )
        if not date or not parse_date(date, self.date_order, self.date_languages):
            # Dateline, e.g. "Silver Spring, MD, April 2, 2001 – ...".
            date = next(
                (d for l in lines[:20] if _YEAR.search(l)
                 for d in [parse_date(l, self.date_order, self.date_languages)] if d),
                None,
            )
        # Escaped inside <pre> so the pipeline's HTML->text step keeps it verbatim.
        return self.make_item(
            url=url or response.url,
            title=title,
            date=date,
            content=f"<pre>{html.escape(text)}</pre>",
            **fields,
        )

    @staticmethod
    def channel_from_url(url):
        return domain_name(url)


class FeedNewsSpider(NewsSpider):
    feed_urls = []
    # Keep article URLs containing ANY of these substrings (empty = keep all).
    url_filter = []
    # Drop article URLs containing ANY of these substrings.
    url_exclude = []
    # In a sitemap index, only follow child sitemaps containing ANY of these.
    sitemap_follow = []
    # Only consider entries whose feed date is on/after this (YYYY-MM-DD).
    min_feed_date = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._entries = []
        self._pending_feeds = 0

    async def start(self):
        for url in self.feed_urls:
            yield self.feed_request(url)

    def feed_request(self, url):
        self._pending_feeds += 1
        return scrapy.Request(
            url,
            callback=self.parse_feed_response,
            errback=self.feed_failed,
            dont_filter=True,
            headers={"Accept": "application/xml,text/xml,application/rss+xml,*/*;q=0.8"},
        )

    def parse_feed_response(self, response):
        try:
            kind, entries = parse_feed(response.body)
        except Exception as exc:  # malformed feed
            self.logger.error(f"Could not parse feed {response.url}: {exc}")
            kind, entries = "urls", []
        if kind == "index":
            children = [
                (loc, mod) for loc, mod, _ in entries
                if not self.sitemap_follow or any(s in loc for s in self.sitemap_follow)
            ]
            for loc, _ in children:
                yield self.feed_request(loc)
        else:
            self._entries.extend(entries)
            self.logger.info(f"{response.url}: {len(entries)} entries")
        yield from self._feed_done()

    def feed_failed(self, failure):
        self.logger.error(f"Feed request failed: {failure.request.url}: {failure.value!r}")
        yield from self._feed_done()

    def _feed_done(self):
        self._pending_feeds -= 1
        if self._pending_feeds > 0:
            return
        entries = {}
        for url, raw_date, title in self._entries:
            url = url.strip()
            if self.url_filter and not any(f in url for f in self.url_filter):
                continue
            if any(x in url for x in self.url_exclude):
                continue
            if url not in entries:
                entries[url] = (parse_date(raw_date), title)
        ordered = list(entries.items())
        if self.min_feed_date:
            ordered = [e for e in ordered if e[1][0] and e[1][0] >= self.min_feed_date]
        since = self.settings.get("PR_SINCE")
        if since:  # undated entries are kept; the pipeline checks the real date
            ordered = [e for e in ordered if not e[1][0] or e[1][0] >= since]
        # Newest first; entries without a date keep feed order after dated ones.
        ordered.sort(key=lambda e: e[1][0] or "", reverse=True)
        self.logger.info(f"{len(ordered)} candidate article URLs from feeds")
        for url, (feed_date, title) in ordered:
            if not self.budget_left:
                break
            if self.want(url):
                yield scrapy.Request(
                    url,
                    callback=self.parse_article,
                    cb_kwargs={"feed_date": feed_date, "feed_title": title},
                )


_YEAR = re.compile(r"\b(19|20)\d{2}\b")


def _join(parts):
    text = " ".join(p.strip() for p in parts if p and p.strip())
    return re.sub(r"\s+", " ", text) or None


def _is_pdf(response):
    ctype = response.headers.get("Content-Type", b"").decode("latin-1").lower()
    return "pdf" in ctype or response.body[:5] == b"%PDF-"


def _is_html(response):
    if not isinstance(response, TextResponse):
        return False
    ctype = response.headers.get("Content-Type", b"").decode("latin-1").lower()
    return "pdf" not in ctype and not response.url.lower().endswith(".pdf")
