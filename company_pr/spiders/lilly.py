import scrapy

from crawler.base import NewsSpider


class LillySpider(NewsSpider):
    """Lilly press releases from lilly.mediaroom.com (its archive starts in January 2019)."""

    name = "lilly"
    allowed_domains = ["lilly.mediaroom.com"]
    title_xpath = '//div[contains(@class,"wd_title")]//text()'
    date_xpath = '//div[@class="wd_date"]/text()'
    content_xpath = '//div[contains(@class,"wd_news_body")]'

    async def start(self):
        yield self.listing_request(0)

    def listing_request(self, offset):
        return scrapy.Request(
            f"https://lilly.mediaroom.com/index.php?s=9042&o={offset}",
            callback=self.parse_listing,
            cb_kwargs={"offset": offset},
        )

    def parse_listing(self, response, offset):
        links = response.xpath('//li[@class="wd_item"]//div[@class="wd_title"]/a/@href').getall()
        fresh = self.new_on_listing(response.urljoin(u) for u in links)
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if fresh and self.budget_left and offset < self.page_cap(100) * 25:
            yield self.listing_request(offset + 25)
