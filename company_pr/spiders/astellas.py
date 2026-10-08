"""Astellas global news (newsroom.astellas.com, back to 2005).

astellas.com/en/news moved to the newsroom (the en sitemap no longer lists
articles and its RSS only carries the latest 5), so we page through the
listing. The listing shows US Eastern dates; the URL slug carries the Tokyo
release date that matches the article's dateline, so that one is preferred.
Link-only entries whose body just points at a PDF are read from the PDF.
Several hundred 2005-2019 entries are title-only shells (no body, no PDF
link anywhere on the newsroom); they are skipped.
"""

import re
from datetime import date

import scrapy

from crawler.base import NewsSpider


class AstellasSpider(NewsSpider):
    name = "astellas"
    allowed_domains = ["newsroom.astellas.com", "mediaroom.com"]  # PDFs: filecache.mediaroom.com
    title_xpath = '//div[contains(@class, "wd_newsfeed_releases-detail")]/div[contains(@class, "wd_title")]//text()'
    content_xpath = '//div[contains(@class, "wd_news_body")]'
    page_size = 50

    async def start(self):
        yield self.listing_request(0)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://newsroom.astellas.com/news?l={self.page_size}&o={page * self.page_size}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        dates = {}
        for item in response.xpath('//li[contains(@class, "wd_item")]'):
            href = item.xpath('.//div[@class="wd_title"]/a/@href').get()
            if href:
                url = response.urljoin(href)
                dates[url] = _slug_date(url) or item.xpath('.//div[@class="wd_date"]/text()').get()
        fresh = self.new_on_listing(list(dates))
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_release, cb_kwargs={"release_date": dates[url]})
        if fresh and self.budget_left and page < self.page_cap(20):
            yield self.listing_request(page + 1)

    def parse_release(self, response, release_date):
        body = response.xpath(self.content_xpath)
        if not body:  # title-only shell; the generic fallback would grab page boilerplate
            self.crawler.stats.inc_value("pr/dropped/no_body")
            return
        pdf = body.xpath('.//a/@href[contains(translate(., "PDF", "pdf"), ".pdf")]').get()
        if pdf and len(body.xpath("normalize-space()").get()) < 200:  # body is just a PDF link
            title = " ".join(response.xpath(self.title_xpath).getall()).strip()
            yield response.follow(
                pdf, callback=self.parse_pdf, cb_kwargs={"page": response.url, "title": title, "day": release_date}
            )
        else:
            yield from self.parse_article(response, feed_date=release_date)

    def parse_pdf(self, response, page, title, day):
        item = self.pdf_item(response, title=title, date=day)
        if item:
            item["news_url"] = page  # the newsroom page, so --new-only recognises it
            yield item


def _slug_date(url):
    """'.../2026-10-07-astellas-...' -> '2026-10-07' (some slugs are malformed)."""
    m = re.search(r"/(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)", url)
    try:
        return date(int(m[1]), int(m[2]), int(m[3])).isoformat() if m else None
    except ValueError:
        return None
