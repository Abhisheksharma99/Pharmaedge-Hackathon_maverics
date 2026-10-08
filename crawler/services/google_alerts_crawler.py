"""
Google Alerts crawler - the full news_crawler pipeline, ported from
universal-crawler's NewsCrawlerService.run_google_alerts_crawler
(backend/app/services/news_crawler_service.py).

Layers: discovery (GoogleNewsDiscovery over the Alerts RSS feed) ->
publisher classification -> URL resolution -> content extraction
(EnhancedContentExtractor: HTTP, then Playwright / newspaper / spider fallbacks)
-> dedup -> MongoDB. Changes from the original are limited to storage:
Postgres writes became storage.mongo_storage calls, and project_id tagging
became `asset` tagging.
"""

import asyncio
import hashlib
import os
import re
from datetime import datetime
from typing import Any, Dict, Optional

from storage.mongo_storage import (
    add_log,
    article_exists,
    create_run,
    insert_article,
    tag_article_asset,
    update_run,
)
from utils.deduplication import Deduplicator
from utils.enhanced_content_extractor import EnhancedContentExtractor
from utils.enhanced_url_resolver import EnhancedURLResolver
from utils.failure_tracker import FailureTracker
from utils.google_news_discovery import GoogleNewsDiscovery
from utils.logging_config import get_logger
from utils.publisher_classifier import PublisherClassifier

logger = get_logger("services.google_alerts_crawler")


