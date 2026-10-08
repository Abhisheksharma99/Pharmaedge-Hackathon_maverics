import scrapy

from crawler.base import NewsSpider


class ArmataPharmaSpider(NewsSpider):
    name = "armata_pharma"
    allowed_domains = ["investor.armatapharma.com"]
    listing_url = "https://investor.armatapharma.com/press-releases"
    title_xpath = '//div[contains(@class,"wd_title")]/text()'
    date_xpath = '//comment()[contains(., "ITEMDATE:")]'
    content_xpath = '//div[contains(@class,"wd_news_body")]'
    page_size = 100

    async def start(self):
        yield self.listing_request(0)

    def listing_request(self, page):
        return scrapy.Request(
            f"{self.listing_url}?l={self.page_size}&o={page * self.page_size}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        links = response.xpath('//ul[contains(@class,"item_list")]/li//div[@class="wd_title"]/a/@href').getall()
        new = self.new_on_listing(response.urljoin(u) for u in dict.fromkeys(links))
        for url in new:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_release)
        # The last page is a partial one; offsets past the end list nothing.
        if len(links) == self.page_size and new and self.budget_left and page + 1 < self.page_cap(10):
            yield self.listing_request(page + 1)

    def parse_release(self, response):
        if response.xpath(self.content_xpath):
            yield from self.parse_article(response)
        else:  # a few old releases are title-only pages
            self.logger.info(f"No release text on {response.url}")
