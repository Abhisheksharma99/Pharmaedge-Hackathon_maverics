"""The old English RSS feed (/global/rss/news_release_feed/) now returns a 500 and
the remaining /rss/news_release_feed is Japanese-only with internal host links,
so the English (WOVN-translated) news-release listing is crawled instead:
/en/news/release/<year>?pageno=N, then each older year down to the oldest one
linked (2017).

Most releases before 2024 were never translated: their /en/ pages are served in
Japanese, and the PDF-only releases are Japanese documents. Like the legacy
English feed, only English releases are kept; the others are skipped (stat
pr/skipped/untranslated).
"""

import re
from urllib.parse import urlsplit

import scrapy
from scrapy.http import TextResponse

from crawler.base import NewsSpider

_JAPANESE = re.compile(r"[\u3040-\u30ff\u4e00-\u9fff]")  # kana + CJK ideographs


def _is_japanese(text):
    text = re.sub(r"\s+", "", text or "")
    return bool(text) and len(_JAPANESE.findall(text)) > 0.2 * len(text)


def _english(url):
    """Older listings link to the Japanese pages (/news/...); use /en/ ones.
    Media files (/-/media/...pdf) only exist at their own path."""
    parts = urlsplit(url)
    if parts.path.startswith(("/en/", "/-/", "/~/")):
        return url
    return parts._replace(path="/en" + parts.path).geturl()


class RohtoSpider(NewsSpider):
    name = "rohto"
    allowed_domains = ["rohto.co.jp"]
    title_xpath = '//h1[@class="h1_basic"]//text()'
    date_xpath = '//section[@class="mainIn"]/p[@class="txtRight01"]//text()'
    content_xpath = '//section[@class="mainIn"]/div[@class="boxCase01" or contains(@class,"boxInfo01")]'
    tags_xpath = '//section[@class="mainIn"]/div[@class="iconWrap"]/div[@class="icon"]//text()'

    async def start(self):
        # Redirects to the current year's list.
        yield scrapy.Request("https://www.rohto.co.jp/en/news/release", callback=self.parse_listing, cb_kwargs={"pages": 1})

    def parse_listing(self, response, pages):
        rows = {}
        for li in response.xpath('//ul[contains(@class,"newsList")]/li[a/@href]'):
            rows[_english(response.urljoin(li.xpath("./a/@href").get()))] = li
        fresh = self.new_on_listing(rows)
        for url in fresh:
            if self.want(url):
                li = rows[url]
                yield scrapy.Request(url, callback=self.parse_news, cb_kwargs={
                    "url": url,
                    "feed_title": li.xpath('normalize-space(.//div[@class="title"])').get(),
                    "feed_date": li.xpath('normalize-space(.//div[@class="date"])').get(),
                })
        if not self.budget_left or pages >= self.page_cap(30):
            return
        next_page = response.xpath('//a[@class="next01"]/@href').get()
        if next_page and fresh:
            url = _english(response.urljoin(next_page))
        else:  # last page of this year: continue with the next older year
            years = {int(y) for y in response.xpath("//a/@href").re(r"/news/release/(\d{4})$")}
            match = re.search(r"/release/(\d{4})", response.url)
            year = int(match[1]) if match else max(years, default=0) + 1
            older = [y for y in years if y < year]
            if not older:
                return
            url = f"https://www.rohto.co.jp/en/news/release/{max(older)}"
        yield scrapy.Request(url, callback=self.parse_listing, cb_kwargs={"pages": pages + 1})

    def parse_news(self, response, url, feed_title, feed_date):
        if isinstance(response, TextResponse):
            title = " ".join(response.xpath(self.title_xpath).getall())
            lead = response.xpath('string(//section[@class="mainIn"]/div[@class="boxCase01"])').get()
            if not (_is_japanese(title) or _is_japanese(lead[:300])):
                yield from self.parse_article(response)
                return
        else:  # PDF-only release
            item = self.pdf_item(response, title=feed_title, date=feed_date)
            if item is None:  # no extractable text (counted by pdf_item)
                return
            if not _is_japanese(item["content"][:500]):
                yield item
                return
        self.crawler.stats.inc_value("pr/skipped/untranslated")
        self.release(url)
