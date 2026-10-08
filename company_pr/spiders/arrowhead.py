import scrapy

from crawler.base import NewsSpider


class ArrowheadSpider(NewsSpider):
    """The newsroom page lists every release (2011 onwards, newest first) on
    one HTML page. Bodies of old (pre-2016) releases contain unclosed tags that
    swallow the site footer, so the body is cut at <footer>."""

    name = "arrowhead"
    allowed_domains = ["arrowheadpharma.com"]

    async def start(self):
        yield scrapy.Request("https://arrowheadpharma.com/en-us/newsroom", callback=self.parse_listing)

    def parse_listing(self, response):
        for row in response.xpath('//div[@class="news"]'):
            if not self.budget_left:
                break
            href = row.xpath("./a[h2]/@href").get()
            if not href or not self.want(response.urljoin(href)):
                continue
            yield response.follow(
                href,
                callback=self.parse_release,
                cb_kwargs={
                    "title": " ".join(row.xpath("./a/h2//text()").getall()),
                    "date": row.xpath('./p[@class="date"]/text()').get(),
                },
            )

    def parse_release(self, response, title, date):
        content = response.xpath('//section[contains(@class,"news-article")]').get() or ""
        yield self.make_item(response, title=title, date=date, content=content.split("<footer", 1)[0])
