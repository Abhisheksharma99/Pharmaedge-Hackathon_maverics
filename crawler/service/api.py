"""
Internal crawl API, called only by the NestJS API (shared service key).

    cd crawler && ../.venv/bin/uvicorn service.api:app --port 8100
"""

import hmac
import os
from contextlib import asynccontextmanager
from typing import Annotated, Dict, List, Literal, Optional

from arq import create_pool
from arq.connections import RedisSettings
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, StringConstraints

load_dotenv()

from onboarding.resolve import resolve  # noqa: E402
from storage.mongo_storage import get_db  # noqa: E402

from .jobs import JobAlreadyRunning, start_job  # noqa: E402
from .steps import PLANS  # noqa: E402


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(os.getenv("VALKEY_URL", "redis://localhost:6380"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.queue = await create_pool(redis_settings())
    yield
    await app.state.queue.aclose()


app = FastAPI(title="Asset journey crawl service", lifespan=lifespan, docs_url=None, redoc_url=None)


def require_service_key(x_service_key: str = Header(default="")) -> None:
    expected = os.getenv("CRAWLER_SERVICE_KEY", "")
    if not expected or not hmac.compare_digest(x_service_key, expected):
        raise HTTPException(401, {"code": "UNAUTHENTICATED", "message": "Invalid service key"})


class JobRequest(BaseModel):
    asset_id: str
    type: Literal["refresh", "onboard", "competitor"] = "refresh"
    # Run only these steps of the plan (default: every crawler). Plan order is kept.
    steps: Optional[List[str]] = None
    requested_by: Optional[Dict[str, str]] = None


def plan_for(job_type: str, steps: Optional[List[str]]) -> List[Dict[str, str]]:
    """The job type's plan, or only the requested steps of it (in plan order)."""
    plan = PLANS[job_type]
    if steps is None:
        return plan
    unknown = sorted(set(steps) - {s["name"] for s in plan})
    if unknown or not steps:
        available = ", ".join(s["name"] for s in plan)
        problem = f"Unknown steps: {', '.join(unknown)}" if unknown else "Give at least one step"
        raise HTTPException(400, {"code": "UNKNOWN_STEP", "message": f"{problem}. Available: {available}"})
    return [s for s in plan if s["name"] in steps]


def public(job: Dict) -> Dict:
    return {"id": job["_id"], **{k: v for k, v in job.items() if k != "_id"}}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sources", dependencies=[Depends(require_service_key)])
def sources():
    """The steps each job type runs, in order (crawlers first, then journey building)."""
    return PLANS


class ResolveRequest(BaseModel):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


@app.post("/resolve", dependencies=[Depends(require_service_key)])
def resolve_asset(req: ResolveRequest):
    """Identity card for a typed drug name (spec §5.2). Sync: FastAPI runs it in a worker thread."""
    identity = resolve(req.query)
    if identity is None:
        raise HTTPException(404, {"code": "ASSET_NOT_RESOLVED",
                                  "message": f'Could not identify a drug called "{req.query}"'})
    return identity


@app.post("/jobs", status_code=201, dependencies=[Depends(require_service_key)])
async def create_job(req: JobRequest):
    db = get_db()
    if not db.assets.count_documents({"_id": req.asset_id}, limit=1):
        raise HTTPException(404, {"code": "ASSET_NOT_FOUND", "message": f'No asset "{req.asset_id}"'})
    try:
        job = await start_job(db, app.state.queue, req.asset_id, req.type, plan_for(req.type, req.steps),
                              req.requested_by)
    except JobAlreadyRunning as e:
        raise HTTPException(409, {"code": "JOB_ALREADY_RUNNING", "message": "A crawl is already running for this asset",
                                  "job_id": e.job_id})
    return public(job)


@app.post("/jobs/{job_id}/cancel", dependencies=[Depends(require_service_key)])
def cancel_job(job_id: str):
    db = get_db()
    job = db.jobs.find_one({"_id": job_id})
    if not job:
        raise HTTPException(404, {"code": "JOB_NOT_FOUND", "message": "Job not found"})
    if job["status"] == "queued":
        # Not started: cancel outright (the worker skips jobs that aren't queued).
        db.jobs.update_one({"_id": job_id, "status": "queued"}, {"$set": {"status": "cancelled", "cancel_requested": True}})
    elif job["status"] == "running":
        db.jobs.update_one({"_id": job_id}, {"$set": {"cancel_requested": True}})
    return public(db.jobs.find_one({"_id": job_id}))
