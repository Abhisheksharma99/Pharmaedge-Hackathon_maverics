"""Huabo's English press releases are those of its parent Huaota, whose own site
(huaota.com, same CMS) also lists a few that huabobio.com lacks and still has the
full text of several older releases that huabobio.com reduced to the headline.
Both lists are read first; each release is taken from huabobio.com, falling back
to its huaota.com copy (same id and date, or same title) when the body is only
the headline, and releases listed only on huaota.com are added."""

import scrapy

from crawler.base import NewsSpider

SITES = ["https://www.huabobio.com", "https://www.huaota.com"]


def _norm(text):
    return " ".join((text or "").split()).casefold()


class HuabobioSpider(NewsSpider):
    name = "huabobio"
    allowed_domains = ["huabobio.com", "huaota.com"]
    title_xpath = '//div[@class="show_title"]/h3//text()'
    date_xpath = '//div[@class="show_title"]/span[@class="date"]/text()'
    content_xpath = '//div[@class="show_content"]'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.listed = {site: {} for site in SITES}  # url -> (date, title)
        self.pending = 0

    async def start(self):
        for site in SITES:
            yield self.listing_request(site, 1)

    def listing_request(self, site, page):
        self.pending += 1
        return scrapy.Request(
            f"{site}/en/news/1/{page}.html",  # "Press Releases"
            callback=self.parse_listing,
            errback=self.listing_failed,
            cb_kwargs={"site": site, "page": page},
        )

    def parse_listing(self, response, site, page):
        self.pending -= 1
        entries = {}
        for link in response.xpath('//div[@class="inews"]//li/a'):
            month = link.xpath('normalize-space(.//div[@class="inews_date"]/span)').get()
            day = link.xpath('normalize-space(.//div[@class="inews_date"]/p)').get()
            title = link.xpath('normalize-space(.//div[@class="inews_txt1"])').get()
            # huaota.com lists http:// links that redirect to https://.
            url = response.urljoin(link.attrib["href"]).replace("http://", "https://", 1)
            entries[url] = (f"{month}-{day}", title)
        new = self.new_on_listing(entries)
        self.listed[site].update((url, entries[url]) for url in new)
        if new and page < self.page_cap(10):
            yield self.listing_request(site, page + 1)
        yield from self.request_articles()

    def listing_failed(self, failure):
        self.pending -= 1
        self.logger.error(f"Listing page failed: {failure.request.url}: {failure.value!r}")
        yield from self.request_articles()

    def request_articles(self):
        if self.pending:
            return
        huabo, huaota = (self.listed[site] for site in SITES)
        copies = {}
        for url, (date, title) in huaota.items():
            copies[(url.rsplit("/", 1)[-1], date)] = url
            copies[_norm(title)] = url
        releases = []
        for url, (date, title) in huabo.items():
            twin = copies.get((url.rsplit("/", 1)[-1], date)) or copies.get(_norm(title))
            releases.append((date, url, twin))
        twins = {twin for _, _, twin in releases}
        releases += [(date, url, None) for url, (date, _) in huaota.items() if url not in twins]
        for _, url, twin in sorted(releases, reverse=True):
            if not self.budget_left:
                break
            if self.want(url):
                yield scrapy.Request(url, callback=self.parse_release, cb_kwargs={"twin": twin})

    def parse_release(self, response, twin=None):
        title = _norm(response.xpath("string(//div[@class='show_title']/h3)").get())
        body = _norm(response.xpath("string(//div[@class='show_content'])").get())
        if len(body.replace(title, "")) >= 80:
            yield from self.parse_article(response)
        elif twin:
            self.release(response.url)
            if self.want(twin):
                yield scrapy.Request(twin, callback=self.parse_article)
        else:
            self.logger.info(f"No article body (only the headline): {response.url}")
