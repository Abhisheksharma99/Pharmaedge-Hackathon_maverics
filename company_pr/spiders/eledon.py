from urllib.parse import urlencode

import scrapy

from crawler.base import NewsSpider


class EledonSpider(NewsSpider):
    name = "eledon"
    impersonate = "chrome"
    allowed_domains = ["ir.eledon.com"]
    listing_url = "https://ir.eledon.com/news-and-events/press-releases"
    date_order = "MDY"  # listing dates look like 10/05/2026

    async def start(self):
        yield scrapy.Request(self.listing_url, callback=self.parse_filters)

    def parse_filters(self, response):
        # The listing defaults to the current year; "_none" on its year filter
        # pages through all years (back to 2016, incl. Tokai/Novus releases).
        year_field = response.xpath('//select[contains(@id,"year-value")]/@name').get()
        if not year_field:
            self.logger.warning("Year filter not found: only the current year is listed")
        yield self.listing_request({year_field: "_none"} if year_field else {}, 0)

    def listing_request(self, params, page):
        return scrapy.Request(
            f"{self.listing_url}?{urlencode({**params, 'page': page})}",
            callback=self.parse_listing,
            cb_kwargs={"params": params, "page": page},
        )

    def parse_listing(self, response, params, page):
        new = 0
        for row in response.xpath("//table//tbody//tr"):
            link = row.xpath('.//td[@data-before="Title"]//a')
            href = link.attrib.get("href", "")
            url = response.urljoin(href)
            if not href.startswith("/") or not self.new_on_listing([url]):
                continue
            new += 1
            if self.want(url):
                yield scrapy.Request(
                    url,
                    callback=self.parse_release,
                    cb_kwargs={
                        "title": link.xpath("string()").get(),
                        "date": row.xpath('./td[@data-before="Date"]/text()').get(),
                    },
                )
        if new and self.budget_left and page + 1 < self.page_cap(60):
            yield self.listing_request(params, page + 1)

    def parse_release(self, response, title, date):
        content = response.xpath('//div[@class="full-release-body"]').get()
        yield self.make_item(response, title=title, date=date, content=content)
