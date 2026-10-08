"""Bristol Myers Squibb press releases from the Q4 press-release API (Cloudflare: needs impersonation).

The API returns each release's full body (bodyType=2), newest first, for the
whole archive (2008 onwards), so no article pages are fetched: crawling them
one by one quickly trips Cloudflare's rate limit (HTTP 429).
"""

from urllib.parse import urlencode

import scrapy

from crawler.base import NewsSpider

API_URL = "https://news.bms.com/feed/PressRelease.svc/GetPressReleaseList?"


class BristolMyersSquibbSpider(NewsSpider):
    name = "bristol_myers_squibb"
    allowed_domains = ["news.bms.com"]
    impersonate = "chrome"
    date_order = "MDY"

    async def start(self):
        yield self.api_request(0)

    def api_request(self, page):
        params = {
            "LanguageId": 1,
            "bodyType": 2,
            "pressReleaseDateFilter": 3,
            "categoryId": "00000000-0000-0000-0000-000000000000",
            "pageSize": min(self.limit or 50, 50),
            "pageNumber": page,
            "tagList": "",
            "includeTags": "true",
            "year": -1,
            "excludeSelection": 1,
        }
        return scrapy.Request(
            API_URL + urlencode(params),
            callback=self.parse_api,
            cb_kwargs={"page": page},
            headers={"Accept": "application/json"},
        )

    def parse_api(self, response, page):
        releases = {
            response.urljoin(r["LinkToDetailPage"]): r
            for r in response.json().get("GetPressReleaseListResult") or []
            if r.get("LinkToDetailPage")
        }
        fresh = self.new_on_listing(releases)
        for url in fresh:
            if self.want(url):
                release = releases[url]
                yield self.make_item(
                    url=url,
                    title=release.get("Headline"),
                    date=release.get("PressReleaseDate"),
                    content=release.get("Body"),
                    tags=release.get("TagsList"),
                )
        if fresh and self.budget_left and page < self.page_cap(50):
            yield self.api_request(page + 1)
