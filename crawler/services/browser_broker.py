"""
Browser Broker Client
Connects to a remote browser broker that launches headless browsers on a fleet and
hands back a Playwright wsEndpoint to connect to (see app/playwright-example.py).

Why this exists: launching a full Chromium per crawler locally caps us at ~2-3
concurrent crawlers before the box runs out of RAM. Offloading the browsers to the
broker means each crawler only holds a cheap WebSocket connection locally, so we can
run 150-200 crawlers at once. The actual browser processes live on the broker fleet.

Protocol (HTTP/JSON):
    POST {BROKER_URL}/launch  {"browser","headless","proxy"?}  -> {"sessionId","wsEndpoint"}
    POST {BROKER_URL}/close   {"sessionId"}

The broker QUEUES at capacity rather than rejecting (it gates admission on host
MemAvailable, not on a session count). That changes two things on this side:
a /launch may legitimately block for minutes, and a timeout must NOT be retried.

Environment variables:
    BROKER_URL          Broker base URL, e.g. http://10.4.104.73:5001 (empty = disabled)
    BROKER_ENABLED      "false" to disable the broker even when BROKER_URL is set
    BROKER_MAX_SESSIONS Fleet-wide session backstop (must match the broker's own value)
    BROKER_QUEUE_MAX    Fleet-wide queue depth (must match the broker's own value)
    BROKER_CLIENT_WORKERS  How many uvicorn workers share the fleet
    BROKER_CLIENT_MAX_INFLIGHT  Override this process's in-flight bound outright
    BROKER_LAUNCH_TIMEOUT  Seconds to wait on /launch (default 150). MUST exceed
                        the broker's BROKER_QUEUE_TIMEOUT_MS.
    BROKER_CLOSE_TIMEOUT   Seconds to wait on /close (default 20)
"""

import os
import asyncio
import random
import threading
import time
from typing import Optional, Tuple

import requests

from utils.logging_config import get_logger

logger = get_logger("services.browser_broker")


def _truthy(value: str, default: bool = True) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


class BrokerAtCapacity(Exception):
    """The broker fleet (or this worker's share of it) has no free session."""


# ---------------------------------------------------------------------------
# Session accounting
# ---------------------------------------------------------------------------
# ONE counter for the whole process, shared by the async and sync paths. There
# used to be two independent semaphores both sized to BROKER_MAX_SESSIONS, so a
# single worker could hold 2x its budget; multiplied by the uvicorn worker count,
# the app asked the broker for ~8x what the fleet could serve. Every rejected
# launch then degraded to a local Chromium inside the app container, which is how
# the 8GiB cgroup filled up.
#
# BROKER_MAX_SESSIONS is the FLEET-WIDE cap (must match the broker's own value).
# BROKER_CLIENT_WORKERS is how many uvicorn workers share it, so each process
# claims only its slice.
_session_semaphore: Optional[threading.BoundedSemaphore] = None
_semaphore_lock = threading.Lock()