def parse_relative_date(date_str: str) -> Optional[datetime]:
    """
    Parse relative date strings like "5 minutes ago", "yesterday", "last week".

    Args:
        date_str: The date string to parse (e.g., "5 minutes ago", "yesterday")

    Returns:
        datetime object or None if not a relative date format
    """
    import re
    from datetime import timedelta

    if not date_str:
        return None

    date_str_lower = date_str.lower().strip()
    now = datetime.now()

    # Handle "today"
    if date_str_lower == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Handle "yesterday"
    if date_str_lower == "yesterday":
        return (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)

    # Handle "X minutes/mins ago"
    mins_match = re.match(r'^(\d+)\s*(?:minutes?|mins?)\s*ago$', date_str_lower)
    if mins_match:
        minutes = int(mins_match.group(1))
        return now - timedelta(minutes=minutes)

    # Handle "X hours ago"
    hours_match = re.match(r'^(\d+)\s*(?:hours?|hrs?)\s*ago$', date_str_lower)
    if hours_match:
        hours = int(hours_match.group(1))
        return now - timedelta(hours=hours)

    # Handle "X days ago"
    days_match = re.match(r'^(\d+)\s*days?\s*ago$', date_str_lower)
    if days_match:
        days = int(days_match.group(1))
        return (now - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)

    # Handle "X weeks ago"
    weeks_match = re.match(r'^(\d+)\s*weeks?\s*ago$', date_str_lower)
    if weeks_match:
        weeks = int(weeks_match.group(1))
        return (now - timedelta(weeks=weeks)).replace(hour=0, minute=0, second=0, microsecond=0)

    # Handle "X months ago"
    months_match = re.match(r'^(\d+)\s*months?\s*ago$', date_str_lower)
    if months_match:
        months = int(months_match.group(1))
        # Approximate: 30 days per month
        return (now - timedelta(days=months * 30)).replace(hour=0, minute=0, second=0, microsecond=0)

    # Handle "last week"
    if date_str_lower == "last week":
        return (now - timedelta(weeks=1)).replace(hour=0, minute=0, second=0, microsecond=0)

    # Handle "last month"
    if date_str_lower == "last month":
        return (now - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)

    # Handle "a minute ago", "an hour ago", "a day ago", etc.
    if re.match(r'^(?:a|an)\s+minute\s*ago$', date_str_lower):
        return now - timedelta(minutes=1)
    if re.match(r'^(?:a|an)\s+hour\s*ago$', date_str_lower):
        return now - timedelta(hours=1)
    if re.match(r'^(?:a|an)\s+day\s*ago$', date_str_lower):
        return (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    if re.match(r'^(?:a|an)\s+week\s*ago$', date_str_lower):
        return (now - timedelta(weeks=1)).replace(hour=0, minute=0, second=0, microsecond=0)

    # Handle day prefixes like "Saturday, March 11, 2026" - strip day name and parse
    day_prefix_match = re.match(
        r'^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)[,\s]+(.+)$',
        date_str_lower
    )
    if day_prefix_match:
        # Return None here - the cleaned date will be parsed by the main parser
        return None

    return None


async def run_google_alerts_crawler(
    crawler_config: Dict[str, Any],
    max_articles: int = 50,
) -> Dict[str, Any]:
    """
    Run Google Alerts RSS crawler.

    This crawler uses pre-generated RSS feed URLs from Google Alerts.
    The RSS URL is stored in crawler_config['google_alerts_rss_url'].

    Works similarly to Google News V3, but:
    - Uses a single RSS feed URL (from Google Alerts) instead of multiple keyword-based URLs
    - If no RSS URL exists, creates a new Google Alert using the keywords and cookies

    Args:
        crawler_config: Crawler configuration with google_alerts_rss_url and settings
        max_articles: Maximum articles to process

    Returns:
        Results dictionary with articles and detailed statistics
    """
    crawler_id = crawler_config["id"]
    asset = crawler_config.get("asset")
    keywords = crawler_config.get("keywords", [])
    exclude_keywords = crawler_config.get("exclude_keywords", [])
    exclude_urls = crawler_config.get("exclude_urls", [])

    # Get or create the RSS feed URL
    rss_url = crawler_config.get("google_alerts_rss_url")

    if not rss_url:
        # Try to create a new Google Alert
        cookies = crawler_config.get("google_alerts_cookies")
        if not cookies:
            return {
                "success": False,
                "error": "No Google Alerts RSS URL or cookies configured"
            }

        from services.google_alerts_service import GoogleAlertsService
        alerts_service = GoogleAlertsService(cookies=cookies)
        try:
            keyword = keywords[0] if keywords else "news"
            result = alerts_service.create_alert_and_get_rss(
                keyword=keyword,
                region=crawler_config.get("google_alerts_region", "co.in"),
                language=crawler_config.get("google_alerts_language", "en"),
                country_code=crawler_config.get("google_alerts_country", "IN")
            )
        finally:
            # Explicit close, not GC - see run_google_news_crawler_v2's finally.
            alerts_service.close()

        if not result["success"]:
            return {
                "success": False,
                "error": f"Failed to create Google Alert: {result.get('error')}"
            }

        rss_url = result["rss_url"]
        logger.info(f"Created new Google Alert RSS URL: {rss_url}")

    # Create run record
    start_time = datetime.now()
    run_record = create_run({
        "crawler_id": crawler_id,
        "crawler_name": crawler_config["name"],
        "crawler_type": "google_alerts",
        "started_at": start_time.isoformat(),
        "status": "running",
        "max_articles": max_articles,
        "keywords": keywords,
        "asset": asset,
        "rss_url": rss_url
    })
    run_id = run_record["id"]

    # Log start
    add_log(
        crawler_id=crawler_id,
        level="INFO",
        message=f"Starting Google Alerts crawler with RSS URL: {rss_url[:80]}... (Run ID: {run_id})"
    )

    discovery = extractor = None
    try:
        # Initialize architecture layers (same as V3)
        discovery = GoogleNewsDiscovery()
        classifier = PublisherClassifier()
        # GOOGLE_DECODE_INTERVAL slows decoding below production's 5s base when
        # running inline from one IP (Google 429s after ~70 quick decodes).
        resolver = EnhancedURLResolver(interval=float(os.getenv("GOOGLE_DECODE_INTERVAL", "5")))
        extractor = EnhancedContentExtractor()
        deduplicator = Deduplicator(similarity_threshold=0.85)
        failure_tracker = FailureTracker()

        # LAYER 1: DISCOVERY from Google Alerts RSS
        add_log(
            crawler_id=crawler_id,
            level="INFO",
            message=f"[Layer 1] Fetching articles from Google Alerts RSS feed..."
        )

        # Create keyword map for the RSS URL (use first keyword if available)
        keyword_map = {rss_url: keywords[0] if keywords else "google_alerts"}

        # Run synchronous discovery in thread pool
        metadata_list = await asyncio.to_thread(
            discovery.discover_from_rss_urls,
            [rss_url],
            keyword_map
        )

        add_log(
            crawler_id=crawler_id,
            level="INFO",
            message=f"[Layer 1] Discovered {len(metadata_list)} article metadata entries from Google Alerts"
        )

        if not metadata_list:
            add_log(
                crawler_id=crawler_id,
                level="WARNING",
                message="No article metadata discovered from Google Alerts RSS feed"
            )

            # Update run record
            end_time = datetime.now()
            update_run(run_id, {
                "completed_at": end_time.isoformat(),
                "duration_seconds": (end_time - start_time).total_seconds(),
                "status": "completed",
                "statistics": {}
            })

            return {"success": True, "run_id": run_id, "crawler_id": crawler_id,
                    "rss_url": rss_url, "articles_discovered": 0, "articles_saved": 0}

        # Process articles using V3 logic
        # The rest is identical to run_google_news_crawler_v3
        processed_articles = []
        saved_count = 0
        duplicate_count = 0
        filtered_count = 0
        aggregator_skipped_count = 0
        resolution_failed_count = 0
        extraction_failed_count = 0
        paywall_count = 0
        infrastructure_error_count = 0
        discovered_urls = []

        for i, metadata in enumerate(metadata_list):
            # Yield control to event loop
            if i % 5 == 0:
                await asyncio.sleep(0)

            if saved_count >= max_articles:
                add_log(
                    crawler_id=crawler_id,
                    level="INFO",
                    message=f"Reached max_articles limit ({max_articles}), stopping"
                )
                break

            try:
                title = metadata.get('title', '')
                publisher_name = metadata.get('publisher_name', '')
                publisher_domain = metadata.get('publisher_domain', '')
                google_news_url = metadata.get('url', '')

                # Check exclude keywords
                if exclude_keywords:
                    if any(kw.lower() in title.lower() for kw in exclude_keywords):
                        filtered_count += 1
                        continue

                # Skip if URL is in exclude list
                if exclude_urls:
                    if any(ex_url in google_news_url for ex_url in exclude_urls):
                        filtered_count += 1
                        continue

                # LAYER 2: CLASSIFICATION
                publisher_classification = classifier.classify(publisher_name, publisher_domain)

                # Note: Aggregators are no longer skipped - they will be processed

                # LAYER 3: URL RESOLUTION
                # Alerts links are already unwrapped to the direct publisher
                # URL by the discovery layer, so resolve() short-circuits to
                # 'direct' — no Google decode, no decode quota consumed.
                resolution_result = await asyncio.to_thread(
                    resolver.resolve, metadata, publisher_classification
                )

                if not resolution_result:
                    resolution_failed_count += 1
                    add_log(
                        crawler_id=crawler_id,
                        level="WARNING",
                        message=f"[Layer 3] Resolution failed for: {title[:60]}..."
                    )
                    continue

                url = resolution_result['url']
                discovered_urls.append(url)

                # DB dedup before the expensive extraction. An article already
                # stored (e.g. for another asset) just gets this asset tagged.
                if article_exists(url):
                    tag_article_asset(url, asset)
                    duplicate_count += 1
                    continue

                # LAYER 4: CONTENT EXTRACTION
                # extract() returns a dict (or None), same as the v3 path —
                # it does its own Playwright/403-bypass fallback internally.
                allow_partial = publisher_classification.get('allow_partial', True)
                extraction_result = await asyncio.to_thread(
                    extractor.extract, url, metadata, allow_partial
                )

                if not extraction_result or not extraction_result.get('content'):
                    extraction_failed_count += 1
                    if extraction_result and extraction_result.get('paywall_detected'):
                        paywall_count += 1
                    add_log(
                        crawler_id=crawler_id,
                        level="WARNING",
                        message=(
                            f"[Layer 4] Extraction failed for {url[:70]}: "
                            f"{(extraction_result or {}).get('error', 'no content returned')}"
                        )
                    )
                    continue

                extracted_title = extraction_result.get('title') or title
                extracted_date = extraction_result.get('date') or metadata.get('publish_date', '')
                extracted_content = extraction_result.get('content', '')

                # Deduplication check (title/URL based, as in v3)
                if deduplicator.is_duplicate(url, extracted_title):
                    duplicate_count += 1
                    continue

                keyword = metadata.get('keyword', '')

                # Parse date: raw string -> news_new_date -> formatted_date -> news_date

                news_date_str = extracted_date
                news_new_date = news_date_str  # Step 1: Store raw string
                formatted_date = None

                if news_date_str:
                    try:
                        from dateutil import parser as date_parser
                        date_str = str(news_date_str)
                        parsed_dt = None

                        # Try relative date parsing
                        parsed_dt = parse_relative_date(date_str)

                        # Try regex extraction for messy strings
                        if not parsed_dt:
                            date_patterns = [
                                r'(?:updated|posted|published|created)\s*(?:on)?\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})',
                                r'\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b',
                                r'\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b',
                                r'\b(\d{4}-\d{2}-\d{2})\b',
                            ]
                            for pattern in date_patterns:
                                match = re.search(pattern, date_str, re.IGNORECASE)
                                if match:
                                    try:
                                        parsed_dt = date_parser.parse(match.group(1))
                                        break
                                    except:
                                        pass

                        # Try direct/fuzzy parsing
                        if not parsed_dt:
                            try:
                                parsed_dt = date_parser.parse(date_str, fuzzy=True)
                            except:
                                pass

                        # Step 2: Get formatted_date (date only)
                        if parsed_dt and isinstance(parsed_dt, datetime):
                            formatted_date = parsed_dt.date()
                    except:
                        pass

                # Fallback to today if parsing failed
                if not formatted_date:
                    formatted_date = datetime.now().date()

                # Same shape as the RSS crawler's articles, so both sources sit
                # together in the `articles` collection.
                record = {
                    "url": url,
                    "title": extracted_title,
                    "content": extracted_content,
                    "date": formatted_date.isoformat(),
                    "raw_date": news_new_date,
                    "company": publisher_name,
                    "publisher_domain": publisher_domain,
                    "keyword": keyword or None,
                    "doi_url": extraction_result.get('doi_url', ''),
                    "crawler_id": crawler_id,
                    "run_id": run_id,
                    "content_hash": hashlib.md5(extracted_content.encode()).hexdigest() if extracted_content else None,
                    "source": "google_alerts",
                    "aggregator_source": "google_alerts",
                    "scraped_at": datetime.now().isoformat(),
                }
                if not insert_article(record, asset):
                    duplicate_count += 1  # same content already stored under another URL
                    continue
                saved_count += 1

                processed_articles.append({
                    "url": url,
                    "title": extracted_title,
                    "publisher": publisher_name,
                    "status": "saved"
                })

            except RuntimeError:
                # The resolver's abort-on-block signal. Swallowing it here (as the
                # original did) kept a blocked run retrying every article for hours.
                raise
            except Exception as e:
                logger.error(f"Error processing article: {str(e)}")
                continue

        # Update run record with results
        end_time = datetime.now()
        statistics = {
            "total_discovered": len(metadata_list),
            "saved": saved_count,
            "duplicates": duplicate_count,
            "filtered": filtered_count,
            "aggregator_skipped": aggregator_skipped_count,
            "resolution_failed": resolution_failed_count,
            "extraction_failed": extraction_failed_count,
            "paywall_blocked": paywall_count,
            "infrastructure_errors": infrastructure_error_count
        }

        update_run(run_id, {
            "completed_at": end_time.isoformat(),
            "duration_seconds": (end_time - start_time).total_seconds(),
            "status": "completed",
            "articles_saved": saved_count,
            "articles_found": len(metadata_list),
            "statistics": statistics
        })

        add_log(
            crawler_id=crawler_id,
            level="INFO",
            message=f"Google Alerts crawler completed: {saved_count} articles saved from {len(metadata_list)} discovered (Run ID: {run_id})"
        )

        return {
            "success": True,
            "run_id": run_id,
            "crawler_id": crawler_id,
            "crawler_name": crawler_config["name"],
            "rss_url": rss_url,
            "articles_discovered": len(metadata_list),
            "articles_saved": saved_count,
            "articles": processed_articles[:20],  # Return first 20 for display
            "statistics": statistics,
            "discovered_urls": discovered_urls[:20]
        }

    except Exception as e:
        logger.error(f"Google Alerts crawler error: {str(e)}")
        add_log(
            crawler_id=crawler_id,
            level="ERROR",
            message=f"Google Alerts crawler failed: {str(e)} (Run ID: {run_id})"
        )

        return {
            "success": False,
            "run_id": run_id,
            "error": str(e)
        }
    finally:
        # Explicit close, not GC - see run_google_news_crawler_v2's finally.
        for _obj in (discovery, extractor):
            if _obj is not None:
                _obj.close()
