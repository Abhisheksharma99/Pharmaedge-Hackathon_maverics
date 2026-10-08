"""Paratek press releases.

Since mid-2014 they come from a B2i widget (paratekpharma.com/news-media); its
headline feed and the pressviewer.com article pages answer 410 to Scrapy's TLS
fingerprint, hence impersonate. The private company's releases (2000-2013, on
paratekpharm.com: HTML pages, later PDFs) survive only in the Wayback Machine;
once the feed is exhausted the crawl continues there, taking titles/dates from
the archived press-release index. Those items keep their original URL.
"""

import json
import re
from urllib.parse import unquote

import scrapy
from scrapy.http import TextResponse

from crawler.base import NewsSpider

WAYBACK = "https://web.archive.org"


class ParatekSpider(NewsSpider):
    name = "paratek"
    impersonate = "chrome"
    custom_settings = {"DOWNLOAD_SLOTS": {"web.archive.org": {"concurrency": 2}}}
    date_order = "MDY"
    feed = "https://www.b2i.us/b2i/LibraryFeed.asp?b=2455&i=50&sd=1&p={page}"
    old_index = WAYBACK + "/web/20120621043524id_/http://www.paratekpharm.com/m_press.html"
    old_files = (
        WAYBACK + "/cdx/search/cdx?url=paratekpharm.com/press/&matchType=prefix&output=json"
        "&fl=timestamp,original,mimetype&collapse=urlkey&filter=statuscode:200"
    )
    title_xpath = '//td[@class="b2iNewsStoryHeadline"]//text()'
    date_xpath = '//td[@class="b2iNewsStoryDate"]//text()'
    # Some releases use a <td> body instead of the <div>.
    content_xpath = (
        '//div[@class="b2iNewsItemBodyDiv"]'
        ' | //td[@class="b2iNewsStoryBody"][not(.//div[@class="b2iNewsItemBodyDiv"])]'
    )

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            self.feed.format(page=page), callback=self.parse_listing, cb_kwargs={"page": page}
        )

    def parse_listing(self, response, page):
        rows = {}
        for link in response.xpath('//td[contains(@class,"HeadlineCell")]/a'):
            # href="Javascript:OpenApiStory('https://www.pressviewer.com/...','');"
            m = re.search(r"OpenApiStory\('([^']+)'", link.attrib.get("href", ""))
            if m:
                date = link.xpath('../../preceding-sibling::tr[1]/td[contains(@class,"DateCell")]/text()').get()
                rows[m[1]] = (link.attrib.get("title"), date)
        fresh = self.new_on_listing(rows)
        for url in fresh:
            if self.want(url):
                title, date = rows[url]
                yield scrapy.Request(
                    url, callback=self.parse_article, cb_kwargs={"feed_title": title, "feed_date": date}
                )
        if fresh and self.budget_left and page < self.page_cap(20):
            yield self.listing_request(page + 1)
        elif not fresh and self.budget_left:
            yield self.wayback_request(self.old_index, self.parse_old_index)

    # ---- pre-2014 archive (Wayback Machine) ----------------------------------

    def wayback_request(self, archive_url, callback, **cb_kwargs):
        # Not impersonated, so Scrapy's per-site throttling applies to archive.org.
        return scrapy.Request(
            archive_url, callback=callback, cb_kwargs=cb_kwargs,
            meta={"impersonate": False, "download_timeout": 120},
        )

    def parse_old_index(self, response):
        # <p class=bodydate>May 22, 2012</p><p class=bodycopy><a onmouseup="MM_openBrWindow('press/x.pdf',..)">Title</a>
        listed = {}
        for a in response.xpath('//p[@class="bodycopy"]/a[contains(@onmouseup,"press/")]'):
            path = re.search(r"'press/([^']+)'", a.attrib["onmouseup"])[1]
            date = a.xpath('normalize-space(../preceding-sibling::p[@class="bodydate"][1])').get()
            listed[unquote(path)] = (a.xpath("normalize-space()").get(), date)
        yield self.wayback_request(self.old_files, self.parse_old_files, listed=listed)

    def parse_old_files(self, response, listed):
        # Only files the archive holds; a few listed PDFs were never captured.
        for timestamp, original, mimetype in json.loads(response.text)[1:]:
            url = original.replace(":80/", "/", 1)
            if mimetype in ("text/html", "application/pdf") and self.want(url):
                title, date = listed.get(unquote(url.rsplit("/", 1)[-1]), (None, None))
                yield self.wayback_request(
                    f"{WAYBACK}/web/{timestamp}id_/{original}",
                    self.parse_old_release, url=url, title=title, date=date,
                )

    def parse_old_release(self, response, url, title, date):
        if not isinstance(response, TextResponse):  # 2003-2013 releases are PDFs
            item = self.pdf_item(response, title=title, date=date)
        else:
            # Title: first non-empty paragraph after the date ("# # #" ends a release).
            heading = response.xpath(
                'normalize-space((//p[@class="prdate"]/following::p[normalize-space()'
                ' and normalize-space() != "# # #"][1]//text()[normalize-space()])[1])'
            ).get()
            body = response.xpath('//p[@class="bodycopy"]') or response.xpath('//p[@class="prdate"]/following::p')
            item = self.make_item(
                response,
                title=heading or title,
                date=response.xpath('normalize-space(//p[@class="prdate"])').get() or date,
                content="\n".join(body.getall()),
            )
        if item:
            item["news_url"] = url
            yield item
