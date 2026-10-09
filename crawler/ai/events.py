"""
AI enrichment and consolidation (spec §5.3).

extract_events: ingested articles / press releases / publications / conference abstracts /
EMA CHMP highlights -> dated journey events and forward-looking milestones
(origin "ai"), each citing its source.
consolidate: merges events about the same real-world occurrence (e.g. an approval
covered by a press release and five news stories) into one event with all
sources. Rule events (from FDA/EMA/trials) are authoritative and always kept.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Any, Dict, List

from pymongo import ReplaceOne

from storage.mongo_storage import get_db

from . import llm
from .triage import TRIAGED_SOURCES, asset_context, ingest_query

EVENT_TYPES = ["approval", "label_expansion", "regulatory_submission", "regulatory_opinion",
               "regulatory_decision_expected", "advisory_committee", "trial_start", "trial_readout",
               "trial_enrollment_complete", "publication", "safety", "launch", "deal", "litigation", "financials",
               "guidance"]
CATEGORY_OF = {"approval": "regulatory", "label_expansion": "regulatory", "regulatory_submission": "regulatory",
               "regulatory_opinion": "regulatory", "regulatory_decision_expected": "regulatory",
               "advisory_committee": "regulatory", "trial_start": "clinical", "trial_readout": "clinical",
               "trial_enrollment_complete": "clinical", "publication": "clinical", "safety": "safety",
               "launch": "company", "deal": "company", "litigation": "company", "financials": "company",
               "guidance": "company"}

EXTRACT_SYSTEM = """Extract journey events for ONE drug asset from a document (press release, news story,
publication abstract or EMA CHMP meeting highlights). Return 0-3 events that are specifically about this asset;
return none if the document has no concrete event. Rules:
- date: when the event happened (YYYY-MM-DD), NOT the publication date unless they are the same. Use the
  publication date only when the event happened that day (e.g. "today announced FDA approval").
- Forward-looking statements (expected readouts, PDUFA dates, planned launches/filings) are milestones:
  is_milestone=true, expected_date at the end of the stated period (H1 2027 -> 2027-06-30, Q4 2026 ->
  2026-12-31, 2027 -> 2027-12-31), date = expected_date.
- Regulators: a CHMP opinion (positive, negative, re-examination) is regulatory_opinion, dated at the meeting; it
  is not an approval - the European Commission decides later. An FDA advisory committee meeting or vote is
  advisory_committee. Use approval only when the text says the authorisation was granted.
- significance: High = approvals, pivotal (phase 3) readouts, major safety actions, major deals or litigation
  outcomes; Medium = submissions/acceptances, phase 2 data, launches, enrollment completion, guidance;
  Low = everything else.
