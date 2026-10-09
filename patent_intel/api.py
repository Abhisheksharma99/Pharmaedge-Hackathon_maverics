"""HTTP API for the frontend.  Run: uvicorn patent_intel.api:app --host 127.0.0.1 --port 8000

POST /v1/crawls                     start a crawl job (202) -> poll GET /v1/crawls/{job_id}
GET  /v1/crawls/{job_id}            job status + coverage summary
GET  /v1/drugs/{drug_id}            drug profile (Adis or name-based)
GET  /v1/drugs/{drug_id}/patents    included (or uncertain) patents, paginated
GET  /healthz                       liveness (no auth)

Security: X-API-Key (constant-time compare, refuses to start without keys), CORS allow-list, strict input
validation (extra fields forbidden), body-size cap, capped crawl budgets, bounded concurrency + queue,
exact-match DB reads only, generic error messages to clients, no-store/nosniff headers, docs off by default.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, UTC
from typing import Annotated, Any, Literal
from collections.abc import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from .adis import adis_id
from .config import settings
from .net import Cache, Http
from .pipeline import drug_id_for, run_drug
from .store import DuplicateError, Store, open_store

log = logging.getLogger("patent_intel.api")

NAME = r"^[\w][\w .,'()+/&-]*$"  # letters/digits (any script) + common company punctuation; no quotes/operators
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=150, pattern=NAME)]
JOB_ID = r"^[a-f0-9]{32}$"
DRUG_ID = r"^(\d{9}|name:[a-z0-9-]{1,80})$"
MAX_BODY = 8 * 1024


# ---------------------------------------------------------------- schemas

class CrawlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adis: str | None = Field(None, max_length=120, description="AdisInsight drug id or URL (preferred: developers come from Adis)")
    drug_name: Name | None = Field(None, description="drug name, used when no Adis id is given")
    companies: list[Name] | None = Field(None, max_length=10, description="optional: override the looked-up company")
    all_developers: bool = False
    max_pages: int | None = Field(None, ge=10, description="page budget; capped by server MAX_PAGES")
    regulatory: bool = Field(True, description="also build the PDUFA/approval timeline (SEC EDGAR + openFDA)")
    fda_calendar: bool = Field(True, description="also match the FDA Tracker PDUFA/AdCom calendar to this drug")

    @field_validator("adis")
    @classmethod
    def _adis(cls, v: str | None) -> str | None:
        return adis_id(v) if v else None  # raises ValueError -> 422

    @model_validator(mode="after")
    def _need_input(self) -> CrawlRequest:
        if not self.adis and not self.drug_name:
            raise ValueError("give `drug_name` (company is looked up) or `adis`")
        return self

    def drug_key(self) -> str:
        base = self.adis or drug_id_for(self.drug_name or "")
        return base + "|" + "|".join(sorted(c.lower() for c in self.companies or [])) + f"|all={self.all_developers}"


class Job(BaseModel):
    job_id: str
    status: Literal["queued", "running", "done", "failed"]
    drug_id: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    request: dict[str, Any]
    summary: dict[str, Any] | None = None
    error: str | None = None


class PatentPage(BaseModel):
    drug_id: str
    decision: str
    total: int
    skip: int
    limit: int
    items: list[dict[str, Any]]


# ---------------------------------------------------------------- app state / lifecycle

class State:
    def __init__(self) -> None:
        self.store: Store
        self.http: Http
        self.sem: asyncio.Semaphore
        self.active: dict[str, str] = {}  # drug_key -> job_id (fast path; the DB unique index is the real guard)
        self.tasks: set[asyncio.Task[None]] = set()  # strong refs so jobs aren't garbage-collected mid-run


S = State()


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    cfg = settings()
    if not cfg.api_keys:
        raise RuntimeError("API_KEYS is empty - refusing to start an unauthenticated API")
    S.store = await open_store(cfg.store_spec(), cfg.mongo_db, cfg.mongo_tls_ca_file)
    S.http = Http(Cache(cfg.data_dir / ".cache"))
    S.sem = asyncio.Semaphore(cfg.max_concurrent_jobs)
    try:
        for st in ("queued", "running"):  # jobs lost by a restart are marked (and unlocked), not left hanging
            lost, _ = await S.store.find("crawl_jobs", {"status": st}, 0, 1000)
            await S.store.upsert("crawl_jobs", [{**j, "status": "failed", "active": False, "finished_at": _now(),
                                                 "error": "interrupted by server restart"} for j in lost])
        yield
    finally:
        for t in list(S.tasks):
            t.cancel()
        await asyncio.gather(*S.tasks, return_exceptions=True)  # let cancelled jobs finish their cleanup
        await S.http.aclose()
        await S.store.close()


cfg0 = settings()
app = FastAPI(title="Patent Intel API", version="1.0", lifespan=lifespan,
              docs_url="/docs" if cfg0.enable_docs else None, redoc_url=None,
              openapi_url="/openapi.json" if cfg0.enable_docs else None)
app.add_middleware(CORSMiddleware, allow_origins=cfg0.cors_origins, allow_methods=["GET", "POST"],
                   allow_headers=["X-API-Key", "Content-Type"], allow_credentials=False, max_age=600)


class _TooLarge(Exception):
    pass


class BodyLimit:
    """Pure-ASGI byte counter: caps chunked bodies too (Content-Length alone can be omitted), and runs
    before FastAPI buffers the body - i.e. before auth - so oversized uploads can't exhaust memory."""

    def __init__(self, app: Any, limit: int) -> None:
        self.app, self.limit = app, limit

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        seen, started, rejected = 0, False, False

        async def reject() -> None:
            nonlocal started, rejected
            rejected = True
            if not started:
                started = True
                await JSONResponse({"detail": "request body too large"}, status_code=413)(scope, receive, send)

        async def counted_receive() -> Any:
            nonlocal seen
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > self.limit:
                    await reject()  # answer now; the app's own error handling must not turn this into a 400
                    raise _TooLarge
            return msg

        async def tracked_send(msg: Any) -> None:
            nonlocal started
            if rejected:
                return  # 413 already sent
            started |= msg["type"] == "http.response.start"
            await send(msg)

        try:
            declared = int(dict(scope.get("headers") or []).get(b"content-length", b"0") or 0)
        except ValueError:  # malformed Content-Length
            return await reject()
        if declared > self.limit:
            return await reject()
        with contextlib.suppress(_TooLarge):  # 413 already sent by reject()
            await self.app(scope, counted_receive, tracked_send)


