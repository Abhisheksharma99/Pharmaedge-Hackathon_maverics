import scrapy

from crawler.base import NewsSpider

# English media releases, newest first (language=4176 is English; archive back to 2015).
LISTING_URL = "https://www.novartis.com/news/newsroom?type=media_release&language=4176&page={}"


class NovartisSpider(NewsSpider):
    name = "novartis"
    allowed_domains = ["novartis.com"]
    title_xpath = "//h1//text()"
    content_xpath = '//div[@class="page_content"]'

    async def start(self):
        yield self.listing_request(0)

    def listing_request(self, page):
        return scrapy.Request(
            LISTING_URL.format(page), callback=self.parse_listing, cb_kwargs={"page": page}
        )

    def parse_listing(self, response, page):
        items = response.xpath('//li[contains(@class,"each-item")]/a[contains(@href,"/news/media-releases/")]')
        dates = {response.urljoin(a.attrib["href"]): a.xpath("normalize-space(.//time)").get() for a in items}
        fresh = self.new_on_listing(dates)
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article, cb_kwargs={"feed_date": dates.get(url)})
        if fresh and self.budget_left and page < self.page_cap(150):
            yield self.listing_request(page + 1)
