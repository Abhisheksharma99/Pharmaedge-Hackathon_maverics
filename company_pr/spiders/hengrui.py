"""The English news JSON API already contains the full article HTML ("remarks")."""

import scrapy

from crawler.base import NewsSpider

PAGE_SIZE = 10


class HengruiSpider(NewsSpider):
    name = "hengrui"
    allowed_domains = ["hengrui.com"]

    async def start(self):
        yield self.api_request(1)

    def api_request(self, page):
        return scrapy.FormRequest(
            "https://www.hengrui.com/data/pages.aspx?typeName=news_list&tp=1",
            formdata={"pageid": str(page), "pagecount": str(PAGE_SIZE)},
            headers={"X-Requested-With": "XMLHttpRequest", "Accept": "application/json, */*"},
            callback=self.parse_api,
            cb_kwargs={"page": page},
            dont_filter=True,
        )

    def parse_api(self, response, page):
        entries = {
            f"https://www.hengrui.com/en/media/detail-{e['id']}.html": e
            for e in response.json().get("data") or []
        }
        new = self.new_on_listing(entries)
        for url in new:
            entry = entries[url]
            if entry.get("remarks") and self.want(url):
                yield self.make_item(
                    url=url,
                    title=entry["title"],
                    date=entry["addtime"],
                    content=entry["remarks"],
                )
        if new and self.budget_left and page < self.page_cap(30):
            yield self.api_request(page + 1)
