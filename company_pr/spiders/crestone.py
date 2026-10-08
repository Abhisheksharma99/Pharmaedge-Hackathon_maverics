"""Posts are discovered through the WordPress REST API (true publish dates,
newest first); the API body is raw Divi shortcodes, so the page is parsed.
Conference-poster posts have no on-page date/title, so the API ones are used."""

import json

import scrapy
from w3lib.html import remove_tags

from crawler.base import NewsSpider


class CrestoneSpider(NewsSpider):
    name = "crestone"
    api = "https://crestonepharma.com/wp-json/wp/v2/posts?per_page=20&page={}&_fields=date,link,title"
    title_xpath = '//div[@class="et_pb_title_container"]/h1[@class="entry-title"]/text()'
    date_xpath = '//div[@class="et_pb_title_container"]//span[@class="published"]/text()'
    content_xpath = '//div[contains(@class,"et_pb_post_content_0_tb_body")]'

    async def start(self):
        yield self.api_request(1)

    def api_request(self, page):
        return scrapy.Request(self.api.format(page), callback=self.parse_api, cb_kwargs={"page": page})

    def parse_api(self, response, page):
        posts = json.loads(response.text)
        fresh = self.new_on_listing([post["link"] for post in posts])
        for post in posts:
            if post["link"] in fresh and self.want(post["link"]):
                yield scrapy.Request(
                    post["link"],
                    callback=self.parse_article,
                    cb_kwargs={
                        "feed_date": post["date"],
                        "feed_title": remove_tags(post["title"]["rendered"]),
                    },
                )
        total = int(response.headers.get("X-WP-TotalPages", b"1").decode() or 1)
        if fresh and self.budget_left and page < min(total, self.page_cap(20)):
            yield self.api_request(page + 1)
