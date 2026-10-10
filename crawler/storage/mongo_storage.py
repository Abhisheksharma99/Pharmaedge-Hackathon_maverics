"""
MongoDB storage for asset-journey data.

Replaces the Postgres layer (storage/json_storage.py + services/news_press_service.py)
that the crawlers wrote to in universal-crawler. Collections:

  articles     - RSS / Google Alerts articles, unique on url, tagged with `assets`
  fda_records  - openFDA records, unique on record_key
  ema_records  - EMA records, unique on record_key
  company_records - company site pages, PDFs, press releases, unique on record_key
  trial_records   - ClinicalTrials.gov studies, unique on record_key
  runs, logs   - crawl bookkeeping (same role as the Postgres runs/logs tables)

An article or regulatory record found for a second asset is not duplicated; the
asset is added to its `assets` array instead (this replaces the old
project_ids / add_project_to_article logic).

use_json(out_dir) redirects every call below to JSON files instead (see
storage/json_store.py), for reviewing data before loading it into MongoDB.
"""

import functools
import logging
import hashlib
import os
import time
import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from dotenv import load_dotenv
from pymongo import MongoClient, UpdateOne
from pymongo.errors import AutoReconnect, OperationFailure

load_dotenv()

_db = None
_json = None


def use_json(out_dir: str) -> None:
    """Write to JSON files in out_dir instead of MongoDB."""
    global _json
    from storage.json_store import JsonStore
    _json = JsonStore(out_dir)


def _backend(fn):
    """Route the call to the JSON store when use_json() is active."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        if _json is not None:
            return getattr(_json, fn.__name__)(*args, **kwargs)
        return fn(*args, **kwargs)
    return wrapper


def _retry(fn):
    """Retry on AutoReconnect. TLS handshakes to the Atlas nodes fail
    intermittently from some networks; a short backoff gets through."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        for attempt in range(5):
            try:
                return fn(*args, **kwargs)
            except AutoReconnect:
                if attempt == 4:
                    raise
                time.sleep(2 ** attempt)
    return wrapper


@_retry
def get_db():
    global _db
    if _db is None:
        client = MongoClient(os.environ["MONGODB_URI"])
        db = client[os.getenv("MONGODB_DB", "asset_journey")]
        db.articles.create_index("url", unique=True)
        db.articles.create_index("assets")
        db.articles.create_index("content_hash")
        for name in ("fda_records", "ema_records", "company_records", "trial_records"):
            db[name].create_index("record_key", unique=True)
            db[name].create_index("assets")
        # Later collections: same contract. A deployment holding duplicate keys from before keeps running (logged);
        # the duplicates must be merged before the unique index can exist.
        for name in ("publication_records", "conference_records", "patent_records"):
            db[name].create_index("assets")
            try:
                db[name].create_index("record_key", unique=True)
            except OperationFailure as e:
                logging.getLogger("storage").warning("no unique record_key index on %s: %s", name, e)
        db.logs.create_index("crawler_id")
        _db = db  # only once indexes exist, so a retry redoes them
    return _db


def get_content_hash(content: str) -> str:
    return hashlib.md5((content or "").encode()).hexdigest()


# --- runs / logs ------------------------------------------------------------

@_backend
@_retry
def create_run(data: Dict[str, Any]) -> Dict[str, Any]:
    run = {"id": str(uuid.uuid4()), **data}
    get_db().runs.insert_one(dict(run))
    return run


@_backend
@_retry
def update_run(run_id: str, updates: Dict[str, Any]) -> None:
    get_db().runs.update_one({"id": run_id}, {"$set": updates})


@_backend
@_retry
def add_log(crawler_id: str, level: str, message: str) -> None:
    get_db().logs.insert_one({
        "crawler_id": crawler_id,
        "level": level,
        "message": message,
        "created_at": datetime.now(),
    })


# --- articles ---------------------------------------------------------------

@_backend
@_retry
def article_exists(url: str) -> bool:
    return get_db().articles.count_documents({"url": url}, limit=1) > 0


@_backend
@_retry
def tag_article_asset(url: str, asset: Optional[str]) -> None:
    """Add `asset` to an existing article's assets (no-op if already there)."""
    if asset:
        get_db().articles.update_one({"url": url}, {"$addToSet": {"assets": asset}})


@_backend
@_retry
def insert_article(record: Dict[str, Any], asset: Optional[str]) -> bool:
    """Insert an article keyed on url. Returns True if it was new.

    Content already stored under another URL (a wire release syndicated to
    several sites) counts as a duplicate: the asset is tagged on the stored copy.
    """
    record = {k: v for k, v in record.items() if k != "assets"}
    if record.get("content_hash"):
        twin = get_db().articles.find_one(
            {"content_hash": record["content_hash"], "url": {"$ne": record["url"]}}, {"url": 1})
        if twin:
            tag_article_asset(twin["url"], asset)
            return False
    update = {"$setOnInsert": record}
    if asset:
        update["$addToSet"] = {"assets": asset}
    result = get_db().articles.update_one({"url": record["url"]}, update, upsert=True)
    return result.upserted_id is not None


# --- regulatory -------------------------------------------------------------

@_backend
@_retry
def upsert_records(collection: str, records: Iterable[Dict[str, Any]], asset: str) -> Dict[str, int]:
    """Upsert regulatory records on record_key, tagging each with `asset`."""
    ops: List[UpdateOne] = []
    for rec in records:
        rec = {**rec, "fetched_at": datetime.now()}
        ops.append(UpdateOne(
            {"record_key": rec["record_key"]},
            {"$set": rec, "$addToSet": {"assets": asset}},
            upsert=True,
        ))
    if not ops:
        return {"inserted": 0, "updated": 0}
    result = get_db()[collection].bulk_write(ops, ordered=False)
    return {"inserted": result.upserted_count, "updated": result.modified_count}
