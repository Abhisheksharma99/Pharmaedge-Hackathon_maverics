"""GlobeNewswire search listings (newest first).

globenewswire.com (Akamai) rejects non-browser TLS fingerprints, hence
impersonate. Akamai also answers bursts with 403s for a while (about 600
requests at ~5/s are enough), so the spider runs one request at a time
(~2/s, no 403s over a 1,400-page test) and backs off and retries on 403.

A search serves at most 100 pages of 50 results (later page numbers repeat
page 100), but it accepts a date filter (``/date/[YYYY-MM-DD TO YYYY-MM-DD]``)
and embeds facet counts. Full-history runs (--limit 0) therefore split each
search into date windows of at most 5,000 results by bisection, which
reaches back to the start of the archive (2000). In normal runs the budget is
split evenly across the search paths.
"""

import asyncio
import json
import math
import re
from datetime import date, timedelta

import scrapy
from scrapy.spidermiddlewares.httperror import HttpError

from crawler.base import NewsSpider
from crawler.config import GLOBE_NEWS_SEARCH_PATHS

ARCHIVE_START = date(1990, 1, 1)
MAX_PAGES = 100  # per search (or date window)


class GlobenewswireSpider(NewsSpider):
    name = "globenewswire"
    category = "wire"
    aggregator_source = "globenewswire"
    impersonate = "chrome"
    custom_settings = {"CONCURRENT_REQUESTS": 1}
    search_paths = GLOBE_NEWS_SEARCH_PATHS
    page_size = 50  # the largest page size the search accepts

    title_xpath = '//h1[contains(@class,"article-headline")]//text()'
    date_xpath = '//*[@itemprop="datePublished"]/time/text()'  # ET date as shown
    content_xpath = '//*[@itemprop="articleBody"]'
    tags_xpath = '//div[@class="tags-container"]//a/text()'
    channel_xpath = '//*[@itemprop="sourceOrganization"]//a/text()'

    async def start(self):
        self.quota = math.ceil(self.limit / len(self.search_paths)) if self.limit and self.search_paths else None
        since = self.settings.get("PR_SINCE")
        start = date.fromisoformat(since) if since else ARCHIVE_START
        window = (start, date.today() + timedelta(days=1))
        for term in self.search_paths:
            # Normal runs only need a date filter for --since.
            yield self.search_request(term, window if since or not self.limit else None)

    def search_path(self, term):
        return term

    def search_request(self, term, window, page=1, listed=None, scheduled=0):
        path = self.search_path(term)
        if window:
            path += f"/date/[{window[0]}%2520TO%2520{window[1]}]"
        return scrapy.Request(
            f"https://www.globenewswire.com/en/search/{path}?page={page}&pageSize={self.page_size}",
            callback=self.parse_search,
            errback=self.retry_blocked,
            cb_kwargs={"term": term, "window": window, "page": page,
                       "listed": set() if listed is None else listed, "scheduled": scheduled},
        )

    def parse_search(self, response, term, window, page, listed, scheduled):
        links = [response.urljoin(h) for h in response.xpath('//div[@class="mainLink"]/a/@href').getall()]
        if page == 1 and links and window and not self.limit:
            total = _result_count(response)
            if total and total > MAX_PAGES * self.page_size and window[0] < window[1]:
                # Too many results to page through: split the window, newest half first.
                mid = window[0] + (window[1] - window[0]) // 2
                self.logger.info(f"'{term}' {window[0]}..{window[1]}: {total} results, splitting")
                yield self.search_request(term, (mid + timedelta(days=1), window[1]))
                yield self.search_request(term, (window[0], mid))
                return
        # Links new to this search: ends pagination on an empty or repeated page
        # (tracked per search since the industry searches share many releases).
        fresh = [u for u in links if u not in listed]
        listed.update(fresh)
        for url in fresh:
            if self.quota and scheduled >= self.quota:
                return
            if self.want(url):
                scheduled += 1
                yield scrapy.Request(url, callback=self.parse_article, errback=self.retry_blocked)
        label = f"'{term}'" + (f" {window[0]}..{window[1]}" if window else "")
        self.logger.info(f"{label} page {page}: {len(fresh)} new links, {scheduled} scheduled")
        more = fresh and len(links) >= self.page_size
        if more and self.budget_left and page < min(self.page_cap(20), MAX_PAGES):
            yield self.search_request(term, window, page + 1, listed, scheduled)
        elif more and page == MAX_PAGES and not self.limit:
            self.logger.warning(f"{label}: stopped at the site's {MAX_PAGES}-page limit")

    async def retry_blocked(self, failure):
        """After an Akamai 403, wait (non-blocking; 1, 2, 4, 8, 16 min) and retry.
        Normal runs give up sooner so they still finish within their timeout."""
        request = failure.request
        tries = request.meta.get("blocked_tries", 0)
        max_tries = 2 if self.limit else 5
        if failure.check(HttpError) and failure.value.response.status == 403 and tries < max_tries:
            if not tries:
                self.logger.info(f"403 (rate limited?), retrying later: {request.url}")
            await asyncio.sleep(60 * 2**tries)
            yield request.replace(dont_filter=True, meta={"blocked_tries": tries + 1})
        else:
            self.logger.warning(f"Giving up on {request.url}: {failure.value!r}")

    def parse_article(self, response):
        title = response.xpath(self.title_xpath).getall()
        yield self.make_item(
            response,
            title=" ".join(t.strip() for t in title if t.strip()),
            date=response.xpath(self.date_xpath).get(),
            content=response.xpath(self.content_xpath).get(),
            tags=response.xpath(self.tags_xpath).getall(),
            channel=response.xpath(self.channel_xpath).get(),
        )


def _result_count(response):
    """Total hits of a search, summed from its embedded language facet."""
    m = re.search(r"SearchFilter = '(.*?)';\s*$", response.text, re.M)
    try:
        facets = json.loads(m[1].replace('\\"', '"'))
        lang = next(f for f in facets if f["FacetName"] == "language")
        return sum(f["Count"] for f in lang["Filters"])
    except (TypeError, ValueError, KeyError, StopIteration):
        return None
