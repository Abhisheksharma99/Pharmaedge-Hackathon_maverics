"""
Key events (spec §4.1): the curated scope the journey and the Home portfolio timeline show by default.

An event is a candidate when it is High significance (or an upcoming High milestone, or a Medium regulatory one:
an expected decision or filing) and company-relevant. Clinical rule events count for company trials only, and
not for trial completions (the start and the readout tell the story) or extension / sub-studies.

Coverage of the same occurrence collapses: an AI event within RULE_WINDOW_DAYS of a rule event, or AI_WINDOW_DAYS
of another AI event, of the same type on the same branch keeps only the better one (rule first, then most
sources). Distinct rule events (two trials started the same day) never collapse. A sparse journey is topped up
to MIN_KEY with its best Medium events, so the default view is never empty.
"""

import re
from datetime import date
from typing import Any, Dict, Iterable, List, Optional

RULE_WINDOW_DAYS = 45
AI_WINDOW_DAYS = 90
MIN_KEY = 10
ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MINOR_STUDY = re.compile(r"\b(extension|substudy|sub-study|OLE|long-term follow)", re.I)


def _dated(e: Dict[str, Any]) -> bool:
    if not ISO_DAY.match(e.get("date") or ""):
        return False
    try:
        date.fromisoformat(e["date"])
    except ValueError:
        return False
    return True


def _company_relevant(e: Dict[str, Any]) -> bool:
    if e.get("category") != "clinical" or e.get("origin") != "rule" or e.get("type") in ("recall", "safety_communication"):
        return True
    return bool(e.get("sponsor_is_company")) and e.get("type") != "trial_completion" \
        and not MINOR_STUDY.search(e.get("title") or "")


def candidate(e: Dict[str, Any], today: str) -> bool:
    if not _dated(e):
        return False
    sig = e.get("significance")
    if e.get("is_milestone"):
        return (e["date"] >= today and (sig == "High" or (sig == "Medium" and e.get("category") == "regulatory"))
                and _company_relevant(e))
    return sig == "High" and _company_relevant(e)


def _days(a: str, b: str) -> int:
    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)


def _rank(e: Dict[str, Any]):
    return (e.get("origin") == "rule", len(e.get("sources") or []) + len(e.get("merged_sources") or []),
            len(e.get("summary") or ""))


def _twin(kept: List[Dict[str, Any]], e: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    for k in reversed(kept):
        if (k.get("type"), k.get("branch")) != (e.get("type"), e.get("branch")):
            continue
        if k.get("origin") == "rule" and e.get("origin") == "rule":
            continue
        window = AI_WINDOW_DAYS if k.get("origin") == "ai" and e.get("origin") == "ai" else RULE_WINDOW_DAYS
        if _days(k["date"], e["date"]) <= window:
            return k
    return None


def select(events: Iterable[Dict[str, Any]], today: str) -> List[str]:
    events = list(events)
    kept: List[Dict[str, Any]] = []
    for e in sorted((x for x in events if candidate(x, today)), key=lambda x: x["date"]):
        twin = _twin(kept, e)
        if twin is None:
            kept.append(e)
        elif _rank(e) > _rank(twin):
            kept[kept.index(twin)] = e
    if len(kept) < MIN_KEY:
        chosen = {e["_id"] for e in kept}
        extra = [x for x in events if x["_id"] not in chosen and _dated(x) and x.get("significance") == "Medium"
                 and not x.get("is_milestone") and _company_relevant(x)]
        kept += sorted(extra, key=_rank, reverse=True)[:MIN_KEY - len(kept)]
        kept.sort(key=lambda x: x["date"])
    return [e["_id"] for e in kept]


def mark(db, asset_id: str, today: Optional[str] = None) -> int:
    today = today or date.today().isoformat()
    events = list(db.journey_events.find({"asset": asset_id}, {"date": 1, "type": 1, "significance": 1, "origin": 1,
                                                               "branch": 1, "category": 1, "is_milestone": 1,
                                                               "sponsor_is_company": 1, "sources": 1, "title": 1,
                                                               "merged_sources": 1, "summary": 1}))
    ids = select(events, today)
    db.journey_events.update_many({"asset": asset_id, "_id": {"$in": ids}}, {"$set": {"key": True}})
    db.journey_events.update_many({"asset": asset_id, "_id": {"$nin": ids}}, {"$set": {"key": False}})
    return len(ids)
