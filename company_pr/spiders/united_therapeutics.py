"""United Therapeutics (UnitedTX) press releases.

Article pages carry no publish date of their own (the dated cards on them are
"Recent Press Releases"), so the date comes from the listing card. Releases
from before ~2005 exist only as PDFs; parse_article extracts their text.
Out-of-range ?page=N returns page 1 again, hence new_on_listing().
"""

import scrapy

from crawler.base import NewsSpider


class UnitedTherapeuticsSpider(NewsSpider):
    name = "united_therapeutics"
    allowed_domains = ["ir.unither.com"]
    title_xpath = '(//section[contains(@class,"news-pr-content")]//h2)[1]//text()'
    content_xpath = '//section[contains(@class,"news-pr-content")]//div[contains(@class,"content_desc")]'

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://ir.unither.com/press-releases?page={page}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        cards = {}
        for card in response.xpath('//div[contains(@class,"press_release_card")]'):
            link = card.xpath('.//div[contains(@class,"press_release_Date")]/a')
            href = link.xpath("@href").get()
            if href:
                cards[response.urljoin(href)] = (
                    card.xpath('normalize-space(.//p[contains(@class,"label")])').get(),
                    link.xpath("normalize-space(.)").get(),
                )
        fresh = self.new_on_listing(cards)
        for url in fresh:
            if self.want(url):
                date, title = cards[url]
                yield scrapy.Request(
                    url,
                    callback=self.parse_article,
                    cb_kwargs={"feed_date": date, "feed_title": title},
                )
        if fresh and self.budget_left and page < self.page_cap(60):
            yield self.listing_request(page + 1)
