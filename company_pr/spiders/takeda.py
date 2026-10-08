"""Takeda newsroom (2014 onwards, plus the Shire archive 2013-2019).

Older releases use a non-markdown article template, hence two content
selectors; some Shire releases are only a link to their PDF version. The /20
suffix in url_filter skips the section index pages.
"""

from scrapy.http import TextResponse

from crawler.base import FeedNewsSpider

SECTIONS = ("newsreleases", "news-releases", "local-newsreleases", "press-releases", "statements", "shire-news-releases")


class TakedaSpider(FeedNewsSpider):
    name = "takeda"
    feed_urls = ["https://www.takeda.com/sitemap-en.xml"]
    url_filter = [f"/newsroom/{section}/20" for section in SECTIONS]
    title_xpath = '(//main//h2[contains(@class, "title")])[1]//text()'
    date_xpath = '//main//div[contains(@class, "PublishDate-module")]/span[1]/text()'
    # Markdown blocks also hold a hidden raw-markdown copy (<span class="hidden">).
    content_xpath = (
        '//main//div[contains(@class, "MarkdownRedesign-module")]/div'
        ' | //main//div[contains(@class, "ArticleContentSectionRedesignNonMD")]'
    )

    def parse_article(self, response, feed_date=None, feed_title=None):
        if isinstance(response, TextResponse):
            body = response.xpath(self.content_xpath)
            pdf = body.xpath('.//a/@href[contains(., ".pdf")]').get()
            if pdf and len(" ".join(body.xpath("normalize-space()").getall())) < 300:
                # "Please download the file below ... Click here for the PDF version"
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
