"""Amgen press releases, walked one year at a time (archive back to 2002).

Uses the listing service's GetNewsReleases method: the GetNewsReleasesV2 call
made by the website stops after the newest 1000 releases (December 2014).
"""

from datetime import date

import scrapy

from crawler.base import NewsSpider

API_URL = (
    "https://www.amgen.com/MyApi/Custom/NewsListing/GetNewsReleases"
    "?rootId={{623B9876-33FF-40EB-BDA0-8465365C59C8}}&selectedYear={year}&isNasdaq=true"
)


class AmgenSpider(NewsSpider):
    name = "amgen"
    allowed_domains = ["www.amgen.com"]
    date_order = "MDY"
    title_xpath = '//div[@class="news-articles-container"]//h1//text()'
    # Body is usually wrapped in div.xn-content, but some releases put it directly in the section.
    content_xpath = '//div[@class="news-articles-container"]//section[contains(@class,"m-article")]/*[not(self::h1)]'

    async def start(self):
        yield self.year_request(date.today().year, empty_years=0)

    def year_request(self, year, empty_years):
        return scrapy.Request(
            API_URL.format(year=year),
            callback=self.parse_year,
            cb_kwargs={"year": year, "empty_years": empty_years},
            headers={"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )

    def parse_year(self, response, year, empty_years):
        releases = {
            response.urljoin(r["Url"]): r
            for month in response.json() or []
            for r in month.get("NewsReleases") or []
        }
        fresh = self.new_on_listing(releases)
        for url in fresh:
            if self.want(url):
                release = releases.get(url, {})
                yield scrapy.Request(
                    url,
                    callback=self.parse_article,
                    cb_kwargs={"feed_date": release.get("Date"), "feed_title": release.get("Title")},
                )
        # Two empty years in a row: the archive has ended.
        empty_years = 0 if fresh else empty_years + 1
        years_done = date.today().year - year + 1
        if empty_years < 2 and self.budget_left and years_done < self.page_cap(10):
            yield self.year_request(year - 1, empty_years)
