from crawler.base import FeedNewsSpider


class GskSpider(FeedNewsSpider):
    name = "gsk"
    feed_urls = ["https://www.gsk.com/en-gb/media/rss/"]
    url_filter = ["/media/press-releases/"]
    title_xpath = "//h1//text()"
    date_xpath = "//time/@datetime"
    date_order = "DMY"
    content_xpath = '//div[contains(@class, "main-container rte child-component")]//div[@class="content-wrapper"]'