- title: one line, factual, under 100 characters. summary: at most two sentences with the key numbers.
- Never invent facts not in the text. Use "" for unknown strings."""

EVENT_SCHEMA = {
    "type": "object",
    "properties": {"events": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": EVENT_TYPES},
            "date": {"type": "string"}, "title": {"type": "string"}, "summary": {"type": "string"},
            "significance": {"type": "string", "enum": ["High", "Medium", "Low"]},
            "is_milestone": {"type": "boolean"}, "expected_date": {"type": "string"},
            "phase": {"type": "string"}, "indication": {"type": "string"}, "region": {"type": "string"},
        },
        "required": ["type", "date", "title", "summary", "significance", "is_milestone", "expected_date",
                     "phase", "indication", "region"],
        "additionalProperties": False}}},
    "required": ["events"], "additionalProperties": False,
}


def _valid_date(value: str) -> str:
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except (TypeError, ValueError):
        return ""


def _extract_one(asset: Dict[str, Any], coll: str, key_field: str, text_field: str, record: Dict[str, Any]) -> List[Dict[str, Any]]:
    text = (record.get(text_field) or "")[:8000]
    doc = (f"Asset: {json.dumps(asset_context(asset))}\nSource: {coll}\nPublished: {record.get('date', '')}\n"
           f"Title: {record.get('title', '')}\n\n{text}")
    result = llm.structured(llm.REASONING_MODEL, EXTRACT_SYSTEM, doc, "events", EVENT_SCHEMA)
    events = []
    for n, e in enumerate(result["events"]):
        when = _valid_date(e["expected_date"] if e["is_milestone"] else e["date"]) or _valid_date(record.get("date", ""))
        if not when:
            continue
        events.append({
            "_id": f"ai:{asset['_id']}:{record[key_field]}:{n}", "asset": asset["_id"], "origin": "ai",
            "confidence": 0.8, "type": e["type"], "category": CATEGORY_OF[e["type"]], "date": when,
            "title": e["title"], "summary": e["summary"], "significance": e["significance"],
            "is_milestone": e["is_milestone"] and when >= date.today().isoformat(),
            "expected_date": when if e["is_milestone"] else None, "phase": e["phase"] or None,
            "indication": e["indication"] or None, "region": e["region"] or None,
            "sources": [{"collection": coll, "record_key": record[key_field]}],
        })
    return events


def extract_events(asset: Dict[str, Any], workers: int = 6) -> Dict[str, int]:
    """Run extraction on ingested records not yet processed for this asset. Each record's events are saved as
    soon as they arrive; a record whose call fails (network, API) is left for the next run, and the step only
    fails when every call did."""
    db, asset_id = get_db(), asset["_id"]
    counts = {"documents": 0, "events": 0, "failed": 0}
    error: Exception = None

    def attempt(coll, key_field, text_field, record):
        try:
            return record, _extract_one(asset, coll, key_field, text_field, record), None
        except Exception as e:  # noqa: BLE001 - reported in counts; the record is retried next run
            return record, None, e

    for coll, (key_field, extra, text_field) in TRIAGED_SOURCES.items():
        records = list(db[coll].find({**ingest_query(asset_id), **extra, f"events_done.{asset_id}": {"$exists": False}},
                                     {key_field: 1, "title": 1, "date": 1, text_field: 1}))
        if not records:
            continue
        with ThreadPoolExecutor(workers) as pool:
            for record, events, failure in pool.map(lambda r: attempt(coll, key_field, text_field, r), records):
                if failure:
                    counts["failed"] += 1
                    error = failure
                    continue
                now = datetime.now(timezone.utc)
                if events:
                    db.journey_events.bulk_write([ReplaceOne({"_id": e["_id"]}, {**e, "updated_at": now}, upsert=True)
                                                  for e in events], ordered=False)
                db[coll].update_one({key_field: record[key_field]}, {"$set": {f"events_done.{asset_id}": now}})
                counts["documents"] += 1
                counts["events"] += len(events)
    if error and not counts["documents"]:
        raise error
    return counts


MERGE_SYSTEM = """You get journey events for one drug asset, close in date and in the same category. Group the
ones that describe the SAME real-world occurrence (e.g. one FDA approval reported by a press release and by news).
Different occurrences (e.g. two separate trials, an approval and a later launch) stay in separate groups.
Every index must appear in exactly one group."""

MERGE_SCHEMA = {"type": "object", "properties": {"groups": {"type": "array", "items": {"type": "array", "items": {"type": "integer"}}}},
                "required": ["groups"], "additionalProperties": False}
WINDOW_DAYS = 10
# A busy window (a court ruling covered by dozens of outlets) is compared in overlapping batches.
MERGE_BATCH, MERGE_OVERLAP = 25, 5


def _days(a: str, b: str) -> int:
    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)


def _merge_batch(db, batch: List[Dict[str, Any]], gone: set) -> int:
    """Ask the model which events in the batch are the same occurrence; fold each group into one survivor."""
    listing = [{"index": i, "type": e["type"], "date": e["date"], "title": e["title"], "summary": (e.get("summary") or "")[:200]}
               for i, e in enumerate(batch)]
    result = llm.structured(llm.TRIAGE_MODEL, MERGE_SYSTEM, json.dumps(listing), "groups", MERGE_SCHEMA)
    merged = 0
    for idx in result["groups"]:
        members = [batch[i] for i in idx if 0 <= i < len(batch)]
        if len(members) < 2:
            continue
        rules = [m for m in members if m["origin"] == "rule"]
        survivor = rules[0] if rules else max(members, key=lambda m: len(m.get("summary") or ""))
        absorbed = [m for m in members if m is not survivor and m["origin"] == "ai"]
        if not absorbed:
            continue
        extra = [s for m in absorbed for s in m["sources"] + m.get("merged_sources", [])]
        # Separate field: a rule event's own `sources` are rewritten on every refresh.
        db.journey_events.update_one({"_id": survivor["_id"]}, {
            "$addToSet": {"merged_sources": {"$each": extra},
                          "merged_from": {"$each": [m["_id"] for m in absorbed]}}})
        db.journey_events.delete_many({"_id": {"$in": [m["_id"] for m in absorbed]}})
        # Keep the in-memory survivor current: a later batch may fold it into another event.
        survivor["merged_sources"] = survivor.get("merged_sources", []) + extra
        gone.update(m["_id"] for m in absorbed)
        merged += len(absorbed)
    return merged


def consolidate(asset_id: str) -> Dict[str, int]:
    """Merge duplicate coverage into one event per occurrence (rule events win as the survivor)."""
    db = get_db()
    events = list(db.journey_events.find({"asset": asset_id, "date": {"$ne": ""}}).sort("date", 1))
    merged = failed = 0
    error: Exception = None
    by_category: Dict[str, List[Dict[str, Any]]] = {}
    for e in events:
        by_category.setdefault(e["category"], []).append(e)
    for group in by_category.values():
        clusters, current = [], []
        for e in group:
            if current and _days(current[0]["date"], e["date"]) > WINDOW_DAYS:
                clusters.append(current)
                current = []
            current.append(e)
        clusters.append(current)
        for cluster in clusters:
            if len(cluster) < 2 or not any(e["origin"] == "ai" for e in cluster):
                continue
            gone: set = set()  # absorbed in an earlier batch of this window
            for start in range(0, len(cluster), MERGE_BATCH - MERGE_OVERLAP):
                batch = [e for e in cluster[start:start + MERGE_BATCH] if e["_id"] not in gone]
                if len(batch) >= 2 and any(e["origin"] == "ai" for e in batch):
                    try:
                        merged += _merge_batch(db, batch, gone)
                    except Exception as e:  # noqa: BLE001 - this batch stays unmerged until the next run
                        failed += 1
                        error = e
                if start + MERGE_BATCH >= len(cluster):
                    break
    if error and not merged:
        raise error
    return {"merged": merged, "merge_failed": failed}
