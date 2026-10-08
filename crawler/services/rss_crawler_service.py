"""
RSS Feed Crawler Service
Handles RSS feed parsing and article extraction.
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from urllib.parse import urlparse
import os
import time
import asyncio
import hashlib
import re
import xml.etree.ElementTree as ET

try:
    import feedparser
    FEEDPARSER_AVAILABLE = True
except ImportError:
    FEEDPARSER_AVAILABLE = False
    feedparser = None

try:
    import trafilatura
    from bs4 import BeautifulSoup
    EXTRACTION_AVAILABLE = True
except ImportError:
    EXTRACTION_AVAILABLE = False

from curl_cffi import requests
from dotenv import load_dotenv
from storage.mongo_storage import (
    article_exists,
    get_content_hash,
    add_log,
    create_run,
    update_run,
    insert_article,
    tag_article_asset,
)
from utils.logging_config import get_logger
from utils.feed_normalize import (
    unwrap_search_redirect,
    clean_feed_title,
    is_search_engine_feed_title,
    resolve_entry_url,
    is_http_url,
)
from utils.feed_filters import (
    article_age_hours,
    is_blocked_domain,
    is_too_old,
    max_age_hours,
)

# Load environment variables
load_dotenv()

# Configure logging
logger = get_logger("services.rss_crawler")


def _get_proxy_url():
    """Build proxy URL from environment variables."""
    full_url = os.getenv("RESIDENTIAL_PROXY", "")
    if full_url:
        return full_url
    username = os.getenv("PROXY_USERNAME", "")
    password = os.getenv("PROXY_PASSWORD", "")
    host = os.getenv("PROXY_HOST", "gate.decodo.com")
    port = os.getenv("PROXY_PORT", "10001")
    if username and password:
        return f"http://{username}:{password}@{host}:{port}"
    return ""


RESIDENTIAL_PROXY_URL = _get_proxy_url()


class RSSCrawlerService:
    """Service for crawling RSS feeds and extracting articles."""

    def __init__(self):
        self.logger = get_logger("services.rss_crawler")
        self.request_delay = 2  # Seconds between requests

        # Sticky residential proxy for this crawl: one session token per
        # RSSCrawlerService instance (== one crawl) so concurrent RSS crawlers
        # each get their own upstream IP instead of sharing one.
        from utils.proxy_manager import ProxyManager
        self.proxy_manager = ProxyManager()
        self._session_token = ProxyManager.new_session_token()

        # Set for the duration of a run so _log() can persist to the DB `logs`
        # table. Until this is set, _log() degrades to console-only.
        self._crawler_id: Optional[str] = None

    def _log(self, level: str, message: str, exc_info: bool = False) -> None:
        """Log to the console AND to the DB `logs` table.

        Every other crawler type calls add_log(), so its failures are visible in
        the UI and queryable in Postgres. This service only ever used the Python
        logger, which writes to container stdout - which is why 104 Google
        Alerts crawlers could fail on every run for days while the DB showed
        nothing but "completed, 0 articles". add_log() is buffered, so this is
        cheap enough to call on the normal path.
        """
        getattr(self.logger, level.lower(), self.logger.info)(
            message, **({"exc_info": True} if exc_info else {})
        )
        if not self._crawler_id:
            return
        try:
            add_log(
                crawler_id=self._crawler_id,
                level=level.upper(),
                message=message,
            )
        except Exception:
            # Logging must never be able to kill a crawl.
            pass

    def _fetch_url(self, url: str, use_proxy: bool = True) -> Optional[str]:
        """Fetch URL content. Requests are routed through the sticky per-crawl
        residential proxy when one is configured (the ``use_proxy`` arg is kept for
        backward compatibility but no longer gates proxying), EXCEPT Google hosts -
        the residential plan 403s CONNECT to google.* so Google Alerts feeds and
        other google.* URLs must go direct."""
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }

        # Bound before the try so the except handler can always report which
        # route was used, even if proxy resolution itself is what failed.
        proxies = None
        try:
            proxies = self.proxy_manager.requests_proxies_for(url, self._session_token)

            response = requests.get(
                url,
                headers=headers,
                timeout=30,
                proxies=proxies,
                impersonate="chrome110"
            )

            if response.status_code == 200:
                return response.text
            else:
                self._log(
                    "warning",
                    f"Failed to fetch {url}: HTTP {response.status_code}"
                    f"{' (via proxy)' if proxies else ' (direct)'}",
                )
                return None

        except Exception as e:
            self._log(
                "error",
                f"Error fetching {url}"
                f"{' (via proxy)' if proxies else ' (direct)'}: {e}",
            )
            return None

    def _parse_hexml_feed(self, feed_content: str, feed_url: str) -> List[Dict[str, Any]]:
        """Parse GlobeNewswire hexML feed format (e.g. Novartis press releases)."""
        try:
            root = ET.fromstring(feed_content)
        except ET.ParseError as e:
            self.logger.error(f"Failed to parse hexML feed {feed_url}: {e}")
            return []

        publisher = ""
        head_title = root.find("./head/title")
        if head_title is not None and head_title.text:
            publisher = head_title.text.strip()

        articles = []
        for entry in root.findall("./body/press_releases/press_release"):
            lang = (entry.get("language") or "en").lower()
            if lang != "en":
                continue

            location_el = entry.find("location")
            url = location_el.get("href") if location_el is not None else ""
            if not url:
                continue

            headline_el = entry.find("headline")
            ingress_el = entry.find("ingress")
            published_el = entry.find("published")

            published = None
            if published_el is not None and published_el.get("date"):
                try:
                    published = datetime.fromisoformat(
                        published_el.get("date").replace("Z", "+00:00")
                    )
                except Exception:
                    pass

            articles.append({
                "title": (headline_el.text or "").strip() if headline_el is not None else "",
                "url": url,
                "description": (ingress_el.text or "").strip() if ingress_el is not None else "",
                "published": published,
                "publisher": publisher,
            })

        self.logger.info(f"Parsed {len(articles)} articles from hexML feed: {feed_url}")
        return articles

    def _parse_rss_feed(self, feed_url: str) -> List[Dict[str, Any]]:
        """Parse RSS feed and extract article entries."""
        if not FEEDPARSER_AVAILABLE:
            self._log("error", "feedparser not installed. Run: pip install feedparser")
            return []

        try:
            # Fetch the feed
            feed_content = self._fetch_url(feed_url)
            if not feed_content:
                self._log("error", f"Failed to fetch RSS feed: {feed_url}")
                return []

            # GlobeNewswire hexML feeds aren't RSS — route to the dedicated parser.
            if "<hexML" in feed_content[:500]:
                return self._parse_hexml_feed(feed_content, feed_url)

            # Parse the feed
            feed = feedparser.parse(feed_content)

            if feed.bozo and feed.bozo_exception:
                self.logger.warning(f"Feed parsing warning: {feed.bozo_exception}")

            # A Google Alerts feed is titled "Google Alert - <keyword>", which is
            # the search engine, not a publisher — leaving it here would label every
            # article with the alert keyword whenever extraction finds no company.
            feed_title = feed.feed.get("title", "")
            feed_publisher = "" if is_search_engine_feed_title(feed_title) else feed_title

            articles = []
            malformed = 0
            for entry in feed.entries:
                # Two separate messes to clean up before this is a usable URL:
                #  - resolve_entry_url() picks the real link when <link> holds an
                #    HTML anchor instead of a URL (both Fierce feeds do this).
                #  - unwrap_search_redirect() unwraps the google.com/url stub that
                #    Google Alerts links to, which serves no article content.
                # Either can yield "", which means the entry has no fetchable URL.
                article = {
                    "title": clean_feed_title(entry.get("title", "")),
                    "url": unwrap_search_redirect(
                        resolve_entry_url(
                            entry.get("link", ""),
                            entry.get("links"),
                            entry.get("id", ""),
                        )
                    ),
                    "description": entry.get("description", "") or entry.get("summary", ""),
                    "published": None,
                    "publisher": feed_publisher,
                }

                # Parse publication date
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    try:
                        article["published"] = datetime(*entry.published_parsed[:6])
                    except:
                        pass
                elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                    try:
                        article["published"] = datetime(*entry.updated_parsed[:6])
                    except:
                        pass

                # Queue only fetchable URLs. Without this check any non-empty
                # string got through, so a feed could report "Parsed 25 articles"
                # and then fail all 25 fetches - healthy-looking and useless.
                if is_http_url(article["url"]):
                    articles.append(article)
                else:
                    malformed += 1

            # Surface drops in the run log. A silent 25-parsed/0-saved feed is the
            # failure mode that hid the Fierce bug for as long as it did.
            suffix = f" ({malformed} entries dropped: no usable URL)" if malformed else ""
            self._log(
                "info" if articles else "warning",
                f"Parsed {len(articles)} articles from RSS feed: {feed_url}{suffix}",
            )
            return articles

        except Exception as e:
            self._log("error", f"Error parsing RSS feed {feed_url}: {e}")
            return []

    def _extract_content(self, url: str, html: str) -> Dict[str, Any]:
        """Extract article content from HTML."""
        if not EXTRACTION_AVAILABLE:
            return {"success": False, "error": "trafilatura not installed"}

        try:
            # Extract main content
            content = trafilatura.extract(
                html,
                url=url,
                include_comments=False,
                include_tables=True,
                output_format='txt'
            )

            if not content or len(content) < 100:
                return {"success": False, "error": "Content too short or empty"}

            # Extract metadata
            metadata = trafilatura.extract_metadata(html)
            title = metadata.title if metadata else ''
            date = metadata.date if metadata else ''

            # Try to extract company/source from HTML
            soup = BeautifulSoup(html, 'html.parser')
            company = None

            # Check meta tags for publisher/site name
            for selector in ['meta[property="og:site_name"]', 'meta[name="publisher"]', 'meta[name="author"]']:
                meta = soup.select_one(selector)
                if meta and meta.get("content"):
                    company = meta.get("content")
                    break

            return {
                "success": True,
                "content": content,
                "title": title,
                "date": date,
                "company": company
            }

        except Exception as e:
            self.logger.error(f"Error extracting content from {url}: {e}")
            return {"success": False, "error": str(e)}

    def _should_exclude(self, url: str, title: str, exclude_keywords: List[str], exclude_urls: List[str]) -> bool:
        """Check if article should be excluded based on keywords or URL patterns."""
        url_lower = url.lower()
        title_lower = title.lower()

        # Check URL exclusions
        for pattern in exclude_urls:
            if pattern.lower() in url_lower:
                return True

        # Check keyword exclusions
        for keyword in exclude_keywords:
            kw_lower = keyword.lower()
            if kw_lower in title_lower or kw_lower in url_lower:
                return True

        return False

    async def run_rss_crawler(
        self,
        crawler_config: Dict[str, Any],
        max_articles: int = 50,
    ) -> Dict[str, Any]:
        """
        Run RSS feed crawler.

        Args:
            crawler_config: Crawler configuration with RSS feed URL(s)
            max_articles: Maximum number of articles to process

        Returns:
            Dict with crawl results
        """
        start_time = time.time()
        crawler_id = crawler_config.get("id", "unknown")
        crawler_name = crawler_config.get("name", "RSS Crawler")

        # Bind the run to this crawler so every _log() below also lands in the
        # DB `logs` table, not just container stdout.
        self._crawler_id = crawler_id

        self._log("info", f"Starting RSS crawler: {crawler_name} (ID: {crawler_id})")

        # Get RSS feed URLs
        rss_urls = []
        if crawler_config.get("rss_feed_url"):
            rss_urls.append(crawler_config["rss_feed_url"])
        if crawler_config.get("rss_feed_urls"):
            rss_urls.extend(crawler_config["rss_feed_urls"])

        # Also check metadata for RSS URLs
        metadata = crawler_config.get("metadata", {})
        if metadata.get("rss_feed_url"):
            rss_urls.append(metadata["rss_feed_url"])
        if metadata.get("rss_feed_urls"):
            rss_urls.extend(metadata["rss_feed_urls"])

        # Remove duplicates while preserving order
        seen = set()
        unique_urls = []
        for url in rss_urls:
            if url and url not in seen:
                seen.add(url)
                unique_urls.append(url)
        rss_urls = unique_urls

        if not rss_urls:
            self._log("error", "No RSS feed URL configured for this crawler")
            return {
                "success": False,
                "error": "No RSS feed URL configured for this crawler"
            }

        # Get exclusion lists
        exclude_keywords = crawler_config.get("exclude_keywords", []) or []
        exclude_urls = crawler_config.get("exclude_urls", []) or []

        # Asset this crawl gathers data for; every saved article is tagged with it
        asset = crawler_config.get("asset")

        # Create run record
        start_time = time.time()
        run_record = create_run({
            "crawler_id": crawler_id,
            "crawler_name": crawler_name,
            "crawler_type": "rss_feed",
            "started_at": datetime.now().isoformat(),
            "status": "running",
            "rss_urls": rss_urls,
            "max_articles": max_articles,
            "asset": asset,
        })
        run_id = run_record["id"]

        # Statistics
        stats = {
            "feeds_processed": 0,
            "articles_discovered": 0,
            "articles_excluded": 0,
            "articles_duplicate": 0,
            "articles_saved": 0,
            "articles_failed": 0,
            "articles_too_old": 0,      # outside the age window
            "articles_blocked": 0,      # blocklisted (social/obituary/jobs/...)
            "errors": [],
            "articles_summary": [],  # per-article tracking for View Records UI
            "discovered_urls": [],   # for Discovered URLs tab
        }

        try:
            all_articles = []

            # Parse all RSS feeds
            for feed_url in rss_urls:
                self.logger.info(f"Processing RSS feed: {feed_url}")
                articles = await asyncio.to_thread(self._parse_rss_feed, feed_url)
                all_articles.extend(articles)
                stats["feeds_processed"] += 1

            stats["articles_discovered"] = len(all_articles)
            self._log(
                "info" if all_articles else "warning",
                f"Discovered {len(all_articles)} articles from {len(rss_urls)} feed(s)",
            )

            # Record all discovered URLs for the UI's Discovered URLs tab
            discovered_at = datetime.now().isoformat()
            for art in all_articles:
                if art.get("url"):
                    stats["discovered_urls"].append({
                        "url": art["url"],
                        "discovered_at": discovered_at,
                    })

            # Process articles (limit to max_articles)
            processed = 0
            for article in all_articles:
                if processed >= max_articles:
                    break

                url = article.get("url", "")
                title = article.get("title", "")
                publisher = article.get("publisher", "")

                # Check exclusions
                if self._should_exclude(url, title, exclude_keywords, exclude_urls):
                    stats["articles_excluded"] += 1
                    stats["articles_summary"].append({
                        "url": url,
                        "title": title,
                        "status": "filtered",
                        "publisher": publisher,
                        "reason": "Matched exclude_keywords or exclude_urls",
                    })
                    continue

                # Blocklisted host (social posts, obituaries, job boards, ...).
                # Checked before the duplicate lookup and the fetch because it
                # costs nothing - search feeds, Google Alerts especially, carry
                # a large share of non-news that would otherwise be stored.
                if is_blocked_domain(url):
                    stats["articles_blocked"] += 1
                    # Console only, deliberately. The `logs` table is already
                    # 21M rows / ~5GB with no scheduled rotation, and a single
                    # archive feed (WIPO, 300 entries) polled hourly would add
                    # thousands of rows a day on its own. The per-article detail
                    # is still persisted in stats["articles_summary"] below, and
                    # the run summary carries the counts.
                    self.logger.info(
                        f"[Filter] Blocked domain {urlparse(url).netloc}: {title[:60]}"
                    )
                    stats["articles_summary"].append({
                        "url": url,
                        "title": title,
                        "status": "filtered",
                        "publisher": publisher,
                        "reason": f"Blocklisted domain: {urlparse(url).netloc}",
                    })
                    continue

                # Age window. Plain RSS and Google Alerts feeds have no
                # server-side time filter (unlike Google News' when:1d), so
                # without this every poll re-offers the feed's whole rolling
                # window. Undated articles are kept.
                if is_too_old(article.get("published")):
                    stats["articles_too_old"] += 1
                    age = article_age_hours(article.get("published"))
                    # Console only - see the note on the blocked-domain branch.
                    self.logger.info(
                        f"[Filter] Too old ({age:.1f}h > {max_age_hours()}h): {title[:60]}"
                        if age is not None else f"[Filter] Too old: {title[:60]}"
                    )
                    stats["articles_summary"].append({
                        "url": url,
                        "title": title,
                        "status": "filtered",
                        "publisher": publisher,
                        "reason": (
                            f"Older than {max_age_hours()}h"
                            + (f" ({age:.1f}h)" if age is not None else "")
                        ),
                    })
                    continue

                # Check if already exists
                if article_exists(url):
                    tag_article_asset(url, asset)
                    stats["articles_duplicate"] += 1
                    stats["articles_summary"].append({
                        "url": url,
                        "title": title,
                        "status": "duplicate",
                        "publisher": publisher,
                        "record_id": None,
                    })
                    continue

                # Fetch and extract content
                self.logger.info(f"Fetching article: {title[:50]}...")
                html = await asyncio.to_thread(self._fetch_url, url)

                if not html:
                    stats["articles_failed"] += 1
                    stats["errors"].append(f"Failed to fetch: {url[:60]}")
                    self._log("warning", f"Article fetch failed: {url[:100]}")
                    stats["articles_summary"].append({
                        "url": url,
                        "title": title,
                        "status": "connection_failed",
                        "publisher": publisher,
                        "reason": "Failed to fetch URL",
                    })
                    continue

                # Extract content
                extraction = self._extract_content(url, html)

                if not extraction.get("success"):
                    stats["articles_failed"] += 1
                    stats["errors"].append(f"Extraction failed: {url[:60]} - {extraction.get('error')}")
                    self._log(
                        "warning",
                        f"Extraction failed for {url[:90]}: {extraction.get('error')}",
                    )
                    stats["articles_summary"].append({
                        "url": url,
                        "title": title,
                        "status": "extraction_failed",
                        "publisher": publisher,
                        "reason": extraction.get("error") or "Extraction returned no content",
                    })
                    continue

                # Build article record
                content = extraction.get("content", "")
                # Feed pubDate WINS over the page-scraped date. trafilatura reads
                # dates via htmldate, which falls back to TODAY when a page exposes
                # no reliable date - so paywalled/JS pages (BioWorld, etc.) silently
                # stamped every article with the crawl date. The feed's pubDate is
                # the publisher's own statement of when it ran, so trust that first
                # and keep the scraped date only as a fallback for feeds without one.
                article_date = article.get("published") or extraction.get("date")
                if isinstance(article_date, datetime):
                    article_date = article_date.strftime("%Y-%m-%d")

                company = extraction.get("company") or article.get("publisher") or urlparse(url).netloc

                record = {
                    "url": url,
                    "title": extraction.get("title") or title,
                    "content": content,
                    "date": article_date or datetime.now().strftime("%Y-%m-%d"),
                    "company": company,
                    "crawler_id": crawler_id,
                    "run_id": run_id,
                    "content_hash": get_content_hash(content),
                    "source": "rss_feed",
                    "keyword": crawler_config.get("keyword"),
                    "feed_title": title,
                    "feed_description": article.get("description", ""),
                    "aggregator_source": "rss_feed_crawler",
                    "scraped_at": datetime.now().isoformat(),
                }

                try:
                    if not insert_article(record, asset):
                        # Same content already stored under another URL
                        stats["articles_duplicate"] += 1
                        stats["articles_summary"].append({
                            "url": url, "title": record["title"], "status": "duplicate",
                            "publisher": publisher, "reason": "Same content as a stored article",
                        })
                        processed += 1
                        continue
                    stats["articles_saved"] += 1
                    self.logger.info(f"Saved to DB: {title[:50]}")
                    stats["articles_summary"].append({
                        "url": url,
                        "title": record["title"],
                        "status": "saved",
                        "date": record["date"],
                        "publisher": publisher,
                    })
                except Exception as e:
                    stats["articles_failed"] += 1
                    self._log("error", f"Failed to save article {url[:80]}: {e}")
                    stats["articles_summary"].append({
                        "url": url,
                        "title": title,
                        "status": "extraction_failed",
                        "publisher": publisher,
                        "reason": f"Exception during save: {e}",
                    })

                processed += 1

                # Delay between requests
                await asyncio.sleep(self.request_delay)

            # Update run record
            duration = time.time() - start_time
            update_run(run_id, {
                "status": "completed",
                "completed_at": datetime.now().isoformat(),
                "duration_seconds": duration,
                "stats": stats
            })

            self._log(
                "info",
                f"RSS crawler completed: {stats['articles_discovered']} discovered, "
                f"{stats['articles_saved']} saved, {stats['articles_duplicate']} duplicates, "
                f"{stats['articles_blocked']} blocked, {stats['articles_too_old']} too old, "
                f"{stats['articles_excluded']} excluded, {stats['articles_failed']} failed",
            )

            return {
                "success": True,
                "run_id": run_id,
                "crawler_id": crawler_id,
                "crawler_name": crawler_name,
                "duration_seconds": round(duration, 2),
                **stats
            }

        except Exception as e:
            self._log("error", f"RSS crawler error: {e}", exc_info=True)
            duration = time.time() - start_time

            update_run(run_id, {
                "status": "failed",
                "completed_at": datetime.now().isoformat(),
                "duration_seconds": duration,
                "error": str(e),
                "stats": stats
            })

            return {
                "success": False,
                "run_id": run_id,
                "error": str(e),
                "duration_seconds": round(duration, 2),
                **stats
            }
