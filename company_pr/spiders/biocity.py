"""The news list comes from a JSON endpoint (POST /news). Each entry links (like
the site does) to its ``url`` when set, else to the own detail page ``href``:

* PR Newswire APAC (en.prnasia.com) releases: their own detail page is empty.
  prnasia sits behind Cloudflare and answers bursts with 429 challenge pages,
  so those requests are slow and not retried; on any failure the same release
  is read from its prnewswire.com copy (matched by title in BioCity's PR
  Newswire newsroom). The item keeps the prnasia URL and the Beijing-time
  release date either way.
* WeChat posts: read from the light own detail page, or from WeChat itself when
  that page is empty.
"""

import re
from datetime import datetime, timedelta, timezone

import scrapy

from crawler.base import NewsSpider

CONTENT_XPATH = (
    '//div[@class="detail-con"]'  # own detail page
    ' | //div[@id="dvContent"]'  # en.prnasia.com
    ' | //section[contains(@class,"release-body")]/div[not(.//a[contains(@class,"fullClick")])]'  # prnewswire.com
    ' | //div[@id="js_content"]'  # mp.weixin.qq.com
)


def _key(title):
    return re.sub(r"[^a-z0-9]", "", (title or "").lower())[:80]


def _beijing_date(iso):
    try:
        return datetime.fromisoformat(iso).astimezone(timezone(timedelta(hours=8))).date().isoformat()
    except (TypeError, ValueError):
        return None


class BiocitySpider(NewsSpider):
    name = "biocity"
    allowed_domains = ["biocitypharma.com", "prnasia.com", "prnewswire.com", "mp.weixin.qq.com"]
    custom_settings = {"DOWNLOAD_DELAY": 5, "CONCURRENT_REQUESTS_PER_DOMAIN": 1}
    newsroom = "https://www.prnewswire.com/news/biocity-biopharma/?page=1&pagesize=100"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.copies = {}  # title key -> prnewswire.com release URL

    async def start(self):
        yield scrapy.Request(self.newsroom, callback=self.parse_newsroom, errback=self.newsroom_failed)

    def parse_newsroom(self, response):
        for link in response.xpath('//a[contains(@class,"newsreleaseconsolidatelink")]'):
            title = " ".join(link.xpath("./h3/text()").getall())
            self.copies[_key(title)] = response.urljoin(link.attrib["href"])
        self.logger.info(f"{len(self.copies)} prnewswire.com copies known")
        yield self.listing_request(1)

    def newsroom_failed(self, failure):
        self.logger.warning(f"PR Newswire newsroom unavailable ({failure.value!r}); no fallback copies")
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.FormRequest(
            "https://www.biocitypharma.com/news",
            formdata={"num": "20", "page": str(page), "year": "0", "type": "1"},
            headers={"X-Requested-With": "XMLHttpRequest", "Referer": "https://www.biocitypharma.com/news/"},
            callback=self.parse_listing,
            cb_kwargs={"page": page},
            dont_filter=True,
        )

    def parse_listing(self, response, page):
        data = response.json()["data"]
        for entry in data["list"]:
            url = entry.get("url") or entry.get("href")
            if not self.want(url):
                continue
            kw = {"title": entry.get("name"), "date": entry.get("date"), "url": url}
            if "prnasia.com" in url:
                yield scrapy.Request(
                    url, callback=self.parse_news, errback=self.prnasia_failed, cb_kwargs=kw,
                    meta={"impersonate": "chrome", "dont_retry": True},
                )
            elif "weixin" in url and entry.get("href"):
                yield scrapy.Request(entry["href"], callback=self.parse_news, cb_kwargs=kw)
            else:
                yield scrapy.Request(url, callback=self.parse_news, cb_kwargs=kw)
        if page < (data.get("lastPage") or 0) and self.budget_left and page < self.page_cap(20):
            yield self.listing_request(page + 1)

    def prnasia_failed(self, failure):
        yield from self.from_copy(failure.request.cb_kwargs, repr(failure.value))

    def from_copy(self, kw, reason):
        """Fall back to the prnewswire.com copy of a PR Newswire APAC release."""
        copy = self.copies.get(_key(kw["title"]))
        self.logger.warning(f"prnasia unusable ({reason}) for {kw['url']}; copy: {copy}")
        if copy:
            yield scrapy.Request(copy, callback=self.parse_news, errback=self.copy_failed, cb_kwargs=kw)
        else:
            self.release(kw["url"])

    def copy_failed(self, failure):
        self.logger.warning(f"Copy failed too: {failure.request.url}: {failure.value!r}")
        self.release(failure.request.cb_kwargs["url"])

    def parse_news(self, response, title, date, url):
        content = response.xpath(CONTENT_XPATH)
        if not content.xpath("normalize-space()").get():
            kw = response.request.cb_kwargs
            if "prnasia.com" in response.url:  # e.g. a challenge page served with 200
                yield from self.from_copy(kw, "no article text")
            elif "weixin" in url and "weixin" not in response.url:  # empty own page
                yield scrapy.Request(url, callback=self.parse_news, errback=self.copy_failed, cb_kwargs=kw)
            else:
                self.crawler.stats.inc_value("pr/skipped/no_text")
                self.release(url)
            return
        # The site's own list date can be days late; prefer the release's own
        # (Beijing time, as on prnasia). Own pages and WeChat show none.
        published = response.xpath('//div[@class="datenum"]/span[@class="datetime"]/text()').get()
        if not published and "prnewswire.com" in response.url:
            published = _beijing_date(response.xpath('//meta[@name="date"]/@content').get())
        yield self.make_item(response, url=url, title=title, date=published or date, content="\n".join(content.getall()))
