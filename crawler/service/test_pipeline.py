"""Pipeline tests (offline). Run: cd crawler && ../.venv/bin/python -m pytest service -q"""

import asyncio

from service.jobs import MemoryJobStore, new_job
from service.pipeline import StepSkipped, run_job

ASSET = {"_id": "trep", "name": "Treprostinil", "aliases": ["Tyvaso"]}
PLAN = [{"name": n, "label": n} for n in ("a", "b", "c")]


def run(store, job_id, steps, finished=None):
    return asyncio.run(run_job(store, job_id, steps, load_asset=lambda _: ASSET,
                               on_finished=(finished.append if finished is not None else lambda _: None)))


def test_runs_steps_in_order_and_records_counts():
    job = new_job("trep", "refresh", PLAN, None)
    store, order, finished = MemoryJobStore(job), [], []

    def step(name):
        def fn(ctx):
            order.append((name, ctx.names))
            return {"records": len(order)}
        return fn

    status = run(store, job["_id"], {n: step(n) for n in "abc"}, finished)
    assert status == "completed"
    assert [o[0] for o in order] == ["a", "b", "c"]
    assert order[0][1] == ["Treprostinil", "Tyvaso"]
    assert [s["status"] for s in store.get(job["_id"])["steps"]] == ["done", "done", "done"]
    assert store.get(job["_id"])["steps"][2]["counts"] == {"records": 3}
    assert finished == ["trep"]  # cache version bumped once at the end


def test_a_failed_step_does_not_stop_the_others():
    job = new_job("trep", "refresh", PLAN, None)
    store = MemoryJobStore(job)

    def boom(ctx):
        raise RuntimeError("FDA API down")

    status = run(store, job["_id"], {"a": lambda c: {}, "b": boom, "c": lambda c: {"ok": 1}})
    steps = store.get(job["_id"])["steps"]
    assert status == "completed_with_errors"
    assert [s["status"] for s in steps] == ["done", "failed", "done"]
    assert steps[1]["error"] == "RuntimeError: FDA API down"


def test_skipped_steps_are_not_failures():
    job = new_job("trep", "refresh", PLAN, None)
    store = MemoryJobStore(job)

    def skip(ctx):
        raise StepSkipped("No adapter for this company website yet")

    assert run(store, job["_id"], {"a": lambda c: {}, "b": skip, "c": lambda c: {}}) == "completed"
    assert store.get(job["_id"])["steps"][1] == {**store.get(job["_id"])["steps"][1], "status": "skipped",
                                                 "error": "No adapter for this company website yet"}


def test_cancel_between_steps_skips_the_rest():
    job = new_job("trep", "refresh", PLAN, None)
    store = MemoryJobStore(job)

    def cancel_after(ctx):
        store.jobs[job["_id"]]["cancel_requested"] = True
        return {}

    status = run(store, job["_id"], {"a": cancel_after, "b": lambda c: {}, "c": lambda c: {}})
    assert status == "cancelled"
    assert [s["status"] for s in store.get(job["_id"])["steps"]] == ["done", "skipped", "skipped"]


def test_jobs_cancelled_or_already_run_are_not_run_again():
    job = {**new_job("trep", "refresh", PLAN, None), "status": "cancelled"}
    store, calls = MemoryJobStore(job), []
    assert run(store, job["_id"], {n: (lambda c: calls.append(1)) for n in "abc"}) == "cancelled"
    assert calls == []


def test_async_steps_are_awaited():
    job = new_job("trep", "refresh", PLAN[:1], None)
    store = MemoryJobStore(job)

    async def async_step(ctx):
        await asyncio.sleep(0)
        return {"articles": 2}

    assert run(store, job["_id"], {"a": async_step}) == "completed"
    assert store.get(job["_id"])["steps"][0]["counts"] == {"articles": 2}


def test_steps_see_the_job_type():
    job = new_job("trep", "competitor", PLAN[:1], None)
    seen = []
    assert run(MemoryJobStore(job), job["_id"], {"a": lambda ctx: seen.append(ctx.job_type)}) == "completed"
    assert seen == ["competitor"]
