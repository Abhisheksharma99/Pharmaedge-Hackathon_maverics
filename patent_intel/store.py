"""Storage (async). Contract: every document has a stable `_id`; `upsert` replaces by `_id`; reads are exact-match only.
Same contract in JSON files and MongoDB -> switching is one setting (MONGO_URI).

Collections: drugs, patents (one per publication), drug_patents (drug<->patent link with match evidence),
crawl_runs (coverage + telemetry), crawl_jobs (API job status). Raw HTML lives in the cache dir, never here.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

Doc = dict[str, Any]

# (keys, options). Unique indexes are the last line of defence against duplicates, whatever the code does.
INDEXES: dict[str, list[tuple[list[str], dict[str, Any]]]] = {
    "patents": [(["publication_number"], {"unique": True}), (["country", "publication_date"], {}),
                (["application_number"], {}), (["family_id"], {}), (["applicants_normalized"], {}), (["content_hash"], {})],
    "drug_patents": [(["drug_id", "decision", "stale"], {}), (["patent_id"], {})],
    "crawl_runs": [(["drug_id", "started_at"], {})],
    "regulatory_events": [(["drug_id", "date"], {}), (["drug_id", "type", "date"], {})],
    "fda_calendar_events": [(["drug_id", "stale", "date"], {}), (["drug_id", "status"], {})],
    "drug_listings": [(["ticker", "stale"], {}), (["drug_id"], {})],  # market_prices: one doc per ticker, by _id
    # at most ONE active (queued/running) job per drug - enforced by the database, across processes
    "crawl_jobs": [(["drug_key"], {"unique": True, "partialFilterExpression": {"active": True}, "name": "one_active_job_per_drug"}),
                   (["status", "created_at"], {})],
}


class DuplicateError(Exception):
    """Insert rejected by a unique constraint."""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
TIMEOUTS_MS = {"serverSelectionTimeoutMS": 10_000, "connectTimeoutMS": 10_000, "socketTimeoutMS": 60_000}


class JsonStore:
    """Files on disk; blocking IO runs in a worker thread so the event loop never stalls."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = threading.Lock()  # one writer/reader at a time across worker threads
        root.mkdir(parents=True, exist_ok=True)

    def _load(self, collection: str) -> dict[str, Doc]:
        path = self.root / f"{collection}.json"
        return {d["_id"]: d for d in json.loads(path.read_text())} if path.exists() else {}

    def _save(self, collection: str, data: dict[str, Doc]) -> None:
        path = self.root / f"{collection}.json"
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(sorted(data.values(), key=lambda d: d["_id"]), ensure_ascii=False, indent=1, default=str))
        os.replace(tmp, path)  # atomic: a crash never corrupts completed data

    def _upsert(self, collection: str, docs: list[Doc]) -> None:
        with self._lock:
            data, now = self._load(collection), _now()
            for d in docs:  # same semantics as Mongo: replace fields, keep first_seen, refresh last_seen
                data[d["_id"]] = {**d, "first_seen": data.get(d["_id"], {}).get("first_seen", now), "last_seen": now}
            self._save(collection, data)

    def _insert(self, collection: str, doc: Doc) -> None:
        with self._lock:
            data = self._load(collection)
            if doc["_id"] in data:
                raise DuplicateError(doc["_id"])
            data[doc["_id"]] = doc
            self._save(collection, data)

    def _mark_stale(self, collection: str, where: dict[str, Any], keep: set[str]) -> int:
        with self._lock:
            data, n = self._load(collection), 0
            for d in data.values():
                if d["_id"] not in keep and not d.get("stale") and all(d.get(k) == v for k, v in where.items()):
                    d["stale"], n = True, n + 1
            if n:
                self._save(collection, data)
            return n

    def _read(self, collection: str) -> dict[str, Doc]:
        with self._lock:
            return self._load(collection)

    async def upsert(self, collection: str, docs: list[Doc]) -> None:
        if docs:
            await asyncio.to_thread(self._upsert, collection, docs)

    async def insert(self, collection: str, doc: Doc) -> None:
        await asyncio.to_thread(self._insert, collection, doc)

    async def mark_stale(self, collection: str, where: dict[str, Any], keep: set[str]) -> int:
        return await asyncio.to_thread(self._mark_stale, collection, where, keep)

    async def get(self, collection: str, _id: str) -> Doc | None:
        return (await asyncio.to_thread(self._read, collection)).get(_id)

    async def find(self, collection: str, where: dict[str, Any], skip: int = 0, limit: int = 50,
                   sort: str = "_id") -> tuple[list[Doc], int]:
        data = await asyncio.to_thread(self._read, collection)
        rows = sorted((d for d in data.values() if all(d.get(k) == v for k, v in where.items())),
                      key=lambda d: (str(d.get(sort, "")), d["_id"]))
        return rows[skip: skip + limit], len(rows)

    async def get_many(self, collection: str, ids: list[str]) -> dict[str, Doc]:
        data = await asyncio.to_thread(self._read, collection)
        return {i: data[i] for i in ids if i in data}

    async def close(self) -> None:
        pass


