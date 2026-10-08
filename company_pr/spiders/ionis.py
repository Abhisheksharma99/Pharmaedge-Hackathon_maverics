"""ir.ionis.com (Akamai) refuses a client session that sends bursts (8 parallel
requests: blocked after ~200 pages) or more than ~500 pages in total (403s,
then HTTP/2 stream resets), even when paced; a fresh session is served again
at once. Pages are fetched one at a time; when the site refuses, the download
handler (crawler/handlers.py) starts a new browser session and refused
releases are re-queued. The spider only gives up after 10 refusals in a row;
then rerun with --new-only to resume.
"""

import scrapy
from scrapy.exceptions import CloseSpider

from crawler.base import NewsSpider


class IonisSpider(NewsSpider):
    name = "ionis"
    impersonate = "chrome"
    allowed_domains = ["ir.ionis.com"]
    listing_url = "https://ir.ionis.com/investor-news/press-releases"
    custom_settings = {"CONCURRENT_REQUESTS": 1}
    refusals = 0

    async def start(self):
        yield scrapy.Request(self.listing_url, callback=self.parse_filters)

    def parse_filters(self, response):
        # The listing defaults to the current year; "_none" on its year filter
        # returns every release (2002 onwards, newest first) on a single page.
        year_field = response.xpath('//select[contains(@id,"year-value")]/@name').get()
        if not year_field:
            self.logger.warning("Year filter not found: only the current year is listed")
        yield scrapy.FormRequest(
            self.listing_url,
            method="GET",
            formdata={year_field: "_none"} if year_field else {},
            callback=self.parse_listing,
            dont_filter=True,
        )

    def parse_listing(self, response):
        for row in response.xpath('//div[contains(@class,"nir-widget--list")]//article'):
            if not self.budget_left:
                break
            link = row.xpath('.//div[contains(@class,"nir-widget--news--headline")]//a')
            href = link.attrib.get("href", "")
            # Three old rows link off-site (ir.akceatx.com, shareholder.com PDFs); all dead.
            if not href.startswith("/"):
                continue
            url = response.urljoin(href)
            if self.want(url):
                yield scrapy.Request(
                    url,
                    callback=self.parse_release,
                    errback=self.refused,
                    meta={"handle_httpstatus_list": [403]},
                    cb_kwargs={
                        "title": link.xpath("string()").get(),
                        "date": row.xpath('.//div[@data-label="Date"]/text()').get(),
                    },
                )

    def parse_release(self, response, title, date):
        if response.status == 403:
            yield from self.refused(response)
            return
        self.refusals = 0
        content = response.xpath('//div[@class="full-release-body"]').get()
        yield self.make_item(response, title=title, date=date, content=content)

    def refused(self, failure_or_response):
        request = failure_or_response.request
        self.refusals += 1
        if self.refusals >= 10:
            raise CloseSpider("refused: ir.ionis.com blocks this session, rerun with --new-only")
        tries = request.meta.get("refused_tries", 0)
        if tries < 2:
            yield request.replace(dont_filter=True, meta={**request.meta, "refused_tries": tries + 1})
        else:
            self.release(request.url)
