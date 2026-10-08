"""Asahi Kasei news (2015 onwards).

The site moved to Adobe Edge Delivery; the old /common/data/news.json is gone.
The site-wide query index lists every page with its publication date. Under
/news/ it also holds redirects to IR library pages (financial briefings,
monthly order data) and other sites, which are skipped; "-pdf" entries are
PDF-only releases.
"""

import re

import scrapy
from scrapy.http import TextResponse

from crawler.base import NewsSpider

# e260930, ze231205, e260824-2, e260817-pdf, 20250109-news-2024-...-att-e250106-pdf
RELEASE_PATH = re.compile(r"/(z?e\d{6}[^/]*|[^/]*-news-[^/]*-pdf)$")


class AsahiKaseiSpider(NewsSpider):
    name = "asahi_kasei"
    allowed_domains = ["www.asahi-kasei.com"]
    title_xpath = '//main//div[@class="hero"]/div[1]//text()'
    date_xpath = '//meta[@name="publicationdate"]/@content'
    # Everything from the hero section on (old pages put the text right after
    # the hero), minus the hero itself and the trailing "back to News" section.
    content_xpath = (
        '//main/div[div[@class="hero"] or preceding-sibling::div[div[@class="hero"]]][following-sibling::div]'
        '/*[not(@class="hero" or @class="separator" or contains(@class, "section-metadata"))]'
    )

    async def start(self):
        yield scrapy.Request(
            "https://www.asahi-kasei.com/query-index.json?limit=10000",
            callback=self.parse_index,
        )

    def parse_index(self, response):
        pages = [
            p for p in response.json().get("data", [])
            if p.get("path", "").startswith("/news/") and RELEASE_PATH.search(p["path"]) and p.get("publicationDate")
        ]
        pages.sort(key=lambda p: float(p["publicationDate"]), reverse=True)
        for page in pages:
            if not self.budget_left:
                break
            url = response.urljoin(page["path"])
            if self.want(url):
                # Titles/dates from the index are needed for the PDF-only releases.
                title = re.sub(r"(PDF)?\s*\|\s*Asahi Kasei$", "", page.get("title") or "")
                yield scrapy.Request(
                    url,
                    callback=self.parse_release,
                    cb_kwargs={"feed_title": title or None, "feed_date": float(page["publicationDate"])},
                )

    def parse_release(self, response, feed_title, feed_date):
        if isinstance(response, TextResponse) and "/news/" not in response.url:
            self.crawler.stats.inc_value("pr/dropped/not_news")  # redirected to an IR page
            return
        for item in self.parse_article(response, feed_date=feed_date, feed_title=feed_title):
            item["news_url"] = response.meta.get("redirect_urls", [response.url])[0]  # "-pdf" path, not the PDF
            yield item