URI_TLS_CA_OPTIONS = ("tlscafile", "tlsinsecure", "tlsallowinvalidcertificates", "ssl_ca_certs")


def mongo_tls_kwargs(uri: str, ca: str | None = None) -> dict[str, str]:
    """Which CA bundle verifies MongoDB's TLS certificate. Certificate verification itself is never disabled here.

    - no TLS in the URI, or the URI sets its own CA/verification options -> {} (the URI decides; a code-level
      tlsCAFile would silently override a URI's tlsCAFile, because PyMongo gives keyword arguments precedence)
    - MONGO_TLS_CA_FILE=system -> {} (OpenSSL's system trust store: servers whose private CA is installed there)
    - MONGO_TLS_CA_FILE=<path> -> that CA bundle (private/corporate CA)
    - default -> certifi's public CA bundle (works everywhere for Atlas, incl. python.org macOS builds without CAs)"""
    query = {k.lower(): v.lower() for k, v in parse_qsl(urlsplit(uri).query)}
    explicit = query.get("tls", query.get("ssl"))
    if explicit == "false" or (explicit != "true" and not uri.startswith("mongodb+srv://")):
        return {}
    if any(k in query for k in URI_TLS_CA_OPTIONS) or ca == "system":
        return {}
    if ca:
        return {"tlsCAFile": ca}
    import certifi

    return {"tlsCAFile": certifi.where()}


class MongoStore:
    """Native async driver (pymongo AsyncMongoClient): one pooled client per process, every call time-bounded."""

    def __init__(self, uri: str, db: str, tls_ca: str | None = None) -> None:
        from pymongo import AsyncMongoClient

        self.client: Any = AsyncMongoClient(uri, tz_aware=True, **TIMEOUTS_MS, **mongo_tls_kwargs(uri, tls_ca))
        self.db = self.client[db]

    async def connect(self) -> MongoStore:
        from pymongo import ASCENDING

        try:
            await self.client.admin.command("ping")  # fail fast on bad URI/credentials/network
            for coll, idxs in INDEXES.items():
                for keys, opts in idxs:
                    await self.db[coll].create_index([(k, ASCENDING) for k in keys], **opts)
        except BaseException:
            await self.client.close()  # don't leak the pool when startup fails
            raise
        return self

    async def upsert(self, collection: str, docs: list[Doc]) -> None:
        """Idempotent: same _id -> same document updated in place (never a second copy); first_seen kept."""
        from pymongo import UpdateOne

        if docs:
            now = _now()
            ops = [UpdateOne({"_id": d["_id"]},
                             {"$set": {**{k: v for k, v in d.items() if k not in ("_id", "first_seen")}, "last_seen": now},
                              "$setOnInsert": {"first_seen": now}}, upsert=True) for d in docs]
            await self.db[collection].bulk_write(ops, ordered=False)

    async def insert(self, collection: str, doc: Doc) -> None:
        from pymongo.errors import DuplicateKeyError

        try:
            await self.db[collection].insert_one(doc)
        except DuplicateKeyError as e:
            raise DuplicateError(str(doc.get("_id"))) from e

    async def mark_stale(self, collection: str, where: dict[str, Any], keep: set[str]) -> int:
        r = await self.db[collection].update_many({**where, "_id": {"$nin": sorted(keep)}, "stale": {"$ne": True}},
                                                  {"$set": {"stale": True, "stale_since": _now()}})
        return r.modified_count

    async def get(self, collection: str, _id: str) -> Doc | None:
        return await self.db[collection].find_one({"_id": _id})

    async def find(self, collection: str, where: dict[str, Any], skip: int = 0, limit: int = 50,
                   sort: str = "_id") -> tuple[list[Doc], int]:
        # `where` values and `sort` are chosen/validated server-side (never raw request JSON) -> no operator injection
        rows = await self.db[collection].find(where).sort([(sort, 1), ("_id", 1)]).skip(skip).limit(limit).to_list()
        return rows, await self.db[collection].count_documents(where)

    async def get_many(self, collection: str, ids: list[str]) -> dict[str, Doc]:
        rows = await self.db[collection].find({"_id": {"$in": [str(i) for i in ids]}}).to_list()
        return {d["_id"]: d for d in rows}

    async def close(self) -> None:
        await self.client.close()


Store = JsonStore | MongoStore


async def open_store(spec: str, db: str = "patent_intel", tls_ca: str | None = None) -> Store:
    """'json:<dir>' or 'mongodb://...' / 'mongodb+srv://...'; `tls_ca` = MONGO_TLS_CA_FILE (see mongo_tls_kwargs)."""
    if spec.startswith(("mongodb://", "mongodb+srv://")):
        return await MongoStore(spec, db, tls_ca).connect()
    return JsonStore(Path(spec.removeprefix("json:")))
