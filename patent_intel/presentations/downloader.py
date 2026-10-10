"""Safe binary download for untrusted documents: SSRF guard on every redirect hop (reuses net._check_public) AND on the
address actually connected to (net.public_transport: no DNS-rebinding window), size cap while streaming, overall
deadline, SHA-256 while streaming, magic-byte validation (never trust URL or Content-Type), conditional GET for known
files, pacing shared with every other client in the process (net.pace), own small connection pool."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import os
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from ..net import UA, _check_public, pace, public_transport

MAGIC = {"pdf": (b"%PDF-",), "image": (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a")}
TOTAL_TIMEOUT_S = 300  # whole download; the 60 s read timeout alone lets a slow-drip server hold the slot for hours


class DownloadError(Exception):
    """code: http_<status> | too_large | not_<kind> | network | timeout"""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def _is_sec(host: str) -> bool:
    return host == "sec.gov" or host.endswith(".sec.gov")


class Downloader:
    def __init__(self, tmp_dir: Path, max_bytes: int, sec_user_agent: str | None) -> None:
        self.tmp_dir, self.max_bytes, self.sec_ua = tmp_dir, max_bytes, sec_user_agent
        tmp_dir.mkdir(parents=True, exist_ok=True)
        self.client = httpx.AsyncClient(
            follow_redirects=True, max_redirects=5, timeout=httpx.Timeout(60, connect=10),
            transport=public_transport(httpx.Limits(max_connections=4, max_keepalive_connections=2)),
            event_hooks={"request": [_check_public]})
        self._locks: dict[str, asyncio.Lock] = {}

    async def aclose(self) -> None:
        await self.client.aclose()

    async def fetch(self, url: str, kind: str = "pdf", validators: dict[str, str] | None = None) -> dict[str, Any] | None:
        """Download to a temp file; returns {tmp_path, sha256, size, content_type, validators}, or None when
        `validators` (etag/last_modified from an earlier download) show the file is unchanged (HTTP 304).
        The caller moves the temp file into the store."""
        host = urlsplit(url).hostname or ""
        headers = {"User-Agent": self.sec_ua if _is_sec(host) and self.sec_ua else UA}
        if validators:
            headers |= {k: v for k, v in (("If-None-Match", validators.get("etag")),
                                          ("If-Modified-Since", validators.get("last_modified"))) if v}
        async with self._locks.setdefault(host, asyncio.Lock()):  # one in-flight download per host, paced
            await pace(host)
            fd, tmp = tempfile.mkstemp(dir=self.tmp_dir, suffix=".part")
            h, size, head = hashlib.sha256(), 0, b""
            try:
                with os.fdopen(fd, "wb") as f:
                    async with asyncio.timeout(TOTAL_TIMEOUT_S), self.client.stream("GET", url, headers=headers) as r:
                        if r.status_code == 304 and validators:
                            raise _NotModified
                        if r.status_code != 200:
                            raise DownloadError(f"http_{r.status_code}", url)
                        if int(r.headers.get("content-length") or 0) > self.max_bytes:
                            raise DownloadError("too_large", r.headers["content-length"])
                        async for chunk in r.aiter_bytes():
                            size += len(chunk)
                            if size > self.max_bytes:
                                raise DownloadError("too_large", f"> {self.max_bytes}")
                            if len(head) < 1024:
                                head += chunk[: 1024 - len(head)]
                            h.update(chunk)
                            f.write(chunk)
                        ctype = r.headers.get("content-type", "")
                        got = {"etag": r.headers.get("etag"), "last_modified": r.headers.get("last-modified")}
                if not any(head.lstrip()[: len(m)] == m for m in MAGIC[kind]):
                    raise DownloadError(f"not_{kind}", f"magic {head[:8]!r}")
            except BaseException as e:
                with contextlib.suppress(OSError):
                    os.unlink(tmp)  # every failure path, also cancellation; one small syscall
                if isinstance(e, _NotModified):
                    return None
                if isinstance(e, TimeoutError):
                    raise DownloadError("timeout", f"> {TOTAL_TIMEOUT_S}s") from None
                if isinstance(e, httpx.HTTPError):
                    raise DownloadError("network", type(e).__name__) from e
                raise
        return {"tmp_path": Path(tmp), "sha256": h.hexdigest(), "size": size, "content_type": ctype,
                "validators": {k: v for k, v in got.items() if v} or None}


class _NotModified(Exception):
    pass
