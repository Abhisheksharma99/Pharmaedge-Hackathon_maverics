"""PHAXIAM Therapeutics (ERYTECH Pharma until its June 2023 merger with
Pherecydes) was placed in judicial liquidation on 11 June 2025 and delisted;
phaxiam.com now serves an unrelated casino site and is never requested. No new
releases are expected; the spider returns the historical archive:

* Wayback Machine snapshots, taken before the domain changed hands, of the
  phaxiam.com English newsroom posts published after the company's last
  GlobeNewswire release (Dec 2024 - Jun 2025, distributed via Business Wire);
* GlobeNewswire, organisation "Phaxiam Therapeutics S.A." (ERYTECH / PHAXIAM
  releases Nov 2016 - Dec 2024, English versions only).

Older ERYTECH releases (2006-2016) only exist as PDFs on the archived
erytech.com and are not collected.
"""

import json
import re
from urllib.parse import urlsplit

import scrapy

from crawler.base import NewsSpider
from crawler.helpers import html_to_text, parse_date

GNW_LAST = "2024-12-05"  # last PHAXIAM release on GlobeNewswire
_ARCHIVE_FROM, _ARCHIVE_TO = "20241206", "20251111"  # the casino site came later
_CDX = (
    "https://web.archive.org/cdx/search/cdx?url=phaxiam.com/en/&matchType=prefix"
    "&output=json&fl=timestamp,original&filter=statuscode:200&filter=mimetype:text/html"
    f"&collapse=urlkey&to={_ARCHIVE_TO}"
)
_GNW = (
    "https://www.globenewswire.com/en/search/organization/"
    "Phaxiam%2520Therapeutics%2520S§A§?page={}&pageSize=50"
)
_ARCHIVE_META = {"max_retry_times": 5}  # web.archive.org often answers 503/429 for a while
_ENGLISH = re.compile(r"/news-release/\d{4}/\d{2}/\d{2}/\d+/\d+/en/")
# "Lyon (France) – June 18, 2025 at 7:00 am CEST – ..."
_DOWNLOAD_LINK = re.compile(r"<a\b[^>]*>(?:(?!</a>).)*Download the press release.*?</a>", re.S)
_DATELINE = re.compile(r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}")


class PhaxiamSpider(NewsSpider):
    name = "phaxiam"
    custom_settings = {"CONCURRENT_REQUESTS_PER_DOMAIN": 2}  # be gentle with web.archive.org

    async def start(self):
        yield scrapy.Request(_CDX, callback=self.parse_cdx, errback=self.archive_failed, meta=_ARCHIVE_META)

    # ---- phaxiam.com newsroom (Wayback Machine) ------------------------------

    def parse_cdx(self, response):
        posts = []
        for timestamp, original in json.loads(response.text or "[]")[1:]:
            parts = [p for p in urlsplit(original).path.split("/") if p]
            # Newsroom posts live at /en/<slug>/; first captured after GNW_LAST.
            if len(parts) == 2 and not urlsplit(original).query and timestamp >= _ARCHIVE_FROM:
                posts.append((timestamp, f"https://phaxiam.com/en/{parts[1]}/"))
        for timestamp, url in sorted(posts, reverse=True):  # roughly newest first
            if self.budget_left and self.want(url):
                yield scrapy.Request(
                    f"https://web.archive.org/web/{timestamp}id_/{url}",
                    callback=self.parse_post,
                    errback=self.post_failed,
                    cb_kwargs={"url": url},
                    meta=_ARCHIVE_META,
                )
        yield self.gnw_request(1)

    def archive_failed(self, failure):
        self.logger.warning(f"Wayback Machine CDX failed ({failure.value!r}); GlobeNewswire only")
        yield self.gnw_request(1)

    def parse_post(self, response, url):
        published = response.xpath('//meta[@property="article:published_time"]/@content').get()
        site = response.xpath('//meta[@property="og:site_name"]/@content').get() or ""
        body = _DOWNLOAD_LINK.sub("", response.xpath('//section[@id="content"]//div[@class="text"]').get() or "")
        # The page shows no date but the release's dateline (the WordPress
        # publish date can be days later).
        dateline = _DATELINE.search((html_to_text(body) or "")[:600])
        date = parse_date(dateline.group(0) if dateline else published)
        # Skip site pages (no publish date), anything not PHAXIAM's, and
        # releases GlobeNewswire already carries.
        if not published or "phaxiam" not in site.lower() or not date or date <= GNW_LAST:
            self.release(url)
            return
        yield self.make_item(
            response,
            url=url,
            title=" ".join(t.strip() for t in response.xpath("//h1//text()").getall() if t.strip()),
            date=date,
            content=body,
        )

    def post_failed(self, failure):
        self.release(failure.request.cb_kwargs["url"])

    # ---- GlobeNewswire ---------------------------------------------------------

    def gnw_request(self, page):
        return scrapy.Request(
            _GNW.format(page),
            callback=self.parse_gnw,
            cb_kwargs={"page": page},
            meta={"impersonate": "chrome"},  # globenewswire.com resets non-browser TLS
        )

    def parse_gnw(self, response, page):
        links = [response.urljoin(h) for h in response.xpath('//div[@class="mainLink"]/a/@href').getall()]
        fresh = self.new_on_listing(links)
        for url in fresh:
            if _ENGLISH.search(url) and self.want(url):
                yield scrapy.Request(url, callback=self.parse_gnw_article, meta={"impersonate": "chrome"})
        if fresh and len(links) >= 50 and self.budget_left and page < self.page_cap(20):
            yield self.gnw_request(page + 1)

    def parse_gnw_article(self, response):
        title = response.xpath('//h1[contains(@class,"article-headline")]//text()').getall()
        yield self.make_item(
            response,
            title=" ".join(t.strip() for t in title if t.strip()),
            date=response.xpath('//*[@itemprop="datePublished"]/time/text()').get(),
            content=response.xpath('//*[@itemprop="articleBody"]').get(),
            tags=response.xpath('//div[@class="tags-container"]//a/text()').getall(),
        )
