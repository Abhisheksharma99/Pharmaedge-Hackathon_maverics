"""
Browser Pool Service
Manages a pool of reusable browser instances to reduce resource consumption.
Prevents memory exhaustion by reusing browsers instead of launching new ones.
"""

import asyncio
import threading
from typing import Optional, List, Tuple
from datetime import datetime, timedelta
from playwright.async_api import Browser, async_playwright, Playwright
import os
from utils.logging_config import get_logger

# Configure logging using CrawlerLogger
logger = get_logger("services.browser_pool")


class BrowserPool:
    """Pool of reusable browser instances to reduce resource consumption."""

    def __init__(
        self,
        max_browsers: int = None,
        browser_lifetime_minutes: int = 30,
        headless: bool = True
    ):
        """
        Initialize browser pool.

        Args:
            max_browsers: Maximum number of concurrent browser instances (default from env or 3)
            browser_lifetime_minutes: Recycle browsers after this many minutes (default: 30)
            headless: Run browsers in headless mode (default: True)
        """
        # Get from environment or use defaults
        if max_browsers is None:
            max_browsers = int(os.getenv('BROWSER_POOL_SIZE', '3'))

        self.max_browsers = max_browsers
        self.browser_lifetime = timedelta(minutes=browser_lifetime_minutes)
        self.headless = headless

        # Pool state
        self.available_browsers: List[Tuple[Browser, datetime]] = []
        self.in_use_browsers: List[Tuple[Browser, datetime]] = []
        self.playwright_instance: Optional[Playwright] = None
        self.lock = asyncio.Lock()
        self._started = False

        logger.info(
            f"Browser pool initialized (max: {max_browsers}, "
            f"lifetime: {browser_lifetime_minutes}m, headless: {headless})"
        )

    async def start(self):
        """Start the playwright instance."""
        if not self._started:
            self.playwright_instance = await async_playwright().start()
            self._started = True
            logger.info("✓ Playwright started for browser pool")

    async def get_browser(self) -> Browser:
        """
        Get an available browser from the pool or create a new one.

        Returns:
            Browser instance ready to use

        Raises:
            Exception: If pool is exhausted and can't create new browser
        """
        if not self._started:
            await self.start()

        async with self.lock:
            # Check for available browser
            while self.available_browsers:
                browser, created_at = self.available_browsers.pop(0)

                # Check if browser is still alive and not too old
                age = datetime.now() - created_at
                if browser.is_connected() and age < self.browser_lifetime:
                    self.in_use_browsers.append((browser, created_at))
                    logger.debug(f"Reusing browser from pool (age: {age.seconds}s)")
                    return browser
                else:
                    # Browser too old or disconnected, close it
                    try:
                        await browser.close()
                        logger.debug(f"Closed stale browser (age: {age.seconds}s)")
                    except Exception as e:
                        logger.warning(f"Error closing stale browser: {e}")

            # No available browsers, check if we can create new one
            total_browsers = len(self.in_use_browsers) + len(self.available_browsers)

            if total_browsers < self.max_browsers:
                logger.info(f"Creating new browser instance ({total_browsers + 1}/{self.max_browsers})")
                browser = await self._create_browser()
                created_at = datetime.now()
                self.in_use_browsers.append((browser, created_at))
                return browser
            else:
                # Pool exhausted
                logger.warning(
                    f"Browser pool exhausted ({self.max_browsers} browsers in use). "
                    f"Consider increasing BROWSER_POOL_SIZE or waiting."
                )
                raise Exception(
                    f"Browser pool exhausted. All {self.max_browsers} browsers are in use. "
                    f"Please wait for a browser to become available or increase BROWSER_POOL_SIZE."
                )

    async def _create_browser(self) -> Browser:
        """
        Create a new browser instance with optimized settings.

        Returns:
            Configured browser instance
        """
        browser = await self.playwright_instance.chromium.launch(
            headless=self.headless,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                # Memory optimizations
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                # GPU and rendering optimizations for stability
                '--disable-gpu',
                '--disable-software-rasterizer',
                # Note: Removed --single-process as it causes instability with multiple contexts
            ]
        )
        logger.debug("New browser instance created")
        return browser

    async def release_browser(self, browser: Browser, force_close: bool = False):
        """
        Release a browser back to the pool for reuse.

        Args:
            browser: Browser to release
            force_close: If True, close the browser instead of returning to pool
        """
        async with self.lock:
            # Find in in_use_browsers
            for i, (b, created_at) in enumerate(self.in_use_browsers):
                if b == browser:
                    self.in_use_browsers.pop(i)

                    # Check if browser should be closed or returned to pool
                    age = datetime.now() - created_at
                    should_reuse = (
                        not force_close and
                        browser.is_connected() and
                        age < self.browser_lifetime
                    )

                    if should_reuse:
                        # Close all pages/contexts to free memory
                        try:
                            contexts = browser.contexts
                            for context in contexts:
                                await context.close()
                        except Exception as e:
                            logger.warning(f"Error closing contexts: {e}")
                            # If we can't close contexts, don't return to pool
                            should_reuse = False

                    if should_reuse:
                        self.available_browsers.append((browser, created_at))
                        logger.debug(f"Browser released back to pool (age: {age.seconds}s)")
                    else:
                        # Close the browser
                        try:
                            if browser.is_connected():
                                await browser.close()
                            reason = "force_close" if force_close else f"expired/disconnected (age: {age.seconds}s)"
                            logger.debug(f"Closed browser: {reason}")
                        except Exception as e:
                            logger.warning(f"Error closing browser: {e}")
                    return

            # Browser not in list - try to close it anyway
            logger.warning("Browser not found in in_use_browsers during release")
            try:
                if browser.is_connected():
                    await browser.close()
            except:
                pass

    async def cleanup_stale_browsers(self):
        """Clean up browsers that have exceeded their lifetime."""
        async with self.lock:
            now = datetime.now()

            # Clean available browsers
            cleaned = []
            for browser, created_at in self.available_browsers:
                age = now - created_at
                if age < self.browser_lifetime and browser.is_connected():
                    cleaned.append((browser, created_at))
                else:
                    try:
                        await browser.close()
                        logger.debug(f"Cleaned stale available browser (age: {age.seconds}s)")
                    except Exception as e:
                        logger.warning(f"Error cleaning stale browser: {e}")

            self.available_browsers = cleaned

            # Note: Don't clean in_use browsers as they're actively being used

    async def close_all(self):
        """Close all browsers and cleanup."""
        async with self.lock:
            # Close all available browsers
            for browser, _ in self.available_browsers:
                try:
                    await browser.close()
                except Exception as e:
                    logger.warning(f"Error closing available browser: {e}")

            # Close all in-use browsers
            for browser, _ in self.in_use_browsers:
                try:
                    await browser.close()
                except Exception as e:
                    logger.warning(f"Error closing in-use browser: {e}")

            # Stop playwright
            if self.playwright_instance:
                try:
                    await self.playwright_instance.stop()
                except Exception as e:
                    logger.warning(f"Error stopping playwright: {e}")

            self.available_browsers.clear()
            self.in_use_browsers.clear()
            self._started = False
            logger.info("✓ All browsers closed and pool cleaned up")

    def get_stats(self) -> dict:
        """
        Get browser pool statistics.

        Returns:
            Dictionary with pool statistics
        """
        return {
            "max_browsers": self.max_browsers,
            "available": len(self.available_browsers),
            "in_use": len(self.in_use_browsers),
            "total": len(self.available_browsers) + len(self.in_use_browsers),
            "capacity_used_percent": int(
                (len(self.in_use_browsers) / self.max_browsers) * 100
            ) if self.max_browsers > 0 else 0,
        }