app.add_middleware(BodyLimit, limit=MAX_BODY)  # added last -> outermost


@app.middleware("http")
async def harden(request: Request, call_next: Any) -> Response:
    resp: Response = await call_next(request)
    resp.headers.update({"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
                         "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer"})
    return resp


_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def require_key(key: Annotated[str | None, Security(_key_header)]) -> None:
    ok = False
    for k in settings().api_keys:  # check every key: timing does not reveal which/whether one matched early
        ok |= hmac.compare_digest((key or "").encode(), k.get_secret_value().encode())
    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or missing API key")


Auth = Depends(require_key)


# ---------------------------------------------------------------- job runner

async def _run_job(job: dict[str, Any], req: CrawlRequest) -> None:
    key, cfg = req.drug_key(), settings()
    try:
        async with S.sem:
            job.update(status="running", started_at=_now())
            await S.store.upsert("crawl_jobs", [job])
            async with asyncio.timeout(cfg.job_timeout_s):  # a stuck source can never hold a slot forever
                run = await run_drug(http=S.http, store=S.store, adis_ref=req.adis, drug_name=req.drug_name,
                                     companies=req.companies, all_developers=req.all_developers,
                                     max_pages=min(req.max_pages or cfg.max_pages, cfg.max_pages),
                                     probe_budget=cfg.probe_pages, regulatory=req.regulatory,
                                     fda_calendar=req.fda_calendar)
            cov = run["coverage"]
            job.update(status="done", drug_id=run["drug_id"], summary={
                k: cov[k] for k in ("included", "uncertain", "rejected", "families", "offices", "legal_status",
                                    "pages_fetched", "budget_exhausted", "pubchem_linked_publications")
            } | {"family_members_not_fetched": len(cov["family_members_not_fetched"]), "companies": run["companies"],
                 "regulatory": run.get("regulatory"), "fda_calendar": run.get("fda_calendar")})
    except TimeoutError:
        job.update(status="failed", error=f"timed out after {cfg.job_timeout_s}s")
    except ValueError as e:  # input-level problems (bad Adis page, missing company) are safe to show
        job.update(status="failed", error=str(e)[:300])
    except asyncio.CancelledError:
        job.update(status="failed", error="cancelled (server shutdown)")
        raise
    except Exception:
        log.exception("job %s failed", job["job_id"])  # details stay in server logs
        job.update(status="failed", error="internal error - see server logs")
    finally:
        job.update(finished_at=_now(), active=False)  # releases the DB-level per-drug lock
        S.active.pop(key, None)
        with contextlib.suppress(Exception):  # DB down at this point: the restart recovery will fix the job doc
            await asyncio.shield(S.store.upsert("crawl_jobs", [job]))


# ---------------------------------------------------------------- routes

