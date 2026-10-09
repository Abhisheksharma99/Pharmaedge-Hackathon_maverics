"""Polite, bounded HTTP for allow-listed hosts + raw-artifact disk cache."""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import ipaddress
import os
import random
import socket
import tempfile
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

import httpx

UA = "PharmaEdgePatentIntel/0.1 (patent research; low-rate)"
ALLOWED_HOSTS = {"adisinsight.springer.com", "idp.springer.com", "patents.google.com", "pubchem.ncbi.nlm.nih.gov",
                 "efts.sec.gov", "www.sec.gov", "api.fda.gov", "calendar.google.com", "clinicaltrials.gov"}
# seconds between requests per host, below each source's published limit
# (PubChem 5/s; SEC 10/s across efts+www; openFDA 240/min without key)
MIN_INTERVAL = {"adisinsight.springer.com": 1.0, "patents.google.com": 1.0, "pubchem.ncbi.nlm.nih.gov": 0.25,
                "efts.sec.gov": 0.25, "www.sec.gov": 0.25, "api.fda.gov": 0.3, "clinicaltrials.gov": 1.0}
MAX_BYTES = 25 * 1024 * 1024  # decoded size cap -> guards decompression bombs too
RETRY_STATUS = {429, 500, 502, 503, 504}  # all GETs here are idempotent; SEC search returns sporadic 500s
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


async def _check_public(request: httpx.Request) -> None:
    """SSRF guard for links found in third-party data (arbitrary sites): http(s) on default ports, no credentials,
    and the host must resolve ONLY to public addresses. Runs on every redirect hop."""
    u = request.url
    if u.scheme not in ("http", "https") or u.port not in (None, 80, 443) or u.userinfo or not u.host:
        raise httpx.UnsupportedProtocol(f"blocked url: {u}")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(u.host, u.port or (443 if u.scheme == "https" else 80),
                                                            type=socket.SOCK_STREAM)
    except OSError as e:
        raise httpx.ConnectError(f"cannot resolve {u.host}") from e
    if not infos or not all(ipaddress.ip_address(i[4][0]).is_global for i in infos):
        raise httpx.UnsupportedProtocol(f"blocked non-public address: {u.host}")


class Http:
    """`public_web=False`: fixed allow-list of known sources (default).
    `public_web=True`: any public website (links from data), guarded against SSRF by `_check_public`."""

    def __init__(self, cache: Cache, public_web: bool = False) -> None:
        self.cache = cache
        self.public_web = public_web
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
        if self.public_web:
            await _check_public(request)
        else:
            _check_host(request)

    async def aclose(self) -> None:
        await self.client.aclose()

    async def _pace(self, host: str) -> None:
        wait = self._last.get(host, 0) + MIN_INTERVAL.get(host, 1.0) - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        self._last[host] = time.monotonic()

    async def get_html(self, url: str, ttl_s: float, ctype: str | tuple[str, ...] = "html",
                       headers: dict[str, str] | None = None, attempts: int = MAX_ATTEMPTS) -> tuple[int, str]:
        """GET a text resource whose content-type contains `ctype` (or any of them); `headers` are per-request
        (e.g. the SEC's required declared User-Agent). Returns (status, text); 200s are cached. Non-transient errors are returned, not retried."""
        if (hit := await asyncio.to_thread(self.cache.get, url, ttl_s)) is not None:  # gzip + disk off the loop
            stats["cache_hits"] += 1
            return 200, hit
        host = urlsplit(url).hostname or ""
        if self._fails[host] >= BREAKER_LIMIT:
            raise HostDown(host)
        async with self._locks.setdefault(host, asyncio.Lock()):  # one in-flight request per host
            for attempt in range(attempts):
                await self._pace(host)
                stats["requests"] += 1
                try:
                    status, text, retry_after = await self._fetch(url, ctype, headers)
                except (httpx.TimeoutException, httpx.TransportError) as e:
                    if isinstance(e, httpx.UnsupportedProtocol):
                        raise
                    status, text, retry_after = 0, "", None
                stats[f"status_{status}"] += 1
                if status not in RETRY_STATUS and status != 0:
                    break
                if attempt == attempts - 1:
                    break  # no pointless sleep after the final attempt
                stats["retries"] += 1
                await asyncio.sleep(min(retry_after or 2**attempt + random.random(), 120))
        if status == 200:
            self._fails[host] = 0
            await asyncio.to_thread(self.cache.put, url, text)
        elif status in RETRY_STATUS or status == 0:
            self._fails[host] += 1
        return status, text

    async def _fetch(self, url: str, ctype: str | tuple[str, ...],
                     headers: dict[str, str] | None) -> tuple[int, str, float | None]:
        async with self.client.stream("GET", url, headers=headers) as r:
            got = r.headers.get("content-type", "")
            if r.status_code == 200 and not any(c in got for c in ((ctype,) if isinstance(ctype, str) else ctype)):
                raise ValueError(f"unexpected content-type {got!r} for {url}")
            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf += chunk
                if len(buf) > MAX_BYTES:
                    raise ValueError(f"response over {MAX_BYTES} bytes: {url}")
            stats["bytes"] += len(buf)
            ra = r.headers.get("retry-after", "")
            return r.status_code, buf.decode(r.encoding or "utf-8", "replace"), float(ra) if ra.isdigit() else None
