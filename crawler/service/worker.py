"""
Crawl worker: runs queued jobs from Valkey.

    cd crawler && ../.venv/bin/arq service.worker.WorkerSettings
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict

from dotenv import load_dotenv

load_dotenv()

from journey.store import bump_asset_version  # noqa: E402
from storage.mongo_storage import get_db  # noqa: E402

from .api import redis_settings  # noqa: E402
from .jobs import MongoJobStore, fail_interrupted  # noqa: E402
from .pipeline import run_job  # noqa: E402
from .steps import STEPS  # noqa: E402

logging.basicConfig(level=logging.INFO)


def _finished(job: Dict[str, Any]) -> None:
    db, asset_id = get_db(), job["asset"]
    db.assets.update_one({"_id": asset_id}, {"$set": {"last_crawled_at": datetime.now(timezone.utc)}})
    # finalize marks the asset ready; a job that ended without it (cancelled, or finalize failed / not planned)
    # leaves a new asset unusable, so say so instead of showing "onboarding" forever.
    if not any(s["name"] == "finalize" and s["status"] == "done" for s in job["steps"]):
        db.assets.update_one({"_id": asset_id, "status": "onboarding"}, {"$set": {"status": "failed"}})
    bump_asset_version(asset_id)


async def run_job_task(ctx, job_id: str) -> str:
    db = get_db()
    store = MongoJobStore(db)
    return await run_job(store, job_id, STEPS,
                         load_asset=lambda asset_id: db.assets.find_one({"_id": asset_id}),
                         on_finished=lambda asset_id: _finished(store.get(job_id)))


def _recover() -> None:
    db = get_db()
    for asset_id in fail_interrupted(db):
        db.assets.update_one({"_id": asset_id, "status": "onboarding"}, {"$set": {"status": "failed"}})
        bump_asset_version(asset_id)
        logging.warning("job for %s was interrupted by a worker restart; marked failed", asset_id)


async def startup(ctx) -> None:
    await asyncio.to_thread(_recover)


class WorkerSettings:
    functions = [run_job_task]
    on_startup = startup
    redis_settings = redis_settings()
    max_jobs = 2              # headless-browser steps are memory hungry
    job_timeout = 4 * 3600    # a full company-site crawl can take a while
    keep_result = 3600
