"""
In-process stand-in for universal-crawler's Postgres google_decode_cache.

Only the surface EnhancedURLResolver uses is kept. Google Alerts links are
already direct publisher URLs, so the resolver rarely gets here; this exists so
the resolver imports and runs unchanged. Run with GOOGLE_DECODE_MODE=inline -
there is no decode worker in this repo to drain an enqueued backlog.
"""

from typing import Any, Dict, List, Optional

STATUS_OK = "ok"
STATUS_FAILED = "failed"

_cache: Dict[str, Dict[str, Any]] = {}


def get(article_id: str) -> Optional[Dict[str, Any]]:
    return _cache.get(article_id)


def put(article_id: str, decoded_url: Optional[str], status: str,
        method: Optional[str] = None) -> None:
    _cache[article_id] = {"decoded_url": decoded_url, "status": status, "method": method}


def enqueue_many(article_ids: List[str]) -> int:
    return 0
