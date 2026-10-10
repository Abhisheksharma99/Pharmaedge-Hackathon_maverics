"""
Cross-source checks on an asset's journey events (spec: journey story, 2.2).

`verify` is pure: it compares what the model read (origin "ai") with what the regulators' records say (origin
"rule") and returns, per event id, a `verification` dict or None. `apply_checks` stores the result on the events,
so the app only reads it. A flag is a prompt to look, never a verdict: the rule events are authoritative only for
what they cover.
"""

import re
from datetime import date
from itertools import combinations
from typing import Any, Dict, List, Optional

APPROVAL_CLAIMS = {"approval", "label_expansion"}  # AI types checked against the regulator's records
# Regulator records that can confirm an approval claim. Labeling-only supplements (label_update) never approve a new
# indication, so they confirm nothing (a "PH-ILD approval" next to a labeling change is still unconfirmed).
REGULATOR_TYPES = {"approval", "label_expansion", "tentative_approval", "new_formulation", "generic_approval"}
DECISION_DATES = {"pdufa_date", "regulatory_decision_expected"}
MATCH_DAYS, CONFLICT_DAYS = 45, 120
REGIONS = {"us": "US", "usa": "US", "united states": "US", "eu": "EU", "europe": "EU", "european union": "EU",
           "ema": "EU"}
REGULATOR = {"US": "FDA", "EU": "EMA"}
# Device clearances (510(k), pumps, nebulizers) are not drug approvals: Drugs@FDA / EPARs never list them.
DEVICE = re.compile(r"510\(k\)|\bclear(?:s|ed|ance)\b|\bdevice\b|\bpump\b|nebuli[sz]er|delivery system|inhaler device", re.I)
# Words every decision-date title shares; what remains names the subject (product, formulation, indication).
GENERIC = {"fda", "ema", "pdufa", "date", "dates", "expected", "decision", "action", "review", "approval", "approve",
           "approves", "goal", "user", "fee", "target", "regulatory", "complete", "response", "letter", "application",
           "applications", "submission", "accepted", "accepts", "with", "from", "that", "this", "under", "until", "into",
           "issued", "issues", "issue", "second", "first", "set", "sets", "by", "for", "the", "and", "late", "early",
           "mid", "end", "year", "quarter", "january", "february", "march", "april", "may", "june", "july", "august",
           "september", "october", "november", "december", "nda", "snda", "bla", "sbla", "maa", "priority", "standard"}


def _region(value: Optional[str]) -> Optional[str]:
    return REGIONS.get((value or "").strip().lower())


def _day(event: Dict[str, Any]) -> Optional[date]:
    try:
        return date.fromisoformat((event.get("date") or "")[:10])
    except ValueError:
        return None


def _unconfirmed_approvals(events: List[Dict[str, Any]], out: Dict[str, Optional[Dict[str, Any]]]) -> None:
    regulator: Dict[str, List[tuple]] = {}
    for e in events:
        region = _region(e.get("region"))
        if e.get("origin") == "rule" and e.get("type") in REGULATOR_TYPES and region and _day(e):
            regulator.setdefault(region, []).append((_day(e), e))
    for e in events:
        region = _region(e.get("region"))
        if (e.get("origin") != "ai" or e.get("type") not in APPROVAL_CLAIMS or e.get("is_milestone")
                or not region or not _day(e) or region not in regulator  # no records in that region: unknown
                or DEVICE.search(e.get("title") or "")):
            continue
        day, nearest = min(regulator[region], key=lambda r: abs((r[0] - _day(e)).days))
        if abs((day - _day(e)).days) <= MATCH_DAYS:
            out[e["_id"]] = {"status": "confirmed", "note": f"Matches {nearest.get('title')} ({day.isoformat()})",
                             "against": [nearest["_id"]]}
        else:
            out[e["_id"]] = {"status": "unconfirmed",
                             "note": (f"No {REGULATOR[region]} approval record within {MATCH_DAYS} days of this date; "
                                      f"nearest is {nearest.get('title')} on {day.isoformat()}"),
                             "against": [nearest["_id"]]}


