"""Tier-1 storage (queryable intelligence) on the EXISTING Store (same MongoDB config/client, bounded concurrency).

Collections: presentations, presentation_pages, presentation_metrics, presentation_claims, presentation_jobs.
Large payloads (full text segments, all table rows, raw model output) live in zstd artifacts, not here.
Indexes are created here (only for MongoStore), so patent_intel/store.py stays untouched.
"""

from __future__ import annotations

import asyncio
from typing import Any

from ..store import MongoStore, Store

WRITE_CONCURRENCY = 2  # never flood the shared MongoDB pool
INDEXES: dict[str, list[tuple[list[str], dict[str, Any]]]] = {
    "presentations": [(["company_id", "date"], {}), (["source_url"], {})],
    "presentation_pages": [(["presentation_id", "page"], {})],
    "presentation_metrics": [(["presentation_id", "stale", "page"], {}), (["presentation_id", "metric"], {}),
                             (["company_id", "metric"], {}), (["trial", "metric"], {})],
    "presentation_claims": [(["presentation_id", "page"], {}), (["company_id", "category"], {})],
    "presentation_jobs": [(["company_key"], {"unique": True, "partialFilterExpression": {"active": True},
                                             "name": "one_active_presentation_job_per_company"})],
}


class PresentationStore:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.sem = asyncio.Semaphore(WRITE_CONCURRENCY)
        self._indexed = False

    async def ensure_indexes(self) -> None:
        if self._indexed or not isinstance(self.store, MongoStore):
            self._indexed = True
            return
        from pymongo import ASCENDING

        for coll, idxs in INDEXES.items():
            for keys, opts in idxs:
                await self.store.db[coll].create_index([(k, ASCENDING) for k in keys], **opts)
        self._indexed = True

    async def upsert(self, collection: str, docs: list[dict[str, Any]], batch: int = 200) -> None:
        for i in range(0, len(docs), batch):  # bounded bulk writes, never one giant array
            async with self.sem:
                await self.store.upsert(collection, docs[i: i + batch])

    async def known_url(self, url: str) -> dict[str, Any] | None:
        """The current version stored for this URL (a replaced file leaves a `superseded_by` older version behind)."""
        async with self.sem:
            rows, _ = await self.store.find("presentations", {"source_url": url}, 0, 50)
        live = [r for r in rows if not r.get("superseded_by")]
        return max(live, key=lambda r: str(r.get("last_seen", ""))) if live else None

    async def get_many(self, collection: str, ids: list[str]) -> dict[str, dict[str, Any]]:
        async with self.sem:
            return await self.store.get_many(collection, ids)

    async def current(self, collection: str, presentation_id: str) -> list[dict[str, Any]]:
        """Non-stale facts of one presentation (bounded by max_pages x facts per slide)."""
        async with self.sem:
            rows, _ = await self.store.find(collection, {"presentation_id": presentation_id, "stale": False}, 0, 100_000)
        return rows

    async def mark_stale(self, collection: str, presentation_id: str, keep: set[str]) -> int:
        async with self.sem:
            return await self.store.mark_stale(collection, {"presentation_id": presentation_id}, keep)
