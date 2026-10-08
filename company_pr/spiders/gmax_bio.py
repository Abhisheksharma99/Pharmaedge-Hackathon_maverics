"""Article pages carry no date; it comes from the listing ("2022" + "December 14").
The listing is not in date order (2014-2018 items follow the 2018-2022 ones), so
all of its pages are read before the newest articles are requested."""

import scrapy

from crawler.base import NewsSpider
from crawler.helpers import parse_date


class GmaxBioSpider(NewsSpider):
    name = "gmax_bio"
    allowed_domains = ["gmaxbiopharm.com"]
    title_xpath = '//div[@class="neiyetitle"]//text()'
    content_xpath = '//div[@class="procontent"]'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.found = {}  # article url -> listing date

    async def start(self):
        yield self.listing_request("https://www.gmaxbiopharm.com/newslist.html", 1)

    def listing_request(self, url, page):
        return scrapy.Request(
            url, callback=self.parse_listing, errback=self.listing_failed, cb_kwargs={"page": page}
        )

    def parse_listing(self, response, page):
        dates = {}
        for link in response.xpath('//p[contains(@class, "lanziziti")]/a'):
            year, month_day = (link.xpath("ancestor::tr[1]/td[1]//td/text()").getall() + ["", ""])[:2]
            dates[response.urljoin(link.attrib["href"])] = parse_date(f"{month_day} {year}") or ""
        new = self.new_on_listing(dates)
        self.found.update((url, dates[url]) for url in new)
        next_page = response.xpath('//div[@class="contentPage"]/a[@class="next"]/@href').get()
        if new and next_page and page < self.page_cap(10):
            yield self.listing_request(response.urljoin(next_page), page + 1)
        else:
            yield from self.request_articles()

    def listing_failed(self, failure):
        self.logger.error(f"Listing page failed: {failure.request.url}: {failure.value!r}")
        yield from self.request_articles()

    def request_articles(self):
        for url, date in sorted(self.found.items(), key=lambda e: e[1], reverse=True):
            if not self.budget_left:
                break
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article, cb_kwargs={"feed_date": date})
