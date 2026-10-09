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
crawler, but failures (dead links, bot walls, wrong content type) are not, and
re-fetching them with retries took ~16 min per run; the source-link client here
also remembers failures, for FAILURE_TTL.
"""

import asyncio
import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

import httpx

from . import TEAM_ROOT  # noqa: F401  (puts the team packages on sys.path)
from patent_intel import fdacal
from patent_intel.config import settings
from patent_intel.ctgov import other_products
from patent_intel.net import MAX_ATTEMPTS, Cache, Http

CACHE_DIR = Path(os.getenv("FDA_CALENDAR_CACHE_DIR", "cache/fda_calendar"))
FAILURE_TTL = 3 * 86400
EVENT_LABELS = {"pdufa": "PDUFA date", "adcom": "FDA advisory committee", "advisory_panel": "FDA advisory panel"}


class RemembersFailures(Http):
    """Http for the events' source links that also caches failed fetches: the status, or the error (unexpected
    content type, oversize, blocked address), replayed until FAILURE_TTL. Rate limiting (429) is not remembered."""

    async def get_html(self, url: str, ttl_s: float, ctype: Any = "html", headers: Any = None,
                       attempts: int = MAX_ATTEMPTS) -> Tuple[int, str]:
        key = f"failed:{url}"
        if (hit := await asyncio.to_thread(self.cache.get, key, FAILURE_TTL)) is not None:
            status, _, error = hit.partition(" ")
            if error:
                raise ValueError(error)
            return int(status), ""
        try:
            status, text = await super().get_html(url, ttl_s, ctype=ctype, headers=headers, attempts=attempts)
        except (ValueError, httpx.UnsupportedProtocol) as e:
            await asyncio.to_thread(self.cache.put, key, f"0 {type(e).__name__}: {str(e)[:200]}")
            raise
        if status not in (200, 429):
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
