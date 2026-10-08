import scrapy

from crawler.base import NewsSpider


class AlnylamSpider(NewsSpider):
    """The IR site's JSON API pages through the whole archive (2016 onwards),
    newest first. Pages start at 1 (page 0 repeats page 1)."""

    name = "alnylam"
    allowed_domains = ["investors.alnylam.com"]
    api_url = "https://investors.alnylam.com/api/v1/press_release?page={}"

    async def start(self):
        yield self.listing_request(1)

    def listing_request(self, page):
        return scrapy.Request(
            self.api_url.format(page),
            headers={
                "Accept": "application/json, */*",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": "https://investors.alnylam.com/press-releases",
            },
            callback=self.parse_listing,
            cb_kwargs={"page": page},
            dont_filter=True,
        )

    def parse_listing(self, response, page):
        data = response.json()
        rows = data.get("tabledata") or []
        new = self.new_on_listing(response.urljoin(row["link"]["link"]) for row in rows)
        for row in rows:
            url = response.urljoin(row["link"]["link"])
            if url in new and self.want(url):
                yield scrapy.Request(
                    url,
                    callback=self.parse_release,
                    cb_kwargs={"title": row["link"]["title"], "date": row["date"]},
                )
        last_page = min(data.get("paggerCount") or 10**9, self.page_cap(60))
        if new and self.budget_left and page < last_page:
            yield self.listing_request(page + 1)

    def parse_release(self, response, title, date):
        paras = response.xpath("//div[@class='col-sm-9']//p[not(contains(@class,'event-date'))]").getall()
        yield self.make_item(response, title=title, date=date, content="\n".join(paras))
