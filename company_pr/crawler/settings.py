"""Scrapy settings shared by every company press-release spider."""

BOT_NAME = "company_pr"

SPIDER_MODULES = ["spiders"]
NEWSPIDER_MODULE = "spiders"
# A spider file that fails to import is skipped instead of aborting the run.
SPIDER_LOADER_WARN_ONLY = True

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)
DEFAULT_REQUEST_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,"
    "image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
ROBOTSTXT_OBEY = False
COOKIES_ENABLED = True

# Politeness / throughput. These limits apply per spider (each spider has its
# own downloader), so running all spiders at once stays gentle on each site.
CONCURRENT_REQUESTS = 8
CONCURRENT_REQUESTS_PER_DOMAIN = 4
DOWNLOAD_DELAY = 0.25
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 0.5
AUTOTHROTTLE_MAX_DELAY = 10
AUTOTHROTTLE_TARGET_CONCURRENCY = 2.0
DOWNLOAD_TIMEOUT = 40
RETRY_TIMES = 2
# A single slow or blocked site must never hold up the whole run
# (run.py disables this for full-history runs, see --timeout).
CLOSESPIDER_TIMEOUT = 900

# curl_cffi browser impersonation for protected sites (see handlers.py); as a
# download handler it is subject to the delays/concurrency limits above.
DOWNLOAD_HANDLERS = {
    "http": "crawler.handlers.ImpersonateDownloadHandler",
    "https": "crawler.handlers.ImpersonateDownloadHandler",
}

# First-in-first-out: articles are fetched in the order spiders yield them
# (newest first), so an interrupted full-history run loses the oldest items.
SCHEDULER_MEMORY_QUEUE = "scrapy.squeues.FifoMemoryQueue"
SCHEDULER_DISK_QUEUE = "scrapy.squeues.PickleFifoDiskQueue"

ITEM_PIPELINES = {
    "crawler.pipelines.CleanPipeline": 100,
    "crawler.pipelines.ValidatePipeline": 200,
    "crawler.pipelines.DedupePipeline": 300,
    "crawler.pipelines.SeenPipeline": 400,
}

FEED_EXPORT_ENCODING = "utf-8"

TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"

LOG_LEVEL = "INFO"
# 85 crawlers in one process would exhaust the telnet port range.
TELNETCONSOLE_ENABLED = False

# ---- Project specific (overridable from run.py) ----
# Max articles each spider fetches per run (0 = unlimited / full history).
PR_LIMIT = 25
# Drop articles published before this date (YYYY-MM-DD, empty = no cutoff).
PR_SINCE = ""
# File of already-scraped URLs (run.py keeps it next to the run folders);
# when PR_NEW_ONLY is on, those URLs are skipped.
PR_SEEN_FILE = "output/seen_urls.txt"
PR_NEW_ONLY = False
