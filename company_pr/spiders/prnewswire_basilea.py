from crawler.config import BASILEA_KEYWORDS
from spiders.prnewswire import PrnewswireSpider


class PrnewswireBasileaSpider(PrnewswireSpider):
    name = "prnewswire_basilea"
    aggregator_source = "prnewswire_basilea"
    keywords = BASILEA_KEYWORDS
