"""www.transcenta.com returns empty bodies (HTTP/2) or hangs (HTTP/1.1); the bare
domain transcenta.com serves the same site fine."""

import scrapy

from crawler.base import NewsSpider


class TranscentaSpider(NewsSpider):
    name = "transcenta"
    allowed_domains = ["transcenta.com"]
    title_xpath = '//div[contains(@class,"newsTop")]/h4//text()'
    date_xpath = '//div[contains(@class,"newsTop")]/p/span//text()'
    content_xpath = '//div[@class="newsBody"]'

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://transcenta.com/Press_Release?&page={page}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        links = [response.urljoin(u) for u in response.xpath('//div[contains(@class,"newsBox")]//div[contains(@class,"newsItem")]/a/@href').getall()]
        fresh = self.new_on_listing(links)  # empty past the last page
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if fresh and self.budget_left and page < self.page_cap(50):
            yield self.listing_request(page + 1)
