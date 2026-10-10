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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from pymongo import UpdateOne

from storage.mongo_storage import get_db

from . import llm
from .untrusted import fence, harden

DECISIONS = ["ingest", "headline", "skip"]
CATEGORIES = ["approval", "regulatory", "trial_readout", "trial_update", "safety", "publication", "financials",
              "deal", "litigation", "launch", "competitor_signal", "conference", "market_report", "unrelated"]
BATCH = 30
WORKERS = 4  # batches judged in parallel (one asset's refresh can bring hundreds of items)

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
SYSTEM = harden(SYSTEM)

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


def _ask(context: str, batch: List[Dict[str, Any]]):
    """(batch by id, model decisions by id) - or (batch by id, the exception) when the call failed."""
    by_id = {str(n): item for n, item in enumerate(batch)}
    payload = [{"id": n, "title": (i.get("title") or "")[:300], "snippet": (i.get("snippet") or "")[:400],
                "source": i.get("source") or "", "date": i.get("date") or ""} for n, i in by_id.items()]
    try:
        # Asset context first, items last: the stable prefix is what the provider's prompt cache can reuse.
        result = llm.structured(llm.TRIAGE_MODEL, SYSTEM, f"Asset: {context}\nItems:\n{fence(json.dumps(payload))}",
                                "triage", SCHEMA, reasoning_effort=llm.TRIAGE_EFFORT)
    except Exception as e:  # noqa: BLE001 - this batch stays undecided and is judged on the next run
        return by_id, e
    return by_id, {d["id"]: d for d in result["decisions"] if d["id"] in by_id}


# Raise when SYSTEM / the categories change in a way that should re-judge stored items: decisions made under an older
# version (or before versions existed, = 1) are then judged again on the next run; same version = reused, as before.
PROMPT_VERSION = 1


def pending_query(asset_id: str) -> Dict[str, Any]:
    """Records of the asset still to be judged under the current prompt version."""
    if PROMPT_VERSION == 1:
        return {f"triage.{asset_id}": {"$exists": False}}
    return {f"triage.{asset_id}.v": {"$not": {"$gte": PROMPT_VERSION}}}


def judge(asset: Dict[str, Any], items: List[Dict[str, Any]],
          counts: Optional[Dict[str, int]] = None) -> Dict[str, Dict[str, str]]:
    """items: {key, title, snippet, source, date}. Returns key -> {decision, category, reason}.
    Items already in the ledger reuse their decision; new ones go to the model in parallel batches. Items of a
    batch whose call failed are left out of the result (and of the ledger), so the next run judges them; the call
    fails only when every batch did."""
    db = get_db()
    out: Dict[str, Dict[str, str]] = {}
    ids = {ledger_id(asset["_id"], i["key"]): i for i in items}
    current = {} if PROMPT_VERSION == 1 else {"prompt_version": {"$gte": PROMPT_VERSION}}
    for row in db.crawl_ledger.find({"_id": {"$in": list(ids)}, **current}):
        out[ids[row["_id"]]["key"]] = {k: row[k] for k in ("decision", "category", "reason")}
    todo = [i for i in items if i["key"] not in out]
    context = json.dumps(asset_context(asset))
    now = datetime.now(timezone.utc)
    batches = [todo[s:s + BATCH] for s in range(0, len(todo), BATCH)]
    failed, error = 0, None
    with ThreadPoolExecutor(min(WORKERS, len(batches)) or 1) as pool:
        results = list(pool.map(lambda b: _ask(context, b), batches))
    for by_id, decided in results:
        if isinstance(decided, Exception):
            failed, error = failed + 1, decided
            continue
        ops = []
        for n, item in by_id.items():
            # The model skipped an item: keep it visible rather than drop it silently.
            d = decided.get(n, {"decision": "headline", "category": "unrelated", "reason": "Not classified"})
            out[item["key"]] = {k: d[k] for k in ("decision", "category", "reason")}
            ops.append(UpdateOne({"_id": ledger_id(asset["_id"], item["key"])}, {"$set": {
                "asset": asset["_id"], "item_key": item["key"], "title": item.get("title"), "url": item.get("url"),
                "date": item.get("date"), "source": item.get("source"), "collection": item.get("collection"),
                **out[item["key"]], "model": llm.TRIAGE_MODEL, "prompt_version": PROMPT_VERSION, "decided_at": now}},
                upsert=True))
        if ops:
            db.crawl_ledger.bulk_write(ops, ordered=False)
    if failed:
        if counts is not None:
            counts["triage_failed_batches"] = counts.get("triage_failed_batches", 0) + failed
        if failed == len(batches):
            raise error
    return out


def triage_entries(asset: Dict[str, Any], entries: List[Dict[str, Any]], counts: Dict[str, int]) -> List[Dict[str, Any]]:
    """Discovery-time filter for feed/search entries: only `ingest` entries get fetched."""
    items = [{"key": e["url"], "url": e["url"], "title": e.get("title"), "snippet": e.get("description"),
              "source": e.get("publisher"), "date": str(e.get("published") or "")[:10], "collection": "articles"}
             for e in entries if e.get("url")]
    decisions = judge(asset, items, counts)
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
        query = {"assets": asset_id, **pending_query(asset_id), **extra}
        records = list(db[coll].find(query, {key_field: 1, "title": 1, "date": 1, "source": 1, "company": 1,
                                             text_field: 1, "url": 1}))
        if not records:
            continue
        items = [{"key": r[key_field], "url": r.get("url"), "title": r.get("title"),
                  "snippet": (r.get(text_field) or "")[:400], "source": r.get("company") or r.get("source"),
                  "date": r.get("date"), "collection": coll} for r in records]
        decisions = judge(asset, items, counts)
        if not decisions:
            continue
        if notable is not None:
            titles = {i["key"]: i.get("title") or i["key"] for i in items}
            notable.extend((titles[k], d["decision"]) for k, d in decisions.items())
        db[coll].bulk_write([UpdateOne({key_field: k}, {"$set": {f"triage.{asset_id}": {**d, "v": PROMPT_VERSION}}})
                             for k, d in decisions.items()], ordered=False)
        for d in decisions.values():
            counts[f"{coll}_{d['decision']}"] = counts.get(f"{coll}_{d['decision']}", 0) + 1
    return counts


def ingest_query(asset_id: str) -> Dict[str, Any]:
    return {"assets": asset_id, f"triage.{asset_id}.decision": "ingest"}


def keys_of(records: Iterable[Dict[str, Any]], key_field: str) -> List[str]:
    return [r[key_field] for r in records]
