"""
Writes for the app-facing collections: `assets` and `journey_events`, plus the
Valkey version bump that invalidates the API's cached views of an asset.
"""

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Tuple

from pymongo import UpdateOne

COLLECTIONS_WITH_ASSETS = ("articles", "fda_records", "ema_records", "trial_records",
                           "company_records", "publication_records", "conference_records", "patent_records")


def asset_id(name: str) -> str:
    """Asset ids are slugs of the canonical name (spec §3.2): lowercase, each run of characters outside [a-z0-9]
    becomes "-" ("Tyvaso DPI" -> "tyvaso-dpi"). The NestJS API uses the same rule."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def rename_asset_tag(db, old: str, new: str) -> Dict[str, int]:
    """Rewrite `assets` array values (e.g. "Treprostinil" -> "treprostinil") in every record collection."""
    counts = {}
    for coll in COLLECTIONS_WITH_ASSETS:
        res = db[coll].update_many({"assets": old}, {"$set": {"assets.$[el]": new}},
                                   array_filters=[{"el": old}])
        counts[coll] = res.modified_count
    return counts


def upsert_asset(db, doc: Dict[str, Any]) -> None:
    now = datetime.now(timezone.utc)
    db.assets.update_one({"_id": doc["_id"]},
                         {"$set": {**doc, "updated_at": now}, "$setOnInsert": {"created_at": now}},
                         upsert=True)


def _identity(event: Dict[str, Any]) -> Tuple[str, str]:
    """What an event is, independent of how its _id is spelled: its type and first source record."""
    return event.get("type") or "", ((event.get("sources") or [{}])[0]).get("record_key") or ""


# Rule-event fields whose change is worth a line in the change log.
WATCHED_FIELDS = ("date", "expected_date", "type", "significance", "title", "is_milestone")


def change_doc(asset: str, event: Dict[str, Any], origin: str, kind: str, at: datetime, baseline: bool,
               field: str = None, before: Any = None, after: Any = None) -> Dict[str, Any]:
    """One `journey_changes` row. The _id is derived from what happened, so a retried step upserts the same rows."""
    key = f"{asset}|{event['_id']}|{kind}|{field or ''}|{json.dumps(after, default=str, sort_keys=True)}"
    doc = {"_id": hashlib.sha1(key.encode()).hexdigest(), "asset": asset, "event_id": event["_id"], "origin": origin,
           "kind": kind, "before": before, "after": after, "title": event.get("title"),
           "category": event.get("category"), "event_date": event.get("date"), "at": at, "baseline": baseline}
    if field:
        doc["field"] = field
    return doc


def write_changes(db, docs: List[Dict[str, Any]]) -> int:
    """Insert change rows that are not there yet (same _id = same change); returns how many were new."""
    db.journey_changes.create_index([("asset", 1), ("at", -1)])
    if not docs:
        return 0
    ops = [UpdateOne({"_id": d["_id"]}, {"$setOnInsert": {k: v for k, v in d.items() if k != "_id"}}, upsert=True)
           for d in docs]
    return db.journey_changes.bulk_write(ops, ordered=False).upserted_count


def replace_rule_events(db, asset: str, events: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    """Upsert this run's rule events and drop this asset's rule events whose source no longer yields one.

    Only this asset's documents are touched, so refreshes of two assets sharing a record (concurrent or not) never
    remove each other's events. Evidence that AI consolidation merged into an event (merged_sources/merged_from) is
    carried over when the event's _id changes (e.g. ids without the asset, before ids carried it): the absorbed AI
    events were deleted when they merged, so dropping the old document would lose that evidence for good."""
    events = list(events)
    now = datetime.now(timezone.utc)
    ids = [e["_id"] for e in events]
    # What was stored before this run, for the change log. No stored rule events = first build, not a "change".
    stored = {d["_id"]: d for d in db.journey_events.find(
        {"asset": asset, "origin": "rule"},
        {f: 1 for f in (*WATCHED_FIELDS, "category", "sources")})}
    baseline = not stored
    # An id respelling (same type + source record under a new id) is neither an addition nor a removal.
    gone = {i: o for i, o in stored.items() if i not in ids}
    respelled = {_identity(o) for o in gone.values()} & {_identity(e) for e in events if e["_id"] not in stored}
    changes = [change_doc(asset, o, "rule", "removed", now, False, before=o.get("date"))
               for o in gone.values() if _identity(o) not in respelled]
    for e in events:
        old = stored.get(e["_id"])
        if old is None:
            if _identity(e) not in respelled:
                changes.append(change_doc(asset, e, "rule", "added", now, baseline))
            continue
        for f in WATCHED_FIELDS:
            if (old.get(f) or None) != (e.get(f) or None):  # None/""/False are all "unset" for this purpose
                changes.append(change_doc(asset, e, "rule", "changed", now, False, f, old.get(f), e.get(f)))
    # Logged before the events change, so a step that dies half-way re-derives the same rows when it is retried.
    logged = write_changes(db, changes)
    # $set, not replace: keeps evidence merged in by AI consolidation (merged_sources).
    # `links` is rule-owned: unset when a rebuild finds no related events, so stale links don't persist.
    # first_seen is set once, when the event is first stored.
    ops = [UpdateOne({"_id": e["_id"]}, {"$set": {**{k: v for k, v in e.items() if k != "_id"}, "updated_at": now},
                                         "$setOnInsert": {"first_seen": now},
                                         **({} if e.get("links") else {"$unset": {"links": ""}})}, upsert=True)
           for e in events]
    written = db.journey_events.bulk_write(ops, ordered=False).upserted_count if ops else 0
    by_identity = {_identity(e): e["_id"] for e in events}
    carried = 0
    for old in db.journey_events.find({"asset": asset, "origin": "rule", "_id": {"$nin": ids}},
                                      {"type": 1, "sources": 1, "merged_sources": 1, "merged_from": 1}):
        new_id = by_identity.get(_identity(old))
        if new_id and (old.get("merged_sources") or old.get("merged_from")):
            db.journey_events.update_one({"_id": new_id}, {"$addToSet": {
                "merged_sources": {"$each": old.get("merged_sources") or []},
                "merged_from": {"$each": old.get("merged_from") or []}}})
            carried += 1
    stale = db.journey_events.delete_many({"asset": asset, "origin": "rule", "_id": {"$nin": ids}}).deleted_count
    db.journey_events.create_index([("asset", 1), ("date", -1)])
    return {"events": len(events), "new": written, "removed": stale, "evidence_carried": carried,
            "changes": 0 if baseline else logged}


def bump_asset_version(asset: str) -> bool:
    """Invalidate the API's cached views of this asset (spec §3.3). False if Valkey is unreachable."""
    try:
        import redis
        client = redis.Redis.from_url(os.getenv("VALKEY_URL", "redis://localhost:6380"), socket_timeout=3)
        prefix = os.getenv("VALKEY_PREFIX", "aj:")
        client.incr(f"{prefix}asset:{asset}:ver")
        client.incr(f"{prefix}assets:ver")
        return True
    except Exception:
        return False
