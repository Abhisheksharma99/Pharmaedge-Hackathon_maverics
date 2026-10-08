"""Chiesi news and press releases (English media hub, back to 2015).

The old /en/media-area/news/ listing is gone; the redesigned media hub splits
it into "news" and "press-release" listings. Page N of every section is
fetched, the cards are merged newest first, then page N+1 is requested.
Past its last page a section repeats that page, which retires the section.
"""

import scrapy

from crawler.base import NewsSpider


class ChiesiSpider(NewsSpider):
    name = "chiesi"
    allowed_domains = ["www.chiesi.com"]
    sections = ["news", "press-release"]
    title_xpath = "//h1//text()"
    date_xpath = '//div[@class="dsc-article-meta"]//time/@datetime'
    content_xpath = '//div[contains(@class, "dsc-article__body")]//div[contains(@class, "dsc-rte")]'
    tags_xpath = '//p[@class="dsc-article-meta__category"]/span[contains(@class, "dsc-tag")]/text()'

    async def start(self):
        yield self.listing_request(self.sections, 1, [], [])

    def listing_request(self, todo, page, cards, active):
        """Page ``page`` of todo[0]; ``active`` collects the sections that
        still had new links on this page."""
        return scrapy.Request(
            f"https://www.chiesi.com/en/media-hub/{todo[0]}.html?page={page}",
            callback=self.parse_listing,
            cb_kwargs={"todo": todo, "page": page, "cards": cards, "active": active},
            meta={"handle_httpstatus_list": [404]},
            dont_filter=True,
        )

    def parse_listing(self, response, todo, page, cards, active):
        found = {}
        for card in response.xpath('//article[contains(@class, "dsc-card")]'):
            href = card.xpath(".//a/@href").get()
            if href:
                found[response.urljoin(href)] = card.xpath(".//time/@datetime").get("")
        fresh = self.new_on_listing(list(found))
        if fresh:
            active = active + [todo[0]]
            cards = cards + [(found[url], url) for url in fresh]
        if todo[1:]:
            yield self.listing_request(todo[1:], page, cards, active)
            return
        for _, url in sorted(cards, reverse=True):
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if active and self.budget_left and page < self.page_cap(30):
            yield self.listing_request(active, page + 1, [], [])
