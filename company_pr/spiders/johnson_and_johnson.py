"""Johnson & Johnson press releases (archive back to 2008). Akamai: needs impersonation.

The press-release listing (?p=N, newest first, 10 per page) drives the crawl.
The sitemap is not used for ordering because its <lastmod> values were
bulk-updated; a full-history run reads it at the end to pick up the few
releases the listing leaves out.
"""

import scrapy
from scrapy.http import TextResponse

from crawler.base import NewsSpider

LISTING_URL = "https://www.jnj.com/media-center/press-releases?p={}"
SECTION = "/media-center/press-releases/"


class JohnsonAndJohnsonSpider(NewsSpider):
    name = "johnson_and_johnson"
    allowed_domains = ["jnj.com"]
    impersonate = "chrome"
    # Impersonated requests skip DOWNLOAD_DELAY/AutoThrottle, so cap concurrency
    # to stay under the CDN rate limit on full-history runs.
    custom_settings = {"CONCURRENT_REQUESTS": 2}
    title_xpath = '//meta[@property="og:title"]/@content'
    date_xpath = '//meta[@property="article:published_time"]/@content'
    content_xpath = '//div[@class="Page-articleBody"]'

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            LISTING_URL.format(page), callback=self.parse_listing, cb_kwargs={"page": page}
        )

    def parse_listing(self, response, page):
        dates = {}
        for promo in response.xpath('//bsp-pagepromo[contains(@class,"PagePromoSearch")]'):
            url = promo.xpath('.//a[@class="PagePromo-itemLink"]/@href').get()
            if url:
                dates[response.urljoin(url)] = promo.xpath('normalize-space(.//*[@class="PagePromo-date"])').get()
        # Out-of-range pages repeat the last page, which ends the walk.
        fresh = self.new_on_listing(dates)
        for url in fresh:
            if SECTION in url and self.want(url):
                yield scrapy.Request(url, callback=self.parse_article, cb_kwargs={"feed_date": dates.get(url)})
        if fresh and self.budget_left and page < self.page_cap(100):
            yield self.listing_request(page + 1)
        elif not fresh and self.budget_left:
            yield scrapy.Request("https://www.jnj.com/sitemap-content.xml", callback=self.parse_sitemap)

    def parse_sitemap(self, response):
        response.selector.remove_namespaces()
        for url in response.xpath("//url/loc/text()").getall():
            if not self.budget_left:
                break
            if SECTION in url and self.want(url.strip()):
                yield scrapy.Request(url.strip(), callback=self.parse_article)

    def parse_article(self, response, **kwargs):
        is_html = isinstance(response, TextResponse)
        # The sitemap also lists topic pages (.../press-releases/financial); they have no article body.
        if is_html and not response.xpath(self.content_xpath):
            return
        for item in super().parse_article(response, **kwargs):
            if is_html:
                item["news_modified_date"] = response.xpath('//meta[@property="article:modified_time"]/@content').get()
            yield item