@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/v1/crawls", status_code=status.HTTP_202_ACCEPTED, response_model=Job, dependencies=[Auth])
async def start_crawl(req: CrawlRequest) -> Job:
    key = req.drug_key()
    if key in S.active:
        raise HTTPException(status.HTTP_409_CONFLICT, f"a crawl for this drug is already in progress: job {S.active[key]}")
    if len(S.active) >= settings().max_queued_jobs:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "crawl queue is full, retry later")
    job = {"_id": uuid.uuid4().hex, "status": "queued", "created_at": _now(), "drug_key": key, "active": True,
           "request": req.model_dump(exclude_none=True)}
    job["job_id"] = job["_id"]
    S.active[key] = job["_id"]
    try:
        await S.store.insert("crawl_jobs", job)  # unique partial index: one active job per drug, across processes
    except DuplicateError:
        S.active.pop(key, None)
        raise HTTPException(status.HTTP_409_CONFLICT, "a crawl for this drug is already in progress") from None
    except Exception:  # never leave the drug locked (409 until restart) when the DB write fails
        S.active.pop(key, None)
        raise
    t = asyncio.create_task(_run_job(job, req))
    S.tasks.add(t)
    t.add_done_callback(S.tasks.discard)
    return Job(**job)


@app.get("/v1/crawls/{job_id}", response_model=Job, dependencies=[Auth])
async def get_crawl(job_id: Annotated[str, Path(pattern=JOB_ID)]) -> Job:
    job = await S.store.get("crawl_jobs", job_id)
    if not job:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
    return Job(**job)


@app.get("/v1/drugs/{drug_id}", dependencies=[Auth])
async def get_drug(drug_id: Annotated[str, Path(pattern=DRUG_ID)]) -> dict[str, Any]:
    drug = await S.store.get("drugs", drug_id)
    if not drug:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "drug not crawled yet")
    return drug


@app.get("/v1/drugs/{drug_id}/patents", response_model=PatentPage, dependencies=[Auth])
async def list_patents(drug_id: Annotated[str, Path(pattern=DRUG_ID)],
                       decision: Literal["include", "uncertain"] = "include",
                       stale: bool = False,
                       skip: Annotated[int, Query(ge=0, le=100_000)] = 0,
                       limit: Annotated[int, Query(ge=1, le=200)] = 50) -> PatentPage:
    """`stale=true` lists links found by earlier runs but not confirmed by the latest one."""
    where = {"drug_id": drug_id, "decision": decision, "stale": stale}
    links, total = await S.store.find("drug_patents", where, skip, limit)
    pats = await S.store.get_many("patents", [lk["patent_id"] for lk in links if lk.get("patent_id")])
    items = [{"match": lk["match"], **(pats.get(lk["patent_id"]) or lk.get("row") or {})} for lk in links]
    return PatentPage(drug_id=drug_id, decision=decision, total=total, skip=skip, limit=limit, items=items)


class EventPage(BaseModel):
    drug_id: str
    total: int
    skip: int
    limit: int
    items: list[dict[str, Any]]


EventType = Literal["pdufa_date", "complete_response_letter", "approval", "tentative_approval"]


@app.get("/v1/drugs/{drug_id}/regulatory", response_model=EventPage, dependencies=[Auth])
async def list_regulatory(drug_id: Annotated[str, Path(pattern=DRUG_ID)],
                          type: EventType | None = None,  # public query parameter name (shadows builtin by design)
                          category: Literal["original", "efficacy", "labeling", "manufacturing", "major", "other"] | None = None,
                          stale: bool = False,
                          skip: Annotated[int, Query(ge=0, le=100_000)] = 0,
                          limit: Annotated[int, Query(ge=1, le=200)] = 100) -> EventPage:
    """Regulatory timeline sorted by date: PDUFA target dates and CRLs (SEC filings, with the source sentence)
    and FDA submissions/approvals (openFDA)."""
    where: dict[str, Any] = ({"drug_id": drug_id, "stale": stale} | ({"type": type} if type else {})
                             | ({"category": category} if category else {}))
    items, total = await S.store.find("regulatory_events", where, skip, limit, sort="date")
    return EventPage(drug_id=drug_id, total=total, skip=skip, limit=limit, items=items)


@app.get("/v1/drugs/{drug_id}/fda-calendar", response_model=EventPage, dependencies=[Auth])
async def list_fda_calendar(drug_id: Annotated[str, Path(pattern=DRUG_ID)],
                            status: Literal["matched", "unresolved"] = "matched",
                            stale: bool = False,
                            skip: Annotated[int, Query(ge=0, le=100_000)] = 0,
                            limit: Annotated[int, Query(ge=1, le=200)] = 100) -> EventPage:
    """FDA Tracker calendar events (PDUFA dates, advisory committees) identified as this drug, with evidence."""
    items, total = await S.store.find("fda_calendar_events", {"drug_id": drug_id, "status": status, "stale": stale},
                                      skip, limit, sort="date")
    return EventPage(drug_id=drug_id, total=total, skip=skip, limit=limit, items=items)


def _main() -> None:  # python -m patent_intel.api  (binds localhost by default; put a TLS proxy in front)
    import uvicorn

    uvicorn.run("patent_intel.api:app", host="127.0.0.1", port=8000, proxy_headers=False)


if __name__ == "__main__":
    _main()
