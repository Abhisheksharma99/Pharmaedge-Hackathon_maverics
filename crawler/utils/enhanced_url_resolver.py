"""
Enhanced URL Resolver - cache-first Google News decoding.

Decoding a Google News link costs a request to Google from our single
Google-facing egress IP: the residential proxy rejects google.com at the CONNECT
tunnel (403 "restricted target"), so decode traffic cannot be spread across proxy
IPs the way Bing and article fetches are.

Measured 2026-08-09: that IP sustains ~78 decodes/hour indefinitely when they are
paced and sequential (130 consecutive, 100% success, zero blocks). The earlier
"~128 then banned" ceiling was a burst artifact, not a quota - the same endpoint
returned 0% at 20-50 concurrency. So the two rules are: never burst, and never
spend the same decode twice.

Resolution is therefore ordered cheapest-first:

  1. Not a Google link at all (Bing/Alerts already unwrap to the publisher) -> free.
  2. Already in the shared Postgres decode cache -> free. The mapping is
     immutable, and the cache is shared across all 4 uvicorn workers and every
     concurrent crawler, so an article is decoded once fleet-wide rather than
     once per crawler per run.
  3. Otherwise spend a decode, paced and jittered.
"""

from typing import Dict, Any, List, Optional
from urllib.parse import urlparse
import logging
import time
import os
import random

