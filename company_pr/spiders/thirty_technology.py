"""Posts are discovered through the WordPress REST API (publish-date order;
the sitemap's lastmod is the last edit) and parsed from the page."""

import json

import scrapy
from w3lib.html import remove_tags

from crawler.base import NewsSpider


class ThirtyTechnologySpider(NewsSpider):
    name = "thirty_technology"
    api = "https://30.technology/wp-json/wp/v2/posts?per_page=20&page={}&_fields=date,link,title"
    title_xpath = '//h1[@class="entry-title"]//text()'
    date_xpath = '//meta[@property="article:published_time"]/@content'
    content_xpath = '//div[@id="main-content"]'

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

    def parse_article(self, response, feed_date=None, feed_title=None):
        for item in super().parse_article(response, feed_date, feed_title):
            item["news_modified_date"] = response.xpath(
                '//meta[@property="article:modified_time"]/@content'
            ).get()
            yield item
