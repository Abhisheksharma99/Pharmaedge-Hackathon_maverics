"""
Enrichment of key journey events (spec §4.3): the indications they concern, the product, a one-line "why it
matters" and links to related key events. Run at finalize on key events not enriched yet (rule events get their
deterministic fields from journey/rules.py; this fills what rules can't know). Batched; cached by content hash.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict

from pymongo import UpdateOne

from . import llm
from .events import clean_impact
from .triage import asset_context

logger = logging.getLogger("crawl.enrich")

BATCH = 20

SYSTEM = """You enrich journey events of ONE drug asset for pharma competitive-intelligence analysts. For each event
return:
- indications: the indication(s) it concerns as short standard names or abbreviations (e.g. PAH, PH-ILD, IPF);
  [] if neither stated nor clearly implied.
- product: the brand or product name it concerns, "" if none.
- impact: one factual sentence (max 25 words) on why it matters for this asset's journey, supported by the title
  and summary; "" if unsure. Never invent numbers or outcomes.
- links: ids from "All key events" of up to 3 events this one directly relates to (same trial, same filing,
  cause and effect); [] if none."""

SCHEMA = {
    "type": "object",
    "properties": {"events": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "indications": {"type": "array", "items": {"type": "string"}},
                       "product": {"type": "string"}, "impact": {"type": "string"},
                       "links": {"type": "array", "items": {"type": "string"}}},
        "required": ["id", "indications", "product", "impact", "links"], "additionalProperties": False}}},
    "required": ["events"], "additionalProperties": False,
}


def enrich_events(db, asset: Dict[str, Any]) -> int:
    asset_id = asset["_id"]
    todo = list(db.journey_events.find({"asset": asset_id, "key": True, "enriched_at": {"$exists": False}}))
    if not todo:
        return 0
    catalog = [{"id": e["_id"], "date": e.get("date"), "title": e.get("title")}
               for e in db.journey_events.find({"asset": asset_id, "key": True}, {"date": 1, "title": 1})]
    known = {c["id"] for c in catalog}
    context = json.dumps(asset_context(asset))
    done = 0
    for start in range(0, len(todo), BATCH):
        batch = todo[start:start + BATCH]
        payload = [{"id": e["_id"], "date": e.get("date"), "type": e.get("type"), "title": e.get("title"),
                    "summary": (e.get("summary") or "")[:400], "indication": e.get("indication") or ""} for e in batch]
        try:
            result = llm.structured(llm.TRIAGE_MODEL, SYSTEM,
                                    f"Asset: {context}\nEvents: {json.dumps(payload)}\nAll key events: {json.dumps(catalog)}",
                                    "enrich", SCHEMA)
        except Exception:  # noqa: BLE001 - this batch is retried on the next finalize; the others still run
            logger.warning("enrichment batch failed for %s", asset_id, exc_info=True)
            continue
        answers = {r["id"]: r for r in result["events"]}
        now = datetime.now(timezone.utc)
        ops = []
        for e in batch:
            r = answers.get(e["_id"])
            if r is None:
                continue  # skipped by the model: retried on the next finalize
            fields: Dict[str, Any] = {"enriched_at": now,
                                      "ai_links": [i for i in dict.fromkeys(r["links"]) if i in known and i != e["_id"]][:3]}
            if not e.get("impact"):  # AI events already carry the one written at extraction
                fields["impact"] = clean_impact(r["impact"])
            if not e.get("product") and r["product"].strip():
                fields["product"] = r["product"].strip()[:60]
            indications = [i.strip()[:40] for i in r["indications"] if i.strip()][:3]
            if not e.get("indications") and indications:
                fields["indications"] = indications
            ops.append(UpdateOne({"_id": e["_id"]}, {"$set": fields}))
        if ops:
            db.journey_events.bulk_write(ops, ordered=False)
            done += len(ops)
    return done
