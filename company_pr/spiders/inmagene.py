"""Inmagene merged with Ikena Oncology and now operates as ImageneBio (Nasdaq: IMA).

inmagenebio.com/news is gone (redirects to imagenebio.com, 404). The Nasdaq IR
site lists every release, including Inmagene's own back to 2020, under the
"ImageneBio" news category (the other category holds Ikena Oncology's
pre-merger releases). The listing is filtered through its Drupal widget form
(year "_none" = all years). Its RSS feed only carries the newest 10.
"""

import scrapy

from crawler.base import NewsSpider


class InmageneSpider(NewsSpider):
    name = "inmagene"
    impersonate = "chrome"
    allowed_domains = ["ir.imagenebio.com"]
    title_xpath = '//article[contains(@class,"node--nir-news--full")]//div[contains(@class,"field--name-field-nir-news-title")]//text()'
    date_xpath = '//article[contains(@class,"node--nir-news--full")]//div[contains(@class,"field--name-field-nir-news-date")]//text()'
    content_xpath = '//article[contains(@class,"node--nir-news--full")]/div[@class="node__content"]/*[not(contains(@class,"file-link"))]'

    async def start(self):
        yield scrapy.Request("https://ir.imagenebio.com/news", callback=self.filter_listing)

    def filter_listing(self, response):
        """Submit the listing's filter form: category ImageneBio, all years."""
        form = response.xpath('//form[@id="widget-form-base"]')
        data = {i.attrib["name"]: i.attrib.get("value", "") for i in form.xpath('.//input[@type="hidden"][@name]')}
        for select in form.xpath(".//select[@name]"):
            name = select.attrib["name"]
            if "news_category" in name:
                data[name] = select.xpath('./option[normalize-space()="ImageneBio"]/@value').get("")
            elif "_year" in name:
                data[name] = "_none"
        data["op"] = "Filter"
        yield scrapy.FormRequest(
            response.urljoin(form.attrib.get("action", "/news")), method="GET", formdata=data,
            callback=self.parse_listing, cb_kwargs={"page": 1},
        )

    def parse_listing(self, response, page):
        links = response.xpath(
            '//article[contains(@class,"nir-widget-list")]//div[contains(@class,"news--headline")]/a/@href'
        ).getall()
        fresh = self.new_on_listing([response.urljoin(u) for u in links])
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_article)
        next_page = response.xpath('//a[@rel="next"]/@href').get()
        if fresh and next_page and self.budget_left and page < self.page_cap(10):
            yield response.follow(next_page, callback=self.parse_listing, cb_kwargs={"page": page + 1})
