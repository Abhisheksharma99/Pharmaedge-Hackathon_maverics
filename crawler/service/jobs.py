"""
Crawl jobs: one document per onboard / refresh / competitor run in the `jobs` collection.
The NestJS API reads these to show progress (spec §3.1, §5.4).
"""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol

ACTIVE = ("queued", "running")


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_job(asset_id: str, job_type: str, steps: List[Dict[str, str]], requested_by: Optional[Dict[str, str]]) -> Dict[str, Any]:
    return {
        "_id": str(uuid.uuid4()),
        "asset": asset_id,
        "type": job_type,
        "status": "queued",
        "steps": [{**s, "status": "pending", "counts": {}, "error": None, "started_at": None, "finished_at": None}
                  for s in steps],
        "cancel_requested": False,
        "requested_by": requested_by,
        "created_at": now(),
        "started_at": None,
        "finished_at": None,
    }


class JobAlreadyRunning(Exception):
    def __init__(self, job_id: str):
        super().__init__(f"Job {job_id} is already running for this asset")
        self.job_id = job_id


async def start_job(db, queue, asset_id: str, job_type: str, steps: List[Dict[str, str]],
                    requested_by: Optional[Dict[str, str]]) -> Dict[str, Any]:
    """Record a job and enqueue it. One active job per asset: raises JobAlreadyRunning otherwise."""
    active = db.jobs.find_one({"asset": asset_id, "status": {"$in": list(ACTIVE)}}, {"_id": 1})
    if active:
        raise JobAlreadyRunning(active["_id"])
    job = new_job(asset_id, job_type, steps, requested_by)
    db.jobs.insert_one(job)
    db.jobs.create_index([("asset", 1), ("created_at", -1)])
    # _job_id = our id, so a retried enqueue can't run the same job twice
    await queue.enqueue_job("run_job_task", job["_id"], _job_id=job["_id"])
    return job


class JobStore(Protocol):
    def get(self, job_id: str) -> Optional[Dict[str, Any]]: ...
    def update(self, job_id: str, fields: Dict[str, Any]) -> None: ...
    def update_step(self, job_id: str, index: int, fields: Dict[str, Any]) -> None: ...


class MongoJobStore:
    def __init__(self, db):
        self.jobs = db.jobs

    def get(self, job_id):
        return self.jobs.find_one({"_id": job_id})

    def update(self, job_id, fields):
        self.jobs.update_one({"_id": job_id}, {"$set": fields})

    def update_step(self, job_id, index, fields):
        self.jobs.update_one({"_id": job_id}, {"$set": {f"steps.{index}.{k}": v for k, v in fields.items()}})


class MemoryJobStore:
    """In-process store for tests."""

    def __init__(self, *jobs: Dict[str, Any]):
        self.jobs = {j["_id"]: j for j in jobs}

    def get(self, job_id):
        return self.jobs.get(job_id)

    def update(self, job_id, fields):
        self.jobs[job_id].update(fields)

    def update_step(self, job_id, index, fields):
        self.jobs[job_id]["steps"][index].update(fields)
