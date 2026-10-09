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
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union

from .jobs import JobStore, now

log = logging.getLogger("crawl.pipeline")

StepResult = Dict[str, Any]
StepFn = Callable[["StepContext"], Union[StepResult, Awaitable[StepResult]]]


def _no_log(kind: str, text: str, **extra: Any) -> None:
    """Default step logger: tests and direct calls run without a live-build feed."""


@dataclass
class StepContext:
    asset: Dict[str, Any]
    is_cancelled: Callable[[], bool]
    job_type: str = "refresh"  # competitor jobs crawl lighter (fewer PubMed results, fewer news searches)
    extras: Dict[str, Any] = field(default_factory=dict)
    # Live-build log line for the job feed: ctx.log("info" | "done" | "warn" | "ai" | "event", text, **extra)
    log: Callable[..., None] = field(default=_no_log)

    @property
    def asset_id(self) -> str:
        return self.asset["_id"]

    @property
    def names(self) -> List[str]:
        """Names to search sources with: canonical name first, then brands/codes."""
        return [self.asset["name"], *self.asset.get("aliases", [])]


class StepSkipped(Exception):
    """Raised by a step that doesn't apply to this asset (e.g. no site adapter)."""


def _summarise(counts: Dict[str, Any]) -> str:
    parts = [f"{k.replace('_', ' ')} {v}" for k, v in counts.items() if isinstance(v, (int, float))]
    return " · ".join(parts[:4]) or "Done"


def _safe(fn: Callable[[], Any], what: str, job_id: str) -> Any:
    """The live log and progress counters are best effort: a failure there never fails a crawl."""
    try:
        return fn()
    except Exception:  # noqa: BLE001
        log.warning("%s failed for job %s", what, job_id, exc_info=True)
        return None


async def run_job(store: JobStore, job_id: str, steps: Dict[str, StepFn], load_asset: Callable[[str], Dict[str, Any]],
                  on_finished: Callable[[str], Any] = lambda asset_id: None,
                  measure: Optional[Callable[[str], Dict[str, Any]]] = None) -> str:
    job = store.get(job_id)
    if not job or job["status"] != "queued":
        return job["status"] if job else "missing"  # cancelled before it started, or a duplicate delivery

    store.update(job_id, {"status": "running", "started_at": now()})
    asset = load_asset(job["asset"])
    ctx = StepContext(asset=asset, job_type=job["type"],
                      is_cancelled=lambda: bool((store.get(job_id) or {}).get("cancel_requested")))

    def emit(step: str, kind: str, text: str, **extra: Any) -> None:
        _safe(lambda: store.feed(job_id, {"step": step, "kind": kind, "text": text, **extra}), "feed", job_id)

    def progress(events_at_start: int) -> None:
        if not measure:
            return
        m = _safe(lambda: measure(job["asset"]), "measure", job_id)
        if m:
            _safe(lambda: store.update(job_id, {"records_by_coll": m["records_by_coll"], "record_years": m["record_years"],
                                               "events_created": max(0, m["events"] - events_at_start)}),
                  "progress write", job_id)

    baseline = _safe(lambda: measure(job["asset"]), "measure", job_id) if measure else None
    events_at_start = (baseline or {}).get("events", 0)
    emit("plan", "info", f"Planning {job['type']} for {asset['name']} · {len(job['steps'])} steps")
    failed = cancelled = False

    for i, step in enumerate(job["steps"]):
        name = step["name"]
        if ctx.is_cancelled():
            cancelled = True
            for j in range(i, len(job["steps"])):
                store.update_step(job_id, j, {"status": "skipped", "error": "Cancelled"})
            emit(name, "warn", "Cancelled")
            break
        ctx.log = lambda kind, text, _step=name, **extra: emit(_step, kind, text, **extra)
        store.update_step(job_id, i, {"status": "running", "started_at": now()})
        emit(name, "info", step.get("label") or name)
        fn = steps[name]
        try:
            result = await fn(ctx) if inspect.iscoroutinefunction(fn) else await asyncio.to_thread(fn, ctx)
            counts = dict(result or {})
            summary = counts.pop("summary", None)
            store.update_step(job_id, i, {"status": "done", "counts": counts, "finished_at": now()})
            emit(name, "done", summary or _summarise(counts))
        except StepSkipped as e:
            store.update_step(job_id, i, {"status": "skipped", "error": str(e), "finished_at": now()})
            emit(name, "warn", f"Skipped: {e}")
        except Exception as e:  # one source failing must not lose the others' data
            log.exception("step %s failed for job %s", name, job_id)
            failed = True
            error = f"{type(e).__name__}: {e}"[:500]
            store.update_step(job_id, i, {"status": "failed", "error": error, "finished_at": now()})
            emit(name, "warn", f"Failed: {error}"[:300])
        progress(events_at_start)

    status = "cancelled" if cancelled else "completed_with_errors" if failed else "completed"
    store.update(job_id, {"status": status, "finished_at": now()})
    on_finished(job["asset"])
    return status
