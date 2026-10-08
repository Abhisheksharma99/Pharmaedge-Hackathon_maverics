"""Google Alerts RSS (Atom) feeds -> publisher articles.

Feed URLs come from GOOGLE_ALERTS_RSS_URLS (crawler/config.py); the spider
does nothing when none are configured. Entry links are
google.com/url?...&url=<publisher url> redirects and are unwrapped locally.
Publisher pages are handled exactly like google_news.
"""

from urllib.parse import parse_qs, urlparse

import scrapy

from crawler.config import GOOGLE_ALERTS_RSS_URLS
from crawler.helpers import html_to_text
from spiders.google_news import GoogleNewsSpider


class GoogleAlertsSpider(GoogleNewsSpider):
    name = "google_alerts"
    aggregator_source = "google_alerts"
    feed_urls = GOOGLE_ALERTS_RSS_URLS
    exclude_url_substrings = ["peerview", "researchgate", "twitter"]

    async def start(self):
        if not self.feed_urls:
            self.logger.warning(
                "No Google Alerts feeds configured (GOOGLE_ALERTS_RSS_URLS); nothing to crawl."
            )
            return
        self.quota = self.feed_quota(len(self.feed_urls))
        for url in self.feed_urls:
            yield scrapy.Request(url, callback=self.parse_feed, dont_filter=True)

    def entry_request(self, link, queue, feed):
        parsed = urlparse(link)
        if parsed.netloc.endswith("google.com") and parsed.path == "/url":
            link = (parse_qs(parsed.query).get("url") or parse_qs(parsed.query).get("q") or [None])[0]
        return link and self.publisher_request(link, queue, feed)

    @staticmethod
    def clean_feed_title(title):
        # Alert titles are HTML-escaped with <b> highlights.
        return html_to_text(title)
