"""
FDA calendar events (PDUFA goal dates, advisory committee meetings) for an asset,
from the team's FDA Tracker calendar crawler (patent_intel/fdacal.py).

The calendar is read through its public iCal exports; an event is kept only when
one of the asset's names is found in the calendar text, the source link's URL or
the linked document (see fdacal). Events the crawler could not confirm
("unresolved") are left out: they are not known to be about this asset.

Records go to `fda_records` (record_type `fda_calendar_event`), keyed by the
calendar event's uid, so a rescheduled PDUFA date updates the same record.

Matching reads the source document of every calendar event (~1,500 since 2013)
whose text doesn't name the drug. Documents are cached for 30 days by the
crawler, but failures are not, and re-fetching them took ~15 min per run: dead
links, and above all hosts that hold bot connections open until they time out
(GlobeNewswire: ~30 s per link). The source-link client here remembers failed
links for FAILURE_TTL and such hosts for HOST_FAILURE_TTL.
"""

import asyncio
import os
from pathlib import Path
from typing import Any, Dict, List, Tuple
from urllib.parse import urlsplit

import httpx

from . import TEAM_ROOT  # noqa: F401  (puts the team packages on sys.path)
from patent_intel import fdacal
from patent_intel.config import settings
from patent_intel.ctgov import other_products
from patent_intel.net import MAX_ATTEMPTS, Cache, HostDown, Http

CACHE_DIR = Path(os.getenv("FDA_CALENDAR_CACHE_DIR", "cache/fda_calendar"))
FAILURE_TTL = 3 * 86400
HOST_FAILURE_TTL = 86400
EVENT_LABELS = {"pdufa": "PDUFA date", "adcom": "FDA advisory committee", "advisory_panel": "FDA advisory panel"}


class RemembersFailures(Http):
    """Http for the events' source links that also caches failures:
    - a link's failed fetch: the status, or the error (unexpected content type, oversize, blocked address),
      replayed until FAILURE_TTL. Rate limiting (429) is not remembered.
    - a host that timed out or dropped the connection (status 0 after the client's retries: what fdacal reports
      as bot protection) or tripped the client's circuit breaker: its links answer status 0 until
      HOST_FAILURE_TTL. Checked under a per-host lock, so links queued behind the failing one skip it too."""

    def __init__(self, cache: Cache, public_web: bool = False) -> None:
        super().__init__(cache, public_web=public_web)
        self._host_locks: Dict[str, asyncio.Lock] = {}

    async def get_html(self, url: str, ttl_s: float, ctype: Any = "html", headers: Any = None,
                       attempts: int = MAX_ATTEMPTS) -> Tuple[int, str]:
        if (hit := await asyncio.to_thread(self.cache.get, url, ttl_s)) is not None:
            return 200, hit  # cached document: no need to wait for the host
        host, key = urlsplit(url).hostname or "", f"failed:{url}"
        async with self._host_locks.setdefault(host, asyncio.Lock()):
            if await asyncio.to_thread(self.cache.get, f"failed-host:{host}", HOST_FAILURE_TTL) is not None:
                return 0, ""
            if (hit := await asyncio.to_thread(self.cache.get, key, FAILURE_TTL)) is not None:
                status, _, error = hit.partition(" ")
                if error:
                    raise ValueError(error)
                return int(status), ""
            try:
                status, text = await super().get_html(url, ttl_s, ctype=ctype, headers=headers, attempts=attempts)
            except HostDown:
                await asyncio.to_thread(self.cache.put, f"failed-host:{host}", "0")
                raise
            except (ValueError, httpx.UnsupportedProtocol) as e:
                await asyncio.to_thread(self.cache.put, key, f"0 {type(e).__name__}: {str(e)[:200]}")
                raise
            if status == 0:
                await asyncio.to_thread(self.cache.put, f"failed-host:{host}", "0")
            elif status not in (200, 429):
                await asyncio.to_thread(self.cache.put, key, str(status))
            return status, text


def to_record(event: Dict[str, Any], names: List[str]) -> Dict[str, Any]:
    terms = event["matched_terms"]
    # The asset's own spelling of each matched name ("Tyvaso DPI", not "tyvaso dpi").
    drugs = [n for n in names if n.lower() in terms] or terms
    event_type = event["event_type"] if event["event_type"] in EVENT_LABELS else event["calendar"]
    return {
        "record_key": f"fda_calendar:{event['provenance']['uid']}",
        "record_type": "fda_calendar_event",
        "source": "fdatracker",
        "date": event["date"],
        "event_type": event_type,
        "title": f"{EVENT_LABELS.get(event_type, 'FDA calendar')}: {', '.join(drugs)}"
                 + (f" ({event['company']})" if event["company"] else ""),
        "drugs": drugs,
        "ticker": event["ticker"],
        "company": event["company"],
        "sponsor_is_company": event["is_company"],
        "calendar_title": event["title"],
        "description": event["description"],
        "links": event["links"],
        "url": next(iter(event["links"]), fdacal.SOURCE_PAGE),
        "matched_terms": terms,
        "evidence": event["evidence"],
        "provenance": event["provenance"],
    }


async def fetch(asset: Dict[str, Any], names: List[str]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Matched calendar events for the asset, as records, plus the crawler's report."""
    cfg = settings()
    start, end = cfg.reg_window()
    company = (asset.get("company") or {}).get("name")
    http = Http(Cache(CACHE_DIR))
    web = RemembersFailures(http.cache, public_web=True)  # SSRF-guarded client for the events' source links
    try:
        events, report = await fdacal.collect(
            http, web, drug_id=asset["_id"], terms=fdacal.drug_terms(asset["name"], names[1:]),
            companies=[company] if company else [], sec_user_agent=cfg.sec_user_agent, start=start, end=end,
            # Other substances containing the name ("treprostinil palmitil") must not count as this asset.
            exclude=await other_products(http, asset["name"]))
    finally:
        await web.aclose()
        await http.aclose()
    return [to_record(e, names) for e in events if e["status"] == "matched"], report
