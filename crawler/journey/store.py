"""
Writes for the app-facing collections: `assets` and `journey_events`, plus the
Valkey version bump that invalidates the API's cached views of an asset.
"""

import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable

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


def replace_rule_events(db, asset: str, events: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    """Upsert this run's rule events and drop rule events whose source no longer yields one."""
    events = list(events)
    now = datetime.now(timezone.utc)
    # $set, not replace: keeps evidence merged in by AI consolidation (merged_sources).
    # `links` is rule-owned: unset when a rebuild finds no related events, so stale links don't persist.
    ops = [UpdateOne({"_id": e["_id"]}, {"$set": {**{k: v for k, v in e.items() if k != "_id"}, "updated_at": now},
                                         **({} if e.get("links") else {"$unset": {"links": ""}})}, upsert=True)
           for e in events]
    written = db.journey_events.bulk_write(ops, ordered=False).upserted_count if ops else 0
    stale = db.journey_events.delete_many({"asset": asset, "origin": "rule",
                                           "_id": {"$nin": [e["_id"] for e in events]}}).deleted_count
    db.journey_events.create_index([("asset", 1), ("date", -1)])
    return {"events": len(events), "new": written, "removed": stale}


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
