"""Vera press releases. The listing shows only the current year unless its
year filter is set to "All" (field name read from the page), so pagination
runs over the all-years view."""

from urllib.parse import urlencode

import scrapy

from crawler.base import NewsSpider


class VeraSpider(NewsSpider):
    name = "vera"
    allowed_domains = ["ir.veratx.com"]
    impersonate = "chrome"  # Scrapy's TLS fingerprint gets a 403
    # Impersonated requests bypass Scrapy's per-site delay/AutoThrottle, and the
    # site answers 403 to bursts: fetch one page at a time, retry 403s.
    custom_settings = {
        "CONCURRENT_REQUESTS": 1,
        "RETRY_HTTP_CODES": [500, 502, 503, 504, 522, 524, 408, 429, 403],
    }
    listing_url = "https://ir.veratx.com/news-events/press-releases"
    title_xpath = '//div[contains(@class,"field--name-field-nir-news-title")]//text()'
    date_xpath = '//div[contains(@class,"field--name-field-nir-news-date")]//text()'
    content_xpath = '//article[contains(@class,"node--nir-news--full")]//div[@class="node__content"]'

    async def start(self):
        yield scrapy.Request(self.listing_url, callback=self.parse_filter)

    def parse_filter(self, response):
        field = response.xpath('//select[contains(@name,"_year[value]")]/@name').get()
        self.all_years = {field: "_none"} if field else {}
        yield self.listing_request(0)

    def listing_request(self, page):
        return scrapy.Request(
            f"{self.listing_url}?{urlencode({**self.all_years, 'page': page})}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        links = response.xpath(
            '//article[contains(@class,"nir-widget-article")]//div[contains(@class,"news--headline")]//a/@href'
        ).getall()
        fresh = self.new_on_listing(response.urljoin(u) for u in links)
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if fresh and self.budget_left and page < self.page_cap(30):
            yield self.listing_request(page + 1)
