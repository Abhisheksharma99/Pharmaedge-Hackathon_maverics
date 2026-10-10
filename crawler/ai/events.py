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
from typing import Any, Dict, List, Optional

from pymongo import ReplaceOne

from journey.store import change_doc, write_changes
from storage.mongo_storage import get_db

from . import llm
from .triage import TRIAGED_SOURCES, asset_context, ingest_query
from .untrusted import fence, harden

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
publication abstract, EMA CHMP meeting highlights, or an investor-presentation slide with the statements and figures
the company presented). Return 0-3 events that are specifically about this asset;
return none if the document has no concrete event. Rules:
- date: when the event happened (YYYY-MM-DD), NOT the publication date unless they are the same. Use the
  publication date only when the event happened that day (e.g. "today announced FDA approval").
- date_basis: "stated" when the text states the event's date (then date_quote = the few words stating it, e.g.
  "approved on March 31, 2021"); "publication" when you used the publication date (date_quote = "").
- Background is not an event: a paper or abstract that mentions an earlier approval, filing or deal is reporting
  history - extract only what the document itself reports (its results, its publication).
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
- indications: the indication(s) the event concerns as short standard names or abbreviations (e.g. PAH,
  PH-ILD, IPF); [] if the text names none. product: the brand or product name it concerns, "" if none.
- impact: one factual sentence (max 25 words) on why the event matters for this asset's journey, only if the
  text supports it; "" otherwise.
