import scrapy

from crawler.base import NewsSpider


class ViatrisSpider(NewsSpider):
    name = "viatris"
    allowed_domains = ["newsroom.viatris.com"]
    content_xpath = '//div[@wd_resize="formatNews"]'

    async def start(self):
        yield self.listing_request(0)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://newsroom.viatris.com/press-releases?o={page * 10}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        cards = {}
        for item in response.xpath('//li[contains(@class, "wd_item")]'):
            href = item.xpath('.//div[@class="wd_title"]/a/@href').get()
            if href:
                cards[response.urljoin(href)] = {
                    "feed_date": item.xpath('.//div[@class="wd_date"]/text()').get(),
                    "feed_title": item.xpath('normalize-space(.//div[@class="wd_title"]/a)').get(),
                }
        fresh = self.new_on_listing(list(cards))
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article, cb_kwargs=cards[url])
        if fresh and self.budget_left and page < self.page_cap(30):
            yield self.listing_request(page + 1)
