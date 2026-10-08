"""European Pharmaceutical Review news.

The site moved to a new CMS: the old news-sitemap*.xml files are gone, new
article URLs (``/<slug>/<id>.article``) no longer contain ``/news/`` and
pre-2023 articles were deleted (their old URLs answer 410). The "more news"
listing is paginated, newest first, and reaches back to January 2023 (~80
pages of 20).
"""

import scrapy

from crawler.base import NewsSpider


class EupharmareviewSpider(NewsSpider):
    name = "eupharmareview"
    category = "news"
    allowed_domains = ["www.europeanpharmaceuticalreview.com"]
    # Anonymous readers get a few free articles per session cookie, then a paywall.
    custom_settings = {"COOKIES_ENABLED": False}
    title_xpath = "//h1//text()"
    date_xpath = '//*[contains(@class,"byline")]//span[@class="date"]/text()'
    content_xpath = '//div[@class="storytext"]'
    tags_xpath = '//*[contains(@class,"topicsList")]//a/text()'

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            "https://www.europeanpharmaceuticalreview.com/more-news/166.more"
            f"?navcode=164&page={page}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        links = response.xpath('//div[@class="listBlocks"]//div[@class="storyDetails"]/h3/a/@href').getall()
        fresh = self.new_on_listing([response.urljoin(url) for url in links])
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if fresh and self.budget_left and page < self.page_cap(30):
            yield self.listing_request(page + 1)
