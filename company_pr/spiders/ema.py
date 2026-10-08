"""European Medicines Agency news.

The news come from EMA's daily JSON export of all news items (title,
first-published date, topics, URL; ~3,900 items back to 1994) instead of the
paginated /en/news listing, which intermittently answers page 1 for any page
number. News items up to ~2008 are only a stub page around a PDF press
release; for those the PDF text is used. EMA answers bursts with HTTP 429,
hence the slow pace.
"""

import scrapy

from crawler.base import NewsSpider

NEWS_JSON = "https://www.ema.europa.eu/en/documents/report/news-json-report_en.json"
MAIN = '//div[@class="main-content"]//div[contains(@class,"node-content-wrapper")]'


class EmaSpider(NewsSpider):
    name = "ema"
    category = "agency"
    allowed_domains = ["www.ema.europa.eu"]
    channel = "european_medicines_agency"
    aggregator_source = "european_medicines_agency"
    custom_settings = {"DOWNLOAD_DELAY": 1.5, "CONCURRENT_REQUESTS_PER_DOMAIN": 1}
    date_order = "DMY"  # the export's dates are dd/mm/yyyy
    title_xpath = '//h1[contains(@class,"content-banner-title")]//text()'
    date_xpath = '//meta[@property="article:published_time"]/@content'
    # Body text only: not the PDF cards or the "References"/"News"/"Related" sections.
    content_xpath = (
        f"{MAIN}/div[@class='item'][not(.//*[contains(@class,'related-section-wrapper')]"
        " or .//*[contains(@class,'paragraph--type--ema-documents')])]"
    )
    pdf_xpath = f"{MAIN}//*[contains(@class,'paragraph--type--ema-documents')]//a[contains(@href,'.pdf')]/@href"

    async def start(self):
        yield scrapy.Request(NEWS_JSON, callback=self.parse_index)

    def parse_index(self, response):
        since = (self.settings.get("PR_SINCE") or "").replace("-", "")
        news = [(_yyyymmdd(n["first_published_date"]), n) for n in response.json()["data"]]
        news.sort(key=lambda e: e[0], reverse=True)
        for published, n in news:
            if not self.budget_left or published < since:
                break
            if self.want(n["news_url"]):
                yield scrapy.Request(n["news_url"], callback=self.parse_news, cb_kwargs={"news": n})

    def parse_news(self, response, news):
        tags = [t for t in news["topics"].split(";") if t]
        body = response.xpath(self.content_xpath).getall()
        pdf = response.xpath(self.pdf_xpath).get()
        if not body and pdf:
            yield response.follow(pdf, callback=self.parse_pdf, cb_kwargs={"news": news, "tags": tags})
            return
        yield self.make_item(
            response,
            title=" ".join(t.strip() for t in response.xpath(self.title_xpath).getall() if t.strip())
            or news["title"],
            date=response.xpath(self.date_xpath).get() or news["first_published_date"],
            content="\n".join(body),
            tags=tags,
        )

    def parse_pdf(self, response, news, tags):
        item = self.pdf_item(
            response, url=news["news_url"], title=news["title"], date=news["first_published_date"], tags=tags
        )
        if item:
            yield item


def _yyyymmdd(ddmmyyyy):
    return "".join(reversed(ddmmyyyy.split("/")))
