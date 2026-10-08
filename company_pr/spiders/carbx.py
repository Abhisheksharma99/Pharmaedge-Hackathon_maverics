"""CARB-X's own news (category "CARB-X News", 2017-today), read from the
category RSS feed page by page. The other news categories in the sitemaps
(product-developer, in-the-news, topic, recommended) are link-outs to external
sites whose carb-x.org pages have no body, so they are not crawled."""

import scrapy

from crawler.base import NewsSpider
from crawler.helpers import parse_feed


class CarbxSpider(NewsSpider):
    name = "carbx"
    feed = "https://carb-x.org/news_categories/news_internal/feed/?paged={}"
    title_xpath = '//article//h1[@class="entry-title"]//text()'
    content_xpath = '//article//div[@class="entry-content"]'
    # carb-x.org answers 429 to bursts of article requests.
    custom_settings = {"CONCURRENT_REQUESTS_PER_DOMAIN": 1, "DOWNLOAD_DELAY": 1}

    async def start(self):
        yield self.feed_request(1)

    def feed_request(self, page):
        return scrapy.Request(self.feed.format(page), callback=self.parse_feed, cb_kwargs={"page": page})

    def parse_feed(self, response, page):
        _, entries = parse_feed(response.body)
        if page == 1:
            self.per_page = len(entries)
        fresh = self.new_on_listing([url for url, _, _ in entries])
        for url, date, title in entries:
            if url in fresh and self.want(url):
                yield scrapy.Request(
                    url, callback=self.parse_article, cb_kwargs={"feed_date": date, "feed_title": title}
                )
        # A short page is the last one (the next would be a 404).
        last_page = len(entries) < self.per_page
        if fresh and not last_page and self.budget_left and page < self.page_cap(20):
            yield self.feed_request(page + 1)
