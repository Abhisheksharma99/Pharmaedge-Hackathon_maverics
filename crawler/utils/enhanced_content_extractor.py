"""
Enhanced Content Extractor with Fallback Chain and Paywall Handling

Extraction strategy (ordered):
1. HTML-based extraction (fastest)
2. trafilatura (excellent for content)
3. newspaper3k (good for standard articles)
4. Basic HTML parsing (fallback)

For JavaScript-heavy sites (MSN, Bloomberg, etc.):
- Uses Playwright to render JavaScript before extraction
- Falls back to curl_cffi for static sites (faster)

Based on test observations:
- Paywalled publishers may provide partial content (headline, snippet, metadata)
- DNS, SSL, and timeout errors are infrastructure issues
- Failed extraction should be classified properly
"""

from typing import Dict, Any, Optional
from curl_cffi import requests
from bs4 import BeautifulSoup
import ssl
import socket
from urllib.parse import urlparse
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

# Configure logger
logger = logging.getLogger(__name__)

# JavaScript-required domains - these sites load content dynamically
# and require a browser to render JavaScript before extraction
JS_REQUIRED_DOMAINS = [
    'msn.com',
    'bloomberg.com',
    'forbes.com',
    'businessinsider.com',
    'seekingalpha.com',
    'investing.com',
    'marketwatch.com',
    'wsj.com',
    'ft.com',
    'barrons.com',
]

# Site-specific article selectors for JS-rendered pages
# These selectors work better than trafilatura on JS-heavy sites
SITE_SPECIFIC_SELECTORS = {
    'msn.com': ['[data-testid="article-body"]', '.article-body', '#content', 'article[role="main"]', 'article', 'main article', '.articleContent'],
    'bloomberg.com': ['.body-content', 'article', '.article-body'],
    'forbes.com': ['.article-body', '.body-container', 'article'],
    'businessinsider.com': ['.content-lock-content', '.post-content', 'article'],
    'seekingalpha.com': ['.paywall-full-content', 'article', '.article-content'],
    'investing.com': ['.articlePage', '.WYSIWYG', 'article'],
}


class ContentCompleteness:
    """Content completeness classification."""
    FULL = "full"              # Full article content
    PARTIAL = "partial"        # Partial content (headline + snippet)
    MINIMAL = "minimal"        # Only headline/metadata
    NONE = "none"             # No content extracted


class FailureType:
    """Failure type classification."""
    INFRASTRUCTURE = "infrastructure"  # DNS, SSL, timeout errors
    PAYWALL = "paywall"               # Paywall detected
    BLOCKED = "blocked"               # 403, 429, etc.
    EXTRACTION = "extraction"         # Content extraction failed
    INVALID_URL = "invalid_url"       # Invalid URL format


