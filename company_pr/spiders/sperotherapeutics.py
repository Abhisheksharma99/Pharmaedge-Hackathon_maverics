"""Spero publishes through a B2i widget (sperotx.com/investors); the widget's
headline feed and the pressviewer.com article pages answer 410 to Scrapy's TLS
fingerprint, hence impersonate. The feed holds every release since the 2017 IPO."""

import re

import scrapy

from crawler.base import NewsSpider


class SperotherapeuticsSpider(NewsSpider):
    name = "sperotherapeutics"
    impersonate = "chrome"
    date_order = "MDY"
    feed = "https://www.b2i.us/b2i/LibraryFeed.asp?b=2748&i=50&sd=1&p={page}"
    title_xpath = '//td[@class="b2iNewsStoryHeadline"]//text()'
    date_xpath = '//td[@class="b2iNewsStoryDate"]//text()'
    # Some releases use a <td> body instead of the <div>.
    content_xpath = (
        '//div[@class="b2iNewsItemBodyDiv"]'
        ' | //td[@class="b2iNewsStoryBody"][not(.//div[@class="b2iNewsItemBodyDiv"])]'
    )

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            self.feed.format(page=page), callback=self.parse_listing, cb_kwargs={"page": page}
        )

    def parse_listing(self, response, page):
        rows = {}
        for link in response.xpath('//td[contains(@class,"HeadlineCell")]/a'):
            # href="Javascript:OpenApiStory('https://www.pressviewer.com/...','');"
            m = re.search(r"OpenApiStory\('([^']+)'", link.attrib.get("href", ""))
            if m:
                date = link.xpath('../../preceding-sibling::tr[1]/td[contains(@class,"DateCell")]/text()').get()
                rows[m[1]] = (link.attrib.get("title"), date)
        fresh = self.new_on_listing(rows)
        for url in fresh:
            if self.want(url):
                title, date = rows[url]
                yield scrapy.Request(
                    url, callback=self.parse_article, cb_kwargs={"feed_title": title, "feed_date": date}
                )
        if fresh and self.budget_left and page < self.page_cap(20):
            yield self.listing_request(page + 1)
