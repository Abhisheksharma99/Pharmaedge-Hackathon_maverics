"""PharmaTimes news listing.

The listing is newest first and reaches back to 2005 (~2,000 pages of 15
articles; past the end it answers an empty page). The Yoast sitemaps are not
an alternative: they are stale (nothing newer than January 2026). The site
answers 429 to bursts of requests, hence the slow pace.
"""

import scrapy

from crawler.base import NewsSpider


class PharmatimesSpider(NewsSpider):
    name = "pharmatimes"
    category = "news"
    allowed_domains = ["pharmatimes.com"]
    custom_settings = {"DOWNLOAD_DELAY": 1.5, "CONCURRENT_REQUESTS_PER_DOMAIN": 1}
    title_xpath = '//h1[@class="entry-title"]//text()'
    date_xpath = '//meta[@property="article:published_time"]/@content'
    content_xpath = (
        '//div[contains(@class,"et_pb_row_inner_1_tb_body")]'
        '//div[contains(@class,"et_pb_text_0_tb_body") or contains(@class,"et_pb_post_content")]'
    )

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://pharmatimes.com/news/page/{page}/?et_blog",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        links = response.xpath('//div[@class="dg-blog-grid"]/article[contains(@id,"post")]//a/@href').getall()
        fresh = self.new_on_listing([response.urljoin(url) for url in dict.fromkeys(links)])
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if fresh and self.budget_left and page < self.page_cap(40):
            yield self.listing_request(page + 1)
