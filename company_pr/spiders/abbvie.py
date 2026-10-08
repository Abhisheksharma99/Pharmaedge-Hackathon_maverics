import scrapy

from crawler.base import NewsSpider


class AbbvieSpider(NewsSpider):
    name = "abbvie"
    allowed_domains = ["news.abbvie.com"]
    page_size = 100
    title_xpath = '//div[contains(@class,"wd_title")]//text()'
    date_xpath = '//div[@class="wd_date"]/text()'
    content_xpath = '//div[contains(@class,"wd_news_body")]'

    async def start(self):
        yield self.listing_request(0)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://news.abbvie.com/index.php?s=2429&l={self.page_size}&o={page * self.page_size}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        links = [
            response.urljoin(href)
            for href in response.xpath('//li[@class="wd_item"]//div[@class="wd_title"]/a/@href').getall()
        ]
        fresh = self.new_on_listing(links)
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if fresh and self.budget_left and page < self.page_cap(5):
            yield self.listing_request(page + 1)
