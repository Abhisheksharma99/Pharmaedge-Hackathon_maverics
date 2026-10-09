"""
Crawl worker: runs queued jobs from Valkey.

    cd crawler && ../.venv/bin/arq service.worker.WorkerSettings
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv()

from journey.store import bump_asset_version  # noqa: E402
from storage.mongo_storage import get_db  # noqa: E402

from . import notify  # noqa: E402
from .api import redis_settings  # noqa: E402
from .jobs import MongoJobStore  # noqa: E402
from .pipeline import run_job  # noqa: E402
from .progress import measure  # noqa: E402
from .steps import STEPS  # noqa: E402

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("crawl.worker")
RECENT_DAYS = 90


def _high_ids(db, asset_id: str) -> set:
    return {e["_id"] for e in db.journey_events.find({"asset": asset_id, "significance": "High"}, {"_id": 1})}


def _new_high(db, job: Dict[str, Any], high_before: set) -> list:
    """New High events worth a notification: key events that are recent (or upcoming milestones), one per title.
    Old events that merely moved between assets on a refresh (shared trials) are not news."""
    created = job.get("created_at")
    if isinstance(created, datetime):
        cutoff = (created - timedelta(days=RECENT_DAYS)).date().isoformat()
    else:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)).date().isoformat()
    out, titles = [], set()
    for e in db.journey_events.find({"asset": job["asset"], "significance": "High"},
                                    {"title": 1, "key": 1, "date": 1, "is_milestone": 1}):
        title = e.get("title") or e["_id"]
        if (e["_id"] in high_before or not e.get("key") or title in titles
                or not (e.get("is_milestone") or (e.get("date") or "") >= cutoff)):
            continue
        titles.add(title)
        out.append({"_id": e["_id"], "title": title})
    return out


def _finished(job: Dict[str, Any], high_before: Optional[set] = None) -> None:
    db, asset_id = get_db(), job["asset"]
    db.assets.update_one({"_id": asset_id}, {"$set": {"last_crawled_at": datetime.now(timezone.utc)}})
    # finalize marks the asset ready; a job that ended without it (cancelled, or finalize failed / not planned)
    # leaves a new asset unusable, so say so instead of showing "onboarding" forever.
    if not any(s["name"] == "finalize" and s["status"] == "done" for s in job["steps"]):
        db.assets.update_one({"_id": asset_id, "status": "onboarding"}, {"$set": {"status": "failed"}})
    # bump first: a client that refetches on the terminal status (or on a notification) must read fresh data
    if not bump_asset_version(asset_id):
        log.warning("cache version bump failed for %s; cached views stay stale until the TTL", asset_id)
    try:
        asset = db.assets.find_one({"_id": asset_id}) or {"_id": asset_id}
        new_high = _new_high(db, job, high_before) if high_before is not None else []
        notify.job_ended(db, job, asset, new_high)
    except Exception:  # noqa: BLE001 - notifications are best effort
        log.warning("notifications failed for job %s", job.get("_id"), exc_info=True)


async def run_job_task(ctx, job_id: str) -> str:
    db = get_db()
    store = MongoJobStore(db)
    job = store.get(job_id)
    high_before = _high_ids(db, job["asset"]) if job else set()
    return await run_job(store, job_id, STEPS,
                         load_asset=lambda asset_id: db.assets.find_one({"_id": asset_id}),
                         on_finished=lambda asset_id: _finished(store.get(job_id), high_before),
                         measure=lambda asset_id: measure(db, asset_id))


class WorkerSettings:
    functions = [run_job_task]
    redis_settings = redis_settings()
    max_jobs = 2              # headless-browser steps are memory hungry
    job_timeout = 4 * 3600    # a full company-site crawl can take a while
    keep_result = 3600
