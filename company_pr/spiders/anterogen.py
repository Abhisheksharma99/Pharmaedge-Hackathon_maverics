import scrapy

from crawler.base import NewsSpider


class AnterogenSpider(NewsSpider):
    name = "anterogen"
    channel = "Anterogen"
    aggregator_source = "Anterogen"
    allowed_domains = ["anterogen.com"]

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://anterogen.com/modules/bbs/index.php?page={page}&code=bbs_notice",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        posts = {}  # stable URL -> listing row (the link embeds the listing page number)
        for row in response.xpath('//div[@id="bbs_body"]//tr[@class="bbs_div"]'):
            post_id = row.xpath(".//td/a/@href").re_first(r"\bid=(\d+)")
            if post_id:
                posts[f"https://anterogen.com/modules/bbs/bbsView.php?id={post_id}&code=bbs_notice"] = row
        fresh = self.new_on_listing(posts)  # empty past the last page
        for url in fresh:
            if self.want(url):
                row = posts[url]
                yield scrapy.Request(
                    url,
                    callback=self.parse_news,
                    cb_kwargs={
                        "title": row.xpath("normalize-space(.//td/a)").get(),
                        "date": row.xpath(".//td/text()").re_first(r"\d{4}-\d{2}-\d{2}"),
                    },
                )
        if fresh and self.budget_left and page < self.page_cap(30):
            yield self.listing_request(page + 1)

    def parse_news(self, response, title, date):
        body = response.xpath('//div[@id="DivAndPrint"]')
        yield self.make_item(
            response,
            title=title,
            date=body.xpath("normalize-space(.//table[4]//tr[1]/td[2])").get() or date,
            content=body.xpath('.//td[@class="viewBody"]').get(),
        )
