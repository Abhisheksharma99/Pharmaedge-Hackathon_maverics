"""Q4 IR site: the press-release list (complete back to Retrophin's 2012
releases) comes from the Q4 JSON feed; article pages need impersonate (403
for Scrapy's TLS fingerprint)."""

import json

import scrapy

from crawler.base import NewsSpider


class TravereSpider(NewsSpider):
    name = "travere"
    allowed_domains = ["ir.travere.com"]
    impersonate = "chrome"
    # Impersonated requests bypass per-site throttling; Q4 sites answer 429 to bursts.
    custom_settings = {"CONCURRENT_REQUESTS": 2}
    date_order = "MDY"  # "10/02/2026 10:00:00"
    feed = (
        "https://ir.travere.com/feed/PressRelease.svc/GetPressReleaseList?LanguageId=1&bodyType=0"
        "&pressReleaseDateFilter=3&pageSize={size}&pageNumber={page}&includeTags=true&year=-1"
    )
    title_xpath = '//h3[contains(@class,"evergreen-news-title")]//text()'
    date_xpath = '//span[@class="evergreen-news-date-text"]/text()'
    content_xpath = '//div[@class="evergreen-news-body"]'

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
            if self.want(url):
                pr = releases[url]
                yield scrapy.Request(
                    url,
                    callback=self.parse_article,
                    cb_kwargs={"feed_title": pr.get("Headline"), "feed_date": pr.get("PressReleaseDate")},
                )
        if fresh and self.budget_left and page < self.page_cap(30):
            yield self.listing_request(page + 1)
