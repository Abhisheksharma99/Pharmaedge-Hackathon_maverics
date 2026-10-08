"""Pfizer press releases (archive back to 2011). Cloudflare requires impersonation.

Cloudflare serves /newsroom/press-releases from a cache that ignores the query
string (every ?page= returns page 1) and /views/ajax fails for uncached
requests. The same Drupal node under its internal path (/node/<id>, read from
the page's drupal-settings JSON) honours the pager, so the listing is walked
there, 48 per page.
"""

import json
import time

import scrapy

from crawler.base import NewsSpider

LISTING_URL = "https://www.pfizer.com/newsroom/press-releases"
LINKS_XPATH = '//div[contains(@class,"press-releases-search-results")]//ul/li//h5/a/@href'


class PfizerSpider(NewsSpider):
    name = "pfizer"
    allowed_domains = ["pfizer.com"]
    impersonate = "chrome"
    # Impersonated requests skip DOWNLOAD_DELAY/AutoThrottle, so cap concurrency
    # to stay under the CDN rate limit on full-history runs.
    custom_settings = {"CONCURRENT_REQUESTS": 4}
    title_xpath = '//h1[contains(@class,"article-title")]//text()'
    date_xpath = '//div[contains(@class,"article-date")]/text()'
    content_xpath = '//div[contains(@class,"article-body") and contains(@class,"copy-clipboard")]'
    tags_xpath = '//*[@id="press-release-archive-container"]/article/div[1]/ul//text()'

    async def start(self):
        yield scrapy.Request(LISTING_URL, callback=self.parse_landing)

    def parse_landing(self, response):
        settings = json.loads(
            response.xpath('//script[@data-drupal-selector="drupal-settings-json"]/text()').get("{}")
        )
        node = settings.get("path", {}).get("currentPath") or "node/558302"
        # Cloudflare also caches /node/<id> pages for a day; a per-run
        # parameter keeps page 0 fresh.
        self.listing_url = f"{response.urljoin('/' + node)}?items_per_page=48&_={int(time.time())}&page="
        yield self.listing_request(0)

    def listing_request(self, page):
        return scrapy.Request(
            f"{self.listing_url}{page}", callback=self.parse_listing, cb_kwargs={"page": page}
        )

    def parse_listing(self, response, page):
        links = [response.urljoin(u) for u in response.xpath(LINKS_XPATH).getall()]
        fresh = self.new_on_listing(links)
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if fresh and self.budget_left and page < self.page_cap(50):
            yield self.listing_request(page + 1)