# Global browser pool instance
_browser_pool: Optional[BrowserPool] = None
_pool_lock = asyncio.Lock()


async def get_browser_pool() -> BrowserPool:
    """
    Get or create the global browser pool instance.

    Returns:
        Global BrowserPool instance
    """
    global _browser_pool

    async with _pool_lock:
        if _browser_pool is None:
            # Get config from environment
            max_browsers = int(os.getenv('BROWSER_POOL_SIZE', '3'))
            browser_lifetime = int(os.getenv('BROWSER_LIFETIME_MINUTES', '30'))

            _browser_pool = BrowserPool(
                max_browsers=max_browsers,
                browser_lifetime_minutes=browser_lifetime,
                headless=True
            )
            await _browser_pool.start()
            logger.info(f"Global browser pool created (size: {max_browsers})")

    return _browser_pool


# ---------------------------------------------------------------------------
# Local-Chromium overflow guard
# ---------------------------------------------------------------------------
# The pool is bounded by BROWSER_POOL_SIZE, but callers that fall back to a raw
# chromium.launch() when the broker is down AND the pool is exhausted used to be
# bounded by nothing at all: pool exhaustion — the one signal that should apply
# backpressure — instead triggered unlimited browser creation. That is what
# filled the 8GiB app cgroup with ~69 Chromiums in prod. Every local launch made
# outside the pool must now hold one of these slots and release it on teardown.
#
# The counter is threading-based (not asyncio) so that BOTH the async crawl path
# and the sync Playwright paths that run in worker threads draw on the SAME
# budget - two separate counters would each allow the full ceiling.
#
# It is per-process, so the real ceiling across the app is
# LOCAL_BROWSER_OVERFLOW x uvicorn workers. Size it accordingly.
_overflow_semaphore: Optional[threading.BoundedSemaphore] = None
_overflow_lock = threading.Lock()


