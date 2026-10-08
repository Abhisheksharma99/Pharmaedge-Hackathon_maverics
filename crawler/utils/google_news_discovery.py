"""
Google News Discovery Layer

CRITICAL: This module treats Google News RSS feeds as METADATA-ONLY sources.
- Does NOT decode Google News URLs
- Does NOT follow Google redirects
- Does NOT scrape Google News pages
- ONLY extracts metadata: title, publisher name, publisher domain, publish date, RSS URL
"""

import os
import html
from typing import List, Dict, Any, Optional
from datetime import datetime
from urllib.parse import quote_plus, urlparse, parse_qs
import feedparser
import re
import time
from curl_cffi import requests
import logging

from utils.proxy_manager import ProxyManager
from utils.feed_normalize import unwrap_search_redirect, clean_feed_title

# Configure logger
logger = logging.getLogger(__name__)


class GoogleNewsDiscovery:
    """
    News discovery layer over a search-engine news RSS feed.

    Extracts metadata ONLY - no URL resolution or content fetching.

    PRIMARY is Google News (NEWS_DISCOVERY_SOURCE, default "google"), with Bing
    as an automatic FALLBACK (NEWS_DISCOVERY_FALLBACK, default "bing").

    Google is primary because it is worth ~75x more: on identical keywords it
    returned 601 fresh <24h articles vs Bing's 8, and 45/50 productive keywords
    vs 7/50. Discovery itself is also safe at fleet scale - 2,205 Google RSS
    requests across 5 sweeps at 60-100 concurrency produced zero blocks. What
    used to get the IP banned was URL *decoding*, which now happens only in the
    single paced decode worker, never in crawlers.

    Bing exists for the case where Google discovery IS blocked. Because a Google
    block is IP-wide it would otherwise take every crawler to zero results;
    falling back to Bing degrades to 8-articles-per-keyword instead of nothing.
    Once a block is seen, the remaining keywords in that crawl go straight to
    Bing rather than re-probing a blocked IP.

    Requests are proxied per-host: Bing goes through the residential proxy with a
    sticky per-crawl session, Google must go DIRECT (the plan 403s google.com at
    the CONNECT tunnel).
    """

    # Hosts that only ever appear as redirect wrappers, never as the publisher.
    # Both the bare and www. forms are listed because _extract_domain strips the
    # www. prefix while the raw-netloc fallback does not.
    REDIRECT_HOSTS = frozenset({
        'news.google.com', 'google.com', 'www.google.com',
        'bing.com', 'www.bing.com', '',
    })

    def __init__(self, rate_limit_delay: float = 2.0, crawler_id: Optional[str] = None):
        """
        Initialize discovery with rate limiting and residential proxy.

        Args:
            rate_limit_delay: Delay in seconds between RSS feed requests (default: 2.0)
        """
        self.session = requests.Session(impersonate="chrome110")
        self.rate_limit_delay = rate_limit_delay
        # Primary source, and the source to fall back to if the primary blocks.
        # Set NEWS_DISCOVERY_FALLBACK="" to disable falling back entirely.
        self.source = os.getenv("NEWS_DISCOVERY_SOURCE", "google").strip().lower()
        self.fallback = os.getenv("NEWS_DISCOVERY_FALLBACK", "bing").strip().lower()

        # CANARY GATE. NEWS_DISCOVERY_SOURCE is process-wide, so without this,
        # switching to Google switches the ENTIRE fleet at once — which is exactly
        # the cold-start stampede a canary exists to avoid. When
        # NEWS_DISCOVERY_CANARY_IDS is set, only those crawler ids use the primary
        # source; every other crawler stays on the fallback. Unset it to promote
        # the whole fleet.
        canary = os.getenv("NEWS_DISCOVERY_CANARY_IDS", "").strip()
        self.is_canary_gated = bool(canary)
        if canary and self.fallback:
            allowed = {c.strip() for c in canary.split(",") if c.strip()}
            if str(crawler_id) not in allowed:
                logger.info(
                    f"[Discovery] Crawler {crawler_id} is not in the canary set — "
                    f"using {self.fallback} instead of {self.source}"
                )
                self.source = self.fallback

        if self.fallback == self.source:
            self.fallback = ""
        # Set once the primary blocks in this crawl, so the remaining keywords go
        # straight to the fallback instead of hammering a blocked IP.
        self._primary_blocked = False
        # Route every request through the residential proxy with a sticky
        # per-crawl session token (one upstream IP per crawler instance).
        self.proxy_manager = ProxyManager()
        self._session_token = ProxyManager.new_session_token()

    def close(self) -> None:
        """Explicitly release the curl_cffi Session's native handle.

        Must be called deterministically (try/finally) rather than left to
        GC: curl_cffi's Curl.__del__ calls curl_easy_cleanup() from whatever
        thread happens to collect it, which under this app's thread-pooled
        crawls can be a different thread than the one that created it -
        a proven source of glibc heap corruption ("double free or
        corruption (fasttop)") that crashes the whole uvicorn worker.
        """
        self.session.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()

    def _proxies(self, url: str = ""):
        """Residential proxy for the request, chosen per-URL.

        The Decodo residential plan 403s every Google domain, so Google feeds
        (Google search RSS, Google Alerts feeds - which are served on the user's
        local ccTLD such as google.co.in) must go DIRECT; Bing and other hosts go
        through the proxy (and get a sticky per-crawl IP)."""
        return self.proxy_manager.requests_proxies_for(url, self._session_token)

    @staticmethod
    def _looks_blocked(status_code: int, body: str) -> bool:
        """Detect a search-engine anti-bot / rate-limit response so a BLOCK is
        never silently mistaken for a genuinely empty feed."""
        if status_code >= 400:
            return True
        low = (body or "")[:2000].lower()
        return any(tok in low for tok in (
            "<title>sorry", "unusual traffic", "detected unusual",
            "/sorry/", "too many requests", "captcha",
        ))

    def discover_from_keywords(self, keywords: List[str]) -> List[Dict[str, Any]]:
        """
        Discover articles from Google News RSS using keywords.
        Returns METADATA ONLY - no actual article URLs or content.

        Supports both simple keywords and boolean expressions:
        - Simple: "Crohn" -> exact phrase search
        - Boolean: "Crohn" OR "IBD" -> either term
        - Complex: ("Crohn" OR "IBD") AND "treatment"

        Args:
            keywords: List of search keywords or boolean expressions

        Returns:
            List of article metadata dictionaries with:
            - title: Article title
            - publisher_name: Publisher name (e.g., "Reuters")
            - publisher_domain: Publisher domain (e.g., "reuters.com")
            - publish_date: Publication date
            - rss_url: Google News RSS URL (for reference only, NOT for scraping)
            - keyword: The search keyword/expression that found this article
        """
        time_filter = "1d"  # Default: last 24 hours (Google only)
        rss_urls = self._build_rss_urls(keywords, time_filter)

        # Create a mapping of RSS URL to keyword (must match _build_rss_urls format)
        keyword_map = {}
        for keyword in sorted(set(keywords)):
            keyword = keyword.strip()
            if not keyword:
                continue
            rss_url = self._rss_url_for_keyword(keyword, time_filter)
            keyword_map[rss_url] = keyword

        return self.discover_from_rss_urls(rss_urls, keyword_map)

    def _rss_url_for_keyword(self, keyword: str, time_filter: str = "1d",
                             source: Optional[str] = None) -> str:
        """Build one news RSS URL for a keyword.

        Args:
            source: Override the active source ("google" | "bing"). Used to
                rebuild a keyword's URL against the fallback after a block.
        """
        keyword = keyword.strip()
        source = (source or self.source).strip().lower()
        if source == "google":
            if self._is_boolean_expression(keyword):
                search_query = f'{keyword} when:{time_filter}'
            else:
                search_query = f'"{keyword}" when:{time_filter}'
            return (
                "https://news.google.com/rss/search?q="
                f"{quote_plus(search_query)}&hl=en-US&gl=US&ceid=US:en"
            )
        # Bing News RSS (default). Boolean AND/OR pass through as-is; simple
        # keywords are quoted for an exact-phrase match.
        #
        # Recency: Bing defaults to RELEVANCE ranking, so a plain feed returns a
        # historical archive (median ~2 years old) that the 24h age filter then
        # rejects wholesale. qft=interval="N" is Bing's server-side recency
        # bucket, and sortbydate=1 orders newest first. This is what makes the
        # 24h window actually productive.
        #
        # Default is "7", not the tighter "4": measured across 50 fleet-shaped
        # keywords, "4" surfaced 11 fresh articles from 10/50 keywords while "7"
        # surfaced 185 from 45/50 — a 17x gain — because "4" buries sub-24h items
        # that "7" returns. The extra ~136 stragglers "7" pulls in (24-30h old)
        # are discarded by the hard 24h clamp in news_crawler_service, so nothing
        # stale gets through. Do NOT use "" (no filter): that returns a
        # relevance-ranked archive going back years — 509 raw for only 30 fresh.
        # NEWS_BING_INTERVAL overrides the bucket for A/B runs.
        if self._is_boolean_expression(keyword):
            search_query = keyword
        else:
            search_query = f'"{keyword}"'
        interval = os.getenv("NEWS_BING_INTERVAL", "7").strip()
        qft = quote_plus(f'interval="{interval}"') if interval else ""
        url = f"https://www.bing.com/news/search?q={quote_plus(search_query)}&format=rss&sortbydate=1"
        if qft:
            url += f"&qft={qft}"
        return url

    def discover_from_rss_urls(self, rss_urls: List[str], keyword_map: Dict[str, str] = None) -> List[Dict[str, Any]]:
        """
        Fetch metadata from Google News RSS URLs with rate limiting.

        Args:
            rss_urls: List of Google News RSS feed URLs
            keyword_map: Optional mapping of RSS URL to keyword

        Returns:
            List of article metadata dictionaries
        """
        all_metadata = []
        keyword_map = keyword_map or {}
        # Cross-feed dedup: the same article routinely surfaces under many keyword
        # feeds (pharma keywords overlap heavily). Dropping duplicates here is
        # free; carrying them downstream costs one Google decode each before the
        # post-resolution dedup discards them. Keyed on the resolved article URL,
        # so a Bing wrapper and its unwrapped twin collapse to one entry.
        seen_urls = set()
        duplicate_entries = 0

        for idx, rss_url in enumerate(rss_urls):
            try:
                keyword = keyword_map.get(rss_url, '')

                # The primary already blocked earlier in this crawl — don't probe
                # it again, go straight to the fallback for the rest.
                active_source = self.source
                if self._primary_blocked and self.fallback and keyword:
                    rss_url = self._rss_url_for_keyword(keyword, source=self.fallback)
                    active_source = self.fallback

                logger.info(f"[Discovery] Fetching RSS feed {idx+1}/{len(rss_urls)}: {rss_url[:80]}...")

                # Add rate limiting delay before each request (except first)
                if idx > 0:
                    logger.info(f"[Discovery] Rate limiting: waiting {self.rate_limit_delay}s before next request...")
                    time.sleep(self.rate_limit_delay)

                # Fetch RSS feed (proxy for Bing; google.com feeds go direct)
                response = self.session.get(rss_url, timeout=30, proxies=self._proxies(rss_url))

                # Distinguish a real block/rate-limit from a genuinely empty feed.
                # A block page (HTTP 4xx/5xx or a "Sorry"/captcha body) parses to
                # zero entries too, so without this check a block is silently
                # mislabeled as "no news" and the crawler reports success.
                if self._looks_blocked(response.status_code, response.text):
                    logger.error(
                        f"[Discovery] BLOCKED by {active_source} (HTTP {response.status_code}) "
                        f"- not an empty feed. URL: {rss_url[:100]}"
                    )

                    # Fall back so a blocked primary degrades to fewer articles
                    # rather than none. Only possible when we know the keyword —
                    # a raw URL (e.g. a Google Alerts feed) can't be rebuilt.
                    if not (self.fallback and keyword and active_source != self.fallback):
                        continue

                    self._primary_blocked = True
                    fallback_url = self._rss_url_for_keyword(keyword, source=self.fallback)
                    logger.warning(
                        f"[Discovery] Falling back to {self.fallback} for '{keyword[:40]}' "
                        f"(and the rest of this crawl)"
                    )
                    time.sleep(self.rate_limit_delay)
                    response = self.session.get(
                        fallback_url, timeout=30, proxies=self._proxies(fallback_url)
                    )
                    if self._looks_blocked(response.status_code, response.text):
                        logger.error(
                            f"[Discovery] Fallback {self.fallback} ALSO blocked "
                            f"(HTTP {response.status_code}) — no source available"
                        )
                        continue
                    rss_url, active_source = fallback_url, self.fallback

                feed = feedparser.parse(response.text)

                if not feed.entries:
                    logger.warning(f"[Discovery] No entries found in feed (HTTP {response.status_code}) - genuinely no matching news")
                    continue

                logger.info(f"[Discovery] Found {len(feed.entries)} entries from {active_source}")

                # `keyword` was resolved at the top of the loop — deliberately not
                # re-read from keyword_map here, because rss_url may have been
                # rewritten to the fallback source and would no longer be a key.

                # Extract metadata from each entry
                for entry_idx, entry in enumerate(feed.entries):
                    metadata = self._extract_metadata(entry, rss_url)
                    if metadata:
                        # Drop articles already seen in an earlier feed this crawl.
                        # Free here; one Google decode each if carried downstream.
                        if metadata['url'] in seen_urls:
                            duplicate_entries += 1
                            logger.debug(
                                f"[Discovery]   Entry {entry_idx + 1}: already seen in an "
                                f"earlier feed, skipping: {metadata.get('title', '')[:60]}"
                            )
                            continue
                        seen_urls.add(metadata['url'])

                        # Add entry index for tracking
                        metadata['entry_index'] = entry_idx + 1
                        metadata['total_entries'] = len(feed.entries)
                        # Add the keyword that found this article
                        metadata['keyword'] = keyword
                        all_metadata.append(metadata)

                        # Log detailed extraction info
                        logger.info(f"[Discovery]   Entry {entry_idx + 1}/{len(feed.entries)}:")
                        logger.info(f"[Discovery]     ✓ Title: {metadata.get('title', 'N/A')[:70]}...")
                        logger.info(f"[Discovery]     ✓ Publisher: {metadata.get('publisher_name', 'N/A')}")
                        logger.info(f"[Discovery]     ✓ Google News URL: {metadata.get('url', 'N/A')[:80]}...")
                        logger.info(f"[Discovery]     ✓ RSS Feed: {rss_url[:80]}...")

            except Exception as e:
                logger.error(f"[Discovery] Error fetching RSS feed: {str(e)}")
                continue

        logger.info(
            f"[Discovery] Total metadata extracted: {len(all_metadata)} unique"
            + (f" ({duplicate_entries} cross-feed duplicates dropped before resolution)"
               if duplicate_entries else "")
        )
        return all_metadata

    def _extract_metadata(self, entry: Any, rss_url: str) -> Optional[Dict[str, Any]]:
        """
        Extract metadata from RSS entry.
        CRITICAL: Only extracts metadata, does NOT resolve URLs or fetch content.

        Args:
            entry: RSS feed entry
            rss_url: Original RSS URL

        Returns:
            Metadata dictionary or None
        """
        try:
            # Extract title (Google Alerts wraps matched keywords in <b> tags)
            title = self._clean_title(entry.get('title', ''))
            if not title:
                return None

            # Resolve the article link. Bing News RSS and Google Alerts both wrap
            # the real URL in a redirect carrying it in a ``url`` query param;
            # unwrap it to the direct publisher URL so the downstream resolver
            # treats it as 'direct' and skips Google decoding entirely.
            raw_link = entry.get('link', '').strip()
            article_url = self._unwrap_redirect(raw_link)

            # Extract publisher information
            publisher_name = ""
            publisher_domain = ""

            # Method 0: Bing exposes the publisher in a news_source field
            news_source = entry.get('news_source', '')
            if isinstance(news_source, str) and news_source.strip():
                publisher_name = news_source.strip()

            # Method 1: Get from source field
            source = entry.get('source', {})
            if isinstance(source, dict):
                publisher_name = publisher_name or source.get('title', '').strip()
                source_url = source.get('href', '')
                if source_url:
                    publisher_domain = self._extract_domain(source_url)

            # Publisher domain from the resolved (direct) article URL
            if not publisher_domain and article_url:
                dom = self._extract_domain(article_url)
                if dom not in self.REDIRECT_HOSTS:
                    publisher_domain = dom

            # Method 2: Parse from title. Google News uses " - Publisher"; Google
            # Alerts uses either that or " | Publisher".
            if not publisher_name:
                for sep in (' - ', ' | '):
                    if sep in title:
                        parts = title.rsplit(sep, 1)
                        if len(parts) == 2 and parts[1].strip():
                            publisher_name = parts[1].strip()
                            break

            # Method 3: Fall back to the raw feed link's host — only useful when
            # it isn't one of the redirect wrappers (which carry no publisher).
            if not publisher_domain:
                try:
                    parsed = urlparse(entry.get('link', ''))
                    if parsed.netloc and parsed.netloc not in self.REDIRECT_HOSTS:
                        publisher_domain = parsed.netloc
                except Exception:
                    pass

            # Last resort: derive the display name from the domain so alerts
            # entries (which carry no <source> element at all) aren't all
            # attributed to 'Unknown'.
            if not publisher_name and publisher_domain:
                publisher_name = publisher_domain.split('.')[0].title()

            # Extract publish date
            publish_date = entry.get('published', '')
            if publish_date:
                try:
                    import dateutil.parser
                    parsed_date = dateutil.parser.parse(publish_date)
                    publish_date = parsed_date.strftime("%Y-%m-%d %H:%M:%S")
                except:
                    pass

            # article_url was resolved at the top (Bing redirect unwrapped to the
            # direct publisher URL; Google links left as-is for later decoding).
            # Validate that we have a URL
            if not article_url:
                logger.warning(f"[Discovery] ✗ Skipping - no URL: {title[:60]}...")
                return None

            # Build metadata dictionary
            metadata = {
                'title': title,
                'url': article_url,  # direct publisher URL (Bing) or Google redirect (decoded later)
                'publisher_name': publisher_name or 'Unknown',
                'publisher_domain': publisher_domain or '',
                'publish_date': publish_date,
                'google_rss_url': rss_url,  # For reference only
                'discovered_at': datetime.now().isoformat()
            }

            # Log discovery with URL
            url_preview = article_url[:80] if len(article_url) > 80 else article_url
            logger.info(f"[Discovery] ✓ {title[:60]}... | Publisher: {publisher_name} | URL: {url_preview}")

            return metadata

        except Exception as e:
            logger.error(f"[Discovery] Error extracting metadata: {str(e)}")
            return None

    def _unwrap_redirect(self, link: str) -> str:
        """Unwrap a search-engine redirect to the real publisher URL.

        Two wrapper shapes are handled:
          - Bing News RSS:  http://www.bing.com/news/apiclick.aspx?...&url=<real>
          - Google Alerts:  https://www.google.com/url?rct=j&sa=t&url=<real>&ct=...

        Both carry the destination in a ``url`` query param, so parse_qs pulls it
        out and percent-decodes it in one step (Google encodes the target's own
        query string, e.g. ``watch%3Fv%3Dxyz`` -> ``watch?v=xyz``).

        Unwrapping matters beyond cosmetics: the downstream resolver only decodes
        news.google.com links and passes everything else through as 'direct', so
        an un-unwrapped wrapper would be stored, fetched and deduped as-is — with
        every article's domain coming out as "google".

        Anything else (a plain URL, a news.google.com link that still needs
        decoding) passes through unchanged.

        Implemented in utils.url_unwrap so the RSS crawler shares one copy.
        """
        return unwrap_search_redirect(link)

    # Back-compat alias — older call sites referenced the Bing-only name.
    _unwrap_bing_url = _unwrap_redirect

    @staticmethod
    def _clean_title(title: str) -> str:
        """Strip the markup Google Alerts wraps around matched keywords.

        Alerts titles arrive as ``Dirty air may trigger <b>rheumatoid arthritis</b>
        flares`` and entities as ``&#39;``; both would otherwise be stored verbatim
        and break title-based dedup against the same article from another source.

        Implemented in utils.feed_normalize so the RSS crawler shares one copy.
        """
        return clean_feed_title(title)

    def _extract_domain(self, url: str) -> str:
        """
        Extract domain from URL.

        Args:
            url: URL string

        Returns:
            Domain string (e.g., "reuters.com")
        """
        try:
            parsed = urlparse(url)
            domain = parsed.netloc
            # Remove www. prefix
            if domain.startswith('www.'):
                domain = domain[4:]
            return domain
        except:
            return ''

    def _is_boolean_expression(self, keyword: str) -> bool:
        """
        Check if keyword contains boolean operators.

        Supports:
        - OR: "Crohn" OR "IBD"
        - AND: "drug" AND "FDA"
        - Parentheses: ("Crohn" OR "IBD") AND "treatment"
        - Exclusion: -site:msn.com
        """
        # Check for boolean operators (case-insensitive but Google uses uppercase)
        boolean_patterns = [' OR ', ' AND ', ' -', '(', ')']
        keyword_upper = keyword.upper()
        return any(pattern.upper() in keyword_upper or pattern in keyword for pattern in boolean_patterns)

    def _build_rss_urls(self, keywords: List[str], time_filter: str = "1d") -> List[str]:
        """
        Build Google News RSS URLs from keywords.

        Supports both simple keywords and boolean expressions:
        - Simple: "Crohn" -> searches for exact phrase "Crohn"
        - Boolean: "Crohn" OR "IBD" -> searches for either term
        - Complex: ("Crohn" OR "IBD") AND "treatment" -> combined search

        Args:
            keywords: List of search keywords or boolean expressions
            time_filter: Time filter for recent articles (1h, 1d, 7d). Default: 1d (last 24 hours)

        Returns:
            List of RSS feed URLs
        """
        rss_urls = []
        for keyword in sorted(set(keywords)):
            keyword = keyword.strip()
            if not keyword:
                continue
            if self._is_boolean_expression(keyword):
                logger.info(f"[Discovery] Boolean expression detected: {keyword[:50]}...")
            rss_urls.append(self._rss_url_for_keyword(keyword, time_filter))

        return rss_urls