class EnhancedContentExtractor:
    """
    Enhanced content extractor with fallback chain and failure classification.

    Based on test observations:
    - Uses ordered fallback chain for robustness
    - Detects and handles paywalls gracefully
    - Classifies failures properly (infrastructure vs logic)
    - Allows partial content for paywalled publishers
    - Uses Playwright for JavaScript-heavy sites (MSN, Bloomberg, etc.)
    """

    def __init__(self):
        self.session = requests.Session(impersonate="chrome110")
        self.timeout = 30
        self.min_full_content_length = 500     # Min chars for full content
        self.min_partial_content_length = 100  # Min chars for partial content
        self._playwright = None
        self._browser = None

    def close(self) -> None:
        """Explicitly release the curl_cffi Session's native handle.

        Must be called (try/finally) rather than left to GC - see
        GoogleNewsDiscovery.close() for why GC-driven cleanup from an
        arbitrary thread corrupts the heap.
        """
        self.session.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()

    def _requires_javascript(self, url: str) -> bool:
        """Check if URL requires JavaScript rendering."""
        domain = urlparse(url).netloc.lower()
        for js_domain in JS_REQUIRED_DOMAINS:
            if js_domain in domain:
                return True
        return False

    def _get_site_selectors(self, url: str) -> list:
        """Get site-specific selectors for article content."""
        domain = urlparse(url).netloc.lower()
        for site_domain, selectors in SITE_SPECIFIC_SELECTORS.items():
            if site_domain in domain:
                return selectors
        return []

    def _fetch_with_playwright(self, url: str, timeout_seconds: int = None) -> Dict[str, Any]:
        """
        Fetch page using Playwright with a hard timeout wrapper.

        The wrapper timeout is a BACKSTOP, not the working limit. It used to be
        30s while the inner path could legitimately spend ~155s (45s goto + 60s
        retry + selector waits), so the timeout fired on the normal slow path and
        every firing abandoned a thread still holding a live Chromium - the
        thread cannot be cancelled once inside page.goto(). Those orphans are why
        prod accumulated browsers 11+ hours old.

        The inner call now owns a self-enforced budget and always tears its
        browser down; this timeout only covers a truly wedged thread.
        """
        if timeout_seconds is None:
            timeout_seconds = int(os.getenv('PLAYWRIGHT_FETCH_TIMEOUT', '90'))
        # Inner finishes first under normal slowness, so its finally runs.
        inner_budget = max(10, timeout_seconds - 15)

        executor = ThreadPoolExecutor(max_workers=1)
        try:
            future = executor.submit(
                self._fetch_with_playwright_inner, url, inner_budget
            )
            return future.result(timeout=timeout_seconds)
        except FuturesTimeoutError:
            error_msg = f"Playwright hard timeout ({timeout_seconds}s) for {urlparse(url).netloc}"
            logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
            return {
                'success': False,
                'failure_type': FailureType.INFRASTRUCTURE,
                'error': error_msg,
                'content': None
            }
        except Exception as e:
            error_msg = f"Playwright wrapper error for {urlparse(url).netloc}: {str(e)[:100]}"
            logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
            return {
                'success': False,
                'failure_type': FailureType.INFRASTRUCTURE,
                'error': error_msg,
                'content': None
            }
        finally:
            # Don't wait for thread completion - let it die in background
            executor.shutdown(wait=False, cancel_futures=True)

    def _fetch_with_playwright_inner(
        self, url: str, budget_seconds: float = 75.0
    ) -> Dict[str, Any]:
        """
        Inner Playwright fetch - called with timeout wrapper.
        Uses sync API since this extractor runs in a thread pool.

        Every blocking step is clamped to the remaining share of budget_seconds
        so this function returns (and runs its teardown) before the wrapper's
        backstop fires. Without that, the wrapper abandoned this thread mid-fetch
        and its Chromium stayed alive for the life of the container.
        """
        broker = None
        broker_session_id = None
        browser = None
        local_slot_held = False
        deadline = time.monotonic() + budget_seconds

        def remaining_ms(cap_ms: int) -> int:
            """Time left in the budget, clamped to a per-step cap."""
            left_ms = int((deadline - time.monotonic()) * 1000)
            if left_ms <= 0:
                raise TimeoutError(f"Playwright budget of {budget_seconds}s exhausted")
            return max(1, min(cap_ms, left_ms))

        def sleep_within_budget(seconds: float):
            """Sleep, but never past the deadline."""
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError(f"Playwright budget of {budget_seconds}s exhausted")
            time.sleep(min(seconds, left))

        try:
            from utils.playwright_sync import safe_sync_playwright
            from services.browser_broker import BrowserBroker

            logger.info(f"[Enhanced Extractor] Using Playwright for JS-heavy site: {urlparse(url).netloc}")

            broker = BrowserBroker()
            with safe_sync_playwright() as p:
                # Broker first: connect to a remote browser over its wsEndpoint so
                # the heavy Chromium runs on the fleet, not in this process. Without
                # this, every JS-heavy article (MSN/Bloomberg/WSJ/...) would launch a
                # local Chromium and exhaust RAM at high crawler concurrency. The
                # remote session is always torn down in the finally below.
                browser = None
                if broker.is_configured:
                    try:
                        broker_session_id, ws_endpoint = broker.launch_sync(headless=True)
                        browser = p.chromium.connect(
                            ws_endpoint, timeout=remaining_ms(60000)
                        )
                        logger.info(
                            f"[Enhanced Extractor] Connected to remote browser broker session {broker_session_id}"
                        )
                    except Exception as broker_err:
                        logger.warning(
                            f"[Enhanced Extractor] Broker launch/connect failed ({broker_err}); "
                            f"falling back to local Chromium"
                        )
                        if broker_session_id:
                            broker.close_sync(broker_session_id)
                            broker_session_id = None
                        browser = None

                # Local fallback: launch Chromium in-process (only when the broker
                # is unconfigured or unavailable). Must hold an overflow slot -
                # this runs once per JS-heavy article, so uncapped it reproduces
                # the same RAM exhaustion the broker was introduced to avoid.
                if browser is None:
                    from services.browser_pool import acquire_local_browser_slot_sync
                    if not acquire_local_browser_slot_sync():
                        raise RuntimeError(
                            "Local Chromium ceiling reached - skipping Playwright "
                            "fetch (caller falls back to the HTTP extractors)"
                        )
                    local_slot_held = True
                    browser = p.chromium.launch(
                        headless=True,
                        args=[
                            '--disable-blink-features=AutomationControlled',
                            '--disable-dev-shm-usage',
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-gpu',
                        ]
                    )
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )
                page = context.new_page()

                # Navigate and wait for content to load
                domain = urlparse(url).netloc.lower()
                is_msn = 'msn.com' in domain

                try:
                    if is_msn:
                        # MSN: Use 'load' event (not networkidle - MSN has continuous network activity)
                        # Then wait for article content selector explicitly
                        logger.info(f"[Enhanced Extractor] MSN detected - using load + selector wait strategy")
                        page.goto(url, wait_until="load", timeout=remaining_ms(45000))
                    else:
                        # Use domcontentloaded for faster loading on other sites
                        page.goto(url, wait_until="domcontentloaded", timeout=remaining_ms(45000))
                except Exception as nav_error:
                    # Try with longer timeout if initial fails
                    logger.warning(f"[Enhanced Extractor] Initial navigation timed out, retrying with load...")
                    page.goto(url, wait_until="load", timeout=remaining_ms(60000))

                # Wait for article content to appear
                site_selectors = self._get_site_selectors(url)
                content_found = False

                if site_selectors:
                    # MSN needs longer wait - try multiple selectors
                    selector_timeout = 15000 if is_msn else 10000

                    for selector in site_selectors[:3]:  # Try first 3 selectors
                        try:
                            page.wait_for_selector(
                                selector, timeout=remaining_ms(selector_timeout)
                            )
                            logger.info(f"[Enhanced Extractor] Found content with selector: {selector}")
                            content_found = True
                            break
                        except:
                            continue

                    if is_msn and not content_found:
                        # MSN fallback: wait for any article-like content
                        logger.info(f"[Enhanced Extractor] MSN: Waiting for JS to render content...")
                        sleep_within_budget(5)  # Give MSN time to load article via JS
                    elif not content_found:
                        sleep_within_budget(3)

                # Check for error pages
                if page.url != url:
                    # Check if redirected to error page
                    if 'error' in page.url.lower() or '404' in page.url:
                        # Browser teardown happens in the finally below.
                        return {
                            'success': False,
                            'failure_type': FailureType.INFRASTRUCTURE,
                            'error': f"Page redirected to error: {page.url}",
                            'content': None
                        }

                html_content = page.content()
                response_size = len(html_content)

                # Try to extract content using site-specific selectors first
                site_selectors = self._get_site_selectors(url)
                extracted_content = None
                extracted_title = page.title()

                for selector in site_selectors:
                    try:
                        element = page.query_selector(selector)
                        if element:
                            text = element.inner_text()
                            if len(text) > 100:  # Minimum viable content
                                extracted_content = text
                                logger.info(f"[Enhanced Extractor] Playwright extracted {len(text)} chars using selector '{selector}'")
                                break
                    except Exception as e:
                        continue

                logger.info(f"[Enhanced Extractor] ✓ Playwright fetched {response_size} bytes")

                result = {
                    'success': True,
                    'html': html_content,
                    'status_code': 200,
                    'content_length': response_size,
                    'fetch_method': 'playwright'
                }

                # If we extracted content via selector, include it
                if extracted_content:
                    result['pre_extracted_content'] = extracted_content
                    result['pre_extracted_title'] = extracted_title

                return result

        except Exception as e:
            error_msg = f"Playwright error for {urlparse(url).netloc}: {str(e)[:100]}"
            logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
            return {
                'success': False,
                'failure_type': FailureType.INFRASTRUCTURE,
                'error': error_msg,
                'content': None
            }
        finally:
            # Close the browser on EVERY exit path - success, error-page return,
            # budget exhaustion, or exception. This used to be two inline calls on
            # the happy paths only, so any failure mid-fetch left a local Chromium
            # running inside the app container.
            if browser is not None:
                try:
                    browser.close()
                except Exception as close_err:
                    logger.warning(
                        f"[Enhanced Extractor] Browser close failed: {str(close_err)[:80]}"
                    )

            # Always tear down the remote broker session (and free its fleet slot),
            # regardless of which exit path the body took. Best-effort; never raises.
            if broker is not None and broker_session_id:
                broker.close_sync(broker_session_id)

            # Give the local-Chromium slot back only after the browser is closed.
            if local_slot_held:
                from services.browser_pool import release_local_browser_slot
                release_local_browser_slot()

    def extract(
        self,
        url: str,
        metadata: Dict[str, Any],
        allow_partial: bool = True
    ) -> Optional[Dict[str, Any]]:
        """
        Extract content from publisher URL with fallback chain.

        Args:
            url: Publisher article URL
            metadata: Article metadata
            allow_partial: Whether to accept partial content (for paywalled publishers)

        Returns:
            Dictionary with:
            - content: Extracted article text
            - title: Extracted title
            - date: Extracted publication date
            - extraction_method: Method used
            - extraction_quality: Quality score (0-100)
            - completeness: Content completeness (full/partial/minimal/none)
            - paywall_detected: Whether paywall was detected
            Or None if extraction completely failed
        """
        logger.info(f"[Enhanced Extractor] Fetching content from: {url[:80]}...")

        # Validate URL
        if not url or not url.startswith('http'):
            error_msg = f"Invalid URL format: {url[:50] if url else 'empty'}"
            logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
            return {
                'failure_type': FailureType.INVALID_URL,
                'error': error_msg,
                'content': None
            }

        # Don't extract from Google domains
        if 'google.com' in url:
            error_msg = "Google domain not allowed for extraction"
            logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
            return {
                'failure_type': FailureType.INVALID_URL,
                'error': error_msg,
                'content': None
            }

        # Fetch page content
        fetch_result = self._fetch_page(url)

        if not fetch_result['success']:
            return fetch_result  # Return failure info

        html_content = fetch_result['html']

        # Check for paywall
        paywall_detected = self._detect_paywall(html_content)

        if paywall_detected:
            logger.warning(f"[Enhanced Extractor] ⚠ Paywall detected")

        # Check if Playwright already extracted content via DOM selectors
        # This is more reliable for JS-heavy sites than trafilatura/newspaper
        if fetch_result.get('pre_extracted_content'):
            pre_content = fetch_result['pre_extracted_content']
            pre_title = fetch_result.get('pre_extracted_title', '')
            content_length = len(pre_content)

            completeness = self._determine_completeness(content_length, paywall_detected)

            if completeness in [ContentCompleteness.FULL, ContentCompleteness.PARTIAL]:
                quality = self._calculate_quality_score(
                    {'content': pre_content, 'title': pre_title, 'paywall_detected': paywall_detected},
                    completeness
                )
                logger.info(f"[Enhanced Extractor] ✓ Using Playwright DOM extraction: {content_length} chars, {completeness}")
                return {
                    'content': pre_content,
                    'title': pre_title,
                    'date': '',
                    'extraction_method': 'playwright_dom',
                    'extraction_quality': quality,
                    'completeness': completeness,
                    'paywall_detected': paywall_detected,
                }

        # Try extraction methods in order
        extraction_methods = [
            ('html_based', self._extract_with_html_based),
            ('trafilatura', self._extract_with_trafilatura),
            ('newspaper3k', self._extract_with_newspaper),
            ('basic_html', self._extract_with_basic_html),
        ]

        best_result = None
        best_quality = 0

        for method_name, method_func in extraction_methods:
            try:
                result = method_func(url, html_content)

                if result:
                    content_length = len(result.get('content', ''))

                    # Determine completeness
                    completeness = self._determine_completeness(
                        content_length,
                        paywall_detected
                    )

                    result['completeness'] = completeness
                    result['paywall_detected'] = paywall_detected
                    result['extraction_method'] = method_name

                    # Calculate quality score
                    quality = self._calculate_quality_score(result, completeness)
                    result['extraction_quality'] = quality

                    logger.info(f"[Enhanced Extractor] {method_name}: {content_length} chars, {completeness}, quality={quality}")

                    # Keep best result
                    if quality > best_quality:
                        best_quality = quality
                        best_result = result

                    # If we have full content, return immediately
                    if completeness == ContentCompleteness.FULL:
                        logger.info(f"[Enhanced Extractor] ✓ Full content extracted using {method_name}")
                        return best_result

            except Exception as e:
                error_detail = str(e)[:100]
                logger.warning(f"[Enhanced Extractor] {method_name} error: {error_detail}")
                continue

        # Check if we have acceptable result
        if best_result:
            completeness = best_result.get('completeness')

            # Accept full content always
            if completeness == ContentCompleteness.FULL:
                return best_result

            # Accept partial content if allowed
            if allow_partial and completeness == ContentCompleteness.PARTIAL:
                logger.info(f"[Enhanced Extractor] ✓ Partial content accepted ({len(best_result.get('content', ''))} chars)")
                return best_result

            # Don't accept minimal or no content
            content_length = len(best_result.get('content', ''))
            error_msg = f"Content quality insufficient: {completeness} ({content_length} chars, min required: {self.min_partial_content_length if allow_partial else self.min_full_content_length})"
            logger.warning(f"[Enhanced Extractor] ✗ {error_msg}")
            logger.info(f"[Enhanced Extractor] Extraction attempts summary:")
            logger.info(f"  - Best method tried: {best_result.get('extraction_method', 'unknown')}")
            logger.info(f"  - Content extracted: {content_length} chars")
            logger.info(f"  - Completeness level: {completeness}")
            return {
                'failure_type': FailureType.EXTRACTION,
                'error': error_msg,
                'paywall_detected': paywall_detected,
                'completeness': completeness,
                'content': None,
                'extraction_attempts': {
                    'best_method': best_result.get('extraction_method', 'unknown'),
                    'content_length': content_length,
                    'completeness': completeness
                }
            }

        # All methods failed
        error_msg = "All extraction methods failed - no content extracted"
        if paywall_detected:
            error_msg += " (paywall detected)"
        logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
        logger.info(f"[Enhanced Extractor] Tried methods: html_based, trafilatura, newspaper3k, basic_html")
        return {
            'failure_type': FailureType.EXTRACTION,
            'error': error_msg,
            'paywall_detected': paywall_detected,
            'content': None,
            'extraction_attempts': {
                'methods_tried': ['html_based', 'trafilatura', 'newspaper3k', 'basic_html'],
                'all_failed': True
            }
        }

    def _fetch_page(self, url: str) -> Dict[str, Any]:
        """
        Fetch page HTML with infrastructure error classification.
        Uses Playwright for JavaScript-heavy sites, curl_cffi for static sites.
        """
        # Check if site requires JavaScript rendering
        if self._requires_javascript(url):
            playwright_result = self._fetch_with_playwright(url)
            if playwright_result.get('success'):
                return playwright_result
            # Playwright was refused (local-Chromium ceiling) or failed. Fall
            # through to the HTTP path rather than dropping the article: curl_cffi
            # impersonation often returns usable HTML, and the extraction chain
            # downstream (trafilatura/newspaper3k) can work with partial content.
            # Without this, hitting the ceiling would turn a slow crawl into a
            # failed one.
            logger.warning(
                f"[Enhanced Extractor] Playwright unavailable for "
                f"{urlparse(url).netloc} ({playwright_result.get('error', 'unknown')[:80]}); "
                f"trying plain HTTP fetch"
            )

        # Standard HTTP fetch for static sites
        try:
            logger.info(f"[Enhanced Extractor] Making HTTP request to: {urlparse(url).netloc}")
            response = self.session.get(url, timeout=self.timeout)

            # Log response details
            response_size = len(response.text) if response.text else 0
            logger.info(f"[Enhanced Extractor] HTTP {response.status_code} - Response size: {response_size} bytes")

            # Check status code
            if response.status_code == 403:
                error_msg = f"403 Forbidden - Site blocked access to {urlparse(url).netloc}"
                logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
                return {
                    'success': False,
                    'failure_type': FailureType.BLOCKED,
                    'error': error_msg,
                    'content': None
                }
            elif response.status_code == 429:
                error_msg = f"429 Too Many Requests - Rate limited by {urlparse(url).netloc}"
                logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
                return {
                    'success': False,
                    'failure_type': FailureType.BLOCKED,
                    'error': error_msg,
                    'content': None
                }
            elif response.status_code >= 400:
                error_msg = f"HTTP {response.status_code} - Server error from {urlparse(url).netloc}"
                logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
                return {
                    'success': False,
                    'failure_type': FailureType.INFRASTRUCTURE,
                    'error': error_msg,
                    'content': None
                }

            logger.info(f"[Enhanced Extractor] ✓ Successfully fetched HTML ({response_size} bytes)")
            return {
                'success': True,
                'html': response.text,
                'status_code': response.status_code,
                'content_length': response_size
            }

        except socket.gaierror as e:
            # DNS resolution error
            error_msg = f"DNS resolution failed for {urlparse(url).netloc}: {str(e)[:80]}"
            logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
            return {
                'success': False,
                'failure_type': FailureType.INFRASTRUCTURE,
                'error': error_msg,
                'content': None
            }

        except ssl.SSLError as e:
            # SSL error
            error_msg = f"SSL certificate error for {urlparse(url).netloc}: {str(e)[:80]}"
            logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
            return {
                'success': False,
                'failure_type': FailureType.INFRASTRUCTURE,
                'error': error_msg,
                'content': None
            }

        except requests.errors.Timeout:
            # Timeout
            error_msg = f"Request timeout after {self.timeout}s for {urlparse(url).netloc}"
            logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
            return {
                'success': False,
                'failure_type': FailureType.INFRASTRUCTURE,
                'error': error_msg,
                'content': None
            }

        except Exception as e:
            # Other infrastructure errors
            error_msg = f"Network error fetching {urlparse(url).netloc}: {str(e)[:80]}"
            logger.error(f"[Enhanced Extractor] ✗ {error_msg}")
            logger.exception("Full traceback:")
            return {
                'success': False,
                'failure_type': FailureType.INFRASTRUCTURE,
                'error': error_msg,
                'content': None
            }

    def _extract_with_html_based(self, url: str, html_content: str) -> Optional[Dict[str, Any]]:
        """Extract using HTML-based approach (fastest)."""
        try:
            from spiders.article_spider import ArticleSpider

            spider = ArticleSpider(html_content, url)
            result = spider.scrape({
                "title": "",
                "date": "",
                "content": "",
                "company": ""
            })

            content = result.get("content", "")
            if not content:
                return None

            return {
                'content': content,
                'title': result.get("title", ""),
                'date': result.get("date", ""),
            }

        except Exception as e:
            return None

    def _extract_with_trafilatura(self, url: str, html_content: str) -> Optional[Dict[str, Any]]:
        """Extract using trafilatura."""
        try:
            import trafilatura

            content = trafilatura.extract(
                html_content,
                url=url,
                include_comments=False,
                include_tables=True,
                include_images=False,
                output_format='txt'
            )

            if not content:
                return None

            # Try to extract metadata
            metadata = trafilatura.extract_metadata(html_content)
            title = metadata.title if metadata else ''
            date = metadata.date if metadata else ''

            return {
                'content': content,
                'title': title,
                'date': date,
            }

        except ImportError:
            return None
        except Exception as e:
            return None

    def _extract_with_newspaper(self, url: str, html_content: str) -> Optional[Dict[str, Any]]:
        """Extract using newspaper3k."""
        try:
            from newspaper import Article

            article = Article(url)
            article.set_html(html_content)
            article.parse()

            content = article.text
            if not content:
                return None

            return {
                'content': content,
                'title': article.title or '',
                'date': article.publish_date.isoformat() if article.publish_date else '',
            }

        except ImportError:
            return None
        except Exception as e:
            return None

    def _extract_with_basic_html(self, url: str, html_content: str) -> Optional[Dict[str, Any]]:
        """Extract using basic HTML parsing (fallback)."""
        try:
            soup = BeautifulSoup(html_content, 'html.parser')

            # Remove unwanted elements
            for element in soup(['script', 'style', 'nav', 'footer', 'header', 'aside']):
                element.decompose()

            # Try to find article content
            article_selectors = [
                'article',
                '[role="article"]',
                '.article-content',
                '.article-body',
                '.post-content',
                '.entry-content',
                'main',
            ]

            content_element = None
            for selector in article_selectors:
                content_element = soup.select_one(selector)
                if content_element:
                    break

            if not content_element:
                content_element = soup.find('body')

            if not content_element:
                return None

            # Extract paragraphs
            paragraphs = content_element.find_all('p')
            if not paragraphs:
                return None

            content = '\n\n'.join([p.get_text(strip=True) for p in paragraphs if p.get_text(strip=True)])

            if not content:
                return None

            # Extract title
            title = ''
            title_element = soup.find('h1')
            if title_element:
                title = title_element.get_text(strip=True)

            return {
                'content': content,
                'title': title,
                'date': '',
            }

        except Exception as e:
            return None

    def _detect_paywall(self, html_content: str) -> bool:
        """Detect if page has a paywall."""
        paywall_indicators = [
            'paywall',
            'subscribe to read',
            'subscription required',
            'subscribe for unlimited',
            'become a member to read',
            'register to continue',
            'subscribers only',
            'paid subscription',
            'premium content',
        ]

        html_lower = html_content.lower()

        for indicator in paywall_indicators:
            if indicator in html_lower:
                return True

        return False

    def _determine_completeness(
        self,
        content_length: int,
        paywall_detected: bool
    ) -> str:
        """Determine content completeness level."""
        if content_length >= self.min_full_content_length:
            if paywall_detected:
                # Long content behind paywall might be partial
                return ContentCompleteness.PARTIAL
            return ContentCompleteness.FULL

        elif content_length >= self.min_partial_content_length:
            return ContentCompleteness.PARTIAL

        elif content_length > 0:
            return ContentCompleteness.MINIMAL

        else:
            return ContentCompleteness.NONE

    def _calculate_quality_score(
        self,
        result: Dict[str, Any],
        completeness: str
    ) -> int:
        """Calculate quality score (0-100)."""
        base_score = 0

        # Base score by completeness
        if completeness == ContentCompleteness.FULL:
            base_score = 85
        elif completeness == ContentCompleteness.PARTIAL:
            base_score = 60
        elif completeness == ContentCompleteness.MINIMAL:
            base_score = 40
        else:
            base_score = 0

        # Bonus for having title
        if result.get('title'):
            base_score += 5

        # Bonus for having date
        if result.get('date'):
            base_score += 5

        # Penalty for paywall
        if result.get('paywall_detected'):
            base_score -= 10

        return min(max(base_score, 0), 100)
