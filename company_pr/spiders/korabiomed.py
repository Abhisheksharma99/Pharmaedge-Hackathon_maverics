"""Korea Biomedical Review (returns 403 to non-browser clients).

Normal runs read the news sitemap (the newest ~2 days). The article list
ignores ``?page=`` (it always answers page 1), so full-history runs
(--limit 0) walk the sequential article ids down from the newest one in the
sitemap: ~33k ids, of which ~24.5k are live articles back to November 2016.
Unused ids answer a tiny JS-alert stub, which is skipped.
"""

import re

import scrapy

from crawler.base import FeedNewsSpider

ARTICLE_URL = "https://www.koreabiomed.com/news/articleView.html?idxno={}"


class KorabiomedSpider(FeedNewsSpider):
    name = "korabiomed"
    category = "news"
    impersonate = "chrome"
    custom_settings = {"DOWNLOAD_DELAY": 0.5}
    channel = "koreabiomed"
    aggregator_source = "koreabiomed"
    feed_urls = ["https://www.koreabiomed.com/sitemap.xml"]
    url_filter = ["/news/"]
    title_xpath = '//meta[@name="title"]/@content'
    date_xpath = '//meta[@property="article:published_time"]/@content'
    content_xpath = '//article[@id="article-view-content-div"]'

    async def start(self):
        for url in self.feed_urls:
            yield self.feed_request(url) if self.limit else scrapy.Request(url, callback=self.walk_ids)

    def walk_ids(self, response):
        newest = max(map(int, re.findall(r"idxno=(\d+)", response.text)), default=0)
        self.logger.info(f"Walking article ids {newest}..1")
        for idxno in range(newest, 0, -1):
            url = ARTICLE_URL.format(idxno)
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)

    def parse_article(self, response, **kwargs):
        if response.xpath('//meta[@property="article:published_time"]'):
            yield from super().parse_article(response, **kwargs)
