"""Reuters Healthcare & Pharmaceuticals section.

reuters.com is behind DataDome: Scrapy and curl_cffi's "chrome" fingerprint get
401, the "safari" one passes. Article URLs come from the site's own section
JSON API (the listing page markup is client-rendered and changes often). The
API pages back through the whole section (~41k articles, to August 2020) in
steps of at most 20.
"""

import json
from urllib.parse import quote

import scrapy

from crawler.base import NewsSpider

SECTION = "/business/healthcare-pharmaceuticals/"
PAGE_SIZE = 20  # the API's maximum


class ReutersSpider(NewsSpider):
    name = "reuters"
    category = "news"
    impersonate = "safari"
    allowed_domains = ["www.reuters.com"]
    # DataDome answers bursts (~60 pages in 15 s) with short-lived 401s, and the
    # cookie it sets with a 401 would get every later request refused too.
    custom_settings = {
        "COOKIES_ENABLED": False,
        "DOWNLOAD_DELAY": 1,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
        "RETRY_HTTP_CODES": [401, 429, 500, 502, 503, 504, 522, 524, 408],
        "RETRY_TIMES": 5,
    }
    title_xpath = '//h1[@data-testid="Heading"]//text()'
    date_xpath = '//meta[@name="article:published_time"]/@content'
    content_xpath = (
        '//div[contains(@class,"article-body-module__content")]'
        '//*[contains(@class,"article-body-module__paragraph") or contains(@class,"sign-off-module__text")]'
    )

    async def start(self):
        yield self.listing_request(0)

    def listing_request(self, offset):
        query = json.dumps(
            {"offset": offset, "section_id": SECTION, "size": PAGE_SIZE, "website": "reuters"},
            separators=(",", ":"),
        )
        return scrapy.Request(
            "https://www.reuters.com/pf/api/v3/content/fetch/"
            f"articles-by-section-alias-or-id-v1?query={quote(query)}",
            callback=self.parse_listing,
            cb_kwargs={"offset": offset},
        )

    def parse_listing(self, response, offset):
        articles = (response.json().get("result") or {}).get("articles") or []
        links = [response.urljoin(a["canonical_url"]) for a in articles if a.get("canonical_url")]
        fresh = self.new_on_listing(links)
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        # Newest first: stop at the end of the section, or once a page predates --since.
        oldest = (articles[-1].get("published_time") or "")[:10] if articles else ""
        page = offset // PAGE_SIZE + 1
        if (
            fresh and len(articles) == PAGE_SIZE and oldest >= (self.settings.get("PR_SINCE") or "")
            and self.budget_left and page < self.page_cap(10)
        ):
            yield self.listing_request(offset + PAGE_SIZE)