def _get_overflow_semaphore() -> threading.BoundedSemaphore:
    """Lazily build the overflow counter."""
    global _overflow_semaphore

    if _overflow_semaphore is None:
        with _overflow_lock:
            if _overflow_semaphore is None:
                limit = max(1, int(os.getenv('LOCAL_BROWSER_OVERFLOW', '2')))
                _overflow_semaphore = threading.BoundedSemaphore(limit)
                logger.info(
                    f"Local Chromium overflow guard armed (limit: {limit} per worker)"
                )
    return _overflow_semaphore


def acquire_local_browser_slot_sync(timeout: Optional[float] = None) -> bool:
    """Blocking variant for callers running outside the event loop.

    Returns False when the worker is already at its ceiling — callers MUST then
    degrade (e.g. fall back to Requests) rather than launch anyway.
    """
    if timeout is None:
        timeout = float(os.getenv('LOCAL_BROWSER_WAIT_SECONDS', '30'))

    sem = _get_overflow_semaphore()
    if sem.acquire(True, timeout):
        return True

    logger.warning(
        f"Local Chromium overflow slot unavailable after {timeout}s "
        f"(ceiling: {os.getenv('LOCAL_BROWSER_OVERFLOW', '2')}/worker) - "
        f"caller must degrade instead of launching"
    )
    return False


async def acquire_local_browser_slot(timeout: Optional[float] = None) -> bool:
    """Reserve a slot for a local (non-pooled) Chromium launch.

    Waits up to ``timeout`` seconds for a slot, since a busy moment usually
    passes. Acquired off-loop so the wait never blocks the event loop.
    """
    if timeout is None:
        timeout = float(os.getenv('LOCAL_BROWSER_WAIT_SECONDS', '30'))
    return await asyncio.to_thread(acquire_local_browser_slot_sync, timeout)


def release_local_browser_slot():
    """Give back a slot taken by acquire_local_browser_slot(). Never raises."""
    if _overflow_semaphore is not None:
        try:
            _overflow_semaphore.release()
        except ValueError:
            # Released more than acquired - a bug, but never worth crashing a
            # teardown path over.
            logger.warning("Local browser slot released more times than acquired")


async def cleanup_browser_pool():
    """Cleanup the global browser pool on shutdown."""
    global _browser_pool

    if _browser_pool:
        await _browser_pool.close_all()
        _browser_pool = None
        logger.info("Global browser pool cleaned up")
