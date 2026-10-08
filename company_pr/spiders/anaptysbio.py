from scrapy.http import TextResponse

from crawler.base import FeedNewsSpider


class AnaptysbioSpider(FeedNewsSpider):
    """The sitemap lists every release (194, back to 2013, same as the IR
    listing). Its lastmod is the last edit, so it only approximates the release
    date for ordering; the date itself comes from the page."""

    name = "anaptysbio"
    impersonate = "chrome"
    feed_urls = ["https://ir.anaptysbio.com/sitemap.xml"]
    url_filter = ["/news-releases/news-release-details/"]
    title_xpath = '//div[contains(@class,"field--name-field-nir-news-title")]//text()'
    date_xpath = '//div[contains(@class,"news-date")]//div[contains(@class,"field__item")]/text()'
    content_xpath = '//div[contains(@class,"full-release-body")]'

    def parse_article(self, response, feed_date=None, feed_title=None):
        body = response.xpath(self.content_xpath) if isinstance(response, TextResponse) else None
        pdf = body.xpath('.//div[contains(@class,"file-link")]//a/@href').get() if body else None
        if pdf and not body.xpath(".//p"):
            # Release published only as an attached PDF: take its text instead.
            yield response.follow(
                pdf,
                callback=self.parse_pdf,
                cb_kwargs={
                    "page_url": response.url,
                    "title": " ".join(response.xpath(self.title_xpath).getall()),
                    "date": response.xpath(self.date_xpath).get(),
                },
            )
            return
        yield from super().parse_article(response, feed_date, feed_title)

    def parse_pdf(self, response, page_url, title, date):
        item = self.pdf_item(response, title=title, date=date)
        if item:
            item["news_url"] = page_url
            yield item
