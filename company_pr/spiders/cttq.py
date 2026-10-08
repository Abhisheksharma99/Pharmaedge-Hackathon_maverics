import scrapy

from crawler.base import NewsSpider


class CttqSpider(NewsSpider):
    name = "cttq"
    allowed_domains = ["www.cttq.com"]
    title_xpath = '//div[@class="n_left"]//h2[@class="_title"]//text()'
    date_xpath = '//div[@class="n_left"]//span[@class="_tool"][1]/text()'
    content_xpath = '//div[contains(@class, "myart")]'

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://www.cttq.com/en/ext/ajax_list.jsp?cid=15785&page_index={page}&page_size=6",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        hrefs = response.xpath("//a[@class='_list_box']/@href").getall()
        new = self.new_on_listing(response.urljoin(f"/en/news/{h}") for h in hrefs)
        for url in new:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if new and self.budget_left and page < self.page_cap(20):
            yield self.listing_request(page + 1)
