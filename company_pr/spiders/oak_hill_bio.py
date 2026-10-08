import scrapy

from crawler.base import NewsSpider


class OakHillBioSpider(NewsSpider):
    name = "oak_hill_bio"
    allowed_domains = ["www.oakhillbio.com"]
    title_xpath = "//h1//text()"
    date_xpath = '//div[@class="news-post-header_date-wrapper"]/div/text()'
    content_xpath = '//div[@class="news-post-content_content"]/div'

    async def start(self):
        yield scrapy.Request("https://www.oakhillbio.com/press", callback=self.parse_listing)

    def parse_listing(self, response):
        for url in response.xpath('//a[contains(@href,"/news/")]/@href').getall():
            if self.want(response.urljoin(url)):
                yield response.follow(url, callback=self.parse_article)
