"""Omeros press releases.

The current IR site (Q4) lists releases from 2016 on through its JSON feed;
article pages need impersonate (403 for Scrapy's TLS fingerprint). Older
releases (2006-2015) were only on the previous IR site, whose full listing
(one page, all years) survives in the Wayback Machine: once the Q4 feed is
exhausted the crawl continues there. Those items keep their original URL.
"""

import json

import scrapy

from crawler.base import NewsSpider
from crawler.helpers import parse_date

WAYBACK = "https://web.archive.org"


class OmerosSpider(NewsSpider):
    name = "omeros"
    impersonate = "chrome"
    # Impersonated requests bypass per-site throttling and the Q4 site answers
    # 429 to bursts; this also keeps archive.org requests gentle.
    custom_settings = {"CONCURRENT_REQUESTS": 2}
    date_order = "MDY"  # "08/12/2026 16:02:00"
    feed = (
        "https://investor.omeros.com/feed/PressRelease.svc/GetPressReleaseList?LanguageId=1&bodyType=0"
        "&pressReleaseDateFilter=3&pageSize={size}&pageNumber={page}&includeTags=true&year=-1"
    )
    old_listing = WAYBACK + "/web/20260406191049id_/https://investor.omeros.com/press-releases"
    title_xpath = '//h3[contains(@class,"evergreen-news-title")]//text()'
    date_xpath = '//span[@class="evergreen-news-date-text"]/text()'
    content_xpath = '//div[@class="evergreen-news-body"]'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.oldest_q4 = None

    async def start(self):
        yield self.listing_request(0)

    def listing_request(self, page):
        # Q4's paging is unstable for releases sharing a timestamp, so
        # full-history runs fetch everything as one page.
        size = 20 if self.limit else 1000
        return scrapy.Request(
            self.feed.format(size=size, page=page), callback=self.parse_listing, cb_kwargs={"page": page}
        )

    def parse_listing(self, response, page):
        releases = {
            response.urljoin(pr["LinkToDetailPage"]): pr
            for pr in json.loads(response.text).get("GetPressReleaseListResult") or []
            if pr.get("LinkToDetailPage")
        }
        fresh = self.new_on_listing(releases)
        for url in fresh:
            pr = releases[url]
            date = parse_date(pr.get("PressReleaseDate"), self.date_order)
            self.oldest_q4 = min(filter(None, [self.oldest_q4, date]), default=None)
            if self.want(url):
                yield scrapy.Request(
                    url,
                    callback=self.parse_article,
                    cb_kwargs={"feed_title": pr.get("Headline"), "feed_date": pr.get("PressReleaseDate")},
                )
        if fresh and self.budget_left and page < self.page_cap(30):
            yield self.listing_request(page + 1)
        elif not fresh and self.budget_left:
            yield self.wayback_request(self.old_listing, self.parse_old_listing)

    # ---- pre-2016 archive (Wayback Machine) ----------------------------------

    def wayback_request(self, archive_url, callback, **cb_kwargs):
        # Not impersonated, so Scrapy's per-site throttling applies to archive.org.
        return scrapy.Request(
            archive_url, callback=callback, cb_kwargs=cb_kwargs,
            meta={"impersonate": False, "download_timeout": 120},
        )

    def parse_old_listing(self, response):
        for row in response.xpath("//table//tbody//tr"):
            href = row.xpath(".//a/@href").get()
            date = row.xpath("normalize-space(.//span)").get()
            # Releases the Q4 feed already covers are skipped.
            day = parse_date(date)
            if not href or not day or (self.oldest_q4 and day >= self.oldest_q4):
                continue
            url = "https://investor.omeros.com" + href
            if self.want(url):
                yield self.wayback_request(
                    f"{WAYBACK}/web/2025id_/{url}", self.parse_old_release, url=url, date=date
                )

    def parse_old_release(self, response, url, date):
        yield self.make_item(
            response,
            url=url,
            title=" ".join(response.xpath('//div[contains(@class,"field--name-field-nir-news-title")]//text()').getall()),
            date=date,
            content=response.xpath('//div[@class="node__content"]').get(),
        )
