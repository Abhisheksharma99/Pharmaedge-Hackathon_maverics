"""
Corpus crawls: the full history of the sources every asset shares, crawled into
the database as soon as the crawl service is up (service/corpus_worker.py),
then refreshed daily. The per-asset steps match each asset against these
collections instead of crawling the sources again.

  company_pr        company_pr/ spiders but google_news -> COMPANY_PR_CORPUS
                    first: each spider's full history, one at a time; daily: newest articles
  ema_reports       EMA reports: EPAR, post-authorisation, DHPC, referrals, orphan designations -> EMA_CORPUS
                    first and daily: every row (EMA refreshes the reports daily)
  designations      designations/ (FDA expedited-program approvals, from PDFs) -> DESIGNATIONS_CORPUS; once only
  ema_chmp          ema/chmp_highlights.py -> CHMP_CORPUS
                    first: every meeting since 2006; daily: the newest meetings
  conference_ers / conference_ats / conference_chest   conference/ crawlers -> CONFERENCE_CORPUS
                    first: every year, one at a time; daily: the newest year, and years not done yet

Each source has a state document in `corpus_sources` (CORPUS_DB): its status, a
heartbeat while it runs, its progress (spiders / years done) and when its full
crawl completed. A restart resumes where the last run stopped; a source running
in one worker is skipped by the others until its heartbeat goes stale.

    cd crawler && ../.venv/bin/python -m corpus [source or group ...] [--full]
"""

import logging
import os
import threading
from dataclasses import dataclass
from functools import lru_cache
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

log = logging.getLogger("corpus")

CORPUS_DB = os.getenv("CORPUS_DB", "pharmaedge")
REFRESH_EVERY = timedelta(hours=20)  # the daily run; a restart later the same day doesn't crawl again
STALE_AFTER = timedelta(minutes=5)  # a running source whose heartbeat is older than this has died
HEARTBEAT_S = 60

Crawl = Callable[..., Dict[str, Any]]


@dataclass
class Source:
    crawl: Crawl  # crawl(db, *, full, progress, should_stop) -> counts; counts["complete"]=False if units remain
    once: bool = False  # crawled in full one time, never refreshed


def collection(db, spec: str):
    """'db.collection' -> that collection, on the same cluster as `db`."""
    name, coll = spec.split(".", 1)
    return db.client[name][coll]


def _states(db):
    return db.client[CORPUS_DB]["corpus_sources"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def state(db, source: str) -> Dict[str, Any]:
    return _states(db).find_one({"_id": source}) or {}


def complete(db, source: str) -> bool:
    """The source's full crawl has finished once: per-asset steps can rely on its collection."""
    return bool(state(db, source).get("full_done_at"))


def progress_add(db, source: str, field: str, value: Any) -> None:
    _states(db).update_one({"_id": source}, {"$addToSet": {f"progress.{field}": value}})


def progress_set(db, source: str, field: str, value: Any) -> None:
    _states(db).update_one({"_id": source}, {"$set": {f"progress.{field}": value}})


def claim(db, source: str) -> Optional[Dict[str, Any]]:
    """Mark the source running, unless another worker runs it (fresh heartbeat). Returns its state, or None."""
    now = _now()
    try:
        return _states(db).find_one_and_update(
            {"_id": source, "$or": [{"status": {"$ne": "running"}}, {"heartbeat_at": {"$lt": now - STALE_AFTER}}]},
            {"$set": {"status": "running", "started_at": now, "heartbeat_at": now, "error": None}},
            upsert=True, return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:  # the filter missed an existing document: it is running elsewhere
        return None


class _Heartbeat:
    """Refreshes the source's heartbeat from a daemon thread while it runs."""

    def __init__(self, db, source: str) -> None:
        self.db, self.source, self.stop = db, source, threading.Event()
        self.thread = threading.Thread(target=self._beat, daemon=True)

    def _beat(self) -> None:
        while not self.stop.wait(HEARTBEAT_S):
            _states(self.db).update_one({"_id": self.source}, {"$set": {"heartbeat_at": _now()}})

    def __enter__(self) -> "_Heartbeat":
        self.thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.stop.set()


def run_source(db, source: str, *, force_full: bool = False,
               should_stop: Callable[[], bool] = lambda: False) -> Dict[str, Any]:
    """Run one source: its full crawl until that has completed once, then (daily) its incremental crawl."""
    spec = sources()[source]
    current = state(db, source)
    if current.get("full_done_at") and not force_full:
        if spec.once:
            return {"skipped": "crawled once (once-only source)"}
        last = _aware(current.get("last_success_at"))
        if last and _now() - last < REFRESH_EVERY:
            return {"skipped": f"refreshed at {last.isoformat(timespec='minutes')}"}
    claimed = claim(db, source)
    if claimed is None:
        return {"skipped": "running in another worker"}
    full = force_full or not claimed.get("full_done_at")
    log.info("corpus %s: %s crawl", source, "full" if full else "incremental")
    try:
        with _Heartbeat(db, source):
            counts = spec.crawl(db, full=full, progress=claimed.get("progress") or {}, should_stop=should_stop)
    except BaseException as e:  # including the worker stopping it: the next run resumes from the progress
        _states(db).update_one({"_id": source}, {"$set": {
            "status": "failed", "finished_at": _now(), "error": f"{type(e).__name__}: {e}"[:500]}})
        raise
    finished = counts.pop("complete", True) and not should_stop()
    now = _now()
    fields = {"status": "done" if finished else "partial", "finished_at": now,
              "mode": "full" if full else "incremental", "last_counts": counts}
    if finished:
        fields["last_success_at"] = now
        if full:
            fields["full_done_at"] = now
    _states(db).update_one({"_id": source}, {"$set": fields})
    log.info("corpus %s: %s %s", source, fields["status"], counts)
    return {**counts, "status": fields["status"], "mode": fields["mode"]}


@lru_cache(maxsize=1)
def sources() -> Dict[str, Source]:
    """Every source, by name (imported on first use: the crawlers load the team packages)."""
    from . import company_pr, conferences, ema, fda_designations

    return {
        "company_pr": Source(company_pr.crawl),
        "ema_reports": Source(ema.crawl_reports),
        "designations": Source(fda_designations.crawl, once=True),
        "ema_chmp": Source(ema.crawl_chmp),
        **{f"conference_{name}": Source(conferences.crawler(name)) for name in conferences.CONFERENCES},
    }


# Worker jobs: the sources in a group run one after another (the EMA ones share EMA's rate limit), groups in
# parallel.
GROUPS: Dict[str, List[str]] = {
    "ema": ["ema_reports", "ema_chmp"],
    "designations": ["designations"],
    "company_pr": ["company_pr"],
    "conference_ers": ["conference_ers"],
    "conference_ats": ["conference_ats"],
    "conference_chest": ["conference_chest"],
}
