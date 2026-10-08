import scrapy

from crawler.base import NewsSpider

HEADLINES_URL = (
    "https://www.bayer.com/media/services/getheadlines.php"
    "?child_ids=2809&newsroom_lang=en-us&limitstart={start}&limitend={count}"
)


class BayerSpider(NewsSpider):
    """Bayer (en-us newsroom) press releases; the headline service goes back to mid-2017."""

    name = "bayer"
    allowed_domains = ["bayer.com"]
    custom_settings = {"DOWNLOAD_DELAY": 0.5}
    page_size = 50
    content_xpath = '//div[@class="text_companyprofile"]//div//p'

    async def start(self):
        yield self.headlines_request(0)

    def headlines_request(self, start):
        return scrapy.Request(
            HEADLINES_URL.format(start=start, count=self.page_size),
            callback=self.parse_headlines,
            cb_kwargs={"start": start},
            headers={"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )

    def parse_headlines(self, response, start):
        releases = {r["caseurl"].strip(): r for r in (response.json() or {}).values()}
        fresh = self.new_on_listing(releases)
        for url in fresh:
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_release, cb_kwargs={"release": releases[url]})
        if fresh and self.budget_left and start < self.page_cap(40) * self.page_size:
            yield self.headlines_request(start + self.page_size)

    def parse_release(self, response, release):
        yield self.make_item(
            response,
            title=release["title"],
            date=release["date"],
            content="\n".join(response.xpath(self.content_xpath).getall()),
            tags=release.get("tag_names"),
        )
