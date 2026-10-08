import re

import scrapy

from crawler.base import NewsSpider


class ArgoBioPharmaSpider(NewsSpider):
    name = "argo_bio_pharma"
    channel = aggregator_source = "argoBioPharma"
    allowed_domains = ["argobiopharma.com"]
    title_xpath = '//div[@class="nynewsshowtop"]//div[@class="mainbox"]//h2/text()'
    date_xpath = '//div[@class="nynewsshowtop"]//div[@class="mainbox"]//p/text()'
    content_xpath = '//div[@class="huisebj pd5"]//p'

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://www.argobiopharma.com/news/index{page if page > 1 else ''}.html",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        # Pages past the end come back empty (HTTP 200).
        links = self.new_on_listing(
            response.urljoin(href)
            for href in dict.fromkeys(response.xpath('//div[@class="nynewsbox"]//a/@href').getall())
            if re.search(r"/news/\d+\.html$", href)
        )
        for url in links:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if links and self.budget_left and page < self.page_cap(30):
            yield self.listing_request(page + 1)
