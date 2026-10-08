from crawler.base import FeedNewsSpider


class TevaSpider(FeedNewsSpider):
    name = "teva"
    impersonate = "chrome"
    feed_urls = ["https://www.tevapharm.com/sitemap.xml"]
    url_filter = ["/news-and-media/latest-news/"]
    title_xpath = "//h1//text()"
    date_xpath = "//div[@class='vi-article-meta-data__slices']//time/text()"
    content_xpath = '//div[@class="vi-content-layout__main"]/div[last()]'
