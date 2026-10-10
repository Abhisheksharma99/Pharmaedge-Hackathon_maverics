"""
Re-check of notes the team marked "Missed by AI" (DATA_CONTRACTS §D `crawl_feedback`), run at finalize.

For each open note: a journey event that matches it resolves it; else records the crawl now holds that support it
become a journey event (origin "feedback", via "finalize", the note's significance or Medium) and resolve it; else it stays open with `last_checked_at`.
A resolved note gets `resolved_event` (the event id) on its journey_notes doc; the API timeline then leaves the note out.
Web pages (`web_records`) behind a resolution add their host to the asset's `crawl_hints.domains` (DATA_CONTRACTS §E.6),
only hosts on the web-search allow-list families or the company's IR domain; the API's WebSearchService reads that field.
A match is title/text overlap within +/-18 months of the note's date (any date when the note has none).
"""

import re
from urllib.parse import urlparse
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from .store import COLLECTIONS_WITH_ASSETS

WINDOW_DAYS = 548  # 18 months
MIN_SHARED = 2
MIN_SHARE = 0.6  # of the note's words that the event / record must contain
RECORD_COLLECTIONS = (*COLLECTIONS_WITH_ASSETS, "web_records")
KEY_FIELDS = ("record_key", "url", "key")  # articles are keyed by url, web records by key
STOP = {"the", "and", "for", "with", "from", "that", "this", "was", "were", "has", "have", "had", "its", "are",
        "but", "not", "new", "per", "into", "after", "about", "over", "than", "also", "their", "been", "will"}
CATEGORY_BY_COLLECTION = {"fda_records": "regulatory", "ema_records": "regulatory", "trial_records": "clinical",
                          "publication_records": "clinical", "patent_records": "ip"}

# Mirror of ALLOWED_DOMAINS in apps/api/src/web-search/web-search.service.ts; the company IR host is added per asset.
WEB_ALLOW_LIST = ("fda.gov", "open.fda.gov", "ema.europa.eu", "clinicaltrials.gov", "pubmed.ncbi.nlm.nih.gov", "sec.gov")

Match = Tuple[float, int, Dict[str, Any]]  # (share of the note's words found, days from the note's date, doc)


def _words(text: Optional[str]) -> set:
    return {w for w in re.findall(r"[a-z0-9][a-z0-9-]*", (text or "").lower()) if len(w) >= 3 and w not in STOP}


