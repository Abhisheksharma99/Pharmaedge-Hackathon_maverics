"""Melinta press releases.

melinta.com now redirects to cormedix.com: CorMedix acquired Melinta (deal
announced 2025-08-07) and publishes the group's releases there, so current
news comes from CorMedix's WordPress API, from the deal announcement on
(earlier CorMedix posts are CorMedix-only news).

Melinta's own sites are gone; once the CorMedix posts are exhausted the crawl
continues in the Wayback Machine with
  * melinta.com posts 2020-2025 (from the archived Yoast post sitemap; the
    people/bio posts mixed into it are skipped), and
  * the 2006-2019 archive of ir.melinta.com (the IR site of the listed company,
    formerly Cempra), captured in full in January 2020.
Archived items keep their original URL as news_url.
"""

import json

import scrapy

from crawler.base import NewsSpider

WAYBACK = "https://web.archive.org"


class MelintaSpider(NewsSpider):
    name = "melinta"
    custom_settings = {"DOWNLOAD_SLOTS": {"web.archive.org": {"concurrency": 2}}}
    # CorMedix posts published since the Melinta deal was announced (2025-08-07).
    api = (
        "https://cormedix.com/wp-json/wp/v2/posts?per_page=20&page={page}&_fields=link,date,title"
        "&after=2025-08-06T23:59:59"
    )
    # Captured in Nov 2025, before melinta.com started redirecting.
    old_posts = WAYBACK + "/web/20251122072227id_/https://melinta.com/post-sitemap.xml"
    old_ir = (
        WAYBACK + "/cdx/search/cdx?url=ir.melinta.com/news-releases/news-release-details/"
        "&matchType=prefix&output=json&fl=timestamp,original&collapse=urlkey&filter=statuscode:200"
    )
    title_xpath = '//section[contains(@class,"title")]//h1//text()'
    date_xpath = '//section[@class="single"]//div[@class="content"]/div/h6[1]//text()'
    content_xpath = '//section[@class="single"]//div[@class="content"]/div/*[position() > 1 or not(self::h6)]'

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            self.api.format(page=page), callback=self.parse_listing, cb_kwargs={"page": page}
        )

    def parse_listing(self, response, page):
        posts = {post["link"]: post for post in json.loads(response.text)}
        fresh = self.new_on_listing(posts)
        for url in fresh:
            if self.want(url):
                post = posts[url]
                yield scrapy.Request(
                    url,
                    callback=self.parse_article,
                    cb_kwargs={"feed_title": post["title"]["rendered"], "feed_date": post["date"]},
                )
        # The API answers 400 past the last page, so follow its page count.
        last_page = int(response.headers.get("X-WP-TotalPages", 1))
        if page < last_page and fresh and self.budget_left and page < self.page_cap(10):
            yield self.listing_request(page + 1)
        elif page >= last_page and self.budget_left:
            yield self.wayback_request(self.old_posts, self.parse_old_posts)
            yield self.wayback_request(self.old_ir, self.parse_old_ir)

    # ---- Melinta's own sites (Wayback Machine) --------------------------------

    def wayback_request(self, archive_url, callback, **cb_kwargs):
        return scrapy.Request(archive_url, callback=callback, cb_kwargs=cb_kwargs, meta={"download_timeout": 120})

    def parse_old_posts(self, response):
        response.selector.remove_namespaces()
        posts = sorted(
            ((u.xpath("lastmod/text()").get() or "", u.xpath("loc/text()").get()) for u in response.xpath("//url")),
            reverse=True,
        )
        for _, url in posts:
            if url and self.want(url):
                yield self.wayback_request(f"{WAYBACK}/web/20251122id_/{url}", self.parse_old_post, url=url)

    def parse_old_post(self, response, url):
        title = response.xpath('normalize-space(//h1[@class="entry-title"])').get()
        if len((title or "").split()) < 5:  # bio pages ("Jisoo Park") and placeholders
            self.release(url)
            return
        # The release is the biggest Divi text module (others: date, label, footer).
        blocks = response.xpath('//div[@class="et_pb_text_inner"][not(ancestor::div[contains(@class,"tb_footer")])]')
        body = max(blocks, key=lambda b: len(b.xpath("string()").get()), default=None)
        yield self.make_item(
            response,
            url=url,
            title=title,
            date=response.xpath('//meta[@property="article:published_time"]/@content').get(),
            content=body.get() if body else None,
        )

    def parse_old_ir(self, response):
        for timestamp, original in json.loads(response.text)[1:]:
            url = original.split("?")[0].rstrip("/")
            if self.want(url):
                yield self.wayback_request(f"{WAYBACK}/web/{timestamp}id_/{original}", self.parse_old_ir_release, url=url)

    def parse_old_ir_release(self, response, url):
        yield self.make_item(
            response,
            url=url,
            title=" ".join(response.xpath('//div[contains(@class,"field--name-field-nir-news-title")]//text()').getall()),
            date=" ".join(response.xpath('//div[contains(@class,"field--name-field-nir-news-date")]//text()').getall()),
            # Skip the attachment boxes ("PDF 9.7 KB") in front of the text.
            content="\n".join(
                response.xpath(
                    '//div[@class="node__content"]/node()[not(contains(@class,"box__right")'
                    ' or contains(@class,"field--name-field-nir-document"))]'
                ).getall()
            ),
        )
