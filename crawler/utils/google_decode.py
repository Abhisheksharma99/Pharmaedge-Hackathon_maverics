
"""
Sequential Google News URL decoder.

This is the exact request path validated on 2026-08-09: 130 consecutive decodes
at ~78/hour, 100% success, zero blocks, across 74 publisher domains.

Two deliberate differences from the `googlenewsdecoder` package it replaces:

  1. **Proper browser headers on both legs.** googlenewsdecoder issues the
     signature GET through bare `requests` with no headers at all, so it goes out
     as `python-requests/2.x` while the rest of the app impersonates Chrome -
     the one place the app's fingerprint leaks.

  2. **Strictly one article at a time.** Batching several articles into a single
     batchexecute POST works and would cut request count roughly in half, but
     request count is NOT the constraint here - burstiness is. The same endpoint
     measured 0% success at 20-50 concurrency and 24% at 5, versus 100% when
     paced sequentially. A batch of 12 still fires 12 rapid signature GETs
     back-to-back, which is the exact shape that gets punished. Smooth beats
     efficient.

Google traffic is never proxied: the residential plan rejects google.com at the
CONNECT tunnel (403 "restricted target"), so these requests always egress from
the server's own IP. Callers should consult `storage.google_decode_cache` first
and only hand this module genuine misses.
"""

import json
import logging
import os
from typing import Optional
from urllib.parse import quote, urlparse

import requests
from selectolax.parser import HTMLParser

logger = logging.getLogger(__name__)

BATCHEXECUTE_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
RPC_ID = "Fbv4je"

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_HEADERS = {
    "User-Agent": _UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
}

_TIMEOUT = int(os.getenv("GOOGLE_DECODE_TIMEOUT", "30"))

_BLOCK_TOKENS = ("/sorry/", "unusual traffic", "captcha", "too many requests",
                 "detected unusual")


class GoogleDecodeBlocked(Exception):
    """Google returned a rate-limit / anti-bot response.

    Raised separately from ordinary failures because it says nothing about the
    article - it says our IP is currently throttled. The block is IP-wide and
    takes plain RSS discovery down with it, so callers should stop rather than
    continue; retrying only deepens it.
    """


def extract_article_id(url: str) -> Optional[str]:
    """
    Pull the base64 article id out of a Google News URL.

    Handles `/rss/articles/<id>`, `/articles/<id>` and `/read/<id>`. Returns None
    for anything that is not a Google News article link (e.g. an already-direct
    publisher URL), which callers treat as "nothing to decode".
    """
    if not url:
        return None
    try:
        parsed = urlparse(url)
        if parsed.hostname != "news.google.com":
            return None
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2 and parts[-2] in ("articles", "read"):
            return parts[-1]
        return None
    except Exception:
        return None


def _looks_blocked(status_code: int, body: str) -> bool:
    if status_code in (429, 503):
        return True
    low = (body or "")[:2000].lower()
    return any(tok in low for tok in _BLOCK_TOKENS)


def _fetch_params(article_id: str):
    """
    Leg 1: scrape the per-article signature and timestamp.

    These are per-article and cannot be shared, computed offline, or harvested in
    bulk (the Google News HTML search page carries zero `data-n-a-sg` nodes), so
    this GET is unavoidably 1:1 with articles.

    Returns (signature, timestamp) or None. Raises GoogleDecodeBlocked on an
    anti-bot response.
    """
    for path in ("articles", "rss/articles"):
        try:
            resp = requests.get(
                f"https://news.google.com/{path}/{article_id}",
                headers=_HEADERS, timeout=_TIMEOUT,
            )
        except requests.exceptions.RequestException as e:
            logger.debug(f"[Decode] params request failed for {article_id[:24]}: {e}")
            continue

        if _looks_blocked(resp.status_code, resp.text):
            raise GoogleDecodeBlocked(
                f"HTTP {resp.status_code} fetching decode params — IP rate-limited"
            )
        if resp.status_code != 200:
            continue

        element = HTMLParser(resp.text).css_first("c-wiz > div[jscontroller]")
        if element is None:
            continue

        signature = element.attributes.get("data-n-a-sg")
        timestamp = element.attributes.get("data-n-a-ts")
        if signature and timestamp:
            return signature, timestamp

    return None


def _decode_with_params(article_id: str, signature: str, timestamp: str) -> Optional[str]:
    """Leg 2: exchange the signature for the publisher URL."""
    inner = (
        '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,'
        'null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],'
        f'"{article_id}",{timestamp},"{signature}"]'
    )
    body = f"f.req={quote(json.dumps([[[RPC_ID, inner, None, '1']]]))}"

    try:
        resp = requests.post(
            BATCHEXECUTE_URL,
            headers={
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": _UA,
                "Accept-Language": "en-US,en;q=0.9",
            },
            data=body, timeout=_TIMEOUT,
        )
    except requests.exceptions.RequestException as e:
        logger.warning(f"[Decode] batchexecute request failed: {e}")
        return None

    if _looks_blocked(resp.status_code, resp.text):
        raise GoogleDecodeBlocked(
            f"HTTP {resp.status_code} from batchexecute — IP rate-limited"
        )
    if resp.status_code != 200:
        logger.warning(f"[Decode] batchexecute returned HTTP {resp.status_code}")
        return None

    # Length-prefixed, newline-delimited JSON stream. Each result is
    # ["wrb.fr", "<rpc id>", "<json string>", ...] where element [1] of the
    # inner json is the decoded URL.
    for line in resp.text.splitlines():
        if not line.strip().startswith("[["):
            continue
        try:
            blocks = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue

        for block in blocks:
            if (not isinstance(block, list) or len(block) < 3
                    or block[0] != "wrb.fr" or block[1] != RPC_ID or not block[2]):
                continue
            try:
                url = json.loads(block[2])[1]
            except (json.JSONDecodeError, ValueError, TypeError, IndexError):
                continue
            if url and "news.google.com" not in url:
                return url

    return None


def decode_article(article_id: str) -> Optional[str]:
    """
    Decode one article id to its publisher URL.

    Costs exactly 2 Google requests. Measured sustainable at ~78/hour when called
    sequentially with spacing between calls - pacing is the caller's job.

    Returns:
        The publisher URL, or None if the article could not be decoded (dead
        link, withdrawn article, unparseable response).

    Raises:
        GoogleDecodeBlocked: the IP is rate-limited. Stop; do not retry.
    """
    if not article_id:
        return None

    params = _fetch_params(article_id)
    if not params:
        return None

    return _decode_with_params(article_id, params[0], params[1])


def decode_url(google_news_url: str) -> Optional[str]:
    """Convenience wrapper taking a full Google News URL."""
    article_id = extract_article_id(google_news_url)
    return decode_article(article_id) if article_id else None
