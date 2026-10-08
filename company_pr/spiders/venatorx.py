"""venatorx.com is in maintenance mode (every page redirects to a holding page;
last release May 2024), but WordPress still serves the press-release RSS feed
with the full article bodies, so items are built from the feed.

The feed's pubDate of releases older than Nov 2023 is the site-migration date,
so the date is taken from the release's dateline; for the few releases without
one, the date (and body, if the feed has none) comes from the release page as
archived by the Wayback Machine before the site went into maintenance."""

import json
import re

import scrapy

from crawler.base import NewsSpider
from crawler.helpers import html_to_text

_DATE = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}"
# "Malvern, PA, May 16, 2024 – ...", "... — November 9, 2023 — ...", "November 25, 2019, Boston, MA ..."
_DATELINE = re.compile(rf"({_DATE})\s*[–—-]|[–—-]\s*({_DATE})|^({_DATE}),", re.M)
_CDX = (
    "https://web.archive.org/cdx/search/cdx?url={}&output=json&fl=timestamp,original"
    "&filter=statuscode:200&to=20250901&limit=1"
)
_ARCHIVE_META = {"max_retry_times": 5}  # web.archive.org often answers 503/429 for a while


class VenatorxSpider(NewsSpider):
    name = "venatorx"
    feed = "https://venatorx.com/feed/?post_type=press-releases&paged={}"

    async def start(self):
        yield self.feed_request(1)

    def feed_request(self, page):
        return scrapy.Request(self.feed.format(page), callback=self.parse_feed, cb_kwargs={"page": page})

    def parse_feed(self, response, page):
        response.selector.register_namespace("content", "http://purl.org/rss/1.0/modules/content/")
        items = response.xpath("//item")
        if page == 1:
            self.per_page = len(items)
        links = [item.xpath("./link/text()").get() for item in items]
        fresh = self.new_on_listing(links)
        for item, url in zip(items, links):
            if url not in fresh or "/press-releases/" not in url or not self.want(url):
                continue
            body = (item.xpath("./content:encoded/text()").get() or "").split("<p>The post <a")[0]
            release = {
                "url": url,
                "title": item.xpath("./title/text()").get(),
                "content": body,
                "feed_date": item.xpath("./pubDate/text()").get(),
            }
            match = _DATELINE.search((html_to_text(body) or "")[:1500])
            if match:
                yield self.make_item(
                    url=url, title=release["title"], date=next(filter(None, match.groups())), content=body
                )
            else:
                yield scrapy.Request(
                    _CDX.format(url.split("://", 1)[1]),
                    callback=self.parse_cdx,
                    errback=self.archive_failed,
                    cb_kwargs={"release": release},
                    meta=_ARCHIVE_META,
                    dont_filter=True,
                )
        # A short page is the last one (the next would be a 404).
        if fresh and len(items) >= self.per_page and self.budget_left and page < self.page_cap(20):
            yield self.feed_request(page + 1)

    def parse_cdx(self, response, release):
        rows = json.loads(response.text or "[]")[1:]
        if not rows:
            yield self.feed_item(release)
            return
        timestamp, original = rows[0]
        yield scrapy.Request(
            f"https://web.archive.org/web/{timestamp}id_/{original}",
            callback=self.parse_archived,
            errback=self.archive_failed,
            cb_kwargs={"release": release},
            meta=_ARCHIVE_META,
        )

    def parse_archived(self, response, release):
        date = response.xpath(
            '//*[contains(@class,"article-container")]/preceding-sibling::*[contains(@class,"date")][1]/text()'
        ).get()
        content = release["content"]
        if not (html_to_text(content) or "").strip():
            content = response.xpath('//div[@class="article-text"]').get()
        yield self.make_item(
            url=release["url"], title=release["title"], date=date or release["feed_date"], content=content
        )

    def archive_failed(self, failure):
        yield self.feed_item(failure.request.cb_kwargs["release"])

    def feed_item(self, release):
        self.logger.info(f"No dateline or archived date for {release['url']}; using the feed date")
        return self.make_item(
            url=release["url"], title=release["title"], date=release["feed_date"], content=release["content"]
        )
