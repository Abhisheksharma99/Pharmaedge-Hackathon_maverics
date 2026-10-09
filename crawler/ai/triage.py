"""
AI triage (spec §5.3): decide what is worth ingesting before spending fetches,
extraction and embeddings on it.

  ingest   - substantive, about this asset's journey: fetch, extract events, index
  headline - relevant but low-signal: keep title + link only
  skip     - unrelated, spam, market-report ads, bot pages

Every decision lands in `crawl_ledger` (one per asset + item), so an item is
never re-judged on refresh, and the reason for every drop is on record.
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from pymongo import UpdateOne

from storage.mongo_storage import get_db

from . import llm

DECISIONS = ["ingest", "headline", "skip"]
CATEGORIES = ["approval", "regulatory", "trial_readout", "trial_update", "safety", "publication", "financials",
              "deal", "litigation", "launch", "competitor_signal", "conference", "market_report", "unrelated"]
BATCH = 30

SYSTEM = """You triage items for the development and commercial journey of ONE drug asset, for pharma
competitive-intelligence analysts. For each item decide:
- ingest: substantively about this asset (or a direct competitor's head-to-head/class news): regulatory decisions,
  submissions, label changes, trial starts/results/enrollment, safety issues, launches, deals or licensing,
  litigation or patents affecting it, financial results with product revenue, pivotal or high-impact publications
  (RCTs, meta-analyses, guidelines).
- headline: relevant but low-signal: conference participation notices, financial calendar notices, reviews,
  broad disease-area news that mentions the asset only in passing, routine corporate news.
- skip: not about the asset or its indication, market-research report ads, SEO spam, job posts, bot-check or
  error pages, unrelated drugs.
Prefer headline over skip when unsure. Reasons: one short sentence."""

SCHEMA = {
    "type": "object",
    "properties": {"decisions": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "decision": {"type": "string", "enum": DECISIONS},
                       "category": {"type": "string", "enum": CATEGORIES}, "reason": {"type": "string"}},
        "required": ["id", "decision", "category", "reason"], "additionalProperties": False}}},
    "required": ["decisions"], "additionalProperties": False,
}


def asset_context(asset: Dict[str, Any]) -> Dict[str, Any]:
    tags = asset.get("tags", {})
    return {"asset": asset["name"], "also_known_as": asset.get("aliases", []),
            "company": asset.get("company", {}).get("name"), "indications": tags.get("indications", []),
            "investigational_indications": tags.get("investigational_indications", []),
            "mechanism": tags.get("mechanism")}


def ledger_id(asset_id: str, item_key: str) -> str:
    return hashlib.sha1(f"{asset_id}|{item_key}".encode()).hexdigest()


def judge(asset: Dict[str, Any], items: List[Dict[str, Any]]) -> Dict[str, Dict[str, str]]:
    """items: {key, title, snippet, source, date}. Returns key -> {decision, category, reason}.
    Items already in the ledger reuse their decision; new ones go to the model in batches."""
    db = get_db()
    out: Dict[str, Dict[str, str]] = {}
    ids = {ledger_id(asset["_id"], i["key"]): i for i in items}
    for row in db.crawl_ledger.find({"_id": {"$in": list(ids)}}):
        out[ids[row["_id"]]["key"]] = {k: row[k] for k in ("decision", "category", "reason")}
    todo = [i for i in items if i["key"] not in out]
    context = json.dumps(asset_context(asset))
    now = datetime.now(timezone.utc)
    for start in range(0, len(todo), BATCH):
        batch = todo[start:start + BATCH]
        by_id = {str(n): item for n, item in enumerate(batch)}
        payload = [{"id": n, "title": (i.get("title") or "")[:300], "snippet": (i.get("snippet") or "")[:400],
                    "source": i.get("source") or "", "date": i.get("date") or ""} for n, i in by_id.items()]
        result = llm.structured(llm.TRIAGE_MODEL, SYSTEM, f"Asset: {context}\nItems: {json.dumps(payload)}",
                                "triage", SCHEMA)
        decided = {d["id"]: d for d in result["decisions"] if d["id"] in by_id}
        ops = []
        for n, item in by_id.items():
            # The model skipped an item: keep it visible rather than drop it silently.
            d = decided.get(n, {"decision": "headline", "category": "unrelated", "reason": "Not classified"})
            out[item["key"]] = {k: d[k] for k in ("decision", "category", "reason")}
            ops.append(UpdateOne({"_id": ledger_id(asset["_id"], item["key"])}, {"$set": {
                "asset": asset["_id"], "item_key": item["key"], "title": item.get("title"), "url": item.get("url"),
                "date": item.get("date"), "source": item.get("source"), "collection": item.get("collection"),
                **out[item["key"]], "model": llm.TRIAGE_MODEL, "decided_at": now}}, upsert=True))
        if ops:
            db.crawl_ledger.bulk_write(ops, ordered=False)
    return out


def triage_entries(asset: Dict[str, Any], entries: List[Dict[str, Any]], counts: Dict[str, int]) -> List[Dict[str, Any]]:
    """Discovery-time filter for feed/search entries: only `ingest` entries get fetched."""
    items = [{"key": e["url"], "url": e["url"], "title": e.get("title"), "snippet": e.get("description"),
              "source": e.get("publisher"), "date": str(e.get("published") or "")[:10], "collection": "articles"}
             for e in entries if e.get("url")]
    decisions = judge(asset, items)
    for d in decisions.values():
        counts[d["decision"]] = counts.get(d["decision"], 0) + 1
    return [e for e in entries if decisions.get(e.get("url"), {}).get("decision") == "ingest"]


TRIAGED_SOURCES = {
    # collection: (key field, filter, text field for the snippet)
    "articles": ("url", {}, "content"),
    "company_records": ("record_key", {"record_type": "press_release"}, "content"),
    "publication_records": ("record_key", {}, "abstract"),
    "conference_records": ("record_key", {}, "abstract"),
    # EMA CHMP meeting highlights (opinions and narrative), not the structured EMA reports: rules cover those.
    "ema_records": ("record_key", {"record_type": {"$in": ["ema_chmp_opinion", "ema_chmp_highlight"]}}, "content"),
}


def triage_stored(asset: Dict[str, Any], notable: Optional[List[Any]] = None) -> Dict[str, int]:
    """Triage records already stored for the asset that haven't been judged yet; store the verdict on them."""
    db, asset_id, counts = get_db(), asset["_id"], {}
    for coll, (key_field, extra, text_field) in TRIAGED_SOURCES.items():
        query = {"assets": asset_id, f"triage.{asset_id}": {"$exists": False}, **extra}
        records = list(db[coll].find(query, {key_field: 1, "title": 1, "date": 1, "source": 1, "company": 1,
                                             text_field: 1, "url": 1}))
        if not records:
            continue
        items = [{"key": r[key_field], "url": r.get("url"), "title": r.get("title"),
                  "snippet": (r.get(text_field) or "")[:400], "source": r.get("company") or r.get("source"),
                  "date": r.get("date"), "collection": coll} for r in records]
        decisions = judge(asset, items)
        if notable is not None:
            titles = {i["key"]: i.get("title") or i["key"] for i in items}
            notable.extend((titles[k], d["decision"]) for k, d in decisions.items())
        db[coll].bulk_write([UpdateOne({key_field: k}, {"$set": {f"triage.{asset_id}": d}})
                             for k, d in decisions.items()], ordered=False)
        for d in decisions.values():
            counts[f"{coll}_{d['decision']}"] = counts.get(f"{coll}_{d['decision']}", 0) + 1
    return counts


def ingest_query(asset_id: str) -> Dict[str, Any]:
    return {"assets": asset_id, f"triage.{asset_id}.decision": "ingest"}


def keys_of(records: Iterable[Dict[str, Any]], key_field: str) -> List[str]:
    return [r[key_field] for r in records]
