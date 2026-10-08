"""The old WordPress site (/category/release/) was replaced by a page-builder
site; English press releases now live under /en/news. Releases from the old
site (2021-2023) were not carried over and are no longer online."""

import json

import scrapy

from crawler.base import NewsSpider


class AlebundSpider(NewsSpider):
    name = "alebund"
    allowed_domains = ["alebund.com"]

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://www.alebund.com/en/news?page={page}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        listing = response.xpath('//div[contains(@class, "general_list")]')
        items = {
            response.urljoin(a.attrib["href"]): a
            for a in listing.xpath('.//a[contains(@class, "general_item")]')
        }
        new = self.new_on_listing(items)
        for url in new:
            if self.want(url):
                item = items[url]
                yield scrapy.Request(
                    url,
                    callback=self.parse_article,
                    cb_kwargs={
                        "feed_title": item.xpath('normalize-space(.//h4[@class="general_title"])').get(),
                        "feed_date": item.xpath('.//time[@class="time_box"]/text()').get(),
                    },
                )
        total = int(listing.attrib.get("data-total") or 0)
        size = int(listing.attrib.get("data-pagesize") or 10)
        more = not total or page * size < total
        if new and more and self.budget_left and page < self.page_cap(30):
            yield self.listing_request(page + 1)

    def parse_article(self, response, feed_title=None, feed_date=None):
        meta = {}
        for raw in response.xpath('//script[@type="application/ld+json"]/text()').getall():
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            if isinstance(data, dict) and data.get("@type") == "NewsArticle":
                meta = data
        # The first text block repeats the title/date; the rest is the release.
        body = response.xpath(
            '(//section[contains(@class, "general_detail_part_1")]'
            '//section[contains(@class, "layout-text-block")])[position() > 1]'
        ).getall()
        yield self.make_item(
            response,
            title=meta.get("headline") or feed_title,
            date=meta.get("datePublished") or feed_date,
            content="\n".join(body),
        )
