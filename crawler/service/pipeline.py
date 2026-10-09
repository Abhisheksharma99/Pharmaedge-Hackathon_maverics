"""
Runs a crawl job's steps in order, recording each step's outcome on the job.

A failed step doesn't sink the job (it ends `completed_with_errors`); a cancel
request is honoured between steps; blocking crawler code runs in a thread so
the worker's event loop stays responsive.
"""

import asyncio
import inspect
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Union

from .jobs import JobStore, now

log = logging.getLogger("crawl.pipeline")

StepResult = Dict[str, Any]
StepFn = Callable[["StepContext"], Union[StepResult, Awaitable[StepResult]]]


@dataclass
class StepContext:
    asset: Dict[str, Any]
    is_cancelled: Callable[[], bool]
    job_type: str = "refresh"  # competitor jobs crawl lighter (fewer PubMed results, fewer news searches)
    extras: Dict[str, Any] = field(default_factory=dict)

    @property
    def asset_id(self) -> str:
        return self.asset["_id"]

    @property
    def names(self) -> List[str]:
        """Names to search sources with: canonical name first, then brands/codes."""
        return [self.asset["name"], *self.asset.get("aliases", [])]


class StepSkipped(Exception):
    """Raised by a step that doesn't apply to this asset (e.g. no site adapter)."""


async def run_job(store: JobStore, job_id: str, steps: Dict[str, StepFn], load_asset: Callable[[str], Dict[str, Any]],
                  on_finished: Callable[[str], Any] = lambda asset_id: None) -> str:
    job = store.get(job_id)
    if not job or job["status"] != "queued":
        return job["status"] if job else "missing"  # cancelled before it started, or a duplicate delivery

    store.update(job_id, {"status": "running", "started_at": now()})
    asset = load_asset(job["asset"])
    ctx = StepContext(asset=asset, job_type=job["type"],
                      is_cancelled=lambda: bool((store.get(job_id) or {}).get("cancel_requested")))
    failed = cancelled = False

    for i, step in enumerate(job["steps"]):
        if ctx.is_cancelled():
            cancelled = True
            for j in range(i, len(job["steps"])):
                store.update_step(job_id, j, {"status": "skipped", "error": "Cancelled"})
            break
        store.update_step(job_id, i, {"status": "running", "started_at": now()})
        fn = steps[step["name"]]
        try:
            result = await fn(ctx) if inspect.iscoroutinefunction(fn) else await asyncio.to_thread(fn, ctx)
            store.update_step(job_id, i, {"status": "done", "counts": result or {}, "finished_at": now()})
        except StepSkipped as e:
            store.update_step(job_id, i, {"status": "skipped", "error": str(e), "finished_at": now()})
        except Exception as e:  # one source failing must not lose the others' data
            log.exception("step %s failed for job %s", step["name"], job_id)
            failed = True
            store.update_step(job_id, i, {"status": "failed", "error": f"{type(e).__name__}: {e}"[:500],
                                          "finished_at": now()})

    status = "cancelled" if cancelled else "completed_with_errors" if failed else "completed"
    store.update(job_id, {"status": status, "finished_at": now()})
    on_finished(job["asset"])
    return status
