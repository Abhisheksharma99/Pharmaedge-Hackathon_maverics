"""The press-release page holds every year in tab panels (newest first); the
listing gives the title and day/month, the panel label gives the year."""

import scrapy

from crawler.base import NewsSpider


class MundipharmaSpider(NewsSpider):
    name = "mundipharma"
    allowed_domains = ["www.mundipharma.com"]
    content_xpath = '//div[@class="container"]//div[@class="text"]'

    async def start(self):
        yield scrapy.Request(
            "https://www.mundipharma.com/media/press-releases", callback=self.parse_listing
        )

    def parse_listing(self, response):
        for row in response.xpath('//div[@role="tabpanel"]//tr[td[contains(@class,"press-release")]/a]'):
            url = response.urljoin(row.xpath('./td[contains(@class,"press-release")]/a/@href').get())
            if not self.want(url):
                continue
            year = row.xpath('./ancestor::div[@role="tabpanel"][1]/@aria-labelledby').get()
            day = row.xpath('normalize-space(./td[contains(@class,"display-date")])').get()
            yield scrapy.Request(
                url,
                callback=self.parse_article,
                cb_kwargs={
                    "feed_date": f"{day} {year}" if day and year else None,
                    "feed_title": row.xpath('normalize-space(./td[contains(@class,"title")])').get(),
                },
            )
