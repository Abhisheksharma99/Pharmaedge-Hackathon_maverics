from urllib.parse import quote

from crawler.config import BASILEA_KEYWORDS
from spiders.globenewswire import GlobenewswireSpider


class GlobenewswireBasileaSpider(GlobenewswireSpider):
    name = "globenewswire_basilea"
    aggregator_source = "globenewswire_basilea"
    search_paths = BASILEA_KEYWORDS

    def search_path(self, keyword):
        return f"keyword/{quote(keyword)}"
