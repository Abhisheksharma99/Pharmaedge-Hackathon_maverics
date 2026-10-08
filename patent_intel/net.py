"""Polite, bounded HTTP for allow-listed hosts + raw-artifact disk cache."""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import os
import random
import tempfile
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

import httpx

UA = "PharmaEdgePatentIntel/0.1 (patent research; low-rate)"
ALLOWED_HOSTS = {"adisinsight.springer.com", "idp.springer.com", "patents.google.com", "pubchem.ncbi.nlm.nih.gov"}
MIN_INTERVAL = {"adisinsight.springer.com": 1.0, "patents.google.com": 1.0, "pubchem.ncbi.nlm.nih.gov": 0.25}  # s between requests (PubChem allows 5/s)
MAX_BYTES = 25 * 1024 * 1024  # decoded size cap -> guards decompression bombs too
RETRY_STATUS = {429, 502, 503, 504}
MAX_ATTEMPTS = 6  # PubChem answers 503 "ServerBusy" under load; backoff reaches ~30 s
BREAKER_LIMIT = 5  # consecutive failures before a host is skipped for the rest of the run

stats: Counter[str] = Counter()


class HostDown(RuntimeError):
    """Raised when a host's circuit breaker is open."""


class Cache:
    """gzip'd raw responses on disk, keyed by sha256(key). TTL is decided by the caller."""

    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self.root / (hashlib.sha256(key.encode()).hexdigest() + ".html.gz")

    def get(self, key: str, ttl_s: float) -> str | None:
        """Thread-safe (called via asyncio.to_thread); counting happens on the event loop side."""
        p = self._path(key)
        try:
            if time.time() - p.stat().st_mtime < ttl_s:
                return gzip.decompress(p.read_bytes()).decode()
        except FileNotFoundError:
            pass
        return None

    def put(self, key: str, text: str) -> None:
        p = self._path(key)
        fd, tmp = tempfile.mkstemp(dir=self.root, suffix=".tmp")  # unique per writer: concurrent puts can't collide
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(gzip.compress(text.encode()))
            os.replace(tmp, p)  # atomic: a crash never leaves a half-written artifact
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise


def _check_host(request: httpx.Request) -> None:
    # Runs for every hop including redirects -> no SSRF via open redirects.
    if request.url.scheme != "https" or request.url.host not in ALLOWED_HOSTS:
        raise httpx.UnsupportedProtocol(f"blocked host: {request.url}")


class Http:
    def __init__(self, cache: Cache) -> None:
        self.cache = cache
        self.client = httpx.AsyncClient(
            headers={"User-Agent": UA},
            follow_redirects=True,
            max_redirects=5,
            timeout=httpx.Timeout(30, connect=10),
            event_hooks={"request": [self._hook]},
        )
        self._locks: dict[str, asyncio.Lock] = {}
        self._last: dict[str, float] = {}
        self._fails: Counter[str] = Counter()

    async def _hook(self, request: httpx.Request) -> None:
        _check_host(request)

    async def aclose(self) -> None:
        await self.client.aclose()

    async def _pace(self, host: str) -> None:
        wait = self._last.get(host, 0) + MIN_INTERVAL.get(host, 1.0) - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        self._last[host] = time.monotonic()

    async def get_html(self, url: str, ttl_s: float, ctype: str = "html") -> tuple[int, str]:
        """GET a text resource whose content-type contains `ctype`. Returns (status, text); 200s are cached. Non-transient errors are returned, not retried."""
        if (hit := await asyncio.to_thread(self.cache.get, url, ttl_s)) is not None:  # gzip + disk off the loop
            stats["cache_hits"] += 1
            return 200, hit
        host = urlsplit(url).hostname or ""
        if self._fails[host] >= BREAKER_LIMIT:
            raise HostDown(host)
        async with self._locks.setdefault(host, asyncio.Lock()):  # one in-flight request per host
            for attempt in range(MAX_ATTEMPTS):
                await self._pace(host)
                stats["requests"] += 1
                try:
                    status, text, retry_after = await self._fetch(url, ctype)
                except (httpx.TimeoutException, httpx.TransportError) as e:
                    if isinstance(e, httpx.UnsupportedProtocol):
                        raise
                    status, text, retry_after = 0, "", None
                stats[f"status_{status}"] += 1
                if status not in RETRY_STATUS and status != 0:
                    break
                stats["retries"] += 1
                await asyncio.sleep(min(retry_after or 2**attempt + random.random(), 120))
        if status == 200:
            self._fails[host] = 0
            await asyncio.to_thread(self.cache.put, url, text)
        elif status in RETRY_STATUS or status == 0:
            self._fails[host] += 1
        return status, text

    async def _fetch(self, url: str, ctype: str) -> tuple[int, str, float | None]:
        async with self.client.stream("GET", url) as r:
            got = r.headers.get("content-type", "")
            if r.status_code == 200 and ctype not in got:
                raise ValueError(f"unexpected content-type {got!r} for {url}")
            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf += chunk
                if len(buf) > MAX_BYTES:
                    raise ValueError(f"response over {MAX_BYTES} bytes: {url}")
            stats["bytes"] += len(buf)
            ra = r.headers.get("retry-after", "")
            return r.status_code, buf.decode(r.encoding or "utf-8", "replace"), float(ra) if ra.isdigit() else None
