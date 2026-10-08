"""PR Newswire keyword search (results are listed newest first).

The site search only covers roughly the last 12 months (no date or archive
parameters exist), so even a full-history run (--limit 0) cannot reach older
releases. In normal runs the budget is split evenly across keywords: each
keyword is paginated only until it has scheduled its share of articles.
"""

import math
import re
from urllib.parse import quote_plus

import scrapy

from crawler.base import NewsSpider
from crawler.config import SEARCH_KEYWORDS

HEADER = '//header[contains(@class,"release-header")]'


class PrnewswireSpider(NewsSpider):
    name = "prnewswire"
    category = "wire"
    aggregator_source = "prnewswire"
    keywords = SEARCH_KEYWORDS
    page_size = 100  # the largest page size the search accepts
    custom_settings = {"RETRY_TIMES": 5}  # the site sheds load with 503s

    title_xpath = f"{HEADER}//h1//text()"
    date_xpath = f'{HEADER}//p[contains(@class,"mb-no")]/text()'
    # Skip the trailing "21% more press release views" advert row; releases with
    # a photo gallery keep their text outside release-body.
    content_xpath = (
        '//section[contains(@class,"release-body")]/div[not(.//*[@class="valueText"])]'
        ' | //body/div[contains(@class,"row")]/div[contains(@class,"col-sm-10")][p]'
    )
    tags_xpath = '//div[contains(@class,"explore-section")]//p/a/text()'
    channel_xpath = f"{HEADER}//a/strong/text()"

    async def start(self):
        self.quota = math.ceil(self.limit / len(self.keywords)) if self.limit and self.keywords else None
        for keyword in self.keywords:
            yield self.search_request(keyword, 1, listed=set(), scheduled=0)

    def search_request(self, keyword, page, **state):
        return scrapy.Request(
            f"https://www.prnewswire.com/search/news/?keyword={quote_plus(keyword)}"
            f"&page={page}&pagesize={self.page_size}",
            callback=self.parse_search,
            cb_kwargs={"keyword": keyword, "page": page, **state},
        )

    def parse_search(self, response, keyword, page, listed, scheduled):
        links = [response.urljoin(h) for h in response.xpath('//a[@class="news-release"]/@href').getall()]
        # Links new to this keyword's search: ends pagination on an empty or
        # repeated page (tracked per keyword since keywords share releases).
        fresh = [u for u in links if "/news-releases/" in u and u not in listed]
        listed.update(fresh)
        for url in fresh:
            if self.quota and scheduled >= self.quota:
                return
            if self.want(url):
                scheduled += 1
                yield scrapy.Request(url, callback=self.parse_article)
        total = re.search(r"of\s+([\d,]+)", " ".join(response.xpath(
            '//section[contains(@class,"search-results-meta")]//text()').getall()))
        total = int(total[1].replace(",", "")) if total else None
        self.logger.info(f"'{keyword}' page {page}: {len(fresh)} new of {total} results, {scheduled} scheduled")
        more = fresh and (total is None or page * self.page_size < total)
        if more and self.budget_left and page < self.page_cap(10):
            yield self.search_request(keyword, page + 1, listed=listed, scheduled=scheduled)

    def parse_article(self, response):
        title = response.xpath(self.title_xpath).getall()
        yield self.make_item(
            response,
            title=" ".join(t.strip() for t in title if t.strip()),
            date=response.xpath(self.date_xpath).get(),
            content="\n".join(response.xpath(self.content_xpath).getall()),
            tags=response.xpath(self.tags_xpath).getall(),
            channel=response.xpath(self.channel_xpath).get(),
        )
