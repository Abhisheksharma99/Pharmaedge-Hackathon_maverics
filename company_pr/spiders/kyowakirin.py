"""Kyowa Kirin news releases, from the site's release index (2008 onwards).

Besides HTML releases the index links PDF-only releases (kyowakirin.com,
ir.kyowakirin.com, data.swcms.net) and a few Orchard Therapeutics (subsidiary)
releases on its IR site. Financial statements, results slide decks and links
to the earnings library are skipped.
"""

import re
from datetime import date

import scrapy

from crawler.base import NewsSpider

NOT_RELEASES = re.compile(
    r"consolidated financial|financial statements|financial summary|appendix to|results? presentation"
    r"|presentation materials|results meeting|correction of figure|notice of revisions to the (appendix|figures)",
    re.I,
)


class KyowakirinSpider(NewsSpider):
    name = "kyowakirin"
    title_xpath = 'string(//div[@class="box-newsrelease-title"]/h1)'
    content_xpath = (
        '//article[@class="box-newsrelease"]/*[not(contains(@class, "box-newsrelease-title"))]'
        ' | //article[contains(@class, "node--nir-news--full")]'  # Orchard IR pages
        '/div[@class="node__content"]/*[not(contains(@class, "box__wrap"))]'
    )

    async def start(self):
        yield scrapy.Request(
            "https://www.kyowakirin.com/media_center/share/json/release.json",
            callback=self.parse_index,
        )

    def parse_index(self, response):
        releases = []
        for article in response.json():
            if not article.get("url"):
                continue
            url = response.urljoin(article["url"])
            title = re.sub(r"<[^>]+>", "", article.get("ttl") or "").strip()
            is_pdf = url.lower().endswith(".pdf")
            if article.get("type") != "normal" and not is_pdf and "/news-release-details/" not in url:
                continue  # earnings library and other non-release links
            if is_pdf and NOT_RELEASES.search(title):
                continue
            d = article.get("date") or {}
            try:
                day = date(int(d["year"]), int(d["month"]), int(d["day"])).isoformat()
            except (KeyError, TypeError, ValueError):
                continue
            releases.append((day, url, title, article.get("category"), is_pdf))
        releases.sort(key=lambda r: r[0], reverse=True)
        for day, url, title, tags, is_pdf in releases:
            if not self.budget_left:
                break
            if self.want(url):
                yield scrapy.Request(
                    url,
                    callback=self.parse_pdf if is_pdf else self.parse_release,
                    cb_kwargs={"day": day, "title": title, "tags": tags},
                    meta={"impersonate": "chrome"} if "orchard-tx.com" in url else {},
                )

    def parse_release(self, response, day, title, tags):
        for item in self.parse_article(response, feed_date=day, feed_title=title):
            item["tags"] = tags
            yield item

    def parse_pdf(self, response, day, title, tags):
        # Dead PDF links redirect to an HTML home page; pdf_item drops those.
        item = self.pdf_item(response, title=title, date=day, tags=tags)
        if item:
            item["news_url"] = response.meta.get("redirect_urls", [response.url])[0]  # as listed
            yield item