def _subject(event: Dict[str, Any]) -> set:
    """What a decision is about: the title's specific words (product, formulation, indication)."""
    words = re.findall(r"[a-z0-9][a-z0-9-]{3,}", (event.get("title") or "").lower())
    return {w for w in words if w not in GENERIC and not w.isdigit()}


def _conflicting_decision_dates(events: List[Dict[str, Any]], out: Dict[str, Optional[Dict[str, Any]]]) -> None:
    decisions = [e for e in events if e.get("type") in DECISION_DATES and _day(e)]
    others: Dict[str, List[Dict[str, Any]]] = {}
    for a, b in combinations(decisions, 2):
        # Two applications each get their own decision date: only the same (or an unknown) application conflicts.
        apps = {x.get("application_number") for x in (a, b) if x.get("application_number")}
        if len(apps) > 1:
            continue
        # Decisions about different things (a Tyvaso sNDA, a court injunction on another product) never conflict.
        sa, sb = _subject(a), _subject(b)
        if sa and sb and not sa & sb:
            continue
        if a["date"][:10] != b["date"][:10] and abs((_day(a) - _day(b)).days) <= CONFLICT_DAYS:
            others.setdefault(a["_id"], []).append(b)
            others.setdefault(b["_id"], []).append(a)
    for e in decisions:
        if e["_id"] in others:
            dates = sorted({o["date"][:10] for o in others[e["_id"]]})
            out[e["_id"]] = {"status": "conflict",  # wins over the approval checks
                             "note": f"Sources give different decision dates: {e['date'][:10]} vs {' vs '.join(dates)}",
                             "against": [o["_id"] for o in others[e["_id"]]]}


def verify(events: List[Dict[str, Any]]) -> Dict[str, Optional[Dict[str, Any]]]:
    """`verification` for every event id (None = nothing to say)."""
    out: Dict[str, Optional[Dict[str, Any]]] = {e["_id"]: None for e in events}
    _unconfirmed_approvals(events, out)
    _conflicting_decision_dates(events, out)
    return out


def apply_checks(db, asset_id: str) -> Dict[str, int]:
    """Store `verification` on the asset's events; clear it from events that no longer get one."""
    events = list(db.journey_events.find({"asset": asset_id}, {"type": 1, "origin": 1, "region": 1, "date": 1,
                                                              "title": 1, "is_milestone": 1, "verification": 1}))
    result = verify(events)
    counts = {"unconfirmed": 0, "conflict": 0, "confirmed": 0}
    for e in events:
        found = result[e["_id"]]
        if found:
            counts[found["status"]] += 1
            if found != e.get("verification"):
                db.journey_events.update_one({"_id": e["_id"]}, {"$set": {"verification": found}})
        elif "verification" in e:
            db.journey_events.update_one({"_id": e["_id"]}, {"$unset": {"verification": ""}})
    return counts


def fold_confirmed(db, asset_id: str) -> int:
    """An AI-read approval that a regulator record confirms (within MATCH_DAYS) and that names the same subject is a
    duplicate report of that approval, often months apart, beyond consolidate's 10-day window: fold it into the rule
    event (its sources kept as merged evidence) instead of showing the approval twice."""
    folded = 0
    for e in db.journey_events.find({"asset": asset_id, "origin": "ai", "verification.status": "confirmed"},
                                    {"title": 1, "sources": 1, "merged_sources": 1, "verification": 1}):
        target_id = (e["verification"].get("against") or [None])[0]
        target = target_id and db.journey_events.find_one({"_id": target_id, "origin": "rule"}, {"title": 1})
        if not target or not (_subject(e) & _subject(target)):
            continue  # a different product's approval in the same weeks: keep both
        db.journey_events.update_one({"_id": target_id}, {"$addToSet": {
            "merged_sources": {"$each": (e.get("sources") or []) + (e.get("merged_sources") or [])},
            "merged_from": e["_id"]}})
        db.journey_events.delete_one({"_id": e["_id"]})
        folded += 1
    return folded
