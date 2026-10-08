"""News is split into three categories, each listed newest-first. All listing
pages are read (categories in parallel) before any article is requested, so the
newest articles across categories come first."""

import scrapy

from crawler.base import NewsSpider

CATEGORIES = [1, 2, 3]  # Company News, Product News, Scientific Progress
META = '//div[@class="newsdbox"]/div[contains(@class, "time")]'  # "Company News • 2026年03月27日"


class KeymedBioscienceSpider(NewsSpider):
    name = "keymed_bioscience"
    allowed_domains = ["en.keymedbio.com"]
    title_xpath = '//div[@class="newsdbox"]/div[contains(@class, "ft_46")]//text()'
    date_xpath = f"{META}/text()[last()]"
    tags_xpath = f"{META}/text()[1]"
    content_xpath = '//div[@class="newsdbox"]/div[contains(@class, "box")]'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.found = {}  # article url -> listing date
        self.pending = 0

    async def start(self):
        for category in CATEGORIES:
            yield self.listing_request(category, 1)

    def listing_request(self, category, page):
        self.pending += 1
        return scrapy.Request(
            f"https://en.keymedbio.com/en/news.html?type={category}&page={page}",
            callback=self.parse_listing,
            errback=self.listing_failed,
            cb_kwargs={"category": category, "page": page},
        )

    def parse_listing(self, response, category, page):
        self.pending -= 1
        dates = {
            response.urljoin(box.xpath("./a/@href").get()):
                box.xpath('normalize-space(.//div[@class="time"])').get()
            for box in response.xpath('//div[@class="box"]/div[@class="box_sm"]')
        }
        new = self.new_on_listing(dates)
        self.found.update((url, dates[url]) for url in new)
        has_next = response.xpath('//ul[@class="pagination"]//a[text()="»"]')
        if new and has_next and page < self.page_cap(10):
            yield self.listing_request(category, page + 1)
        yield from self.request_articles()

    def listing_failed(self, failure):
        self.pending -= 1
        self.logger.error(f"Listing page failed: {failure.request.url}: {failure.value!r}")
        yield from self.request_articles()

    def request_articles(self):
        if self.pending:
            return
        for url, _ in sorted(self.found.items(), key=lambda e: e[1], reverse=True):
            if not self.budget_left:
                break
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
