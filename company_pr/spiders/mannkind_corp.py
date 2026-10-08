import scrapy

from crawler.base import NewsSpider


class MannkindCorpSpider(NewsSpider):
    name = "mannkind_corp"
    allowed_domains = ["investors.mannkindcorp.com"]
    impersonate = "chrome"  # Scrapy's TLS fingerprint gets a 403
    # Impersonated requests bypass Scrapy's per-site delay/AutoThrottle, and the
    # site answers 403 to bursts: fetch one page at a time, retry 403s.
    custom_settings = {
        "CONCURRENT_REQUESTS": 1,
        "RETRY_HTTP_CODES": [500, 502, 503, 504, 522, 524, 408, 429, 403],
    }
    date_order = "MDY"  # "09/09/26"
    title_xpath = '//div[contains(@class,"field--name-field-nir-news-title")]//text()'
    date_xpath = '//div[contains(@class,"field--name-field-nir-news-date")]//text()'
    content_xpath = '//article[contains(@class,"node--nir-news--full")]//div[@class="node__content"]'

    async def start(self):
        yield self.listing_request(0)

    def listing_request(self, page):
        return scrapy.Request(
            f"https://investors.mannkindcorp.com/press-releases?page={page}",
            callback=self.parse_listing,
            cb_kwargs={"page": page},
        )

    def parse_listing(self, response, page):
        links = response.xpath('//div[contains(@class,"list")]/article[@data-title]//a/@href').getall()
        fresh = self.new_on_listing(response.urljoin(u) for u in links)
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if fresh and self.budget_left and page < self.page_cap(60):
            yield self.listing_request(page + 1)
