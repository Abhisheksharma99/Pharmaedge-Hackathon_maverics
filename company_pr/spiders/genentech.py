from crawler.base import FeedNewsSpider


class GenentechSpider(FeedNewsSpider):
    name = "genentech"
    # Sitemap links (/press-releases/<id>?{all}=<date>/<slug>) redirect to the clean URL.
    feed_urls = ["https://www.gene.com/sitemap"]
    url_filter = ["/media/press-releases/"]
    title_xpath = '//div[@class="block-basic"]/h2//text()'
    date_xpath = '//div[@class="block-basic"]/p[1]/text()'
    # Skip the date line and the headline at the top of the block.
    content_xpath = '//div[@class="block-basic"]/*[position() > 2]'
