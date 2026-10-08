"""Roche investor updates: URLs from the sitemap, content from Roche's news JSON API.

roche_med_cor is the twin spider for media releases (med-cor-* slugs).
The sitemap holds the whole archive the API serves (2016 onwards).
"""

import scrapy

from crawler.base import NewsSpider
from crawler.helpers import parse_feed


class RocheInvUpdateSpider(NewsSpider):
    name = "roche_inv_update"
    channel = "roche"
    aggregator_source = "roche"
    url_prefix = "https://www.roche.com/investors/updates/inv-update-"
    api_url = "https://api-prod.roche.com/externaldatasources/news/"

    async def start(self):
        yield scrapy.Request("https://www.roche.com/sitemap-0.xml", callback=self.parse_sitemap)

    def parse_sitemap(self, response):
        _, entries = parse_feed(response.body)
        urls = {loc.strip() for loc, _, _ in entries if loc.strip().startswith(self.url_prefix)}
        # Slugs are <prefix>YYYY-MM-DD[b|c|d], so a reverse sort is newest first.
        for url in sorted(urls, reverse=True):
            if not self.budget_left:
                break
            if self.want(url):
                slug = url.rsplit("/", 1)[-1]
                yield scrapy.Request(self.api_url + slug, callback=self.parse_api, cb_kwargs={"url": url})

    def parse_api(self, response, url):
        data = response.json()
        fields = {
            "title": (data.get("Title") or {}).get("en"),
            "date": data.get("ReleaseDate") or data.get("ReleaseDateTime"),
            "modified_date": data.get("ModifiedDate"),
            "tags": [data["Category"]] if data.get("Category") else None,
        }
        content = (data.get("Content") or {}).get("en")
        attachments = (data.get("Attachments") or {}).get("en") or []
        pdfs = [a["Url"] for a in attachments if a.get("Url") and a.get("MimeType") == "application/pdf"]
        if not content and pdfs:  # a few releases only exist as the attached PDF
            yield scrapy.Request(pdfs[0], callback=self.parse_pdf, cb_kwargs={"url": url, "fields": fields})
        else:
            yield self.make_item(url=url, content=content, **fields)

    def parse_pdf(self, response, url, fields):
        item = self.pdf_item(response, **fields)
        if item:
            item["news_url"] = url
            yield item
