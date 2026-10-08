import scrapy

from crawler.base import NewsSpider


class BasileaSpider(NewsSpider):
    name = "basilea"
    allowed_domains = ["www.basilea.com"]
    title_xpath = '//div[@class="hero_header"]/h2//text()'
    date_xpath = '//div[@class="hero_subheader"]/text()'
    # Some old releases start with a paragraph of escaped HTML ("<html xmlns=...").
    content_xpath = (
        '//div[contains(@class,"news-single")]//div[@class="mod_text"]'
        '/*[not(starts-with(normalize-space(), "<html"))]'
    )

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        url = "https://www.basilea.com/news" + (f"/page-{page}" if page > 1 else "")
        return scrapy.Request(url, callback=self.parse_listing, cb_kwargs={"page": page})

    def parse_listing(self, response, page):
        links = response.xpath(
            '//div[contains(@class,"news_item article")]/div[@class="news_item_links"]/a[contains(@class,"var_more")]'
        )
        # Out-of-range page numbers return the last page again.
        fresh = self.new_on_listing([response.urljoin(a.attrib["href"]) for a in links])
        for a in links:
            url = response.urljoin(a.attrib["href"])
            # Securities-offering releases sit behind a "Swiss residents only" legal gate.
            if url in fresh and a.attrib.get("data-swissaccessonly") != "1" and self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        if fresh and self.budget_left and page < self.page_cap(50):
            yield self.listing_request(page + 1)
