import scrapy

from crawler.base import NewsSpider


class GosunchinaSpider(NewsSpider):
    name = "gosunchina"
    allowed_domains = ["gosunchina.com"]
    title_xpath = '//div[@class="news_info"]//h1//text()'
    date_xpath = '//div[@class="news_info"]//h5/text()'
    content_xpath = '//div[@class="news_info"]//div[@class="info"]'

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://www.gosunchina.com/en/CompanyNews/list.aspx?page={page}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        links = [response.urljoin(u) for u in response.xpath('//ul[@class="clearfix slickul"]/li//a/@href').getall()]
        fresh = self.new_on_listing(dict.fromkeys(links))  # empty past the last page
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        has_next = response.xpath(f'//a[contains(@href,"list.aspx?page={page + 1}")]')
        if fresh and has_next and self.budget_left and page < self.page_cap(20):
            yield self.listing_request(page + 1)