def _client_session_limit() -> int:
    """This process's share of the fleet's IN-FLIGHT budget (sessions + queue).

    The broker now queues at capacity instead of rejecting, so a request it can't
    serve immediately is legitimate demand, not overshoot. If this bound covered
    only live sessions, the app would refuse locally before the broker ever got a
    chance to queue — reintroducing the local-Chromium fallback the queue exists
    to remove. BROKER_CLIENT_MAX_INFLIGHT overrides the derived value outright.
    """
    override = int(os.getenv("BROKER_CLIENT_MAX_INFLIGHT", "0"))
    if override > 0:
        return override
    fleet_limit = int(os.getenv("BROKER_MAX_SESSIONS", "45"))
    queue_limit = int(os.getenv("BROKER_QUEUE_MAX", str(fleet_limit * 2)))
    workers = max(1, int(os.getenv("BROKER_CLIENT_WORKERS", "1")))
    return max(1, (fleet_limit + queue_limit) // workers)


def _get_session_semaphore() -> threading.BoundedSemaphore:
    """Lazily build the shared counter. Threading-based so the sync Playwright
    path (which runs off the event loop) draws on the same budget as async."""
    global _session_semaphore
    if _session_semaphore is None:
        with _semaphore_lock:
            if _session_semaphore is None:
                limit = _client_session_limit()
                _session_semaphore = threading.BoundedSemaphore(limit)
                logger.info(
                    f"Broker session budget for this worker: {limit} "
                    f"(fleet: {os.getenv('BROKER_MAX_SESSIONS', '200')}, "
                    f"workers: {os.getenv('BROKER_CLIENT_WORKERS', '1')})"
                )
    return _session_semaphore


class BrowserBroker:
    """Thin async client over the remote browser broker's /launch and /close."""

    def __init__(self):
        self.broker_url = os.getenv("BROKER_URL", "").strip().rstrip("/")
        self.enabled = _truthy(os.getenv("BROKER_ENABLED", ""), default=True)
        # MUST exceed the broker's BROKER_QUEUE_TIMEOUT_MS. A queued /launch
        # holds the connection open while it waits for a slot; if we give up
        # first, the broker still has a live waiter for a crawl that is gone and
        # will eventually hand it a browser nobody collects.
        self.launch_timeout = int(os.getenv("BROKER_LAUNCH_TIMEOUT", "150"))
        # /close runs on teardown paths and must stay snappy.
        self.close_timeout = int(os.getenv("BROKER_CLOSE_TIMEOUT", "20"))
        self.retries = max(1, int(os.getenv("BROKER_LAUNCH_RETRIES", "3")))
        # How long to wait for a free session slot before giving up. Bounded so a
        # queued caller can never park a worker thread indefinitely.
        self.acquire_timeout = float(os.getenv("BROKER_ACQUIRE_TIMEOUT", "30"))
        self._acquired = False  # whether this client holds a semaphore slot

    @property
    def is_configured(self) -> bool:
        return self.enabled and bool(self.broker_url)

    def _post(self, path: str, payload: dict, timeout: Optional[int] = None) -> dict:
        """POST to the broker. Retry policy is deliberately asymmetric.

        - 503 means the broker's queue is full or our wait expired — genuinely
          "try again later", so back off and retry. Treating it as a hard failure
          is what sent every over-cap crawl down the local-Chromium path.
        - A READ TIMEOUT is never retried. The broker queues /launch, so a timeout
          means our waiter may still be alive on the far side; retrying would
          stack duplicate waiters and hand out browsers for crawls that already
          gave up — manufacturing exactly the phantom sessions the queue exists
          to prevent.
        - Connection errors (nothing was ever accepted) are safe to retry.
        """
        timeout = self.launch_timeout if timeout is None else timeout
        last_error = None
        for attempt in range(self.retries):
            try:
                resp = requests.post(
                    f"{self.broker_url}{path}", json=payload, timeout=timeout
                )
                if resp.status_code == 503:
                    last_error = BrokerAtCapacity(
                        f"broker at capacity (attempt {attempt + 1}/{self.retries})"
                    )
                    if attempt < self.retries - 1:
                        # Exponential backoff with jitter so 40 crawlers rejected
                        # in the same instant don't retry in lockstep.
                        delay = (2 ** attempt) + random.uniform(0, 0.5)
                        logger.debug(
                            f"Broker at capacity; retrying in {delay:.1f}s "
                            f"({attempt + 1}/{self.retries})"
                        )
                        time.sleep(delay)
                        continue
                    raise last_error
                resp.raise_for_status()
                return resp.json()
            except BrokerAtCapacity:
                raise
            except requests.exceptions.ReadTimeout as e:
                # See the docstring: retrying a timed-out queued request stacks
                # duplicate waiters on the broker.
                logger.warning(
                    f"Broker {path} timed out after {timeout}s; NOT retrying "
                    f"(a queued waiter may still be live on the broker)"
                )
                raise BrokerAtCapacity(
                    f"broker timed out on {path} after {timeout}s"
                ) from e
            except Exception as e:
                # Transient network/5xx: one more try before giving up.
                last_error = e
                if attempt < self.retries - 1:
                    time.sleep((2 ** attempt) + random.uniform(0, 0.5))
                    continue
                raise
        raise last_error if last_error else RuntimeError("broker post failed")

    async def launch(
        self,
        proxy_url: Optional[str] = None,
        browser: str = "chromium",
        headless: bool = True,
    ) -> Tuple[str, str]:
        """
        Launch a remote browser and return (session_id, ws_endpoint).

        Acquires a slot from the concurrency semaphore first so we never ask the
        broker for more live sessions than BROKER_MAX_SESSIONS. The slot is released
        by close() (or if the launch itself fails).
        """
        sem = _get_session_semaphore()
        # Acquire off-loop: the counter is shared with sync callers, and the
        # bounded timeout keeps a queued crawl from pinning a thread forever.
        if not await asyncio.to_thread(sem.acquire, True, self.acquire_timeout):
            raise BrokerAtCapacity(
                f"no broker slot free for this worker after {self.acquire_timeout}s "
                f"(limit: {_client_session_limit()})"
            )
        self._acquired = True
        try:
            payload = {"browser": browser, "headless": headless}
            if proxy_url:
                payload["proxy"] = proxy_url
            data = await asyncio.to_thread(self._post, "/launch", payload)
            session_id = data["sessionId"]
            ws_endpoint = data["wsEndpoint"]
            logger.debug(f"Broker launched session {session_id}")
            return session_id, ws_endpoint
        except Exception:
            # Launch failed - give the slot back so a fallback/retry can proceed.
            self._release_slot(sem)
            raise

    async def close(self, session_id: Optional[str]):
        """Close a broker session. Best-effort: never raises."""
        sem = _get_session_semaphore()
        try:
            if session_id:
                await asyncio.to_thread(
                    self._post, "/close", {"sessionId": session_id}, self.close_timeout
                )
                logger.debug(f"Broker closed session {session_id}")
        except Exception as e:
            logger.warning(f"Broker close failed for session {session_id}: {e}")
        finally:
            self._release_slot(sem)

    def _release_slot(self, sem: threading.BoundedSemaphore):
        if self._acquired:
            self._acquired = False
            try:
                sem.release()
            except ValueError:
                pass

    # --- Synchronous variants (for callers running outside the event loop, e.g.
    # the content extractor's sync Playwright path which runs in a thread pool) ---

    def launch_sync(
        self,
        proxy_url: Optional[str] = None,
        browser: str = "chromium",
        headless: bool = True,
    ) -> Tuple[str, str]:
        """Synchronous variant of launch(). Returns (session_id, ws_endpoint).

        Draws on the SAME per-worker budget as the async path (they used to have
        independent counters, letting one worker hold twice its share).
        """
        sem = _get_session_semaphore()
        if not sem.acquire(True, self.acquire_timeout):
            raise BrokerAtCapacity(
                f"no broker slot free for this worker after {self.acquire_timeout}s "
                f"(limit: {_client_session_limit()})"
            )
        self._acquired = True
        try:
            payload = {"browser": browser, "headless": headless}
            if proxy_url:
                payload["proxy"] = proxy_url
            data = self._post("/launch", payload)
            session_id = data["sessionId"]
            ws_endpoint = data["wsEndpoint"]
            logger.debug(f"Broker launched session {session_id} (sync)")
            return session_id, ws_endpoint
        except Exception:
            self._release_slot(sem)
            raise

    def close_sync(self, session_id: Optional[str]):
        """Synchronous best-effort close. Never raises."""
        sem = _get_session_semaphore()
        try:
            if session_id:
                self._post("/close", {"sessionId": session_id}, self.close_timeout)
                logger.debug(f"Broker closed session {session_id} (sync)")
        except Exception as e:
            logger.warning(f"Broker close failed for session {session_id} (sync): {e}")
        finally:
            self._release_slot(sem)
