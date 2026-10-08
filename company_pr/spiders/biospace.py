"""BioSpace "Deals" and "Latest News & Press Releases".

Normal runs walk the two listings: the old ``?p=<n>`` pagination is ignored by
the site now; each list has a "Load More" button whose ``data-url``
(``?p=<list-id>.<page>``) returns the next page.

Full-history runs (--limit 0) read the monthly sitemaps instead (sitemap-YYYYMM,
October 2005 onwards): ~890k URLs, almost all press releases. They are read one
month at a time, newest first, so memory stays small; --since skips the older
months.
"""

import re

import scrapy

from crawler.base import NewsSpider
from crawler.helpers import parse_feed

LISTINGS = [
    "https://www.biospace.com/deals",
    "https://www.biospace.com/latest-news-press-releases",
]
SITEMAP_INDEX = "https://www.biospace.com/sitemap.xml"
CTA = "Help employers find you"  # job-board plug at the end of old press releases


class BiospaceSpider(NewsSpider):
    name = "biospace"
    category = "news"
    allowed_domains = ["www.biospace.com"]
    # Non-article pages listed in the sitemaps.
    url_exclude = [
        f"biospace.com/{path}" for path in (
            "employer/", "employer-resources/", "events/", "tag/", "advertise",
            "career-events", "our-community", "hotbed-map-campaigns", "insights/",
        )
    ]
    title_xpath = '//h1[@class="Page-headline"]//text()'
    date_xpath = '//meta[@property="article:published_time"]/@content'
    tags_xpath = '//meta[@property="article:section"]/@content'
    # node(): older articles keep their text directly in the body, between <br>s.
    content_xpath = (
        '//div[@class="Page-articleBody"]/h2'
        ' | //div[@class="Page-articleBody"]//div[contains(@class,"RichTextArticleBody")]/node()'
        '[not(contains(@class,"Promo") or contains(@class,"GoogleDfpAd") or contains(@class,"HtmlModule"))]'
        f'[not(contains(., "{CTA}")) and not(preceding-sibling::node()[contains(., "{CTA}")])]'
    )

    async def start(self):
        if not self.limit:
            yield scrapy.Request(SITEMAP_INDEX, callback=self.parse_sitemap_index)
            return
        for url in LISTINGS:
            yield scrapy.Request(url, callback=self.parse_listing)

    def parse_listing(self, response):
        links = response.xpath(
            '//div[@class="PageList-items-item"]//div[contains(@class,"PagePromo-title")]//a/@href'
        ).getall()
        fresh = self.new_on_listing([response.urljoin(url) for url in links])
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if not fresh or not self.budget_left:
            return
        for next_page in response.xpath("//*[@data-list-loadmore-pagination]//button/@data-url").getall():
            page = re.search(r"\.(\d+)$", next_page)
            if page and int(page[1]) <= self.page_cap(10):
                yield response.follow(next_page, callback=self.parse_listing)

    def parse_article(self, response, **kwargs):
        # The sitemaps also list landing/marketing pages (og:type "website").
        if response.xpath('//meta[@property="og:type"]/@content').get() == "article":
            yield from super().parse_article(response, **kwargs)

    # ---- full history -------------------------------------------------------

    def parse_sitemap_index(self, response):
        _, sitemaps = parse_feed(response.body)
        since = (self.settings.get("PR_SINCE") or "")[:7].replace("-", "")
        months = sorted(
            (loc for loc, _, _ in sitemaps if (m := re.search(r"sitemap-(\d{6})\.xml", loc)) and m[1] >= since),
            reverse=True,
        )
        yield from self.next_sitemap([loc for loc, _, _ in sitemaps if "sitemap-latest" in loc] + months)

    def next_sitemap(self, pending):
        if pending:
            # Low priority: the next month is only fetched once this one's articles are queued.
            yield scrapy.Request(pending[0], callback=self.parse_sitemap, cb_kwargs={"pending": pending[1:]}, priority=-1)

    def parse_sitemap(self, response, pending):
        _, entries = parse_feed(response.body)
        self.logger.info(f"{response.url}: {len(entries)} entries")
        since = self.settings.get("PR_SINCE") or ""
        for url, lastmod, _ in entries:
            if (lastmod or "9")[:10] < since or any(x in url for x in self.url_exclude):
                continue  # last modified before --since, so published before it too
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        yield from self.next_sitemap(pending)
