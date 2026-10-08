"""Item pipelines: normalise -> validate -> de-duplicate.

These replace the old pandas post-processing (clean_data / clean_date_* /
clean_content_* / drop_duplicates / dropna) that ran in spider_closed().
"""

from datetime import datetime, timezone
from pathlib import Path

from scrapy.exceptions import DropItem

from crawler.helpers import clean_text, html_to_text, parse_date, url_id

MIN_CONTENT_CHARS = 80


class _Pipeline:
    def __init__(self, crawler):
        self.crawler = crawler

    @classmethod
    def from_crawler(cls, crawler):
        return cls(crawler)

    @property
    def spider(self):
        return self.crawler.spider


class CleanPipeline(_Pipeline):
    def process_item(self, item, spider=None):
        spider = self.spider
        order = getattr(spider, "date_order", None)
        langs = getattr(spider, "date_languages", None)

        item["news_url"] = (item.get("news_url") or "").strip() or None
        item["news_url_id"] = url_id(item["news_url"]) if item["news_url"] else None
        item["title"] = clean_text(item.get("title"))
        item["news_date"] = parse_date(item.get("news_date"), order, langs)
        item["news_modified_date"] = parse_date(item.get("news_modified_date"), order, langs)
        item["content"] = html_to_text(item.get("content"))
        item["tags"] = _clean_tags(item.get("tags"))
        item["channel"] = clean_text(item.get("channel"))
        item["aggregator_source"] = clean_text(item.get("aggregator_source"))
        item["spider"] = spider.name
        item["scraped_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        return item


class ValidatePipeline(_Pipeline):
    def __init__(self, crawler):
        super().__init__(crawler)
        self.since = crawler.settings.get("PR_SINCE") or None

    def process_item(self, item, spider=None):
        missing = [f for f in ("news_url", "title", "news_date") if not item.get(f)]
        if missing:
            self.crawler.stats.inc_value("pr/dropped/missing_fields")
            raise DropItem(f"missing {', '.join(missing)}: {item.get('news_url')}")
        if not item.get("content") or len(item["content"]) < MIN_CONTENT_CHARS:
            self.crawler.stats.inc_value("pr/dropped/no_content")
            raise DropItem(f"no content: {item['news_url']}")
        if self.since and item["news_date"] < self.since:
            self.crawler.stats.inc_value("pr/dropped/too_old")
            raise DropItem(f"older than {self.since}: {item['news_url']}")
        return item


class DedupePipeline(_Pipeline):
    def __init__(self, crawler):
        super().__init__(crawler)
        self.urls = set()
        self.titles = set()

    def process_item(self, item, spider=None):
        # Title + date: recurring releases ("Inducement Grants ...") reuse
        # titles, but the same release on two URLs shares both.
        title_key = (item["title"].casefold(), item["news_date"])
        if item["news_url"] in self.urls or title_key in self.titles:
            self.crawler.stats.inc_value("pr/dropped/duplicate")
            raise DropItem(f"duplicate: {item['news_url']}")
        self.urls.add(item["news_url"])
        self.titles.add(title_key)
        return item


def _clean_tags(tags):
    if not tags:
        return []
    if isinstance(tags, str):
        tags = [t for t in tags.replace(";", ",").split(",")]
    out = []
    for tag in tags:
        tag = clean_text(tag)
        if tag and tag not in out:
            out.append(tag)
    return out


class SeenPipeline(_Pipeline):
    """Appends each saved URL to PR_SEEN_FILE as it is scraped, so an
    interrupted long crawl can be resumed with --new-only."""

    def __init__(self, crawler):
        super().__init__(crawler)
        path = Path(crawler.settings.get("PR_SEEN_FILE"))
        path.parent.mkdir(parents=True, exist_ok=True)
        self.file = open(path, "a", buffering=1, encoding="utf-8")

    def close_spider(self, spider=None):
        self.file.close()

    def process_item(self, item, spider=None):
        self.file.write(item["news_url"] + "\n")
        return item
