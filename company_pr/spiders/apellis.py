"""Apellis was acquired by Biogen in 2026 and investors.apellis.com now answers
every URL with "401 Authentication failed". Apellis issued its releases via
GlobeNewswire, whose organization page lists every wire release (Nov 2016 to
the March 2026 acquisition announcement, newest first) with full text. Once that
list is exhausted (full-history runs), the few older or IR-only releases that
never went over GlobeNewswire are recovered from Wayback Machine copies of the
IR site.
"""

import re

import scrapy

from crawler.base import NewsSpider

WIRE_LISTING = (
    "https://www.globenewswire.com/en/search/organization/"
    "Apellis%20Pharmaceuticals%CE%B4%20Inc%C2%A7?page={}&pageSize=50"
)
IR_CAPTURES = (
    "https://web.archive.org/cdx/search/cdx?url=investors.apellis.com/news-releases/"
    "news-release-details/*&output=json&fl=timestamp,original&filter=statuscode:200&collapse=urlkey"
)


# "CRESTWOOD, Ky., July 15, 2015 /PRNewswire/ --", "LOUISVILLE, KY., August 10, 2017 - "
DATELINE = re.compile(r"([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})\s*(?:/PRNewswire|\(GLOBE NEWSWIRE\)|[-–—])")


def _words(text):
    """Comparable words of a title or URL slug ("M.D." -> md, "EMPAVELI®" -> empavelir)."""
    text = re.sub(r"[.'’]", "", text.lower().replace("®", "r").replace("™", "tm"))
    return set(re.findall(r"[a-z0-9]+", text))


class ApellisSpider(NewsSpider):
    name = "apellis"
    impersonate = "chrome"
    allowed_domains = ["globenewswire.com", "web.archive.org"]
    title_xpath = "//h1//text()"
    # "November 08, 2017 21:38 ET" - the US date; the URL path holds the UTC one.
    date_xpath = "//time/text()"
    content_xpath = '//div[@id="main-body-container"]'

    async def start(self):
        self.wire_titles = []
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            WIRE_LISTING.format(page), callback=self.parse_listing, cb_kwargs={"page": page}
        )

    def parse_listing(self, response, page):
        links = response.xpath('//div[@class="mainLink"]/a')
        self.wire_titles += [_words(a.xpath("string()").get()) for a in links]
        new = self.new_on_listing(response.urljoin(a.attrib["href"]) for a in links)
        for url in new:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if not self.budget_left:
            return
        if new and page < self.page_cap(20):
            yield self.listing_request(page + 1)
        elif not new:
            yield scrapy.Request(IR_CAPTURES, callback=self.parse_captures)

    def parse_captures(self, response):
        slugs = set()
        for timestamp, original in response.json()[1:]:
            slug = original.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
            words = _words(slug.replace("-", " "))
            # Skip query-string variants and releases that went over the wire.
            if slug in slugs or any(len(words & t) >= 0.75 * len(words) for t in self.wire_titles):
                continue
            slugs.add(slug)
            url = f"https://web.archive.org/web/{timestamp}/{original}"
            if self.want(url):
                yield scrapy.Request(
                    f"https://web.archive.org/web/{timestamp}id_/{original}",
                    callback=self.parse_ir_copy,
                    cb_kwargs={"url": url},
                )

    def parse_ir_copy(self, response, url):
        article = response.xpath('//article[contains(@class,"node--nir-news--full")]')
        title = article.xpath('.//div[contains(@class,"field--name-field-nir-news-title")]//text()')
        body = article.xpath(
            './/div[contains(@class,"node__content")][not(.//div[contains(@class,"field--name-field-nir-document")])]'
        )
        # Older templates print the date as bare text inside <article>. Some
        # pre-IPO releases were posted twice there, once under a later import
        # date, so the dateline of the text wins when it has one.
        date = article.xpath('.//div[contains(@class,"field--name-field-nir-news-date")]//text()') or article.xpath(
            "./text()"
        )
        dateline = DATELINE.search(" ".join(body.xpath(".//text()").getall())[:400])
        yield self.make_item(
            response,
            url=url,
            title=" ".join(title.getall()),
            date=dateline[1] if dateline else " ".join(date.getall()),
            content=body.get(),
        )
