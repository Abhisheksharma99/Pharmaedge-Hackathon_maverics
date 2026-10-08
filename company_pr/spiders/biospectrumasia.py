"""BioSpectrum Asia news, analysis and opinion articles.

The site runs a JS browser check that blocks Scrapy and curl_cffi's "chrome"
fingerprint but lets "safari" through. Articles are discovered from the
sitemap instead of the old category listings: normal runs read page-0 (the
newest ~7000 URLs), full-history runs (--limit 0) the whole sitemap index
(~26.6k articles back to December 2016). Bursts of article requests
(and the sitemap index) intermittently get HTTP 500/504, hence the gentler
pacing and extra retries.
"""

from crawler.base import FeedNewsSpider
from crawler.helpers import parse_date


class BiospectrumasiaSpider(FeedNewsSpider):
    name = "biospectrumasia"
    category = "news"
    impersonate = "safari"
    custom_settings = {"DOWNLOAD_DELAY": 1, "CONCURRENT_REQUESTS_PER_DOMAIN": 2, "RETRY_TIMES": 5}
    feed_urls = ["https://www.biospectrumasia.com/xml/sitemap/page-0.xml"]
    archive_feed = "https://www.biospectrumasia.com/xml/sitemap.xml"
    url_filter = [".html"]  # skips the category pages of the sitemap index
    title_xpath = '//meta[@property="og:title"]/@content'
    date_xpath = 'substring-before(//p[@class="float-left"], "|")'
    content_xpath = '//div[@class="pt-2"]/*[not(self::h3) and not(contains(@class,"row"))]'

    async def start(self):
        for url in self.feed_urls if self.limit else [self.archive_feed]:
            yield self.feed_request(url)

    def parse_article(self, response, feed_date=None, feed_title=None):
        for item in super().parse_article(response, feed_date=feed_date, feed_title=feed_title):
            if not parse_date(item["news_date"]):  # a few pages show a zero date ("December 8, 1899")
                item["news_date"] = feed_date
            yield item
