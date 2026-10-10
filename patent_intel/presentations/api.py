"""Presentation endpoints, mounted by patent_intel/api.py with ONE include_router line. Own job queue/limits:
heavy work never runs in the request; existing endpoints and their limits are untouched.

POST /v1/presentations/crawls      {"company", "ticker"?, "ir_url"?} -> 202 {job_id}
GET  /v1/presentations/crawls/{id} job status + per-deck summary
GET  /v1/presentations/{presentation_id}            deck metadata
GET  /v1/presentations/{presentation_id}/metrics    extracted metrics with evidence (paginated)

Job lock + crash recovery: one active job per company (unique partial index, MongoDB). A running job refreshes
`heartbeat_at` every HEARTBEAT_S; a job whose heartbeat is older than LEASE_S belongs to a process that died (OOM,
SIGKILL, hard deploy) and is marked failed + unlocked when someone next asks for that company or that job. Jobs of
live processes - this one or another instance on the same database - are never reset.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from ..store import DuplicateError, Store
from .config import presentation_settings
from .pipeline import company_key, process_company
from .storage import PresentationStore

log = logging.getLogger("patent_intel.presentations")
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=150, pattern=r"^[\w][\w .,'()+/&-]*$")]
PRES_ID = r"^pres_[a-f0-9]{24}$"
JOB_ID = r"^[a-f0-9]{32}$"
HEARTBEAT_S, LEASE_S = 30, 120
INSTANCE = uuid.uuid4().hex  # this process, recorded as the job owner (diagnostics)


class PresentationCrawl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    company: Name
    ticker: str | None = Field(None, pattern=r"^[A-Za-z0-9.\-]{1,10}$")
    ir_url: str | None = Field(None, max_length=300, description="company IR 'events & presentations' page (https)")

    @field_validator("ir_url")
    @classmethod
    def _https(cls, v: str | None) -> str | None:
        if v and not v.startswith("https://"):
            raise ValueError("ir_url must be an https:// URL")  # host safety is enforced again on every fetch (SSRF guard)
        return v


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _lease_expired(job: dict[str, Any]) -> bool:
    beat = job.get("heartbeat_at") or job.get("created_at") or ""
    try:
        return datetime.fromisoformat(beat) < datetime.now(UTC) - timedelta(seconds=LEASE_S)
    except ValueError:
        return True


def _public(obj: Any) -> Any:
    """Response view: no server filesystem paths (artifacts are identified by sha256)."""
    if isinstance(obj, dict):
        return {k: _public(v) for k, v in obj.items() if k not in ("path", "image_paths")}
    if isinstance(obj, list):
        return [_public(v) for v in obj]
    return obj


def router(auth: Any, get_store: Callable[[], Store], sec_user_agent: Callable[[], str | None],
           tasks: set[asyncio.Task[None]]) -> APIRouter:
    """`tasks`: the app's background-task set, so the existing shutdown handler cancels and awaits these too."""
    r = APIRouter(prefix="/v1/presentations", dependencies=[auth])
    ps = presentation_settings()
    sem = asyncio.Semaphore(ps.max_concurrent)  # presentation jobs only; patent jobs keep their own semaphore
    active: dict[str, str] = {}
    indexed = False

    async def recover(store: Store, company: str) -> int:
        """Fail + unlock this company's active jobs whose owner stopped heartbeating. Returns how many."""
        rows, _ = await store.find("presentation_jobs", {"company_key": company, "active": True}, 0, 100)
        dead = [j | {"status": "failed", "active": False, "finished_at": _now(), "error": "interrupted (server stopped)"}
                for j in rows if j["job_id"] not in active.values() and _lease_expired(j)]
        await store.upsert("presentation_jobs", dead)
        for j in dead:
            log.warning("presentation job %s recovered: owner %s stopped heartbeating", j["job_id"], j.get("owner"))
        return len(dead)

    async def heartbeat(store: Store, job: dict[str, Any]) -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_S)
            job["heartbeat_at"] = _now()
            try:
                await store.upsert("presentation_jobs", [job])
            except Exception as e:  # DB blip: the next beat retries; LEASE_S allows several misses
                log.warning("presentation job %s heartbeat failed: %s", job["job_id"], type(e).__name__)

    async def run(job: dict[str, Any], req: PresentationCrawl) -> None:
        store = get_store()
        beat = asyncio.create_task(heartbeat(store, job))
        try:
            async with sem:
                job.update(status="running", started_at=_now())
                await store.upsert("presentation_jobs", [job])
                async with asyncio.timeout(ps.job_timeout_s * max(ps.latest_n, 1)):
                    rep = await process_company(store=store, company=req.company, ticker=req.ticker, ir_url=req.ir_url,
                                                sec_user_agent=sec_user_agent())
                job.update(status="done", summary={"discovery": rep["discovery"], "vision": rep["vision"],
                                                   "presentations": [{k: p.get(k) for k in ("presentation_id", "title", "date", "status",
                                                                                            "pages", "metrics", "claims", "error")}
                                                                     for p in rep["presentations"]]})
        except TimeoutError:
            job.update(status="failed", error="timeout")
        except asyncio.CancelledError:
            job.update(status="failed", error="cancelled (server shutdown)")
            raise
        except Exception:
            log.exception("presentation job %s failed", job["job_id"])  # contained: never reaches the main pipeline
            job.update(status="failed", error="internal error - see server logs")
        finally:
            beat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await beat
            job.update(finished_at=_now(), active=False)
            active.pop(job["company_key"], None)
            with contextlib.suppress(Exception):
                await asyncio.shield(store.upsert("presentation_jobs", [job]))

    @r.post("/crawls", status_code=status.HTTP_202_ACCEPTED)
    async def start(req: PresentationCrawl) -> dict[str, Any]:
        nonlocal indexed
        key = company_key(req.company, req.ticker)
        if key in active:
            raise HTTPException(status.HTTP_409_CONFLICT, "a presentation crawl for this company is already in progress")
        if len(active) >= ps.max_queue_size:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "presentation queue is full, retry later")
        store = get_store()
        if not indexed:  # the one-active-job index must exist before the first insert, not after the first job ran
            await PresentationStore(store).ensure_indexes()
            indexed = True
        jid = uuid.uuid4().hex
        now = _now()
        job = {"_id": jid, "job_id": jid, "status": "queued", "created_at": now, "heartbeat_at": now, "owner": INSTANCE,
               "company_key": key, "active": True, "request": req.model_dump(exclude_none=True)}
        active[key] = jid
        try:
            try:
                await store.insert("presentation_jobs", job)
            except DuplicateError:
                if not await recover(store, key):  # held by a live job (here or another instance): a real conflict
                    raise
                await store.insert("presentation_jobs", job)  # the holder had died; its lock is released now
        except DuplicateError:
            active.pop(key, None)
            raise HTTPException(status.HTTP_409_CONFLICT, "a presentation crawl for this company is already in progress") from None
        except Exception:
            active.pop(key, None)
            raise
        t = asyncio.create_task(run(job, req))
        tasks.add(t)
        t.add_done_callback(tasks.discard)
        return {k: job[k] for k in ("job_id", "status", "company_key")}

    @r.get("/crawls/{job_id}")
    async def job_status(job_id: Annotated[str, Path(pattern=JOB_ID)]) -> dict[str, Any]:
        store = get_store()
        job = await store.get("presentation_jobs", job_id)
        if not job:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
        if job.get("active") and job_id not in active.values() and _lease_expired(job):
            await recover(store, job["company_key"])  # never reports a dead job as running forever
            job = await store.get("presentation_jobs", job_id) or job
        return {k: v for k, v in job.items() if k != "_id"}

    @r.get("/{presentation_id}")
    async def deck(presentation_id: Annotated[str, Path(pattern=PRES_ID)]) -> dict[str, Any]:
        doc = await get_store().get("presentations", presentation_id)
        if not doc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "presentation not found")
        return _public({k: v for k, v in doc.items() if k not in ("_id", "slide_artifacts")})

    @r.get("/{presentation_id}/metrics")
    async def metrics(presentation_id: Annotated[str, Path(pattern=PRES_ID)],
                      skip: Annotated[int, Query(ge=0, le=100_000)] = 0,
                      limit: Annotated[int, Query(ge=1, le=200)] = 100) -> dict[str, Any]:
        items, total = await get_store().find("presentation_metrics", {"presentation_id": presentation_id, "stale": False},
                                              skip, limit, sort="page")
        return {"presentation_id": presentation_id, "total": total, "skip": skip, "limit": limit, "items": items}

    return r