def _day(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _needle(fb: Dict[str, Any]) -> set:
    words = _words(fb.get("title"))
    return words if len(words) >= MIN_SHARED else words | _words((fb.get("text") or "")[:200])


def _score(needle: set, doc: Dict[str, Any], when: Optional[date], doc_day: Optional[date]) -> Optional[Match]:
    """None unless the doc is in the date window and holds enough of the note's words."""
    if not needle:
        return None
    gap = abs((doc_day - when).days) if when and doc_day else 0
    if gap > WINDOW_DAYS:
        return None
    shared = len(needle & _words(f"{doc.get('title') or ''} {doc.get('text') or doc.get('summary') or ''}"))
    share = shared / len(needle)
    return (share, gap, doc) if shared >= min(MIN_SHARED, len(needle)) and share >= MIN_SHARE else None


def _best(matches: List[Match]) -> Optional[Dict[str, Any]]:
    return max(matches, key=lambda m: (m[0], -m[1]))[2] if matches else None


def _snippet(field: str) -> Dict[str, Any]:
    return {"$cond": [{"$eq": [{"$type": f"${field}"}, "string"]}, {"$substrCP": [f"${field}", 0, 600]}, ""]}


def _records(db, asset_id: str) -> List[Dict[str, Any]]:
    """The asset's records across the crawl collections as {collection, record_key, title, text, day}."""
    out = []
    for coll in RECORD_COLLECTIONS:
        rows = db[coll].aggregate([{"$match": {"assets": asset_id}}, {"$project": {
            "title": 1, "date": 1, "start_date": 1, "record_key": 1, "url": 1, "key": 1,
            "text": {"$concat": [_snippet("abstract"), " ", _snippet("content"), " ", _snippet("summary")]}}}])
        for r in rows:
            key = next((r[f] for f in KEY_FIELDS if r.get(f)), None)
            if key:
                out.append({"collection": coll, "record_key": str(key), "title": r.get("title") or "",
                            "text": r.get("text") or "", "day": _day(r.get("date") or r.get("start_date"))})
    return out


def _cites(event: Dict[str, Any], refs: List[Dict[str, Any]]) -> bool:
    have = {(s.get("collection"), s.get("record_key")) for s in (event.get("sources") or []) + (event.get("merged_sources") or [])}
    return any((r.get("collection"), r.get("record_key")) in have for r in refs)


def _find_event(events: List[Dict[str, Any]], fb: Dict[str, Any], when: Optional[date]) -> Optional[Dict[str, Any]]:
    needle, refs = _needle(fb), [r for r in fb.get("sources") or [] if r.get("record_key")]
    cited = [e for e in events if refs and _cites(e, refs)]
    if cited:  # the note cites a record that an event is already built on
        return cited[0]
    return _best([m for e in events if (m := _score(needle, e, when, _day(e.get("date"))))])


def _find_records(records: List[Dict[str, Any]], fb: Dict[str, Any], when: Optional[date]) -> List[Dict[str, Any]]:
    needle, refs = _needle(fb), {(r.get("collection"), r.get("record_key")) for r in fb.get("sources") or []}
    cited = [r for r in records if (r["collection"], r["record_key"]) in refs]
    if cited:
        return cited
    found = [m for r in records if (m := _score(needle, r, when, r["day"]))]
    return [m[2] for m in sorted(found, key=lambda m: (-m[0], m[1]))[:3]]


def _create_event(db, asset_id: str, fb: Dict[str, Any], support: List[Dict[str, Any]], now: datetime) -> Optional[str]:
    """A journey event from the note and the records behind it. None when nothing gives it a date."""
    when = fb.get("date") or next((r["day"].isoformat() for r in support if r["day"]), None)
    if not _day(when):
        return None
    note = db.journey_notes.find_one({"_id": fb.get("note_id")}, {"category": 1, "branch": 1, "significance": 1}) or {}
    event_id = f"feedback:{asset_id}:{fb['note_id']}"
    event = {
        "asset": asset_id, "origin": "feedback", "via": "finalize", "confidence": 0.7, "type": "note",
        "category": note.get("category") or CATEGORY_BY_COLLECTION.get(support[0]["collection"], "company"),
        "date": str(when)[:10], "title": fb.get("title") or support[0]["title"], "summary": fb.get("text") or "",
        "significance": note.get("significance") or "Medium", "is_milestone": False, "expected_date": None,
        "sources": [{"collection": r["collection"], "record_key": r["record_key"]} for r in support],
        "updated_at": now,
    }
    if note.get("branch"):
        event["branch"] = note["branch"]
    db.journey_events.update_one({"_id": event_id}, {"$set": event}, upsert=True)
    return event_id


def _host(url: Any) -> Optional[str]:
    try:
        host = (urlparse(str(url)).hostname or "").lower()
    except ValueError:
        return None
    return host.removeprefix("www.") or None


def _on_list(host: str, domains: List[str]) -> bool:
    return any(host == d or host.endswith("." + d) for d in domains)


def add_crawl_hints(db, asset_id: str, sources: List[Dict[str, Any]]) -> List[str]:
    """`$addToSet` the hosts of the web pages among `sources` into the asset's `crawl_hints.domains`.

    Only hosts on the allow-list families or the asset's company IR domain are kept; returns the ones added.
    """
    keys = [s.get("record_key") for s in sources if s.get("collection") == "web_records" and s.get("record_key")]
    if not keys:
        return []
    asset = db.assets.find_one({"_id": asset_id}, {"company": 1}) or {}
    ir_host = _host((asset.get("company") or {}).get("ir_url"))
    allowed = [*WEB_ALLOW_LIST, *([ir_host] if ir_host else [])]
    hosts = set()
    for field in KEY_FIELDS:  # a source's record_key is the page's key, record_key or url
        for doc in db.web_records.find({field: {"$in": keys}}, {"url": 1, "domain": 1}):
            host = _host(doc.get("url")) or _host(f"//{doc.get('domain')}")
            if host and _on_list(host, allowed):
                hosts.add(host)
    if hosts:
        db.assets.update_one({"_id": asset_id}, {"$addToSet": {"crawl_hints.domains": {"$each": sorted(hosts)}}})
    return sorted(hosts)


def recheck(db, asset_id: str, log: Callable[..., None]) -> Dict[str, int]:
    """Re-check this asset's open `crawl_feedback`; `log` is the job-feed logger (ctx.log)."""
    open_notes = list(db.crawl_feedback.find({"asset": asset_id, "status": "open"}))
    if not open_notes:
        return {}
    events = list(db.journey_events.find({"asset": asset_id}, {"date": 1, "title": 1, "summary": 1, "sources": 1,
                                                               "merged_sources": 1}))
    records: Optional[List[Dict[str, Any]]] = None  # loaded once, and only if some note has no event yet
    now = datetime.now(timezone.utc)
    resolved = created = 0
    for fb in open_notes:
        when = _day(fb.get("date"))
        event = _find_event(events, fb, when)
        event_id = event["_id"] if event else None
        web_sources = [*(event.get("sources") or []), *(event.get("merged_sources") or [])] if event else []
        if not event_id:
            records = _records(db, asset_id) if records is None else records
            support = _find_records(records, fb, when)
            event_id = _create_event(db, asset_id, fb, support, now) if support else None
            web_sources = [{"collection": r["collection"], "record_key": r["record_key"]} for r in support]
            if event_id:
                created += 1
                log("event", fb.get("title") or event_id, event_id=event_id)
        if event_id:
            resolved += 1
            add_crawl_hints(db, asset_id, web_sources)
            # The event carries the content now, so the API timeline skips the user's note.
            db.journey_notes.update_one({"_id": fb.get("note_id")}, {"$set": {"resolved_event": event_id}})
            db.crawl_feedback.update_one({"_id": fb["_id"], "status": "open"}, {"$set": {
                "status": "resolved", "resolved_at": now, "resolved_event": event_id, "last_checked_at": now}})
        else:
            db.crawl_feedback.update_one({"_id": fb["_id"]}, {"$set": {"last_checked_at": now}})
    n = len(open_notes)
    log("info", f"Re-checked {n} note{'s' * (n != 1)} marked ‘Missed by AI’ · "
                + (f"{resolved} now on the journey" if resolved else "none on the journey yet"))
    return {"feedback_checked": n, "feedback_resolved": resolved, "feedback_events_created": created}
