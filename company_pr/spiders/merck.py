from urllib.parse import urlencode

import scrapy

from crawler.base import NewsSpider


class MerckSpider(NewsSpider):
    """Merck press releases straight from the WordPress REST API (tag 289 =
    Press Release, archive back to 2010)."""

    name = "merck"
    allowed_domains = ["merck.com"]

    async def start(self):
        yield self.api_request(1)

    def api_request(self, page):
        params = {
            "tags": 289,
            "page": page,
            "per_page": min(self.limit or 100, 100),
            "_embed": "wp:term",
            "_fields": "link,date,modified,title,content,_links,_embedded",
        }
        return scrapy.Request(
            "https://www.merck.com/wp-json/wp/v2/news_item/?" + urlencode(params),
            callback=self.parse_api,
            cb_kwargs={"page": page},
            headers={"Accept": "application/json"},
        )

    def parse_api(self, response, page):
        posts = response.json()
        fresh = set(self.new_on_listing([post["link"] for post in posts]))
        for post in posts:
            if post["link"] not in fresh or not self.want(post["link"]):
                continue
            terms = post.get("_embedded", {}).get("wp:term", [])
            yield self.make_item(
                url=post["link"],
                title=post["title"]["rendered"],
                date=post["date"],
                modified_date=post.get("modified"),
                content=post["content"]["rendered"],
                tags=[t["name"] for group in terms for t in group if t.get("taxonomy") == "post_tag"],
            )
        total_pages = int(response.headers.get("X-WP-TotalPages", b"0") or 0)
        if fresh and self.budget_left and page < min(total_pages, self.page_cap(30)):
            yield self.api_request(page + 1)
