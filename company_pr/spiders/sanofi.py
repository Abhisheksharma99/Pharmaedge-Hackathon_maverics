"""Sanofi press releases from the English sitemap (the site's archive starts in January 2020).

Every sitemap <lastmod> is the crawl day, so articles are ordered by the
publication timestamp embedded in the URL (.../press-releases/2026/2026-10-06-05-30-00-<id>).
"""

import re

import scrapy

from crawler.base import NewsSpider

ARTICLE_RE = re.compile(r"/media-room/press-releases/\d{4}/(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})-\d+$")


class SanofiSpider(NewsSpider):
    name = "sanofi"
    allowed_domains = ["sanofi.com"]
    title_xpath = '//h1[@id="pressrelease-heading"]//text()'
    date_xpath = '//*[@id="pressrelease-date"]//text()'
    content_xpath = '(//div[contains(@class,"css-1blu0l0-MuiGrid2-root")])[1]'

    async def start(self):
        yield scrapy.Request("https://www.sanofi.com/assets/sitemap.en.xml", callback=self.parse_sitemap)

    def parse_sitemap(self, response):
        response.selector.remove_namespaces()
        urls = [u.strip() for u in response.xpath("//url/loc/text()").getall()]
        stamps = {u: m[1] for u in urls if (m := ARTICLE_RE.search(u))}
        since = self.settings.get("PR_SINCE")
        self.logger.info(f"{len(stamps)} press releases in sitemap")
        for url in sorted(stamps, key=stamps.get, reverse=True):
            if not self.budget_left or (since and stamps[url][:10] < since):
                break
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
