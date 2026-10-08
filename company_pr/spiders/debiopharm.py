"""Debiopharm press releases (live sitemap, or the Wayback Machine as fallback).

www.debiopharm.com answers HTTP 451 (empty body) to every request from some
networks (seen from India with every curl_cffi browser profile, plain http and
the bare domain); the Wayback Machine still captured it with HTTP 200 in Sept
2026. When the live sitemap index fails, the spider falls back to the archive:
the CDX index lists every captured release URL, the archived press-release
listing gives the newest ones first, and each release is parsed from its raw
snapshot, keeping the original debiopharm.com URL (the page's canonical link)
as news_url. Archived copies can lag the live site by a few months.

To crawl the live site from a blocked network, run with HTTPS_PROXY set to an
allowed proxy (user:password@host:port works): Scrapy's HttpProxyMiddleware
turns it into meta["proxy"], which both the plain downloader and the curl_cffi
impersonation handler (crawler/handlers.py) use.
"""

import json
from urllib.parse import unquote, urlsplit

import scrapy

from crawler.base import FeedNewsSpider

_WAYBACK = "https://web.archive.org/web/{}id_/{}"
_CDX = (
    "https://web.archive.org/cdx/search/cdx?url=www.debiopharm.com/&matchType=prefix"
    "&output=json&fl=timestamp,original&filter=statuscode:200"
    "&filter=original:.*/press-releases/.%2B&collapse=urlkey"
)
_LISTING = "https://www.debiopharm.com/press-releases/"
_ARCHIVE_META = {"max_retry_times": 5}  # web.archive.org often answers 503/429 for a while


def _release_slug(url):
    """'.../<section>/press-releases/<slug>/' -> slug (None for listings)."""
    parts = [p for p in unquote(urlsplit(url).path).split("/") if p]
    if len(parts) == 3 and parts[1] == "press-releases" and parts[2] != "page" and not urlsplit(url).query:
        return parts[2].lower()
    return None


class DebiopharmSpider(FeedNewsSpider):
    name = "debiopharm"
    feed_urls = ["https://www.debiopharm.com/sitemap_index.xml"]
    sitemap_follow = ["press_release-sitemap"]
    url_filter = ["/press-release"]  # /press-release/<slug>/ and /<section>/press-releases/<slug>/
    title_xpath = '//h1[contains(@class,"intro__title")]//text()'
    date_xpath = "(//time)[1]//text()"
    content_xpath = '//section[@itemprop="articleBody"]'
    custom_settings = {"CONCURRENT_REQUESTS_PER_DOMAIN": 2}  # be gentle with web.archive.org

    def feed_failed(self, failure):
        if failure.request.url != self.feed_urls[0]:
            yield from super().feed_failed(failure)
            return
        response = getattr(failure.value, "response", None)
        reason = f"HTTP {response.status}" if response is not None else repr(failure.value)
        self.logger.warning(f"Live site unavailable ({reason}); using Wayback Machine snapshots instead")
        yield from self._feed_done()
        yield scrapy.Request(_CDX, callback=self.parse_cdx, meta=_ARCHIVE_META, dont_filter=True)

    def parse_cdx(self, response):
        # slug -> (capture timestamp, original URL); a release moved between
        # sections keeps its most recently first-captured URL.
        self.archive = {}
        for timestamp, original in json.loads(response.text or "[]")[1:]:
            slug = _release_slug(original)
            if slug and timestamp > self.archive.get(slug, ("",))[0]:
                self.archive[slug] = (timestamp, original)
        self.logger.info(f"{len(self.archive)} archived press releases")
        yield scrapy.Request(
            _WAYBACK.format("29991231", _LISTING),  # redirects to the latest capture
            callback=self.parse_archived_listing,
            errback=self.archived_listing_failed,
            meta=_ARCHIVE_META,
        )

    def parse_archived_listing(self, response):
        newest = [_release_slug(response.urljoin(href)) for href in response.xpath("//main//a/@href").getall()]
        yield from self.schedule_archived(dict.fromkeys(slug for slug in newest if slug in self.archive))

    def archived_listing_failed(self, failure):
        yield from self.schedule_archived({})

    def schedule_archived(self, newest_first):
        rest = sorted(self.archive, key=lambda slug: self.archive[slug][0], reverse=True)
        for slug in [*newest_first, *rest]:
            if not self.budget_left:
                break
            timestamp, original = self.archive[slug]
            url = "https://www.debiopharm.com" + urlsplit(original).path.rstrip("/") + "/"
            if self.want(url):
                yield scrapy.Request(
                    _WAYBACK.format(timestamp, original),
                    callback=self.parse_snapshot,
                    errback=self.snapshot_failed,
                    cb_kwargs={"url": url},
                    meta=_ARCHIVE_META,
                )

    def parse_snapshot(self, response, url):
        canonical = response.xpath('//link[@rel="canonical"]/@href').get()
        for item in self.parse_article(response):
            item["news_url"] = canonical if canonical and "debiopharm.com" in canonical else url
            yield item

    def snapshot_failed(self, failure):
        self.logger.info(f"Snapshot failed: {failure.request.url}: {failure.value!r}")
        self.release(failure.request.cb_kwargs["url"])
