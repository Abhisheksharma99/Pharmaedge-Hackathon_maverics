"""Regeneron press releases.

The investor-site listing only reaches back to late 2017 (even with the year
filter off); its sitemap lists every release since 2007, newest lastmod first.
A few releases are only an attached PDF.

The site's WAF answers 403 once roughly 1,100 pages were fetched in one go, so
a full-history run (~1,120 releases) can lose its last few dozen requests:
requests are processed FIFO so those are the oldest ones, and a later
`--limit 0 --new-only` run picks them up. (Impersonated requests also bypass
Scrapy's download delay/AutoThrottle, hence the low concurrency.)
"""

from scrapy.http import TextResponse

from crawler.base import FeedNewsSpider


class RegeneronSpider(FeedNewsSpider):
    name = "regeneron"
    impersonate = "chrome"  # non-browser TLS gets its HTTP/2 stream reset
    custom_settings = {
        "CONCURRENT_REQUESTS": 2,
        "SCHEDULER_MEMORY_QUEUE": "scrapy.squeues.FifoMemoryQueue",  # newest first
    }
    feed_urls = ["https://investor.regeneron.com/sitemap.xml"]
    url_filter = ["/news-releases/news-release-details/"]
    title_xpath = '//div[contains(@class, "field--name-field-nir-news-title")]//text()'
    date_xpath = '//div[contains(@class, "field--name-field-nir-news-date")]//text()'
    content_xpath = '//div[@class="full-release-body"]'

    def parse_article(self, response, feed_date=None, feed_title=None):
        if isinstance(response, TextResponse):
            body = response.xpath(self.content_xpath)
            pdf = body.xpath('.//a[@type="application/pdf"]/@href').get()
            if pdf and len(body.xpath("normalize-space()").get("")) < 300:
                yield response.follow(
                    pdf,
                    callback=self.parse_pdf,
                    cb_kwargs={
                        "page": response.url,
                        "title": " ".join(response.xpath(self.title_xpath).getall()).strip(),
                        "day": " ".join(response.xpath(self.date_xpath).getall()).strip(),
                    },
                )
                return
        yield from super().parse_article(response, feed_date, feed_title)

    def parse_pdf(self, response, page, title, day):
        item = self.pdf_item(response, title=title, date=day)
        if item:
            item["news_url"] = page  # the release page, so --new-only recognises it
            yield item
