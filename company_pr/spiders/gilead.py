"""Gilead press releases (sitemap covers the whole archive, 1996 onwards)."""

from scrapy.http import TextResponse

from crawler.base import FeedNewsSpider


class GileadSpider(FeedNewsSpider):
    name = "gilead"
    feed_urls = ["https://www.gilead.com/sitemap.xml"]
    url_filter = ["/news/news-details/"]
    title_xpath = "//h1/text()"
    date_xpath = '//div[contains(@class, "field-news-date")]/text()'
    content_xpath = '//div[@class="field-news-content"]/div'

    def parse_article(self, response, feed_date=None, feed_title=None):
        # A few sitemap entries redirect to the home page or the news index.
        if isinstance(response, TextResponse) and not response.xpath(self.content_xpath):
            self.crawler.stats.inc_value("pr/dropped/no_body")
            return
        yield from super().parse_article(response, feed_date, feed_title)
