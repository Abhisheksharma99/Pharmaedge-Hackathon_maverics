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


from service.jobs import MongoJobStore


def test_the_feed_logs_plan_steps_and_outcomes_in_order():
    job = new_job("trep", "refresh", PLAN, None)
    store = MemoryJobStore(job)

    def b(ctx):
        ctx.log("ai", "“FDA accepts sNDA”", verdict="Ingest")
        return {"triaged": 3, "summary": "3 relevant · 0 dropped"}

    def c(ctx):
        raise StepSkipped("No newsroom crawler")

    run(store, job["_id"], {"a": lambda ctx: {"fda_new": 2, "ema_new": 1}, "b": b, "c": c})
    feed = store.feeds[job["_id"]]
    assert [(f["step"], f["kind"]) for f in feed] == [
        ("plan", "info"), ("a", "info"), ("a", "done"), ("b", "info"), ("b", "ai"), ("b", "done"),
        ("c", "info"), ("c", "warn")]
    assert feed[0]["text"] == "Planning refresh for Treprostinil · 3 steps"
    assert feed[2]["text"] == "fda new 2 · ema new 1"
    assert feed[4]["verdict"] == "Ingest"
    assert feed[5]["text"] == "3 relevant · 0 dropped"
    assert store.get(job["_id"])["steps"][1]["counts"] == {"triaged": 3}  # the summary is not a count
    assert feed[7]["text"] == "Skipped: No newsroom crawler"
    assert [f["id"] for f in feed] == list(range(1, 9))


def test_failed_steps_are_logged_as_warnings():
    job = new_job("trep", "refresh", PLAN, None)
    store = MemoryJobStore(job)

    def boom(ctx):
        raise RuntimeError("FDA API down")

    run(store, job["_id"], {"a": boom, "b": lambda c: {}, "c": lambda c: {}})
    assert store.feeds[job["_id"]][2] == {"id": 3, "step": "a", "kind": "warn", "text": "Failed: RuntimeError: FDA API down"}


def test_progress_is_measured_after_each_step():
    job = new_job("trep", "refresh", PLAN, None)
    store, calls = MemoryJobStore(job), []

    def measure(asset_id):
        calls.append(asset_id)
        return {"records_by_coll": {"fda_records": 10 * len(calls)}, "record_years": [{"coll": "fda_records", "year": 2021, "n": 1}],
                "events": 100 + len(calls)}

    asyncio.run(run_job(store, job["_id"], {n: (lambda c: {}) for n in "abc"}, load_asset=lambda _: ASSET, measure=measure))
    saved = store.get(job["_id"])
    assert calls == ["trep"] * 4  # baseline + one per step
    assert saved["records_by_coll"] == {"fda_records": 40}
    assert saved["events_created"] == 3
    assert saved["record_years"] == [{"coll": "fda_records", "year": 2021, "n": 1}]


def test_a_broken_feed_or_measure_never_fails_the_job():
    job = new_job("trep", "refresh", PLAN, None)
    store = MemoryJobStore(job)

    def bad_feed(job_id, item):
        raise ConnectionError("mongo blip")

    store.feed = bad_feed

    def bad_measure(asset_id):
        raise ConnectionError("mongo blip")

    status = asyncio.run(run_job(store, job["_id"], {n: (lambda c: {}) for n in "abc"}, load_asset=lambda _: ASSET,
                                 measure=bad_measure))
    assert status == "completed"


def test_mongo_store_numbers_feed_lines_with_the_job_cursor(db):
    db.jobs.insert_one(new_job("trep", "refresh", PLAN, None))
    job_id = db.jobs.docs[0]["_id"]
    store = MongoJobStore(db)
    store.feed(job_id, {"step": "plan", "kind": "info", "text": "Planning"})
    store.feed(job_id, {"step": "a", "kind": "done", "text": "Done"})
    assert [(d["id"], d["text"]) for d in db.job_feed.docs] == [(1, "Planning"), (2, "Done")]
    assert db.jobs.docs[0]["feed_cursor"] == 2
