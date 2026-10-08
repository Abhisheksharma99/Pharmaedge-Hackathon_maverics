import scrapy

from crawler.base import NewsSpider


class LongbioSpider(NewsSpider):
    name = "longbio"
    allowed_domains = ["longbio.com"]
    title_xpath = '//div[@class="m-article1"]/div[contains(@class,"g-titc1")]//text()'
    date_xpath = '//div[@class="m-article1"]//div[@class="left"]/div[@class="date"]/text()'
    content_xpath = '//div[@class="m-article1"]//div[@class="txt"]/div[@class="desc"]'

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            f"http://www.longbio.com/news.html?page={page}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        links = [response.urljoin(u) for u in response.xpath('//ul[@class="ul-newslist"]/li/a/@href').getall()]
        fresh = self.new_on_listing(links)  # empty past the last page
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if fresh and self.budget_left and page < self.page_cap(20):
            yield self.listing_request(page + 1)