from storage import google_decode_cache
from utils.google_decode import (
    GoogleDecodeBlocked,
    decode_article,
    extract_article_id,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# "worker"  - crawlers enqueue misses for the paced decode worker and skip them
#             this run (the safe default at fleet scale).
# "inline"  - crawlers decode misses themselves. Only for low-volume, serial
#             callers; at 100 concurrent crawlers this is the burst pattern that
#             got the IP blocked.
DECODE_MODE = os.getenv("GOOGLE_DECODE_MODE", "worker").strip().lower()


def title_hint(metadata: Dict[str, Any]) -> str:
    """Short article label for logs."""
    return (metadata.get('title') or metadata.get('url') or '')[:60]


class EnhancedURLResolver:
    """
    Cache-first URL resolver for Google News links.

    Checks the shared Postgres decode cache before spending any of the server
    IP's decode budget, and paces only the requests that actually reach Google.
    """

    # Domains to exclude (from production crawlers)
    # MSN excluded: Playwright timeout issues, content often aggregated from other sources
    EXCLUDE_URL_SUBSTRINGS = [
        "peerview", "researchgate", "twitter", "youtube",
        "facebook", "linkedin", "instagram", "openpr",
        "msn.com"  # Skip MSN - causes 90s Playwright timeouts, content is aggregated
    ]

    # Stop the whole batch after this many consecutive Google blocks (429/503/sorry).
    # Prevents a flagged IP from snowballing into hundreds of failing requests,
    # which only deepens the ban.
    MAX_CONSECUTIVE_BLOCKS = 5

    def __init__(self, interval: float = 5.0, proxy: Optional[str] = None,
                 abort_on_block: bool = True, decode_mode: Optional[str] = None):
        """
        Initialize the URL resolver.

        Args:
            interval: Base delay in seconds between decoding requests. The actual
                delay is randomized between interval and 2.5x interval to avoid the
                fixed-cadence fingerprint Google flags as a bot (default: 5.0).
            proxy: Optional proxy URL (http://user:pass@host:port). If omitted, falls
                back to the RESIDENTIAL_PROXY / PROXY_* env vars. Routing decode
                requests through a rotating residential proxy is the durable fix for
                datacenter-IP blocks.
            abort_on_block: If True, raise after MAX_CONSECUTIVE_BLOCKS consecutive
                Google blocks instead of grinding through every URL (default: True).
        """
        self.interval = max(interval, 1.0)
        self.abort_on_block = abort_on_block
        self.decode_mode = (decode_mode or DECODE_MODE).strip().lower()
        self.request_count = 0     # decodes that actually reached Google
        self.cache_hits = 0
        self.queued = 0            # misses handed to the decode worker
        self.consecutive_blocks = 0
        # Why the last resolve() returned None: 'deferred' (handed to the decode
        # worker, will resolve next cycle) vs 'failed' (genuinely unresolvable).
        # Callers must not record a deferral as a failure — it is neither a lost
        # article nor a failed URL, just one that isn't ready yet.
        self.last_outcome: Optional[str] = None

        if proxy or os.getenv("URL_DECODE_USE_PROXY", "").lower() in ("1", "true", "yes"):
            logger.warning(
                "[URL Decoder] A decode proxy was requested but will be IGNORED: the "
                "residential plan rejects google.com at the CONNECT tunnel (403 "
                "'restricted target'), so decoding must egress from the server IP."
            )

        logger.info(
            f"[URL Decoder] Cache-first decoder initialized | base interval="
            f"{self.interval}s (jittered, applied to cache misses only)"
        )

    @staticmethod
    def _is_block_message(message: str) -> bool:
        """Detect Google rate-limit / anti-bot responses in a decoder error message."""
        if not message:
            return False
        lowered = message.lower()
        return any(token in lowered for token in ("429", "503", "sorry", "too many requests",
                                                  "service unavailable"))

    def resolve(self, metadata: Dict[str, Any], publisher_classification: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
        """
        Resolve metadata to the actual article URL.

        Cheapest-first: a non-Google URL passes straight through, a cached decode
        costs nothing, and only a genuine miss spends a decode (paced + jittered).

        Args:
            metadata: Article metadata with 'url' field containing Google News redirect URL
            publisher_classification: Optional publisher classification (ignored)

        Returns:
            Dictionary with:
            - url: Decoded actual article URL
            - resolution_method: 'googledecoder'
            - domain: Extracted domain name

            Or None if decoding failed or URL should be excluded
        """
        # Default: any None return below means a genuine failure. The one
        # deferral path overrides this explicitly.
        self.last_outcome = 'failed'
        google_url = metadata.get('url', '')

        if not google_url:
            logger.error("[URL Decoder] ✗ No URL in metadata")
            return None

        logger.info(f"[URL Decoder] Starting resolution for URL from metadata")
        logger.debug(f"[URL Decoder] Input URL: {google_url[:150]}...")

        # If not a Google News URL, return as-is
        if "news.google.com" not in google_url:
            actual_url = google_url
            resolution_method = 'direct'
            logger.info(f"[URL Decoder] Not a Google News URL, using directly")
        else:
            article_id = extract_article_id(google_url)
            if not article_id:
                logger.error(f"[URL Decoder] ✗ Malformed Google News URL: {google_url[:100]}")
                return None

            # TIER 1: shared cache. Free — no Google request, no delay.
            cached = google_decode_cache.get(article_id)
            if cached:
                if cached['status'] != google_decode_cache.STATUS_OK or not cached['decoded_url']:
                    logger.info(
                        f"[URL Decoder] Cached failure for {article_id[:24]}… — skipping "
                        f"(will be retried once the failure entry expires)"
                    )
                    return None
                self.cache_hits += 1
                self.consecutive_blocks = 0
                actual_url = cached['decoded_url']
                resolution_method = 'cache'
                logger.info(f"[URL Decoder] ✓ Cache hit — no Google request spent")

            elif self.decode_mode == "worker":
                # TIER 2 (default): hand the article to the decode worker and move
                # on. Crawlers never talk to Google's decode endpoint, so 100
                # concurrent crawlers produce exactly one paced request stream
                # instead of 100 competing bursts — which is what caused the ban.
                #
                # The article is skipped THIS run and picked up as a cache hit on
                # the next cycle, typically within the hour. That latency is fine
                # against a 24h news window, and it is the price of never bursting.
                newly_queued = google_decode_cache.enqueue_many([article_id])
                self.queued += 1
                self.last_outcome = 'deferred'
                logger.info(
                    f"[URL Decoder] Cache miss — "
                    f"{'queued for' if newly_queued else 'already with'} the decode "
                    f"worker; skipping this run: {title_hint(metadata)}"
                )
                return None

            else:
                # TIER 2 (inline mode): decode here and now. Only safe for
                # low-volume, low-concurrency callers such as the failed-URL retry
                # service — at fleet scale this is the burst pattern that gets the
                # IP blocked. Jitter the cadence; a constant interval is itself a
                # bot signature.
                if self.request_count > 0:
                    delay = random.uniform(self.interval, self.interval * 2.5)
                    logger.info(f"[URL Decoder] Rate limiting: waiting {delay:.1f}s...")
                    time.sleep(delay)

                logger.info(
                    f"[URL Decoder] Cache miss — decoding via Google "
                    f"(decode #{self.request_count + 1})"
                )

                try:
                    actual_url = decode_article(article_id)
                    self.request_count += 1

                except GoogleDecodeBlocked as e:
                    # Do NOT cache — this says nothing about the article, only that
                    # our IP is currently throttled.
                    logger.error(f"[URL Decoder] ✗ Google block: {e}")
                    self._handle_block(str(e))
                    return None
                except RuntimeError:
                    # Batch-abort signal from _handle_block — propagate to stop the crawl.
                    raise
                except Exception as e:
                    error_msg = f"{type(e).__name__}: {str(e)[:200]}"
                    logger.error(f"[URL Decoder] ✗ Exception: {error_msg}")
                    logger.exception("Full traceback:")
                    self._handle_block(error_msg)
                    return None

                if not actual_url or 'news.google.com' in actual_url:
                    logger.error(f"[URL Decoder] ✗ FAILED: no publisher URL returned")
                    google_decode_cache.put(
                        article_id, None, google_decode_cache.STATUS_FAILED, 'batchexecute'
                    )
                    return None

                # Real success — clear the block streak and cache it fleet-wide.
                self.consecutive_blocks = 0
                resolution_method = 'googledecoder'
                google_decode_cache.put(
                    article_id, actual_url, google_decode_cache.STATUS_OK, 'batchexecute'
                )
                logger.info(f"[URL Decoder] ✓ Decoded to Publisher URL: {actual_url}")

        # Check if URL should be excluded
        if self.should_exclude_url(actual_url):
            logger.warning(f"[URL Decoder] ✗ URL excluded (contains excluded substring): {actual_url[:80]}...")
            return None

        # Extract domain (same logic as production crawlers)
        domain = self.extract_domain_from_url(actual_url)

        if not domain:
            logger.error(f"[URL Decoder] ✗ Failed to extract domain from: {actual_url[:80]}...")
            return None

        logger.info(f"[URL Decoder] ✓ Resolution complete - Domain: {domain}, Method: {resolution_method}")

        self.last_outcome = 'resolved'
        return {
            'url': actual_url,
            'resolution_method': resolution_method,
            'domain': domain,
            # A cache hit is a previously-successful decode, so it is exactly as
            # authoritative as a fresh one.
            'confidence': 100.0 if resolution_method in ('googledecoder', 'cache') else 90.0,
            'score_breakdown': {
                'method': resolution_method,
                'decoded': resolution_method in ('googledecoder', 'cache')
            },
            'original_url': google_url,
            'metadata': metadata
        }

    def _handle_block(self, error_msg: str) -> None:
        """React to a decode failure.

        If the failure looks like a Google rate-limit / anti-bot block (429/503/
        sorry page), apply exponential backoff and, after MAX_CONSECUTIVE_BLOCKS in
        a row, raise RuntimeError to abort the batch. Non-block failures (genuinely
        bad URLs) don't count toward the streak and don't trigger backoff.
        """
        if not self._is_block_message(error_msg):
            return  # ordinary decode miss, not an IP block — keep going

        self.consecutive_blocks += 1
        backoff = min(300, 30 * (2 ** (self.consecutive_blocks - 1)))  # 30,60,120,240,300s
        logger.warning(
            f"[URL Decoder] Google block detected "
            f"(streak {self.consecutive_blocks}/{self.MAX_CONSECUTIVE_BLOCKS}); "
            f"backing off {backoff}s"
        )
        time.sleep(backoff)

        if self.abort_on_block and self.consecutive_blocks >= self.MAX_CONSECUTIVE_BLOCKS:
            logger.error(
                "[URL Decoder] ✗ Aborting batch — IP appears blocked by Google. "
                "Rotate IP / enable residential proxy before retrying."
            )
            raise RuntimeError("Google News rate-limit / IP block (consecutive failures)")

    def extract_domain_from_url(self, url: str) -> Optional[str]:
        """
        Extract domain name from URL.

        Uses exact same logic as GoogleNewsSpider and GoogleAlertSpider.

        Args:
            url: The URL to extract domain from

        Returns:
            Domain name (e.g., "reuters", "bloomberg") or None
        """
        if not url:
            return None

        try:
            parsed_url = urlparse(url)
            domain_parts = parsed_url.netloc.split(".")

            if not domain_parts:
                return None

            # Logic from GoogleAlertSpider
            if len(domain_parts) > 2:
                domain_name = domain_parts[-2]
            else:
                domain_name = domain_parts[0]

            # Logic from GoogleNewsSpider
            if domain_name == "www" and len(domain_parts) > 1:
                domain_name = domain_parts[1]

            return domain_name if domain_name else None

        except Exception as e:
            logger.error(f"Error extracting domain from {url}: {str(e)}")
            return None

    def should_exclude_url(self, url: str) -> bool:
        """
        Check if URL should be excluded based on domain patterns.

        Same as production crawlers.

        Args:
            url: URL to check

        Returns:
            True if URL should be excluded, False otherwise
        """
        if not url:
            return True

        return any(
            substring in url.lower()
            for substring in self.EXCLUDE_URL_SUBSTRINGS
        )

    def get_stats(self) -> Dict[str, Any]:
        """Get current processing statistics.

        `cache_hits` is the number of Google decodes this crawl did NOT have to
        spend — the headline number for decode-budget health.
        """
        total = self.request_count + self.cache_hits
        return {
            "requests_made": self.request_count,   # decodes that reached Google
            "cache_hits": self.cache_hits,
            "queued_for_worker": self.queued,
            "cache_hit_rate": round(self.cache_hits / total, 3) if total else 0.0,
            "decode_mode": self.decode_mode,
            "interval": self.interval,
        }

    def reset_stats(self):
        """Reset request statistics."""
        self.request_count = 0
        self.cache_hits = 0
        self.queued = 0
        self.consecutive_blocks = 0
        logger.info("Statistics reset")
