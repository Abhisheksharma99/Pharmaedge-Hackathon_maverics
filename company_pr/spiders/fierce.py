"""Fierce Pharma / Biotech / Healthcare.

Normal runs read the RSS feeds (newest ~25 per feed). Cloudflare challenges
some Fierce feed URLs for every client (e.g. the fiercepharma "all articles"
/rss/xml and, at the time of writing, all fiercebiotech feeds), while the
per-section feeds load fine, so fiercepharma is covered through its section
feeds and a blocked feed is only logged as a warning.

Full-history runs (--limit 0) add the three sites' sitemaps: ~270k articles
back to 2005 (the sitemaps lag the feeds by a couple of weeks). Everything
needs the chrome impersonation.
"""

from urllib.parse import urlparse

from crawler.base import FeedNewsSpider


class FierceSpider(FeedNewsSpider):
    name = "fierce"
    category = "news"
    impersonate = "chrome"
    channel = "fiercepharma"
    aggregator_source = "fiercepharma"
    feed_urls = [
        "https://www.fiercepharma.com/rss/pharma/xml",
        "https://www.fiercepharma.com/rss/manufacturing/xml",
        "https://www.fiercepharma.com/rss/marketing/xml",
        "https://www.fiercebiotech.com/rss/xml",
        "https://www.fiercehealthcare.com/rss/xml",
    ]
    archive_feeds = [
        "https://www.fiercepharma.com/sitemap.xml",
        "https://www.fiercebiotech.com/sitemap.xml",
        "https://www.fiercehealthcare.com/sitemap.xml",
    ]
    # Sponsored content, podcasts, webinars and site pages listed in the sitemaps.
    url_exclude = [
        "/sponsored/", "/partner-content/", "/webinars/", "/pharmatalkradio/", "/resource/",
        "/book/", "/collection/", "/fiercepharmacom/", "/fiercebiotechcom/",
        "/fiercehealthcarecom/", "/fiercelifesciencescom/",
    ]
    title_xpath = '//div[@class="container"]//h1[contains(@class,"element-title")]//text()'
    date_xpath = '//meta[@property="article:published_time"]/@content'
    content_xpath = '//div[@class="container"]//div[@id="article-body-row"]'
    tags_xpath = '//div[@class="container"]//div[contains(@id,"article-tags")]/a/text()'

    async def start(self):
        for url in self.feed_urls + ([] if self.limit else self.archive_feeds):
            yield self.feed_request(url)

    def want(self, url):
        # Articles live at /<section>/<slug>; one-segment URLs are landing pages.
        return "/" in urlparse(url).path.strip("/") and super().want(url)

    def feed_failed(self, failure):
        self.logger.warning(f"Feed unavailable: {failure.request.url}: {failure.value!r}")
        yield from self._feed_done()
