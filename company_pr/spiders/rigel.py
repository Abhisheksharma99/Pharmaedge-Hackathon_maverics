"""Rigel press releases (the site's archive starts in 2007). Out-of-range
?page=N redirects to the first page, hence new_on_listing()."""

import scrapy
from scrapy.spidermiddlewares.httperror import HttpError

from crawler.base import NewsSpider


class RigelSpider(NewsSpider):
    name = "rigel"
    allowed_domains = ["www.rigel.com"]
    # The equisolve-hosted IR sites (Matinas, Rigel, SCYNEXIS) answer 403 to
    # bursts and then block Scrapy's TLS fingerprint for a while: pace requests,
    # and retry a 403 once as Chrome (see blocked()).
    custom_settings = {"DOWNLOAD_DELAY": 1}
    title_xpath = '//h1[@class="article-heading"]//text()'
    date_xpath = '//article[@class="full-news-article"]//time/@datetime'
    content_xpath = (
        '//article[@class="full-news-article"]/node()[not(self::h1)'
        ' and not(contains(@class,"related-documents"))'
        ' and not(contains(@class,"spr-ir-news-article-date"))]'
    )

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://www.rigel.com/investors/news-events/press-releases?page={page}",
            callback=self.parse_listing,
            errback=self.blocked,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        links = response.xpath('//div[contains(@class,"main-content")]//article//a/@href').getall()
        fresh = self.new_on_listing(response.urljoin(u) for u in links)
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article, errback=self.blocked)
        if fresh and self.budget_left and page < self.page_cap(60):
            yield self.listing_request(page + 1)

    def blocked(self, failure):
        request = failure.request
        if (
            failure.check(HttpError)
            and failure.value.response.status == 403
            and not request.meta.get("impersonate")
        ):
            yield request.replace(meta={**request.meta, "impersonate": "chrome"}, dont_filter=True)
