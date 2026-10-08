"""BARDA (medicalcountermeasures.gov) newsroom.

The live newsroom only lists a handful of items, mostly linking to external
ASPR / HHS pages (sometimes wrapped in Outlook "safelinks"). In April 2025 the
per-year newsroom pages (/newsroom/<year>, 2019-2025) and their articles were
moved to a PageFreezer archive, which can only be replayed client-side from
multi-GB WACZ files; many of the HHS/ASPR pages they link to are gone or
archived the same way. Full-history runs (--limit 0) therefore read those year
pages and the pages they link to from the Internet Archive: BARDA's own
articles as captured just before the move, external releases as captured
around their publication date (~390 items from January 2019 on; earlier years
have no usable captures). Title, date and summary come from the newsroom row;
the body from the linked page (or PDF) when it can be fetched, otherwise the
row's summary is used.
"""

from urllib.parse import parse_qs, urljoin, urlparse

import scrapy

from crawler.base import NewsSpider
from crawler.helpers import parse_date

SITE = "https://www.medicalcountermeasures.gov/"
BEFORE_MOVE = "20250401"  # last Wayback captures of the newsroom before it moved
ARCHIVE_YEARS = range(2019, 2026)
# Article bodies: BARDA's own pages, HHS (Drupal 8 / 7), aspr.gov, phe.gov and
# aspr.hhs.gov (SharePoint).
BODY_XPATHS = [
    '//div[contains(@class,"container")]/div[contains(@class,"row p-sm-3")]',
    '//div[contains(@class,"field--name-field-paragraph-body")]',
    '//div[contains(@class,"field--name-body") and contains(@class,"field__item")]',
    '//div[contains(@class,"field-name-body")]',
    '//div[contains(@class,"ms-rtestate-field")]',
    '//*[@itemprop="articleBody"]',
]


class BardaSpider(NewsSpider):
    name = "barda"
    category = "agency"
    impersonate = "chrome"  # hhs.gov (Akamai) rejects non-browser clients

    async def start(self):
        yield scrapy.Request(SITE + "newsroom/", callback=self.parse_listing)
        if not self.limit:
            for year in ARCHIVE_YEARS:
                yield scrapy.Request(
                    _wayback(f"{SITE}newsroom/{year}/", BEFORE_MOVE),
                    callback=self.parse_listing,
                    cb_kwargs={"archived": True},
                )

    def parse_listing(self, response, archived=False):
        page_url = response.url.split("id_/", 1)[-1]  # the original URL of a Wayback copy
        for row in response.xpath('//div[contains(@class,"resultsWindow")]//div[contains(@class,"resultRow")]'):
            href = row.xpath('.//div[contains(@class,"resultTitle")]//a/@href').get()
            if not href:
                continue
            url = _unwrap_safelink(urljoin(page_url, href.strip()))
            if not self.want(url):
                continue
            listing = {
                "url": url,
                "title": row.xpath('normalize-space(.//div[contains(@class,"resultTitle")])').get(),
                "date": row.xpath('normalize-space(.//*[contains(@class,"resultDate")])').get(),
                "summary": row.xpath('normalize-space(.//div[contains(@class,"resultDescription")])').get(),
            }
            if "#" in url:  # an anchor on a publications page: the row is all there is
                yield self.make_item(content=listing.pop("summary"), **listing)
                continue
            if archived:
                own_page = urlparse(url).netloc.endswith("medicalcountermeasures.gov")
                published = (parse_date(listing["date"]) or "").replace("-", "")
                fetch = _wayback(url, BEFORE_MOVE if own_page or not published else published)
            else:
                fetch = url
            yield scrapy.Request(
                fetch,
                callback=self.parse_article,
                errback=self.article_failed,
                cb_kwargs={"listing": listing},
            )

    def parse_article(self, response, listing):
        if response.body[:5] == b"%PDF-":
            item = self.pdf_item(response, url=listing["url"], title=listing["title"], date=listing["date"])
            if item:
                yield item
            return
        content = None
        if response.headers.get("Content-Type", b"").startswith(b"text/html"):
            content = next(filter(None, (response.xpath(xp).get() for xp in BODY_XPATHS)), None)
        yield self.make_item(
            url=listing["url"],
            title=listing["title"],
            date=listing["date"],
            content=content or listing["summary"],
        )

    def article_failed(self, failure):
        listing = failure.request.cb_kwargs["listing"]
        self.logger.info(f"Using newsroom summary for {listing['url']}: {failure.value!r}")
        yield self.make_item(
            url=listing["url"],
            title=listing["title"],
            date=listing["date"],
            content=listing["summary"],
        )


def _wayback(url, timestamp):
    return f"https://web.archive.org/web/{timestamp}id_/{url}"


def _unwrap_safelink(url):
    if "safelinks.protection.outlook.com" in url:
        return parse_qs(urlparse(url).query).get("url", [url])[0]
    return url
