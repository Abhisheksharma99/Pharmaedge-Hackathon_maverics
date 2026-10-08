"""AstraZeneca press releases.

The listing JSON (newest first, with dates) only covers the last ~2 years;
when budget is left (e.g. --limit 0) the remaining releases, back to 2009,
come from the sitemap.
"""

import re

import scrapy

from crawler.base import NewsSpider

LISTING_PAGE = "https://www.astrazeneca.com/media-centre/press-releases.html"
ARTICLE_RE = re.compile(r"/media-centre/press-releases/(\d{4})/[^/]+\.html$")


class AstraZenecaSpider(NewsSpider):
    name = "astra_zeneca"
    allowed_domains = ["www.astrazeneca.com"]
    title_xpath = '//h1/div[@class="l-constrained"]//text()'
    date_xpath = '//span[@class="date__date"]/text()'
    # Some releases put the body in a two-column "videoPar" block above articleBody.
    content_xpath = (
        '//div[contains(@class,"videoPar")]//div[contains(@class,"l-two-block--offset-left-c0")]'
        ' | //div[@itemprop="articleBody"]/div[contains(@class,"parsys")]'
    )
    tags_xpath = '//li[@class="tags__list-item"]/text()'

    # Every request sends the listing page as Referer: Akamai answers 403 when
    # it is the JSON endpoint (Scrapy's default for follow-up requests).

    async def start(self):
        yield scrapy.Request(
            "https://www.astrazeneca.com/content/astraz/media-centre/press-releases/_jcr_content/par/filternew.data.json",
            callback=self.parse_listing,
            headers={"Accept": "application/json", "X-Requested-With": "XMLHttpRequest", "Referer": LISTING_PAGE},
        )

    def parse_listing(self, response):
        articles = sorted(response.json(), key=lambda a: a.get("dateTime") or "", reverse=True)
        for article in articles:
            if not self.budget_left:
                break
            # "/content/astraz/media-centre/..." redirects to the public "/media-centre/..." URL.
            url = response.urljoin(article["link"].replace("/content/astraz/", "/", 1))
            if self.want(url):
                yield self.article_request(url, article.get("dateTime"), article.get("title"))
        if self.budget_left:
            yield scrapy.Request(
                "https://www.astrazeneca.com/azcomsitemap.xml",
                callback=self.parse_sitemap,
                headers={"Referer": LISTING_PAGE},
            )

    def parse_sitemap(self, response):
        response.selector.remove_namespaces()
        entries = []
        for node in response.xpath("//url"):
            url = node.xpath("normalize-space(loc)").get()
            if m := ARTICLE_RE.search(url):
                entries.append((m[1], node.xpath("normalize-space(lastmod)").get(), url))
        self.logger.info(f"{len(entries)} press releases in sitemap")
        for _, _, url in sorted(entries, reverse=True):  # by year in the URL, then lastmod
            if not self.budget_left:
                break
            if self.want(url):
                yield self.article_request(url)

    def article_request(self, url, date=None, title=None):
        return scrapy.Request(
            url,
            callback=self.parse_article,
            cb_kwargs={"feed_date": date, "feed_title": title},
            headers={"Referer": LISTING_PAGE},
        )
