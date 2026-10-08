"""post-sitemap1.xml is stale (misses recent releases), so the WordPress REST
API is used; it returns the full article body and the publish date."""

import json

import scrapy

from crawler.base import NewsSpider


class F2gSpider(NewsSpider):
    name = "f2g"
    api = "https://f2g.com/wp-json/wp/v2/posts?per_page=20&page={}"

    async def start(self):
        yield self.api_request(1)

    def api_request(self, page):
        return scrapy.Request(self.api.format(page), callback=self.parse_api, cb_kwargs={"page": page})

    def parse_api(self, response, page):
        posts = json.loads(response.text)
        fresh = self.new_on_listing([post["link"] for post in posts])
        for post in posts:
            url = post["link"]
            if url in fresh and "/press-release/" in url and self.want(url):
                yield self.make_item(
                    url=url,
                    title=post["title"]["rendered"],
                    date=post["date"],
                    modified_date=post["modified"],
                    content=post["content"]["rendered"],
                )
        total = int(response.headers.get("X-WP-TotalPages", b"1").decode() or 1)
        if fresh and self.budget_left and page < min(total, self.page_cap(20)):
            yield self.api_request(page + 1)
