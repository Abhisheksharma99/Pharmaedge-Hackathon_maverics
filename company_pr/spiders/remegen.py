"""English news: "Company News" (cid 115) and, once that is exhausted, the small
"Media Reports" section (cid 116). A few releases are only a PDF attachment
(hosted on remegen.cn); their text is taken from the PDF."""

import scrapy

from crawler.base import NewsSpider

SECTIONS = [115, 116]
TITLE = '//div[@class="articleTop"]//div[@class="title"]/h1'
BODY = '//div[@class="articleTop"]//div[@class="content"]'


class RemegenSpider(NewsSpider):
    name = "remegen"
    allowed_domains = ["remegen.com", "remegen.cn"]
    title_xpath = f"{TITLE}//text()"
    date_xpath = '//div[@class="articleTop"]//div[@class="title"]/p/span/text()'
    content_xpath = BODY

    async def start(self):
        yield self.listing_request(0, 1)

    def listing_request(self, section, page):
        return scrapy.Request(
            f"https://www.remegen.com/index.php?v=listing&cid={SECTIONS[section]}&page={page}",
            callback=self.parse_listing,
            cb_kwargs={"section": section, "page": page},
        )

    def parse_listing(self, response, section, page):
        hrefs = response.xpath('//ul[contains(@class, "gsdtarticleList")]/li/a/@href').getall()
        new = self.new_on_listing(map(response.urljoin, hrefs))
        for url in new:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if not self.budget_left:
            return
        total = int(response.xpath('//div[@class="pageBox"]/span[@class="total"]/text()').get() or 0)
        if new and (not total or page < total) and page < self.page_cap(30):
            yield self.listing_request(section, page + 1)
        elif section + 1 < len(SECTIONS):
            yield self.listing_request(section + 1, 1)

    def parse_article(self, response):
        pdf = response.xpath(f'{BODY}//a[contains(@href, ".pdf")]/@href').get()
        if pdf and len(response.xpath(f"normalize-space({BODY})").get()) < 200:
            yield response.follow(
                pdf,
                callback=self.parse_pdf,
                cb_kwargs={
                    "page_url": response.url,
                    "title": response.xpath(f"normalize-space({TITLE})").get(),
                    "date": response.xpath(self.date_xpath).get(),
                },
            )
        else:
            yield from super().parse_article(response)

    def parse_pdf(self, response, page_url, title, date):
        # Keep the listed article page (which links the PDF) as the URL.
        item = self.pdf_item(response, title=title, date=date, url=page_url)
        if item:
            yield item
