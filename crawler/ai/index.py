"""
Selective vector index for Asset AI (spec §5.3, step "index").

Only ingested records (triage) plus the company's prescribing information and
annual reports are embedded, in ~1,500-character chunks, into `record_chunks`
with an Atlas Vector Search index. Re-indexing happens only when a record's
text changes (content hash).
"""

import hashlib
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Tuple

from pymongo import ReplaceOne
from pymongo.operations import SearchIndexModel

from storage.mongo_storage import get_db

from . import llm
from .triage import TRIAGED_SOURCES, ingest_query

INDEX_NAME = "record_chunks_vector"
CHUNK, OVERLAP, MAX_CHUNKS = 1500, 200, 40
DOCUMENT_TYPES = ["prescribing_info", "annual_report"]


def chunks(text: str) -> List[str]:
    text = " ".join(text.split())
    out, start = [], 0
    while start < len(text) and len(out) < MAX_CHUNKS:
        out.append(text[start:start + CHUNK])
        start += CHUNK - OVERLAP
    return out


def ensure_vector_index(db) -> None:
    coll = db.record_chunks
    if any(i.get("name") == INDEX_NAME for i in coll.list_search_indexes()):
        return
    coll.create_search_index(SearchIndexModel(name=INDEX_NAME, type="vectorSearch", definition={"fields": [
        {"type": "vector", "path": "embedding", "numDimensions": llm.EMBEDDING_DIMENSIONS, "similarity": "cosine"},
        {"type": "filter", "path": "assets"}, {"type": "filter", "path": "collection"},
        {"type": "filter", "path": "record_type"}, {"type": "filter", "path": "date"},
    ]}))


def _sources(asset_id: str) -> Iterator[Tuple[str, str, str, Dict[str, Any]]]:
    for coll, (key_field, extra, text_field) in TRIAGED_SOURCES.items():
        yield coll, key_field, text_field, {**ingest_query(asset_id), **extra}
    yield "company_records", "record_key", "content", {"assets": asset_id, "record_type": {"$in": DOCUMENT_TYPES}}


def index_asset(asset_id: str) -> Dict[str, int]:
    db = get_db()
    db.record_chunks.create_index("record_key")
    counts = {"records": 0, "chunks": 0, "failed": 0}
    error: Exception = None
    for coll, key_field, text_field, query in _sources(asset_id):
        for r in db[coll].find(query, {key_field: 1, text_field: 1, "title": 1, "date": 1, "record_type": 1,
                                       "assets": 1, "url": 1, "indexed_hash": 1}):
            text = f"{r.get('title') or ''}\n{r.get(text_field) or ''}".strip()
            digest = hashlib.sha1(text.encode()).hexdigest()
            if not text or r.get("indexed_hash") == digest:
                continue
            parts = chunks(text)
            try:
                vectors = llm.embed(parts)
            except Exception as e:  # noqa: BLE001 - no indexed_hash is saved, so the record is retried next run
                counts["failed"] += 1
                error = e
                continue
            now = datetime.now(timezone.utc)
            key = r[key_field]
            db.record_chunks.delete_many({"collection": coll, "record_key": key})
            db.record_chunks.bulk_write([ReplaceOne({"_id": f"{coll}|{key}|{i}"}, {
                "collection": coll, "record_key": key, "chunk": i, "text": part, "embedding": vec,
                "assets": r.get("assets", []), "title": r.get("title"), "date": r.get("date"),
                "record_type": r.get("record_type") or coll, "url": r.get("url"), "indexed_at": now,
            }, upsert=True) for i, (part, vec) in enumerate(zip(parts, vectors))], ordered=False)
            db[coll].update_one({key_field: key}, {"$set": {"indexed_hash": digest}})
            counts["records"] += 1
            counts["chunks"] += len(parts)
    if error and not counts["records"]:
        raise error
    ensure_vector_index(db)
    return counts


def wait_until_queryable(timeout: int = 180) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = next(iter(get_db().record_chunks.list_search_indexes(INDEX_NAME)), {})
        if status.get("queryable"):
            return True
        time.sleep(3)
    return False