- Never invent facts not in the text. Use "" for unknown strings."""
EXTRACT_SYSTEM = harden(EXTRACT_SYSTEM)

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
            "indications": {"type": "array", "items": {"type": "string"}},
            "product": {"type": "string"}, "impact": {"type": "string"},
            "date_basis": {"type": "string", "enum": ["stated", "publication"]}, "date_quote": {"type": "string"},
        },
        "required": ["type", "date", "title", "summary", "significance", "is_milestone", "expected_date",
                     "phase", "indication", "region", "indications", "product", "impact", "date_basis", "date_quote"],
        "additionalProperties": False}}},
    "required": ["events"], "additionalProperties": False,
}


# Literature (papers, abstracts) restates history; only what the document itself reports is dated by it.
LITERATURE = {"publication_records", "conference_records"}
LITERATURE_OWN = {"publication", "trial_readout"}

EARLIEST, HORIZON_YEARS = "1980-01-01", 15  # outside this window a model-read date is a misread, not an event
TITLE_MAX = 120


def _valid_date(value: str) -> str:
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except (TypeError, ValueError):
        return ""


def clean_impact(text: str) -> Optional[str]:
    """'Why it matters': one short factual sentence, or nothing (over-long answers are rejected, not cut)."""
    text = " ".join((text or "").split())
    return text if text and len(text.split()) <= 30 else None


def _plausible(when: str) -> bool:
    latest = date.today().replace(year=date.today().year + HORIZON_YEARS).isoformat()
    return EARLIEST <= when <= latest


def _extract_one(asset: Dict[str, Any], coll: str, key_field: str, text_field: str, record: Dict[str, Any]) -> List[Dict[str, Any]]:
    text = (record.get(text_field) or "")[:8000]
    doc = (f"Asset: {json.dumps(asset_context(asset))}\nSource: {coll}\nPublished: {record.get('date', '')}\n"
           + fence(f"Title: {record.get('title', '')}\n\n{text}"))
    result = llm.structured(llm.REASONING_MODEL, EXTRACT_SYSTEM, doc, "events", EVENT_SCHEMA,
                            reasoning_effort=llm.EXTRACT_EFFORT)
    events = []
    published = _valid_date(record.get("date", ""))
    for n, e in enumerate(result["events"][:3]):  # the prompt allows 0-3; never trust a count
        if not (e.get("title") or "").strip():
            continue
        read = _valid_date(e["expected_date"] if e["is_milestone"] else e["date"])
        if read and not _plausible(read):
            continue  # a misread date: re-dating it to the document would invent an event
        when = read or published  # no usable date: the document's own
        if not when:
            continue
        basis, quote = e.get("date_basis") or "", (e.get("date_quote") or "").strip()
        if not e["is_milestone"]:
            # A stated date must be in the words quoted for it: otherwise it is a misread.
            if basis == "stated" and quote and when[:4] not in quote:
                continue
            # Dated by the paper itself, an approval / filing / deal in a paper is background, not news (a 2026 review
            # mentioning the 2021 PH-ILD approval must not become a 2026 approval).
            if (coll in LITERATURE and e["type"] not in LITERATURE_OWN
                    and (basis == "publication" or not read or when == published)):
                continue
        # Dated after the document that reports it: a forward-looking statement, whatever the label says.
        milestone = e["is_milestone"] or bool(published and when > published)
        event = {
            "_id": f"ai:{asset['_id']}:{record[key_field]}:{n}", "asset": asset["_id"], "origin": "ai",
            "confidence": 0.8, "type": e["type"], "category": CATEGORY_OF[e["type"]], "date": when,
            "title": e["title"].strip()[:TITLE_MAX], "summary": e["summary"], "significance": e["significance"],
            "is_milestone": milestone and when >= date.today().isoformat(),
            "expected_date": when if milestone else None, "phase": e["phase"] or None,
            "indication": e["indication"] or None, "region": e["region"] or None,
            **({"date_basis": basis} if basis else {}),
            "sources": [{"collection": coll, "record_key": record[key_field]}],
        }
        indications = [i.strip()[:40] for i in e.get("indications") or [] if i.strip()][:3]
        if indications:
            event["indications"] = indications
        if (e.get("product") or "").strip():
            event["product"] = e["product"].strip()[:60]
        event["impact"] = clean_impact(e.get("impact", ""))
        events.append(event)
    return events


# Sources that skip triage (already selected for the asset) but carry events: investor-presentation slides state
# planned filings, expected readouts and results (crawler step `presentations`; slide text + claims + figures).
UNTRIAGED_SOURCES = {"company_records": ("record_key", {"record_type": "presentation_slide"}, "content")}


def _pending(asset_id: str) -> List[tuple]:
    triaged = [(c, k, {**ingest_query(asset_id), **extra}, t) for c, (k, extra, t) in TRIAGED_SOURCES.items()]
    return triaged + [(c, k, {"assets": asset_id, **extra}, t) for c, (k, extra, t) in UNTRIAGED_SOURCES.items()]


def extract_events(asset: Dict[str, Any], workers: int = 6) -> Dict[str, int]:
    """Run extraction on ingested records not yet processed for this asset. Each record's events are saved as
    soon as they arrive; a record whose call fails (network, API) is left for the next run, and the step only
    fails when every call did."""
    db, asset_id = get_db(), asset["_id"]
    counts = {"documents": 0, "events": 0, "failed": 0}
    error: Exception = None
    # The asset's first extraction is the baseline for the change log: it is not a "change" to find them all.
    baseline = next(iter(db.journey_events.find({"asset": asset_id, "origin": "ai"}, {"_id": 1})), None) is None

    def attempt(coll, key_field, text_field, record):
        try:
            return record, _extract_one(asset, coll, key_field, text_field, record), None
        except Exception as e:  # noqa: BLE001 - reported in counts; the record is retried next run
            return record, None, e

    for coll, key_field, query, text_field in _pending(asset_id):
        records = list(db[coll].find({**query, f"events_done.{asset_id}": {"$exists": False}},
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
                    known = {d["_id"]: d for d in db.journey_events.find({"_id": {"$in": [e["_id"] for e in events]}},
                                                                         {"first_seen": 1})}
                    # ReplaceOne drops fields, so an event seen before keeps its first_seen by copying it over.
                    db.journey_events.bulk_write(
                        [ReplaceOne({"_id": e["_id"]},
                                    {**e, "first_seen": (known.get(e["_id"]) or {}).get("first_seen") or now,
                                     "updated_at": now}, upsert=True) for e in events], ordered=False)
                    write_changes(db, [change_doc(asset_id, e, "ai", "added", now, baseline)
                                       for e in events if e["_id"] not in known])
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
MERGE_SYSTEM = harden(MERGE_SYSTEM)

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
    result = llm.structured(llm.TRIAGE_MODEL, MERGE_SYSTEM, fence(json.dumps(listing)), "groups", MERGE_SCHEMA,
                            reasoning_effort=llm.TRIAGE_EFFORT)
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
