# v3 Phase 1a: Crawler data (feed, enrichment, branches, key events) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the crawler produce everything the v3 UI reads from Mongo: a live-build job feed with progress counters, enriched journey events (indications, product, details, links, impact), indication branches, key-event flags, and job-end notifications — and backfill them for every existing asset.

**Architecture:** Python crawl service (`crawler/`). The pipeline gains a per-step log callback (`StepContext.log`) and a `measure` hook that stores records-per-collection, records-per-year and events created on the job. Rule events get deterministic enrichment in `journey/rules.py`. A new `journey/derive.py` runs at `finalize`: LLM-grouped indication branches (`journey/branches.py`, rules decide trunk/ended/status/side/colour), rule-based key events (`journey/key_events.py`), and LLM enrichment of key events (`ai/enrich.py`). Notifications are written at job end (`service/notify.py`).

**Tech Stack:** Python 3.11, pymongo, OpenAI (via `ai/llm.structured`, content-hash cached), pytest with the in-memory `FakeDb` from `crawler/conftest.py`.

**Spec:** `docs/superpowers/specs/2026-10-09-asset-journey-v3-design.md` (§4.1–4.3, §5); data contracts `docs/design/asset-journey-v3/DATA_CONTRACTS.md` §A (types), §D (Mongo), §E (crawler).

## Global Constraints

- Extend, don't fork: new fields are optional; existing journey/job readers keep working.
- `journey_events` new fields: `indications[]`, `product`, `details{}`, `impact`, `branch`, `span[]`, `links[]`, plus `key` (bool), `ai_links[]`, `enriched_at`. Rules never write `indications`/`product` when they don't know them (so enrichment survives rebuilds).
- `asset_branches` docs: `{ _id: asset+':'+id, asset, id, label, full, color, off, trunk, from, why, status, ended, origin, partner, aliases[], members[], start, updated_at }`; index `{asset:1}`. **Never overwrite `origin:'user'` branches.**
- Branch palette (trunk first): `#2347d9, #0b7a6f, #6941c6, #e0620f, #0e7490, #b54708`; a branch keeps its colour across refreshes.
- `job_feed` docs `{ job, id, t, step, kind ('info'|'done'|'warn'|'ai'|'event'), text, verdict?, event_id?, merged? }`; `id` = the job's monotonic `feed_cursor`; index `{job:1, id:1}` unique.
- Jobs gain `feed_cursor`, `records_by_coll{}`, `record_years[{coll,year,n}]`, `events_created`.
- Notifications `{ user, kind, title, sub, link, read, at }`, fanned out to active users whose `user_prefs.notify.<pref>` is on (defaults: `highEvents` on, `crawls` on, `weeklyDigest` off).
- The live log is best effort: a feed/measure/notify failure never fails a crawl. An LLM failure in branches/enrichment keeps the previous data and is reported as a warn line.
- Key events target ~40–80 per primary asset (spec §4.1).
- `cd crawler && ../.venv/bin/python -m pytest -q` stays green (baseline 95 passed).

## Review Focus

- **No LLM key / network down during finalize**: the job still finishes `ready`; branches stay as they were; a `warn` feed line says so. Test in Task 7 (`test_derive_keeps_previous_branches_when_the_llm_fails`).
- **LLM returns junk** (unknown member ids, duplicate branch ids, a parent that starts later or doesn't exist, an empty id): unknown members are ignored, duplicates dropped, bad parents fall back to the trunk. Tests in Task 4.
- **Asset with no qualifying programme** (e.g. a competitor with only investigator trials): no branches are written, every event's `branch` is unset, the UI draws one lane. Test in Task 4.
- **Undated or malformed event dates** (`""`, `"2021"`): key-event selection skips them instead of crashing in `date.fromisoformat`. Test in Task 5.
- **Rule rebuild after enrichment**: a rebuild must not wipe AI-written `indications`/`product`/`impact` on rule events. Test in Task 2 (`test_rule_events_omit_unknown_indications_and_product`).

---

### Task 1: Live-build feed and progress in the pipeline

**Files:**
- Modify: `crawler/conftest.py` (FakeCollection: `$ne`, `$exists`, `$inc`, `$unset`, `find_one_and_update`, `insert_many`, `delete_many`, `bulk_write`)
- Modify: `crawler/service/jobs.py`
- Modify: `crawler/service/pipeline.py`
- Create: `crawler/service/progress.py`
- Test: `crawler/service/test_pipeline.py` (append), `crawler/service/test_progress.py`

**Interfaces:**
- Produces:
  - `JobStore.feed(job_id: str, item: dict) -> None`; `MongoJobStore.feed` (atomic `$inc feed_cursor`, insert into `job_feed`); `MemoryJobStore.feeds: Dict[str, List[dict]]`.
  - `new_job(...)` adds `feed_cursor: 0, records_by_coll: {}, record_years: [], events_created: 0`.
  - `StepContext.log(kind: str, text: str, **extra) -> None` (no-op by default).
  - `run_job(store, job_id, steps, load_asset, on_finished=..., measure=None)`; `measure(asset_id) -> {"records_by_coll": {coll: n}, "record_years": [{coll, year, n}], "events": int}`.
  - A step result may carry `"summary": str` — popped (not stored in counts) and used as the step's `done` line.
  - `service.progress.measure(db, asset_id) -> dict` (shape above).

- [ ] **Step 1: Extend the FakeDb (test infrastructure)**

In `crawler/conftest.py`, replace `_matches` and `_apply` and add methods to `FakeCollection`:

```python
def _matches(doc, flt):
    for key, cond in (flt or {}).items():
        value = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and value not in cond["$in"]:
                return False
            if "$nin" in cond and value in cond["$nin"]:
                return False
            if "$ne" in cond and value == cond["$ne"]:
                return False
            if "$exists" in cond and (key in doc) != cond["$exists"]:
                return False
            if "$gte" in cond and (value is None or value < cond["$gte"]):
                return False
        elif isinstance(value, list):
            if cond not in value:
                return False
        elif value != cond:
            return False
    return True


def _apply(doc, update):
    doc.update(update.get("$set", {}))
    for key in update.get("$unset", {}):
        doc.pop(key, None)
    for key, value in update.get("$inc", {}).items():
        doc[key] = doc.get(key, 0) + value
    for key, value in update.get("$addToSet", {}).items():
        if value not in doc.setdefault(key, []):
            doc[key].append(value)
    for key, value in update.get("$pull", {}).items():
        doc[key] = [x for x in doc.get(key, []) if x != value]
```

Add to `FakeCollection` (after `update_many`):

```python
    def find_one_and_update(self, flt, update, projection=None, return_document=None, upsert=False):
        doc = self.find_one(flt)
        if doc is None:
            return None
        _apply(doc, update)
        return dict(doc)

    def insert_many(self, docs):
        self.docs.extend(dict(d) for d in docs)

    def delete_many(self, flt):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not _matches(d, flt)]
        return SimpleNamespace(deleted_count=before - len(self.docs))

    def bulk_write(self, ops, ordered=True):
        for op in ops:  # pymongo UpdateOne
            self.update_one(op._filter, op._doc, upsert=op._upsert)
        return SimpleNamespace(upserted_count=0, modified_count=len(ops))
```

- [ ] **Step 2: Write the failing pipeline tests**

Append to `crawler/service/test_pipeline.py`:

```python
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
```

Create `crawler/service/test_progress.py`:

```python
"""Live-build progress counters (offline)."""

from service.progress import measure


class StubColl:
    def __init__(self, rows=(), count=0):
        self.rows, self.count = list(rows), count

    def aggregate(self, pipeline):
        return iter(self.rows)

    def count_documents(self, flt):
        return self.count


class StubDb(dict):
    def __getitem__(self, name):
        return self.setdefault(name, StubColl())

    def __getattr__(self, name):
        return self[name]


def test_measure_counts_records_per_collection_and_year():
    db = StubDb()
    db["fda_records"] = StubColl([{"_id": "2021", "n": 3}, {"_id": "2022", "n": 2}, {"_id": "", "n": 4}])
    db["trial_records"] = StubColl([{"_id": "2019", "n": 7}])
    db["journey_events"] = StubColl(count=12)
    out = measure(db, "trep")
    assert out["records_by_coll"]["fda_records"] == 9  # undated records still count
    assert out["records_by_coll"]["articles"] == 0
    assert {"coll": "trial_records", "year": 2019, "n": 7} in out["record_years"]
    assert all(r["year"] for r in out["record_years"])  # undated buckets are not years
    assert out["events"] == 12
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd crawler && ../.venv/bin/python -m pytest service/test_pipeline.py service/test_progress.py -q 2>&1 | tail -5`
Expected: FAIL — `ModuleNotFoundError: No module named 'service.progress'` and pipeline tests failing (`AttributeError: 'MemoryJobStore' object has no attribute 'feeds'`).

- [ ] **Step 4: Implement `service/jobs.py` changes**

Add `from pymongo import ReturnDocument` to the imports. In `new_job`, add after `"cancel_requested": False,`:

```python
        "feed_cursor": 0,
        "records_by_coll": {},
        "record_years": [],
        "events_created": 0,
```

Add `def feed(self, job_id: str, item: Dict[str, Any]) -> None: ...` to the `JobStore` protocol. Replace `MongoJobStore` and `MemoryJobStore`:

```python
class MongoJobStore:
    def __init__(self, db):
        self.jobs = db.jobs
        self.job_feed = db.job_feed
        self.job_feed.create_index([("job", 1), ("id", 1)], unique=True)

    def get(self, job_id):
        return self.jobs.find_one({"_id": job_id})

    def update(self, job_id, fields):
        self.jobs.update_one({"_id": job_id}, {"$set": fields})

    def update_step(self, job_id, index, fields):
        self.jobs.update_one({"_id": job_id}, {"$set": {f"steps.{index}.{k}": v for k, v in fields.items()}})

    def feed(self, job_id, item):
        """Append one live-build log line, numbered by the job's monotonic feed cursor (the API's `since`)."""
        job = self.jobs.find_one_and_update({"_id": job_id}, {"$inc": {"feed_cursor": 1}}, projection={"feed_cursor": 1},
                                            return_document=ReturnDocument.AFTER)
        if job:
            self.job_feed.insert_one({"job": job_id, "id": job["feed_cursor"], "t": now(), **item})


class MemoryJobStore:
    """In-process store for tests."""

    def __init__(self, *jobs: Dict[str, Any]):
        self.jobs = {j["_id"]: j for j in jobs}
        self.feeds: Dict[str, List[Dict[str, Any]]] = {}

    def get(self, job_id):
        return self.jobs.get(job_id)

    def update(self, job_id, fields):
        self.jobs[job_id].update(fields)

    def update_step(self, job_id, index, fields):
        self.jobs[job_id]["steps"][index].update(fields)

    def feed(self, job_id, item):
        lines = self.feeds.setdefault(job_id, [])
        lines.append({"id": len(lines) + 1, **item})
```

- [ ] **Step 5: Implement the pipeline changes (`service/pipeline.py`)**

Change the typing import to `from typing import Any, Awaitable, Callable, Dict, List, Optional, Union`. Add before `StepContext`:

```python
def _no_log(kind: str, text: str, **extra: Any) -> None:
    """Default step logger: tests and direct calls run without a live-build feed."""
```

Add the field to `StepContext` (after `extras`):

```python
    # Live-build log line for the job feed: ctx.log("info" | "done" | "warn" | "ai" | "event", text, **extra)
    log: Callable[..., None] = field(default=_no_log)
```

Add these helpers after `StepSkipped`:

```python
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
```

Replace `run_job` with:

```python
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
            store.update(job_id, {"records_by_coll": m["records_by_coll"], "record_years": m["record_years"],
                                  "events_created": max(0, m["events"] - events_at_start)})

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
```

- [ ] **Step 6: Create `crawler/service/progress.py`**

```python
"""
Live-build progress for the app (DATA_CONTRACTS §B.2): the asset's records per collection and per year, and the
size of its journey. Measured after every step and stored on the job.
"""

from typing import Any, Dict, List

from journey.store import COLLECTIONS_WITH_ASSETS

# "2021-03-31" -> "2021"; missing or non-string dates fall into an "" bucket (counted, not placed on a year).
YEAR = {"$substrBytes": [{"$ifNull": [{"$toString": "$date"}, ""]}, 0, 4]}


def measure(db, asset_id: str) -> Dict[str, Any]:
    by_coll: Dict[str, int] = {}
    years: List[Dict[str, Any]] = []
    for coll in COLLECTIONS_WITH_ASSETS:
        rows = list(db[coll].aggregate([{"$match": {"assets": asset_id}},
                                        {"$group": {"_id": YEAR, "n": {"$sum": 1}}}]))
        by_coll[coll] = sum(r["n"] for r in rows)
        years += [{"coll": coll, "year": int(r["_id"]), "n": r["n"]} for r in rows if str(r["_id"]).isdigit()]
    return {"records_by_coll": by_coll, "record_years": years,
            "events": db.journey_events.count_documents({"asset": asset_id})}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd crawler && ../.venv/bin/python -m pytest service -q 2>&1 | tail -3`
Expected: all `service` tests pass (old + 6 new).

---

### Task 2: Deterministic enrichment of rule events

**Files:**
- Modify: `crawler/journey/rules.py`
- Test: `crawler/journey/test_rules.py` (append)

**Interfaces:**
- Produces: rule events carry `details` (ordered dict of display facts), `product` (when known), `indications` (when known: trial conditions[:3], EMA/CHMP short indication) and `links` (ids of related rule events: same NCT id, same application number, same product within ±5 years; nearest first; ≤6). Helpers `short_indication(text) -> str`, `link_events(events) -> events`.

- [ ] **Step 1: Write the failing tests**

Append to `crawler/journey/test_rules.py`:

```python
from journey.rules import build_rule_events, link_events, short_indication, patent_events


def test_short_indication_prefers_the_disease_abbreviation():
    text = ("Treatment of adult patients with WHO Functional Class (FC) III or IV and: inoperable chronic "
            "thromboembolic pulmonary hypertension (CTEPH), or persistent CTEPH after surgery.")
    assert short_indication(text) == "CTEPH"
    assert short_indication("Treatment of pulmonary arterial hypertension; to improve exercise") == \
        "Treatment of pulmonary arterial hypertension"
    assert short_indication("") == ""


def test_trial_events_carry_indications_and_details():
    record = {"record_key": "ctgov:NCT04708782", "nct_id": "NCT04708782", "acronym": "TETON-1", "phases": ["PHASE3"],
              "overall_status": "COMPLETED", "start_date": "2021-06-01", "primary_completion_date": "2026-02-02",
              "conditions": ["Idiopathic Pulmonary Fibrosis", "Interstitial Lung Disease"], "enrollment": 598,
              "lead_sponsor": "United Therapeutics", "title": "Inhaled treprostinil in IPF"}
    start, done = trial_events(A, [record], "United Therapeutics", today="2026-10-09")
    assert start["indications"] == ["Idiopathic Pulmonary Fibrosis", "Interstitial Lung Disease"]
    assert start["details"] == {"Trial": "NCT04708782", "Phase": "Phase 3", "Enrollment": "598",
                                "Status": "Completed", "Sponsor": "United Therapeutics"}
    assert "product" not in start


def test_fda_events_carry_product_and_details():
    record = {**sub("k3", "NDA022387", "SUPPL", "AP", "Efficacy"), "submission_number": "17",
              "products": [{"route": "INHALATION"}, {"route": "INHALATION"}]}
    e = fda_events(A, [record])[0]
    assert e["product"] == "Tyvaso"
    assert e["details"] == {"Application": "NDA022387 S-17", "Class": "Efficacy", "Route": "Inhalation",
                            "Sponsor": "United Therap"}


def test_rule_events_omit_unknown_indications_and_product():
    e = fda_events(A, [sub("k1", "NDA022387", "ORIG", "AP", None)])[0]
    assert "indications" not in e  # left for AI enrichment, which a rebuild must not wipe
    p = patent_events(A, [{"record_key": "patent:US1", "country": "US", "kind": "B2", "legal_status": "Active",
                           "grant_date": "2015-01-27", "expiry_date": "2032-04-20", "publication_number": "US1",
                           "assignees": ["United Therapeutics Corp"], "title": "Treprostinil production"}],
                      today="2026-10-09")
    assert all("product" not in x and "indications" not in x for x in p)
    assert p[0]["details"]["Patent"] == "US1"


def test_ema_approval_gets_its_label_indication():
    events = ema_events(A, [{"record_key": "e1", "record_type": "ema_epar", "medicine_status": "Authorised",
                             "date": "2020-04-03", "name_of_medicine": "Trepulmix",
                             "marketing_authorisation_developer_applicant_holder": "SciPharm Sàrl",
                             "ema_product_number": "EMEA/H/C/005207",
                             "therapeutic_indication": "inoperable chronic thromboembolic pulmonary hypertension (CTEPH)"}])
    assert events[0]["indications"] == ["CTEPH"]
    assert events[0]["product"] == "Trepulmix"
    assert events[0]["details"]["Holder"] == "SciPharm Sàrl"


def test_link_events_joins_the_same_trial_and_application():
    events = [
        {"_id": "start", "nct_id": "NCT1", "date": "2017-02-01"},
        {"_id": "done", "nct_id": "NCT1", "date": "2019-12-26"},
        {"_id": "approval", "application_number": "NDA022387", "product": "Tyvaso", "date": "2009-07-30"},
        {"_id": "suppl", "application_number": "NDA022387", "product": "Tyvaso", "date": "2021-03-31"},
        {"_id": "other", "product": "Tyvaso", "date": "2010-01-01"},
        {"_id": "lonely", "date": ""},
    ]
    linked = {e["_id"]: e.get("links") for e in link_events(events)}
    assert linked["start"] == ["done"]
    assert linked["suppl"] == ["approval"]
    assert linked["approval"] == ["other", "suppl"]  # same product within 5 years first (nearest), then the application
    assert linked["lonely"] is None


def test_build_rule_events_links_across_sources(db):
    db.trial_records.insert_one({"record_key": "ctgov:NCT1", "nct_id": "NCT1", "assets": [A], "phases": ["PHASE3"],
                                 "overall_status": "COMPLETED", "start_date": "2017-02-01",
                                 "primary_completion_date": "2019-12-26", "conditions": ["PH-ILD"], "title": "INCREASE"})
    events = {e["type"]: e for e in build_rule_events(db, A, "United Therapeutics")}
    assert events["trial_start"]["links"] == [events["trial_completion"]["_id"]]
```

(`trial_events`, `ema_events`, `fda_events` and `sub` are already imported/defined at the top of the file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && ../.venv/bin/python -m pytest journey/test_rules.py -q 2>&1 | tail -3`
Expected: FAIL — `ImportError: cannot import name 'link_events'`.

- [ ] **Step 3: Implement in `crawler/journey/rules.py`**

Add after `_brand`:

```python
_ABBREVIATION = re.compile(r"\(([A-Z][A-Za-z0-9-]{1,12})\)")
_NOT_INDICATIONS = {"FC", "WHO", "NYHA", "EU", "US", "SC", "IV", "PI"}


def short_indication(text: Optional[str]) -> str:
    """Display form of a label indication: the disease abbreviation the text gives ("... (CTEPH)"), else its
    first clause, at most 60 characters."""
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return ""
    for abbr in _ABBREVIATION.findall(text):
        if abbr not in _NOT_INDICATIONS:
            return abbr
    first = re.split(r"[;:.]", text)[0].strip()
    return first if len(first) <= 60 else first[:57].rstrip() + "…"


def _routes(record: Dict[str, Any]) -> str:
    routes = dict.fromkeys((p.get("route") or "").strip().title() for p in record.get("products") or [])
    return ", ".join(r for r in routes if r)


def _facts(**facts: Any) -> Dict[str, str]:
    """Ordered display facts for the event card, without empty values."""
    return {k.replace("_", " "): str(v) for k, v in facts.items() if v not in (None, "", [])}
```

In `fda_calendar_event`, add to `common`:

```python
                  details=_facts(Type="PDUFA date" if r.get("event_type") == "pdufa" else "Advisory committee",
                                 Company=r.get("company")),
```

In `fda_events`, the recall branch: add `product=(r.get("product_description") or "")[:60] or None` — only when non-empty — and details. Replace the recall `events.append(...)` with:

```python
            recall = _event(asset, r, "fda_records", "recall", category="safety", region="US", date=r.get("date", ""),
                            title=f"FDA recall: {r.get('product_description', '')[:90]}",
                            summary=r.get("reason_for_recall", ""), significance="High",
                            details=_facts(Reason=(r.get("reason_for_recall") or "")[:90],
                                           Classification=r.get("classification")))
            events.append(recall)
            continue
```

Replace the `common = dict(...)` line for submissions with:

```python
        suffix = f" S-{r.get('submission_number')}" if sub_type == "SUPPL" and r.get("submission_number") else ""
        common = dict(category="regulatory", region="US", date=r["date"], application_number=app_no,
                      product=brand or None,
                      details=_facts(Application=f"{app_no}{suffix}", Class=cls, Route=_routes(r), Sponsor=sponsor))
```

(`product=None` must not be written: after building, strip `None` products — see Step 3d.)

In `chmp_events`, add to the new-event `_event(...)` call: `product=r.get("name_of_medicine") or None, indications=[short_indication(r.get("therapeutic_indication"))], details=_facts(Opinion=opinion, Procedure=procedure)`; and to the EC-decision milestone the same `product` and `indications`.

In `ema_events`, set per record (before the `if rt == ...` chain):

```python
        holder = r.get("marketing_authorisation_developer_applicant_holder")
        extra = dict(product=r.get("name_of_medicine") or None,
                     indications=[short_indication(r.get("therapeutic_indication"))],
                     details=_facts(Procedure=r.get("ema_product_number"), Holder=holder, Status=r.get("medicine_status")))
```

and pass `**extra` into each `_event(...)` call of that chain (approval, withdrawn, orphan, post-authorisation, DHPC).

In `trial_events`, add to `common`:

```python
                      indications=(r.get("conditions") or [])[:3],
                      details=_facts(Trial=r.get("nct_id"), Phase=phase_label if phase else None,
                                     Enrollment=r.get("enrollment"),
                                     Status=(r.get("overall_status") or "").replace("_", " ").capitalize(),
                                     Sponsor=r.get("lead_sponsor")),
```

In `patent_events`, add to the grant `_event(...)`:

```python
                                 details=_facts(Patent=r.get("publication_number"), Assignee=(r.get("assignees") or [None])[0],
                                                Granted=r.get("grant_date"), Expiry=r.get("expiry_date"),
                                                Status=r.get("legal_status")),
```

and to each expiry dict: `"details": _facts(Patents=", ".join(numbers), Expiry=when),`.

- [ ] **Step 3d: Add the cleanup + linking and wire them into `build_rule_events`**

Add before `build_rule_events`:

```python
def _clean(event: Dict[str, Any]) -> Dict[str, Any]:
    """Unknown product / indications are left out (not null), so AI enrichment survives rule rebuilds."""
    if not event.get("product"):
        event.pop("product", None)
    inds = [i for i in event.get("indications") or [] if i]
    if inds:
        event["indications"] = inds
    else:
        event.pop("indications", None)
    return event


def _gap(a: Dict[str, Any], b: Dict[str, Any]) -> int:
    try:
        return _days_apart(a["date"], b["date"])
    except (KeyError, ValueError):
        return 10 ** 6


def link_events(events: List[Dict[str, Any]], years: int = 5, cap: int = 6) -> List[Dict[str, Any]]:
    """`links`: other rule events about the same trial, the same application, or the same product within ±5
    years (nearest first). Product neighbours come before application neighbours of the same distance."""
    by_nct: Dict[str, List[Dict[str, Any]]] = {}
    by_app: Dict[str, List[Dict[str, Any]]] = {}
    by_product: Dict[str, List[Dict[str, Any]]] = {}
    for e in events:
        for index, key in ((by_nct, e.get("nct_id")), (by_app, e.get("application_number")), (by_product, e.get("product"))):
            if key:
                index.setdefault(key, []).append(e)
    for e in events:
        same = by_nct.get(e.get("nct_id"), []) + by_app.get(e.get("application_number"), [])
        near = [x for x in by_product.get(e.get("product"), []) if _gap(x, e) <= years * 365]
        related = {x["_id"]: x for x in near + same if x is not e}
        if related:
            e["links"] = [x["_id"] for x in sorted(related.values(), key=lambda x: _gap(x, e))][:cap]
    return events
```

Replace `build_rule_events` with:

```python
def build_rule_events(db, asset_id: str, company: Optional[str]) -> List[Dict[str, Any]]:
    q = {"assets": asset_id}
    events = (fda_events(asset_id, db.fda_records.find(q))
              + ema_events(asset_id, db.ema_records.find(q))
              + trial_events(asset_id, db.trial_records.find(q, {"study": 0}), company)
              + patent_events(asset_id, db.patent_records.find(q, {"abstract": 0, "events": 0})))
    return link_events([_clean(e) for e in events])
```

Note: `link_events` sorts "approval" neighbours: `other` (product, 0.4y) then `suppl` (application, 11.7y) — matching the test. Linking by product only within 5 years, by NCT/application at any distance.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && ../.venv/bin/python -m pytest journey -q 2>&1 | tail -3`
Expected: all `journey` tests pass (existing rule tests still green: titles, significance, ids unchanged).

---

### Task 3: AI extraction returns indications, product and impact

**Files:**
- Modify: `crawler/ai/events.py`
- Test: `crawler/ai/test_events.py` (create)

**Interfaces:**
- Produces: AI-extracted events carry `indications` (≤3), `product` (or absent), `impact` (≤30 words or `None`). Helper `clean_impact(text) -> Optional[str]` (used by Task 6).

- [ ] **Step 1: Write the failing test**

Create `crawler/ai/test_events.py`:

```python
"""AI extraction fields (offline: the model call is stubbed)."""

from ai import events as ai_events
from ai.events import clean_impact

ASSET = {"_id": "trep", "name": "Treprostinil", "aliases": [], "company": {"name": "United Therapeutics"}, "tags": {}}
RECORD = {"record_key": "pr-1", "title": "FDA accepts sNDA", "date": "2026-09-30", "content": "text"}


def test_extraction_keeps_indications_product_and_impact(monkeypatch):
    out = {"events": [{"type": "regulatory_submission", "date": "2026-09-30", "title": "FDA accepts Tyvaso sNDA for IPF",
                       "summary": "Accepted.", "significance": "High", "is_milestone": False, "expected_date": "",
                       "phase": "", "indication": "IPF", "region": "US", "indications": ["IPF", " ", "PH-ILD", "PAH", "x"],
                       "product": "Tyvaso", "impact": "Sets the PDUFA clock for a potential IPF label."}]}
    monkeypatch.setattr(ai_events.llm, "structured", lambda *a, **k: out)
    [event] = ai_events._extract_one(ASSET, "company_records", "record_key", "content", RECORD)
    assert event["indications"] == ["IPF", "PH-ILD", "PAH"]
    assert event["product"] == "Tyvaso"
    assert event["impact"] == "Sets the PDUFA clock for a potential IPF label."


def test_empty_product_is_left_out_and_long_impact_rejected(monkeypatch):
    out = {"events": [{"type": "publication", "date": "2021-01-13", "title": "INCREASE published", "summary": "s",
                       "significance": "Medium", "is_milestone": False, "expected_date": "", "phase": "",
                       "indication": "", "region": "", "indications": [], "product": "", "impact": "word " * 40}]}
    monkeypatch.setattr(ai_events.llm, "structured", lambda *a, **k: out)
    [event] = ai_events._extract_one(ASSET, "company_records", "record_key", "content", RECORD)
    assert "product" not in event and event["impact"] is None and "indications" not in event


def test_clean_impact():
    assert clean_impact("  One factual line.  ") == "One factual line."
    assert clean_impact("") is None
    assert clean_impact("word " * 31) is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd crawler && ../.venv/bin/python -m pytest ai/test_events.py -q 2>&1 | tail -3`
Expected: FAIL — `ImportError: cannot import name 'clean_impact'`.

- [ ] **Step 3: Implement in `crawler/ai/events.py`**

Append to `EXTRACT_SYSTEM` (before `- Never invent facts`):

```
- indications: the indication(s) the event concerns as short standard names or abbreviations (e.g. PAH,
  PH-ILD, IPF); [] if the text names none. product: the brand or product name it concerns, "" if none.
- impact: one factual sentence (max 25 words) on why the event matters for this asset's journey, only if the
  text supports it; "" otherwise.
```

In `EVENT_SCHEMA`'s item `properties`, add:

```python
            "indications": {"type": "array", "items": {"type": "string"}},
            "product": {"type": "string"}, "impact": {"type": "string"},
```

and append `"indications", "product", "impact"` to its `required` list.

Add after `_valid_date`:

```python
def clean_impact(text: str) -> Optional[str]:
    """'Why it matters': one short factual sentence, or nothing (over-long answers are rejected, not cut)."""
    text = " ".join((text or "").split())
    return text if text and len(text.split()) <= 30 else None
```

(add `Optional` to the `typing` import.) In `_extract_one`, build the event dict then add the new fields:

```python
        event = {
            ... existing keys unchanged ...
        }
        indications = [i.strip()[:40] for i in e.get("indications") or [] if i.strip()][:3]
        if indications:
            event["indications"] = indications
        if (e.get("product") or "").strip():
            event["product"] = e["product"].strip()[:60]
        event["impact"] = clean_impact(e.get("impact", ""))
        events.append(event)
```

(i.e. change `events.append({...})` to `event = {...}` followed by the lines above.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && ../.venv/bin/python -m pytest ai -q 2>&1 | tail -3`
Expected: all `ai` tests pass.

---

### Task 4: Indication branches (`journey/branches.py`)

**Files:**
- Create: `crawler/journey/branches.py`
- Test: `crawler/journey/test_branches.py`

**Interfaces:**
- Consumes: `ai.llm.structured`, `llm.REASONING_MODEL`.
- Produces:
  - `PALETTE: List[str]`
  - `candidate_trials(db, asset, today) -> List[dict]` (`{id, acronym, phase, phase_rank, status, start, end, conditions, title}`; company-sponsored, Phase ≥2, started, not withdrawn)
  - `candidate_events(db, asset_id) -> List[dict]` (`{id, date, type, region, title, summary, indication, origin}`)
  - `propose(asset, trials, events) -> List[dict]` (LLM: `{id, full, members, parent, why, partner, aliases}`)
  - `build(proposed, trials, events, company, existing) -> List[dict]` (pure; branch docs in the Global Constraints shape, trunk first, user branches appended)
  - `save(db, asset_id, branches) -> None`
  - `refresh(db, asset, today=None) -> List[dict]`
  - `match_branches(texts, branches) -> List[str]`, `place(event, branches, by_member) -> (branch_id|None, span)`
  - `assign_all(db, asset_id) -> int`

- [ ] **Step 1: Write the failing tests**

Create `crawler/journey/test_branches.py`:

```python
"""Indication branches (offline: the LLM grouping is a fixture). Run: cd crawler && ../.venv/bin/python -m pytest journey -q"""

from journey import branches as B

CO = "United Therapeutics"


def trial(id, start, conditions, status="COMPLETED", phase=3, acronym=""):
    return {"id": id, "acronym": acronym, "phase": f"Phase {phase}", "phase_rank": phase, "status": status,
            "start": start, "end": "", "conditions": conditions, "title": ""}


def ev(id, date, type="approval", region="US", indication=""):
    return {"id": id, "date": date, "type": type, "region": region, "title": id, "summary": "", "indication": indication,
            "origin": "rule"}


TRIALS = [
    trial("NCT_TRIUMPH", "2005-06-01", ["Pulmonary Hypertension"], acronym="TRIUMPH"),
    trial("NCT_INCREASE", "2017-02-03", ["Pulmonary Hypertension", "Interstitial Lung Disease"], acronym="INCREASE"),
    trial("NCT_PERFECT", "2018-05-08", ["Pulmonary Hypertension", "COPD"], status="TERMINATED", acronym="PERFECT"),
    trial("NCT_PERFECT_OLE", "2018-12-21", ["Pulmonary Hypertension", "COPD"], status="TERMINATED", acronym="PERFECT OLE"),
    trial("NCT_TETON1", "2021-06-01", ["Idiopathic Pulmonary Fibrosis"], acronym="TETON-1"),
    trial("NCT_TETON_PPF", "2023-10-30", ["Progressive Pulmonary Fibrosis"], status="RECRUITING", acronym=""),
]
EVENTS = [
    ev("remodulin", "2002-05-21"),
    ev("tyvaso_ild", "2021-03-31", type="label_expansion"),
    ev("trepulmix", "2020-04-03", region="EU", indication="CTEPH"),
    ev("ipf_snda", "2026-09-30", type="regulatory_submission"),
]
PROPOSED = [
    {"id": "PAH", "full": "Pulmonary arterial hypertension", "members": ["NCT_TRIUMPH", "remodulin"], "parent": "",
     "why": "", "partner": "", "aliases": ["pulmonary arterial hypertension", "pah"]},
    {"id": "PH-ILD", "full": "PH due to interstitial lung disease", "members": ["NCT_INCREASE", "tyvaso_ild", "ghost"],
     "parent": "PAH", "why": "INCREASE took inhaled treprostinil into WHO Group 3", "partner": "",
     "aliases": ["interstitial lung disease", "ph-ild"]},
    {"id": "IPF", "full": "Idiopathic pulmonary fibrosis", "members": ["NCT_TETON1", "ipf_snda"], "parent": "PH-ILD",
     "why": "FVC gains in INCREASE led to TETON", "partner": "", "aliases": ["idiopathic pulmonary fibrosis", "ipf"]},
    {"id": "PPF", "full": "Progressive pulmonary fibrosis", "members": ["NCT_TETON_PPF"], "parent": "IPF",
     "why": "TETON-PPF extends the IPF approach", "partner": "", "aliases": ["progressive pulmonary fibrosis", "ppf"]},
    {"id": "CTEPH", "full": "Chronic thromboembolic PH", "members": ["trepulmix"], "parent": "PAH",
     "why": "SC treprostinil studied in inoperable CTEPH", "partner": "SciPharm", "aliases": ["cteph"]},
    {"id": "PH-COPD", "full": "PH due to COPD", "members": ["NCT_PERFECT", "NCT_PERFECT_OLE"], "parent": "PAH",
     "why": "PERFECT tested inhaled treprostinil in PH-COPD", "partner": "", "aliases": ["copd", "ph-copd"]},
    {"id": "PH-SCD", "full": "PH in sickle cell disease", "members": [], "parent": "PAH", "why": "", "partner": "",
     "aliases": ["sickle cell"]},  # withdrawn trial only: not a member, so it doesn't qualify
    {"id": "PAH", "full": "dup", "members": [], "parent": "", "why": "", "partner": "", "aliases": []},  # duplicate id
]


def built(existing=()):
    return {b["id"]: b for b in B.build(PROPOSED, TRIALS, EVENTS, CO, list(existing))}


def test_trunk_is_the_indication_of_the_first_approval():
    out = built()
    assert out["PAH"]["trunk"] and out["PAH"]["off"] == 0 and out["PAH"]["from"] is None
    assert list(out)[0] == "PAH"


def test_fixture_branches_with_parents_and_status():
    out = built()
    assert set(out) == {"PAH", "PH-ILD", "IPF", "PPF", "CTEPH", "PH-COPD"}
    assert (out["PH-ILD"]["from"], out["IPF"]["from"], out["PPF"]["from"]) == ("PAH", "PH-ILD", "IPF")
    assert out["CTEPH"]["from"] == "PAH" and out["PH-COPD"]["from"] == "PAH"
    assert out["PAH"]["status"] == "Approved · US"
    assert out["CTEPH"]["status"] == "Approved · EU (SciPharm)"
    assert out["IPF"]["status"] == "Filed · under review"
    assert out["PPF"]["status"] == "Phase 3 recruiting"
    assert out["PH-COPD"]["status"] == "Closed · PERFECT terminated"
    assert out["PH-COPD"]["ended"] == "Terminated" and out["PH-ILD"]["ended"] is None
    assert out["PH-ILD"]["start"] == "2017-02-03"
    assert out["PH-ILD"]["members"] == ["NCT_INCREASE", "tyvaso_ild"]  # unknown "ghost" dropped


def test_lane_sides_put_active_branches_right_and_closed_or_partner_left():
    out = built()
    assert [out[b]["off"] for b in ("PH-ILD", "IPF", "PPF")] == [1, 2, 3]
    assert {out["PH-COPD"]["off"], out["CTEPH"]["off"]} == {-1, -2}


def test_colours_come_from_the_palette_and_stay_stable():
    first = built()
    assert first["PAH"]["color"] == B.PALETTE[0]
    assert len({b["color"] for b in first.values()}) == 6
    again = built(existing=[{"id": "IPF", "color": "#0e7490", "origin": "ai"}])
    assert again["IPF"]["color"] == "#0e7490"
    assert again["PAH"]["color"] == B.PALETTE[0]
    assert len({b["color"] for b in again.values()}) == 6


def test_bad_parents_fall_back_to_the_trunk():
    proposed = [dict(p) for p in PROPOSED[:3]]
    proposed[1]["parent"] = "IPF"  # IPF starts after PH-ILD: can't be its parent
    proposed[2]["parent"] = "NOPE"
    out = {b["id"]: b for b in B.build(proposed, TRIALS, EVENTS, CO, [])}
    assert out["PH-ILD"]["from"] == "PAH" and out["IPF"]["from"] == "PAH"


def test_user_branches_are_never_overwritten():
    user = {"id": "PAH", "label": "PAH", "full": "Mine", "color": "#000000", "off": 0, "origin": "user"}
    out = B.build(PROPOSED, TRIALS, EVENTS, CO, [user])
    assert [b for b in out if b["id"] == "PAH"] == [user]


def test_no_qualifying_programme_means_no_branches():
    assert B.build([], [], [], CO, []) == []
    assert B.build([{"id": "X", "full": "x", "members": ["nothing"], "parent": "", "why": "", "partner": "",
                     "aliases": []}], [], [], CO, []) == []


def test_match_branches_uses_the_most_specific_alias_and_word_boundaries():
    brs = list(built().values())
    assert B.match_branches(["PH due to interstitial lung disease (PH‑ILD)"], brs) == ["PH-ILD"]
    assert B.match_branches(["Spahn syndrome"], brs) == []
    assert B.match_branches(["PH-ILD", "PAH"], brs) == ["PH-ILD", "PAH"]


def test_place_prefers_members_then_nct_then_text():
    brs = list(built().values())
    by_member = {m: b["id"] for b in brs for m in b["members"]}
    assert B.place({"_id": "trepulmix"}, brs, by_member) == ("CTEPH", [])
    assert B.place({"_id": "rule:x", "nct_id": "NCT_TETON1"}, brs, by_member) == ("IPF", [])
    assert B.place({"_id": "ai:1", "indications": ["PH-ILD", "PAH"]}, brs, by_member) == ("PH-ILD", ["PAH"])
    assert B.place({"_id": "ai:2", "title": "TETON-2 meets endpoint in IPF"}, brs, by_member) == ("IPF", [])
    assert B.place({"_id": "ai:3", "title": "Quarterly results"}, brs, by_member) == (None, [])


def test_refresh_saves_assigns_and_drops_stale_branches(db, monkeypatch):
    asset = {"_id": "trep", "name": "Treprostinil", "company": {"name": CO}, "tags": {}}
    db.trial_records.insert_one({"record_key": "ctgov:NCT_TETON1", "nct_id": "NCT_TETON1", "assets": ["trep"],
                                 "lead_sponsor": CO, "phases": ["PHASE3"], "overall_status": "COMPLETED",
                                 "start_date": "2021-06-01", "conditions": ["Idiopathic Pulmonary Fibrosis"]})
    db.trial_records.insert_one({"record_key": "ctgov:NCT_W", "nct_id": "NCT_W", "assets": ["trep"], "lead_sponsor": CO,
                                 "phases": ["PHASE3"], "overall_status": "WITHDRAWN", "start_date": "2017-06-01",
                                 "conditions": ["Sickle cell"]})
    db.journey_events.insert_one({"_id": "remodulin", "asset": "trep", "category": "regulatory", "type": "approval",
                                  "origin": "rule", "date": "2002-05-21", "region": "US", "title": "FDA approves Remodulin"})
    db.journey_events.insert_one({"_id": "rule:trial_start:ctgov:NCT_TETON1", "asset": "trep", "nct_id": "NCT_TETON1",
                                  "date": "2021-06-01", "type": "trial_start", "category": "clinical"})
    db.asset_branches.insert_one({"_id": "trep:OLD", "asset": "trep", "id": "OLD", "origin": "ai"})
    seen = {}

    def fake(model, system, user, name, schema, **kw):
        seen["payload"] = user
        return {"branches": [PROPOSED[0], PROPOSED[2]]}

    monkeypatch.setattr(B.llm, "structured", fake)
    out = B.refresh(db, asset, today="2026-10-09")
    assert [b["id"] for b in out] == ["PAH", "IPF"]
    assert "NCT_W" not in seen["payload"]  # withdrawn trials never started
    assert {d["id"] for d in db.asset_branches.docs} == {"PAH", "IPF"}
    assert B.assign_all(db, "trep") == 2
    placed = {e["_id"]: e["branch"] for e in db.journey_events.docs}
    assert placed == {"remodulin": "PAH", "rule:trial_start:ctgov:NCT_TETON1": "IPF"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && ../.venv/bin/python -m pytest journey/test_branches.py -q 2>&1 | tail -3`
Expected: FAIL — `ImportError: cannot import name 'branches' from 'journey'`.

- [ ] **Step 3: Create `crawler/journey/branches.py`**

```python
"""
Indication branches (spec §4.2, DATA_CONTRACTS §E.5): the asset's development drawn as a trunk (the indication of
its first approval) with branches that fork off the programme that led to them.

An LLM groups the asset's company-sponsored Phase 2+ trials and regulatory events into indication programmes and
names each one's parent and rationale. Everything else is rule-based, so it stays stable across refreshes: which
branches qualify, the trunk, ended, status, lane side and colour. Team-created branches (origin "user") are kept
as they are.
"""

import json
import re
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from pymongo import UpdateOne

from ai import llm

PALETTE = ["#2347d9", "#0b7a6f", "#6941c6", "#e0620f", "#0e7490", "#b54708"]
APPROVAL_TYPES = {"approval", "label_expansion", "new_formulation"}
FILED_TYPES = {"regulatory_submission", "regulatory_decision_expected", "regulatory_opinion"}
REGULATORY_TYPES = sorted(APPROVAL_TYPES | FILED_TYPES | {"application_withdrawn", "orphan_designation"})
STOPPED = {"TERMINATED", "WITHDRAWN", "SUSPENDED"}
ACTIVE_WORDS = {"RECRUITING": "recruiting", "ACTIVE_NOT_RECRUITING": "active", "NOT_YET_RECRUITING": "starting",
                "ENROLLING_BY_INVITATION": "enrolling"}
REGIONS = {"us": "US", "usa": "US", "united states": "US", "eu": "EU", "europe": "EU", "european union": "EU"}

SYSTEM = """You map ONE drug asset's development into indication branches for a journey chart.
A branch is a strategic programme in a distinct indication (disease or patient population), e.g. PAH, PH-ILD, IPF.
Rules:
- Group the given company trials and regulatory events into branches; member ids must come from the input.
- Merge sub-populations and naming variants of one indication into one branch (e.g. WHO Group 1 "pulmonary
  hypertension" studies belong to PAH). Formulations, devices or products are never branches.
- id: the standard short abbreviation (e.g. PAH, PH-ILD, IPF, PPF, CTEPH, PH-COPD); full: the full name.
- parent: the id of the branch whose programme most directly led to this one (it must have started earlier);
  "" for the first branch. why: one line (max 15 words) on why the programme moved into this indication.
- partner: the company running this programme if it is a partner or licensee rather than the asset's company,
  else "".
- aliases: 3-8 lowercase phrases that identify this indication in free text, abbreviations included."""

SCHEMA = {
    "type": "object",
    "properties": {"branches": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "full": {"type": "string"},
                       "members": {"type": "array", "items": {"type": "string"}},
                       "parent": {"type": "string"}, "why": {"type": "string"}, "partner": {"type": "string"},
                       "aliases": {"type": "array", "items": {"type": "string"}}},
        "required": ["id", "full", "members", "parent", "why", "partner", "aliases"], "additionalProperties": False}}},
    "required": ["branches"], "additionalProperties": False,
}


def _phase_rank(phases: List[str]) -> int:
    return max((int(p[-1]) for p in phases or [] if re.fullmatch(r"(EARLY_)?PHASE\d", p or "")), default=0)


def candidate_trials(db, asset: Dict[str, Any], today: str) -> List[Dict[str, Any]]:
    """Company-sponsored Phase 2+ trials that actually started (withdrawn trials never did)."""
    company = ((asset.get("company") or {}).get("name") or "").lower()
    out = []
    for r in db.trial_records.find({"assets": asset["_id"]}, {"study": 0}):
        rank = _phase_rank(r.get("phases"))
        start = r.get("start_date") or ""
        if (not company or company not in (r.get("lead_sponsor") or "").lower() or rank < 2
                or r.get("overall_status") == "WITHDRAWN" or not start or start > today):
            continue
        out.append({"id": r["nct_id"], "acronym": r.get("acronym") or "", "phase": f"Phase {rank}", "phase_rank": rank,
                    "status": r.get("overall_status") or "", "start": start,
                    "end": r.get("primary_completion_date") or r.get("completion_date") or "",
                    "conditions": r.get("conditions") or [], "title": r.get("title") or ""})
    return sorted(out, key=lambda t: t["start"])


def candidate_events(db, asset_id: str, cap: int = 80) -> List[Dict[str, Any]]:
    """Regulatory milestones that show where the asset was filed and approved (AI ones only when High)."""
    out = []
    for e in db.journey_events.find({"asset": asset_id, "category": "regulatory", "type": {"$in": REGULATORY_TYPES}}):
        if e.get("origin") == "ai" and e.get("significance") != "High":
            continue
        out.append({"id": e["_id"], "date": e.get("date") or "", "type": e["type"], "region": e.get("region") or "",
                    "title": e.get("title") or "", "summary": (e.get("summary") or "")[:200],
                    "indication": e.get("indication") or ", ".join(e.get("indications") or []),
                    "origin": e.get("origin") or ""})
    return sorted(out, key=lambda e: e["date"])[:cap]


def propose(asset: Dict[str, Any], trials: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tags = asset.get("tags") or {}
    payload = {"asset": asset["name"], "company": (asset.get("company") or {}).get("name"),
               "indications": tags.get("indications", []), "investigational": tags.get("investigational_indications", []),
               "trials": [{k: t[k] for k in ("id", "acronym", "phase", "status", "start", "conditions")} for t in trials],
               "regulatory_events": [{k: e[k] for k in ("id", "date", "type", "region", "title", "indication")}
                                     for e in events]}
    return llm.structured(llm.REASONING_MODEL, SYSTEM, json.dumps(payload), "branches", SCHEMA)["branches"]


def _region(text: str) -> str:
    t = (text or "").strip()
    return REGIONS.get(t.lower(), t if len(t) <= 3 and t.isupper() else "")


def _status(d: Dict[str, Any], ended: Optional[str], partner: str) -> str:
    if d["approvals"]:
        regions = sorted({_region(a["region"]) for a in d["approvals"]} - {""})
        return "Approved" + (f" · {', '.join(regions)}" if regions else "") + (f" ({partner})" if partner else "")
    if ended:
        first = d["trials"][0]
        return f"Closed · {first['acronym'] or first['id']} {first['status'].lower()}"
    if any(e["type"] in FILED_TYPES for e in d["events"]):
        return "Filed · under review"
    active = [t for t in d["trials"] if t["status"] in ACTIVE_WORDS]
    if active:
        t = max(active, key=lambda t: t["phase_rank"])
        return f"Phase {t['phase_rank']} {ACTIVE_WORDS[t['status']]}"
    return "In development"


def build(proposed: List[Dict[str, Any]], trials: List[Dict[str, Any]], events: List[Dict[str, Any]],
          company: Optional[str], existing: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Rule-based branch docs from the LLM's grouping (pure). Trunk first, then by fork date; user branches last."""
    trial_by = {t["id"]: t for t in trials}
    event_by = {e["id"]: e for e in events}
    user = [b for b in existing if b.get("origin") == "user"]
    taken, claimed = {b["id"] for b in user}, set()
    drafts: List[Dict[str, Any]] = []
    for p in proposed:
        bid = re.sub(r"\s+", " ", p.get("id") or "").strip()[:24]
        if not bid or bid in taken or any(d["id"] == bid for d in drafts):
            continue
        ts = sorted((trial_by[m] for m in p["members"] if m in trial_by and m not in claimed), key=lambda t: t["start"])
        es = sorted((event_by[m] for m in p["members"] if m in event_by and m not in claimed), key=lambda e: e["date"])
        approvals = [e for e in es if e["type"] in APPROVAL_TYPES and e["date"]]
        if not approvals and not ts:
            continue
        claimed.update(t["id"] for t in ts)
        claimed.update(e["id"] for e in es)
        dates = [t["start"] for t in ts] + [e["date"] for e in es if e["date"]]
        drafts.append({"p": p, "id": bid, "trials": ts, "events": es, "approvals": approvals, "start": min(dates)})
    if not drafts:
        return user

    def trunk_key(d):
        first_p3 = min((t["start"] for t in d["trials"] if t["phase_rank"] >= 3), default="9999")
        return (min((a["date"] for a in d["approvals"]), default="9999"), first_p3, d["start"])

    trunk = min(drafts, key=trunk_key)
    ordered = [trunk] + sorted((d for d in drafts if d is not trunk), key=lambda d: d["start"])
    kept_colors = {b["id"]: b["color"] for b in existing if b.get("color") and b.get("origin") != "user"}
    used = {b.get("color") for b in user} | {kept_colors[d["id"]] for d in ordered if d["id"] in kept_colors}
    company_l = (company or "").lower()
    out, right, left = [], 0, 0
    for i, d in enumerate(ordered):
        p, is_trunk = d["p"], d is trunk
        ended = ("Terminated" if not d["approvals"] and d["trials"]
                 and all(t["status"] in STOPPED for t in d["trials"]) else None)
        partner = (p.get("partner") or "").strip()
        if partner and company_l and (partner.lower() in company_l or company_l in partner.lower()):
            partner = ""
        parent = None
        if not is_trunk:
            wanted = (p.get("parent") or "").strip()
            ok = next((x for x in drafts if x["id"] == wanted and x is not d and x["start"] <= d["start"]), None)
            parent = ok["id"] if ok else trunk["id"]
        if is_trunk:
            off = 0
        elif ended or partner:
            left -= 1
            off = left
        else:
            right += 1
            off = right
        color = kept_colors.get(d["id"]) or next((c for c in PALETTE if c not in used), PALETTE[i % len(PALETTE)])
        used.add(color)
        aliases = [a.strip().lower() for a in [*p.get("aliases", []), d["id"], p.get("full", "")] if len(a.strip()) >= 3]
        out.append({"id": d["id"], "label": d["id"], "full": (p.get("full") or d["id"]).strip(), "color": color,
                    "off": off, "trunk": is_trunk, "from": parent, "why": "" if is_trunk else (p.get("why") or "").strip(),
                    "status": _status(d, ended, partner), "ended": ended, "origin": "ai", "partner": partner or None,
                    "aliases": list(dict.fromkeys(aliases)), "start": d["start"],
                    "members": [t["id"] for t in d["trials"]] + [e["id"] for e in d["events"]]})
    return out + user


def save(db, asset_id: str, branches: List[Dict[str, Any]]) -> None:
    now = datetime.now(timezone.utc)
    keep = []
    for b in branches:
        keep.append(b["id"])
        if b.get("origin") == "user":
            continue
        doc = {k: v for k, v in b.items() if k != "_id"}
        db.asset_branches.update_one({"_id": f"{asset_id}:{b['id']}"}, {"$set": {**doc, "asset": asset_id, "updated_at": now}},
                                     upsert=True)
    db.asset_branches.delete_many({"asset": asset_id, "origin": {"$ne": "user"}, "id": {"$nin": keep}})
    db.asset_branches.create_index([("asset", 1)])


def refresh(db, asset: Dict[str, Any], today: Optional[str] = None) -> List[Dict[str, Any]]:
    """Re-derive and store the asset's branches (one cached LLM call)."""
    today = today or date.today().isoformat()
    trials = candidate_trials(db, asset, today)
    events = candidate_events(db, asset["_id"])
    proposed = propose(asset, trials, events) if trials or events else []
    existing = list(db.asset_branches.find({"asset": asset["_id"]}))
    out = build(proposed, trials, events, (asset.get("company") or {}).get("name"), existing)
    save(db, asset["_id"], out)
    return out


_DASHES = re.compile(r"[‐-―−]")


def match_branches(texts: List[str], branches: List[Dict[str, Any]]) -> List[str]:
    """Branch ids named in free text: per text the branch with the longest matching alias, in text order."""
    found: List[str] = []
    for text in texts:
        t = _DASHES.sub("-", (text or "").lower())
        best: Optional[Tuple[str, int]] = None
        for b in branches:
            for a in b.get("aliases") or []:
                if (best is None or len(a) > best[1]) and re.search(rf"(?<![a-z0-9]){re.escape(a)}(?![a-z0-9])", t):
                    best = (b["id"], len(a))
        if best and best[0] not in found:
            found.append(best[0])
    return found


def place(event: Dict[str, Any], branches: List[Dict[str, Any]], by_member: Dict[str, str]) -> Tuple[Optional[str], List[str]]:
    """(branch, span) for one event: grouping membership, then its trial, then the indications it names
    (falling back to the title). None means the trunk."""
    if event["_id"] in by_member:
        return by_member[event["_id"]], []
    if event.get("nct_id") in by_member:
        return by_member[event["nct_id"]], []
    texts = list(event.get("indications") or []) or [event.get("indication") or ""]
    ids = match_branches(texts, branches) or match_branches([event.get("title") or ""], branches)
    return (ids[0], ids[1:]) if ids else (None, [])


def assign_all(db, asset_id: str) -> int:
    """Write `branch` / `span` on every event of the asset (events of an asset without branches get neither)."""
    branches = list(db.asset_branches.find({"asset": asset_id}))
    if not branches:
        db.journey_events.update_many({"asset": asset_id}, {"$unset": {"branch": "", "span": ""}})
        return 0
    trunk = next((b["id"] for b in branches if b.get("trunk")), branches[0]["id"])
    by_member = {m: b["id"] for b in branches for m in b.get("members") or []}
    ops = []
    for e in db.journey_events.find({"asset": asset_id}, {"nct_id": 1, "indications": 1, "indication": 1, "title": 1}):
        branch, span = place(e, branches, by_member)
        ops.append(UpdateOne({"_id": e["_id"]}, {"$set": {"branch": branch or trunk, "span": span}}))
    if ops:
        db.journey_events.bulk_write(ops, ordered=False)
    db.journey_events.create_index([("asset", 1), ("branch", 1), ("date", 1)])
    return len(ops)
```

Note on the fixture test `test_place_prefers_members_then_nct_then_text`: `ev("trepulmix", ...)` is a member of CTEPH, so membership wins. In `test_match_branches...` the first text uses a non-breaking hyphen (U+2011), normalised by `_DASHES`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && ../.venv/bin/python -m pytest journey/test_branches.py -q 2>&1 | tail -3`
Expected: all 11 tests pass.

---

### Task 5: Key events (`journey/key_events.py`)

**Files:**
- Create: `crawler/journey/key_events.py`
- Test: `crawler/journey/test_key_events.py`

**Interfaces:**
- Produces: `WINDOW_DAYS = 45`; `candidate(event, today) -> bool`; `select(events, today) -> List[str]` (ids, pure); `mark(db, asset_id, today=None) -> int` (writes `key` true/false, returns the key count).

- [ ] **Step 1: Write the failing tests**

Create `crawler/journey/test_key_events.py`:

```python
"""Key-event selection (offline)."""

from journey.key_events import mark, select

TODAY = "2026-10-09"


def e(id, date, type="approval", sig="High", origin="rule", branch="PAH", **kw):
    return {"_id": id, "date": date, "type": type, "significance": sig, "origin": origin, "branch": branch,
            "category": kw.pop("category", "regulatory"), "sources": kw.pop("sources", [{}]), **kw}


def test_high_company_events_are_key_and_low_ones_are_not():
    events = [e("a", "2002-05-21"), e("b", "2016-08-12", sig="Low"), e("c", "2009-07-30", sig="Medium")]
    assert select(events, TODAY) == ["a"]


def test_investigator_trials_are_not_key_but_company_and_ai_clinical_events_are():
    events = [e("inv", "2015-01-01", type="trial_start", category="clinical", sponsor_is_company=False),
              e("co", "2017-02-01", type="trial_start", category="clinical", sponsor_is_company=True),
              e("ai", "2020-02-24", type="trial_readout", category="clinical", origin="ai")]
    assert select(events, TODAY) == ["co", "ai"]


def test_ai_coverage_of_a_rule_event_collapses_into_it():
    events = [e("rule", "2021-03-31", type="label_expansion"),
              e("ai1", "2021-04-02", type="label_expansion", origin="ai", sources=[{}, {}, {}])]
    assert select(events, TODAY) == ["rule"]


def test_ai_duplicates_keep_the_best_sourced_one():
    events = [e("x1", "2025-07-31", type="trial_readout", origin="ai", category="clinical", sources=[{}]),
              e("x2", "2025-09-02", type="trial_readout", origin="ai", category="clinical", sources=[{}, {}],
                merged_sources=[{}]),
              e("x3", "2026-03-11", type="trial_readout", origin="ai", category="clinical")]  # > 45 days later
    assert select(events, TODAY) == ["x2", "x3"]


def test_distinct_rule_events_never_collapse():
    events = [e("freedom_c", "2006-10-01", type="trial_start", category="clinical", sponsor_is_company=True),
              e("freedom_m", "2006-10-01", type="trial_start", category="clinical", sponsor_is_company=True)]
    assert select(events, TODAY) == ["freedom_c", "freedom_m"]


def test_upcoming_milestones_count_from_medium_and_past_ones_do_not():
    events = [e("next", "2027-07-30", type="regulatory_decision_expected", sig="Medium", is_milestone=True),
              e("stale", "2025-01-01", type="expected_readout", sig="Medium", is_milestone=True)]
    assert select(events, TODAY) == ["next"]


def test_undated_or_partial_dates_are_skipped():
    assert select([e("u", ""), e("p", "2021"), e("ok", "2021-03-31")], TODAY) == ["ok"]


def test_mark_writes_flags(db):
    for x in [e("a", "2002-05-21"), e("b", "2016-08-12", sig="Low")]:
        db.journey_events.insert_one({**x, "asset": "trep"})
    assert mark(db, "trep", today=TODAY) == 1
    assert {d["_id"]: d["key"] for d in db.journey_events.docs} == {"a": True, "b": False}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && ../.venv/bin/python -m pytest journey/test_key_events.py -q 2>&1 | tail -3`
Expected: FAIL — `ModuleNotFoundError: No module named 'journey.key_events'`.

- [ ] **Step 3: Create `crawler/journey/key_events.py`**

```python
"""
Key events (spec §4.1): the curated scope the journey and the Home portfolio timeline show by default.

An event is a candidate when it is High significance (or an upcoming High/Medium milestone) and company-relevant:
not a clinical rule event from an investigator-sponsored trial. Coverage of the same occurrence collapses: an AI
event within WINDOW_DAYS of a rule or AI event of the same type on the same branch keeps only the better one (rule
first, then most sources). Distinct rule events (two trials started the same day) never collapse.
"""

import re
from datetime import date
from typing import Any, Dict, Iterable, List, Optional

WINDOW_DAYS = 45
ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def candidate(e: Dict[str, Any], today: str) -> bool:
    if not ISO_DAY.match(e.get("date") or ""):
        return False
    sig = e.get("significance")
    if e.get("is_milestone"):
        return e["date"] >= today and sig in ("High", "Medium")
    if sig != "High":
        return False
    return not (e.get("category") == "clinical" and e.get("origin") == "rule" and not e.get("sponsor_is_company"))


def _days(a: str, b: str) -> int:
    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)


def _rank(e: Dict[str, Any]):
    return (e.get("origin") == "rule", len(e.get("sources") or []) + len(e.get("merged_sources") or []),
            len(e.get("summary") or ""))


def select(events: Iterable[Dict[str, Any]], today: str) -> List[str]:
    kept: List[Dict[str, Any]] = []
    for e in sorted((x for x in events if candidate(x, today)), key=lambda x: x["date"]):
        group = (e.get("type"), e.get("branch"))
        twin = next((k for k in reversed(kept) if (k.get("type"), k.get("branch")) == group
                     and _days(k["date"], e["date"]) <= WINDOW_DAYS
                     and not (k.get("origin") == "rule" and e.get("origin") == "rule")), None)
        if twin is None:
            kept.append(e)
        elif _rank(e) > _rank(twin):
            kept[kept.index(twin)] = e
    return [e["_id"] for e in kept]


def mark(db, asset_id: str, today: Optional[str] = None) -> int:
    today = today or date.today().isoformat()
    events = list(db.journey_events.find({"asset": asset_id}, {"date": 1, "type": 1, "significance": 1, "origin": 1,
                                                               "branch": 1, "category": 1, "is_milestone": 1,
                                                               "sponsor_is_company": 1, "sources": 1,
                                                               "merged_sources": 1, "summary": 1}))
    ids = select(events, today)
    db.journey_events.update_many({"asset": asset_id, "_id": {"$in": ids}}, {"$set": {"key": True}})
    db.journey_events.update_many({"asset": asset_id, "_id": {"$nin": ids}}, {"$set": {"key": False}})
    return len(ids)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && ../.venv/bin/python -m pytest journey/test_key_events.py -q 2>&1 | tail -3`
Expected: 8 passed.

---

### Task 6: Enrichment of key events (`ai/enrich.py`)

**Files:**
- Create: `crawler/ai/enrich.py`
- Test: `crawler/ai/test_enrich.py`

**Interfaces:**
- Consumes: `ai.events.clean_impact`, `ai.triage.asset_context`, `llm.structured`, `llm.TRIAGE_MODEL`.
- Produces: `BATCH = 20`; `enrich_events(db, asset) -> int` — key events without `enriched_at` get `impact`, `ai_links` (known key-event ids, ≤3, not self), `product` / `indications` only when missing, and `enriched_at`.

- [ ] **Step 1: Write the failing tests**

Create `crawler/ai/test_enrich.py`:

```python
"""Key-event enrichment (offline: the model call is stubbed)."""

from ai import enrich

ASSET = {"_id": "trep", "name": "Treprostinil", "aliases": [], "company": {"name": "United Therapeutics"}, "tags": {}}


def seed(db, n):
    for i in range(n):
        db.journey_events.insert_one({"_id": f"e{i}", "asset": "trep", "key": True, "date": f"20{10 + i % 10}-01-01",
                                      "type": "approval", "title": f"Event {i}", "summary": "s"})


def test_enriches_missing_fields_in_batches_and_marks_them_done(db, monkeypatch):
    seed(db, 25)
    db.journey_events.docs[0]["product"] = "Remodulin"  # rules already knew it: kept
    db.journey_events.insert_one({"_id": "low", "asset": "trep", "key": False, "date": "2010-01-01", "title": "Low"})
    calls = []

    def fake(model, system, user, name, schema, **kw):
        calls.append(user)
        ids = [line.split('"id": "')[1].split('"')[0] for line in user.split("Events: ")[1].split("}, {")]
        return {"events": [{"id": i, "indications": ["PAH"], "product": "Tyvaso", "impact": "First approval.",
                            "links": ["e1", "nope", i]} for i in ids]}

    monkeypatch.setattr(enrich.llm, "structured", fake)
    assert enrich.enrich_events(db, ASSET) == 25
    assert len(calls) == 2  # 20 + 5
    by_id = {d["_id"]: d for d in db.journey_events.docs}
    assert by_id["e0"]["product"] == "Remodulin" and by_id["e2"]["product"] == "Tyvaso"
    assert by_id["e2"]["impact"] == "First approval." and by_id["e2"]["indications"] == ["PAH"]
    assert by_id["e2"]["ai_links"] == ["e1"]  # unknown ids and self dropped
    assert by_id["e1"]["ai_links"] == []
    assert "enriched_at" in by_id["e2"] and "enriched_at" not in by_id["low"]
    assert enrich.enrich_events(db, ASSET) == 0  # nothing left to do


def test_an_event_the_model_skipped_is_retried_next_time(db, monkeypatch):
    seed(db, 2)
    monkeypatch.setattr(enrich.llm, "structured", lambda *a, **k: {"events": [
        {"id": "e0", "indications": [], "product": "", "impact": "", "links": []}]})
    assert enrich.enrich_events(db, ASSET) == 1
    by_id = {d["_id"]: d for d in db.journey_events.docs}
    assert by_id["e0"]["impact"] is None and "product" not in by_id["e0"] and "indications" not in by_id["e0"]
    assert "enriched_at" not in by_id["e1"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && ../.venv/bin/python -m pytest ai/test_enrich.py -q 2>&1 | tail -3`
Expected: FAIL — `ImportError: cannot import name 'enrich' from 'ai'`.

- [ ] **Step 3: Create `crawler/ai/enrich.py`**

```python
"""
Enrichment of key journey events (spec §4.3): the indications they concern, the product, a one-line "why it
matters" and links to related key events. Run at finalize on key events not enriched yet (rule events get their
deterministic fields from journey/rules.py; this fills what rules can't know). Batched; cached by content hash.
"""

import json
from datetime import datetime, timezone
from typing import Any, Dict

from pymongo import UpdateOne

from . import llm
from .events import clean_impact
from .triage import asset_context

BATCH = 20

SYSTEM = """You enrich journey events of ONE drug asset for pharma competitive-intelligence analysts. For each event
return:
- indications: the indication(s) it concerns as short standard names or abbreviations (e.g. PAH, PH-ILD, IPF);
  [] if neither stated nor clearly implied.
- product: the brand or product name it concerns, "" if none.
- impact: one factual sentence (max 25 words) on why it matters for this asset's journey, supported by the title
  and summary; "" if unsure. Never invent numbers or outcomes.
- links: ids from "All key events" of up to 3 events this one directly relates to (same trial, same filing,
  cause and effect); [] if none."""

SCHEMA = {
    "type": "object",
    "properties": {"events": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "indications": {"type": "array", "items": {"type": "string"}},
                       "product": {"type": "string"}, "impact": {"type": "string"},
                       "links": {"type": "array", "items": {"type": "string"}}},
        "required": ["id", "indications", "product", "impact", "links"], "additionalProperties": False}}},
    "required": ["events"], "additionalProperties": False,
}


def enrich_events(db, asset: Dict[str, Any]) -> int:
    asset_id = asset["_id"]
    todo = list(db.journey_events.find({"asset": asset_id, "key": True, "enriched_at": {"$exists": False}}))
    if not todo:
        return 0
    catalog = [{"id": e["_id"], "date": e.get("date"), "title": e.get("title")}
               for e in db.journey_events.find({"asset": asset_id, "key": True}, {"date": 1, "title": 1})]
    known = {c["id"] for c in catalog}
    context = json.dumps(asset_context(asset))
    done = 0
    for start in range(0, len(todo), BATCH):
        batch = todo[start:start + BATCH]
        payload = [{"id": e["_id"], "date": e.get("date"), "type": e.get("type"), "title": e.get("title"),
                    "summary": (e.get("summary") or "")[:400], "indication": e.get("indication") or ""} for e in batch]
        result = llm.structured(llm.TRIAGE_MODEL, SYSTEM,
                                f"Asset: {context}\nEvents: {json.dumps(payload)}\nAll key events: {json.dumps(catalog)}",
                                "enrich", SCHEMA)
        answers = {r["id"]: r for r in result["events"]}
        now = datetime.now(timezone.utc)
        ops = []
        for e in batch:
            r = answers.get(e["_id"])
            if r is None:
                continue  # skipped by the model: retried on the next finalize
            fields: Dict[str, Any] = {"enriched_at": now, "impact": clean_impact(r["impact"]),
                                      "ai_links": [i for i in dict.fromkeys(r["links"]) if i in known and i != e["_id"]][:3]}
            if not e.get("product") and r["product"].strip():
                fields["product"] = r["product"].strip()[:60]
            indications = [i.strip()[:40] for i in r["indications"] if i.strip()][:3]
            if not e.get("indications") and indications:
                fields["indications"] = indications
            ops.append(UpdateOne({"_id": e["_id"]}, {"$set": fields}))
        if ops:
            db.journey_events.bulk_write(ops, ordered=False)
            done += len(ops)
    return done
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && ../.venv/bin/python -m pytest ai/test_enrich.py -q 2>&1 | tail -3`
Expected: 2 passed.

---

### Task 7: Derivation at finalize, step log lines

**Files:**
- Create: `crawler/journey/derive.py`
- Modify: `crawler/service/steps.py` (finalize, journey, ai_triage, ai_events, regulatory, clinical)
- Modify: `crawler/ai/triage.py` (`triage_stored(asset, notable=None)`)
- Test: `crawler/journey/test_derive.py`, `crawler/service/test_steps.py` (update the finalize test, add log tests)

**Interfaces:**
- Consumes: `branches.refresh`, `branches.assign_all`, `key_events.mark`, `enrich.enrich_events`.
- Produces: `derive_journey(db, asset, log=...) -> {"branches": int, "key_events": int, "enriched": int, (+"branch_errors"/"enrich_errors": 1)}`; `triage_stored(asset, notable: Optional[list] = None)` appends `(title, decision)` for every new decision.

- [ ] **Step 1: Write the failing tests**

Create `crawler/journey/test_derive.py`:

```python
"""Finalize-time derivation (offline)."""

from journey import derive


def test_derive_runs_branches_keys_and_enrichment_in_order(db, monkeypatch):
    calls = []
    monkeypatch.setattr(derive.branches, "refresh", lambda db, asset: calls.append("refresh") or [{"id": "PAH"}, {"id": "IPF"}])
    monkeypatch.setattr(derive.branches, "assign_all", lambda db, asset_id: calls.append("assign") or 3)
    monkeypatch.setattr(derive.key_events, "mark", lambda db, asset_id: calls.append("key") or 7)
    monkeypatch.setattr(derive.enrich, "enrich_events", lambda db, asset: calls.append("enrich") or 5)
    lines = []
    out = derive.derive_journey(db, {"_id": "trep"}, log=lambda kind, text, **kw: lines.append((kind, text)))
    assert out == {"branches": 2, "key_events": 7, "enriched": 5}
    assert calls == ["refresh", "assign", "key", "enrich", "assign", "key"]
    assert lines[-1] == ("info", "2 indication branches · 7 key events")


def test_derive_keeps_previous_branches_when_the_llm_fails(db, monkeypatch):
    db.asset_branches.insert_one({"_id": "trep:PAH", "asset": "trep", "id": "PAH"})

    def down(*a, **k):
        raise RuntimeError("OPENAI_API_KEY is not set")

    monkeypatch.setattr(derive.branches, "refresh", down)
    monkeypatch.setattr(derive.enrich, "enrich_events", down)
    monkeypatch.setattr(derive.branches, "assign_all", lambda db, asset_id: 0)
    monkeypatch.setattr(derive.key_events, "mark", lambda db, asset_id: 4)
    lines = []
    out = derive.derive_journey(db, {"_id": "trep"}, log=lambda kind, text, **kw: lines.append((kind, text)))
    assert out == {"branches": 1, "branch_errors": 1, "enriched": 0, "enrich_errors": 1, "key_events": 4}
    assert [k for k, _ in lines] == ["warn", "warn", "info"]
```

In `crawler/service/test_steps.py`, replace the `journey` fixture and the finalize test with:

```python
@pytest.fixture
def journey(monkeypatch, db):
    monkeypatch.setattr(steps, "get_db", lambda: db)
    monkeypatch.setattr(steps, "build_rule_events", lambda db, asset_id, company: [{"_id": "rule:patent_expiry"}])
    monkeypatch.setattr(steps, "replace_rule_events", lambda db, asset_id, events: {"events": len(events), "new": 1,
                                                                                     "removed": 0})
    monkeypatch.setattr(steps, "derive_journey", lambda db, asset, log: {"branches": 6, "key_events": 41, "enriched": 3})
    return db


def test_finalize_rebuilds_the_journey_and_marks_the_asset_ready(journey):
    journey.assets.insert_one({**ASSET, "competitors": [{"id": "sotatercept", "name": "Sotatercept"}]})
    journey.journey_events.insert_one({"asset": "treprostinil", "is_milestone": True, "date": "2020-01-01",
                                       "type": "patent_expiry"})  # past: not next
    journey.journey_events.insert_one({"asset": "treprostinil", "is_milestone": True, "date": future(90),
                                       "type": "expected_readout"})
    journey.journey_events.insert_one({"asset": "treprostinil", "is_milestone": True, "date": future(400),
                                       "type": "patent_expiry"})
    assert steps.finalize(ctx()) == {"events": 1, "new": 1, "removed": 0, "branches": 6, "key_events": 41,
                                     "enriched": 3, "suggested_questions": 4,
                                     "summary": "Asset ready · 41 key events · 6 branches"}
    asset = journey.assets.find_one({"_id": "treprostinil"})
    assert asset["status"] == "ready" and asset["last_crawled_at"]
    assert asset["suggested_questions"][1] == "What is expected from Treprostinil's next trial readout, and when?"
    assert asset["suggested_questions"][2] == "How does Treprostinil compare with Sotatercept?"


def test_journey_step_logs_new_high_events(journey):
    lines = []
    c = StepContext(asset=ASSET, is_cancelled=lambda: False, log=lambda kind, text, **kw: lines.append((kind, text, kw)))
    journey.journey_events.insert_one({"_id": "old", "asset": "treprostinil", "significance": "High", "title": "Old"})

    def rebuild(db, asset_id, events):
        db.journey_events.insert_one({"_id": "new", "asset": "treprostinil", "significance": "High", "date": "2021-03-31",
                                      "title": "FDA approves efficacy supplement for Tyvaso",
                                      "sources": [{}], "merged_sources": [{}, {}]})
        db.journey_events.insert_one({"_id": "low", "asset": "treprostinil", "significance": "Low", "title": "Label"})
        return {"events": 3, "new": 2, "removed": 0}

    steps.replace_rule_events = rebuild  # restored by monkeypatch at teardown (fixture patched it)
    out = steps.journey(c)
    assert out["summary"] == "3 events from structured sources"
    assert lines == [("event", "FDA approves efficacy supplement for Tyvaso", {"event_id": "new", "merged": 3})]


def test_ai_triage_logs_a_sample_of_verdicts(monkeypatch):
    def triage(asset, notable=None):
        notable.extend([("FDA accepts sNDA", "ingest"), ("Market report", "skip"), ("Webinar", "headline")])
        return {"articles_ingest": 1, "articles_skip": 1, "articles_headline": 1}

    monkeypatch.setattr(steps, "triage_stored", triage)
    lines = []
    c = StepContext(asset=ASSET, is_cancelled=lambda: False, log=lambda kind, text, **kw: lines.append((kind, text, kw)))
    out = steps.ai_triage(c)
    assert lines[0] == ("ai", "“FDA accepts sNDA”", {"verdict": "Ingest"})
    assert {kw["verdict"] for _, _, kw in lines} == {"Ingest", "Skip", "Headline"}
    assert out["summary"] == "1 relevant · 1 dropped"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && ../.venv/bin/python -m pytest journey/test_derive.py service/test_steps.py -q 2>&1 | tail -4`
Expected: FAIL — `ModuleNotFoundError: No module named 'journey.derive'` / `AttributeError: ... 'derive_journey'`.

- [ ] **Step 3: Create `crawler/journey/derive.py`**

```python
"""
v3 journey derivation, run at finalize after the rule rebuild (spec §4): indication branches, key events and the
enrichment of key events. Branch assignment and key selection run twice: enrichment adds indications to AI events,
which can move them to a branch. LLM failures keep the previous branches / enrichment and are logged, never fatal.
"""

import logging
from typing import Any, Callable, Dict

from ai import enrich

from . import branches, key_events

logger = logging.getLogger("crawl.journey")


def _no_log(kind: str, text: str, **extra: Any) -> None:
    pass


def derive_journey(db, asset: Dict[str, Any], log: Callable[..., None] = _no_log) -> Dict[str, int]:
    asset_id = asset["_id"]
    counts: Dict[str, int] = {}
    try:
        counts["branches"] = len(branches.refresh(db, asset))
    except Exception as e:  # noqa: BLE001 - the LLM is optional; keep what we had
        logger.warning("branch derivation failed for %s", asset_id, exc_info=True)
        counts["branches"] = db.asset_branches.count_documents({"asset": asset_id})
        counts["branch_errors"] = 1
        log("warn", f"Couldn't re-derive indication branches ({type(e).__name__}); kept the previous ones")
    branches.assign_all(db, asset_id)
    key_events.mark(db, asset_id)
    try:
        counts["enriched"] = enrich.enrich_events(db, asset)
    except Exception as e:  # noqa: BLE001
        logger.warning("event enrichment failed for %s", asset_id, exc_info=True)
        counts["enriched"] = 0
        counts["enrich_errors"] = 1
        log("warn", f"Couldn't enrich key events ({type(e).__name__}); they'll be retried on the next refresh")
    branches.assign_all(db, asset_id)
    counts["key_events"] = key_events.mark(db, asset_id)
    log("info", f"{counts['branches']} indication branches · {counts['key_events']} key events")
    return counts
```

- [ ] **Step 4: Add `notable` to `triage_stored` (`crawler/ai/triage.py`)**

Change the signature to `def triage_stored(asset: Dict[str, Any], notable: Optional[List[Any]] = None) -> Dict[str, int]:` (add `Optional` to the typing import). After `decisions = judge(asset, items)`, add:

```python
        if notable is not None:
            titles = {i["key"]: i.get("title") or i["key"] for i in items}
            notable.extend((titles[k], d["decision"]) for k, d in decisions.items())
```

- [ ] **Step 5: Update `crawler/service/steps.py`**

Add the import `from journey.derive import derive_journey` (next to the other `journey` imports). Add helpers after `_tokens`:

```python
def _high_ids(db, asset_id: str) -> set:
    return {e["_id"] for e in db.journey_events.find({"asset": asset_id, "significance": "High"}, {"_id": 1})}


def _log_new_events(ctx: StepContext, db, before: set, cap: int = 40) -> None:
    """One feed line per new High event (the live build pops them on its timeline)."""
    new = [e for e in db.journey_events.find({"asset": ctx.asset_id, "significance": "High"},
                                             {"title": 1, "date": 1, "sources": 1, "merged_sources": 1})
           if e["_id"] not in before]
    for e in sorted(new, key=lambda e: e.get("date") or "")[:cap]:
        ctx.log("event", e.get("title") or e["_id"], event_id=e["_id"],
                merged=len(e.get("sources") or []) + len(e.get("merged_sources") or []))


VERDICTS = {"ingest": "Ingest", "headline": "Headline", "skip": "Skip"}


def _sample_verdicts(decisions: List[Any], per: Dict[str, int] = None) -> List[Any]:
    per = per or {"ingest": 6, "headline": 3, "skip": 3}
    taken: Dict[str, int] = {}
    out = []
    for title, decision in decisions:
        if taken.get(decision, 0) < per.get(decision, 0):
            taken[decision] = taken.get(decision, 0) + 1
            out.append((title, decision))
    return out
```

Replace `regulatory`'s return with:

```python
    return {"fda_new": fda_counts["inserted"], "fda_updated": fda_counts["updated"],
            "ema_new": ema_counts["inserted"], "ema_updated": ema_counts["updated"],
            "summary": f"Stored {fda_counts['inserted'] + fda_counts['updated']} FDA and "
                       f"{ema_counts['inserted'] + ema_counts['updated']} EMA records"}
```

Replace `clinical`'s return with:

```python
    return {"trials_new": counts["inserted"], "trials_updated": counts["updated"],
            "summary": f"Stored {counts['inserted'] + counts['updated']} studies ({counts['inserted']} new)"}
```

Replace `ai_triage`, `ai_events` and `journey`:

```python
def ai_triage(ctx: StepContext) -> StepResult:
    before = llm.usage_snapshot()
    notable: List[Any] = []
    counts = triage_stored(ctx.asset, notable=notable)
    for title, decision in _sample_verdicts(notable):
        ctx.log("ai", f"“{str(title)[:110]}”", verdict=VERDICTS[decision])
    relevant = sum(v for k, v in counts.items() if k.endswith("_ingest"))
    dropped = sum(v for k, v in counts.items() if k.endswith("_skip"))
    return {**counts, **_tokens(before), "summary": f"{relevant} relevant · {dropped} dropped"}


def ai_events(ctx: StepContext) -> StepResult:
    before, db = llm.usage_snapshot(), get_db()
    high_before = _high_ids(db, ctx.asset_id)
    counts = extract_events(ctx.asset)
    merged = consolidate(ctx.asset_id)
    _log_new_events(ctx, db, high_before)
    return {**counts, **merged, **_tokens(before),
            "summary": f"{counts['documents']} documents · {counts['events']} events extracted · {merged['merged']} merged"}


def journey(ctx: StepContext) -> StepResult:
    db = get_db()
    before = _high_ids(db, ctx.asset_id)
    counts = replace_rule_events(db, ctx.asset_id, build_rule_events(db, ctx.asset_id,
                                                                    ctx.asset.get("company", {}).get("name")))
    _log_new_events(ctx, db, before)
    return {**counts, "summary": f"{counts['events']} events from structured sources"}
```

Replace `finalize`:

```python
def finalize(ctx: StepContext) -> StepResult:
    """Rebuild rule events (patents found late belong in the journey too), derive branches / key events /
    enrichment, then mark the asset ready with its suggested questions. The worker bumps the cache version when
    the job ends."""
    db = get_db()
    counts = replace_rule_events(db, ctx.asset_id, build_rule_events(db, ctx.asset_id,
                                                                     ctx.asset.get("company", {}).get("name")))
    derived = derive_journey(db, ctx.asset, log=ctx.log)
    asset = db.assets.find_one({"_id": ctx.asset_id})  # fresh: competitors were written during this job
    questions = suggested_questions(db, asset)
    now = datetime.now(timezone.utc)
    db.assets.update_one({"_id": ctx.asset_id}, {"$set": {"status": "ready", "suggested_questions": questions,
                                                          "last_crawled_at": now, "updated_at": now}})
    return {**counts, **derived, "suggested_questions": len(questions),
            "summary": f"Asset ready · {derived.get('key_events', 0)} key events · {derived.get('branches', 0)} branches"}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd crawler && ../.venv/bin/python -m pytest -q 2>&1 | tail -3`
Expected: the whole crawler suite passes.

---

### Task 8: Job-end notifications

**Files:**
- Create: `crawler/service/notify.py`
- Modify: `crawler/service/worker.py`
- Test: `crawler/service/test_notify.py`

**Interfaces:**
- Produces: `DEFAULT_PREFS = {"highEvents": True, "crawls": True, "weeklyDigest": False}`; `recipients(db, pref) -> List[str]`; `push(db, pref, kind, title, sub, link) -> int`; `job_ended(db, job, asset, new_high) -> int`. Worker: `run_job_task` snapshots High event ids before the run and passes `measure`; `_finished(job, high_before=None)` notifies.

- [ ] **Step 1: Write the failing tests**

Create `crawler/service/test_notify.py`:

```python
"""Job-end notifications (offline)."""

from service import notify, steps
from service.jobs import new_job


def users(db, *ids):
    for i in ids:
        db.users.insert_one({"_id": i, "active": True})
    db.users.insert_one({"_id": "gone", "active": False})


def job(type="refresh", status="completed", failed=()):
    j = new_job("trep", type, steps.PLANS[type], None)
    j["status"] = status
    for s in j["steps"]:
        s["status"] = "failed" if s["name"] in failed else "done"
        s["error"] = "boom" if s["name"] in failed else None
    return j


def test_onboarding_finished_goes_to_everyone_who_wants_crawl_updates(db):
    users(db, "u1", "u2")
    db.user_prefs.insert_one({"user": "u2", "notify": {"crawls": False}})
    db.journey_events.insert_one({"asset": "trep"})
    n = notify.job_ended(db, job("onboard"), {"_id": "trep", "name": "Treprostinil", "status": "ready", "kind": "primary"}, [])
    assert n == 1
    [doc] = db.notifications.docs
    assert doc["user"] == "u1" and doc["kind"] == "onboarding_finished" and doc["read"] is False
    assert doc["title"] == "Treprostinil journey is ready" and doc["sub"] == "1 journey events"
    assert doc["link"] == "/assets/trep/overview"


def test_failed_steps_raise_a_job_failed_notification(db):
    users(db, "u1")
    j = job(failed=("patents",))
    notify.job_ended(db, j, {"_id": "trep", "name": "Treprostinil", "status": "ready", "kind": "primary"}, [])
    [doc] = db.notifications.docs
    assert doc["kind"] == "job_failed" and doc["title"] == "Treprostinil: 1 step failed"
    assert doc["link"] == f"/jobs/{j['_id']}"


def test_new_high_events_on_a_primary_asset(db):
    users(db, "u1")
    asset = {"_id": "trep", "name": "Treprostinil", "status": "ready", "kind": "primary"}
    notify.job_ended(db, job(), asset, [{"_id": "e1", "title": "FDA accepts Tyvaso sNDA for IPF"}])
    assert db.notifications.docs[-1]["title"] == "FDA accepts Tyvaso sNDA for IPF"
    assert db.notifications.docs[-1]["link"] == "/assets/trep/overview?focus=e1"
    notify.job_ended(db, job(), asset, [{"_id": "e1", "title": "A"}, {"_id": "e2", "title": "B"}])
    assert db.notifications.docs[-1]["title"] == "2 new high-significance events for Treprostinil"
    assert db.notifications.docs[-1]["sub"] == "A; B"
    before = len(db.notifications.docs)
    notify.job_ended(db, job("competitor"), {**asset, "kind": "competitor"}, [{"_id": "e3", "title": "C"}])
    assert len(db.notifications.docs) == before  # competitors don't notify for their own events


def test_high_event_preference_off(db):
    users(db, "u1")
    db.user_prefs.insert_one({"user": "u1", "notify": {"highEvents": False}})
    assert notify.job_ended(db, job(), {"_id": "trep", "name": "T", "status": "ready", "kind": "primary"},
                            [{"_id": "e1", "title": "A"}]) == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd crawler && ../.venv/bin/python -m pytest service/test_notify.py -q 2>&1 | tail -3`
Expected: FAIL — `ImportError: cannot import name 'notify' from 'service'`.

- [ ] **Step 3: Create `crawler/service/notify.py`**

```python
"""
In-app notifications written when a crawl job ends (spec §5): onboarding finished, failed steps, and new
High-significance events on primary assets. Fanned out to active users whose preferences allow the kind
(user_prefs.notify; defaults below). The API adds comment notifications.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List

DEFAULT_PREFS = {"highEvents": True, "crawls": True, "weeklyDigest": False}


def recipients(db, pref: str) -> List[str]:
    users = [str(u["_id"]) for u in db.users.find({"active": True}, {"_id": 1})]
    prefs = {p["user"]: p.get("notify") or {} for p in db.user_prefs.find({"user": {"$in": users}})}
    return [u for u in users if {**DEFAULT_PREFS, **prefs.get(u, {})}.get(pref)]


def push(db, pref: str, kind: str, title: str, sub: str, link: str) -> int:
    users = recipients(db, pref)
    now = datetime.now(timezone.utc)
    if users:
        db.notifications.insert_many([{"user": u, "kind": kind, "title": title, "sub": sub, "link": link, "read": False,
                                       "at": now} for u in users])
        db.notifications.create_index([("user", 1), ("at", -1)])
    return len(users)


def job_ended(db, job: Dict[str, Any], asset: Dict[str, Any], new_high: List[Dict[str, Any]]) -> int:
    name, asset_id = asset.get("name") or job["asset"], job["asset"]
    overview = f"/assets/{asset_id}/overview"
    failed = [s for s in job["steps"] if s["status"] == "failed"]
    sent = 0
    if job["status"] == "failed" or failed:
        title = (f"{name}: data collection failed" if job["status"] == "failed"
                 else f"{name}: {len(failed)} step{'s' if len(failed) != 1 else ''} failed")
        sub = ", ".join(s.get("label") or s["name"] for s in failed[:2]) or "See the crawl job for details"
        sent += push(db, "crawls", "job_failed", title, sub, f"/jobs/{job['_id']}")
    if job["type"] == "onboard" and asset.get("status") == "ready":
        events = db.journey_events.count_documents({"asset": asset_id})
        sent += push(db, "crawls", "onboarding_finished", f"{name} journey is ready", f"{events} journey events", overview)
    elif job["type"] != "onboard" and job["status"] != "cancelled" and new_high and asset.get("kind") == "primary":
        if len(new_high) == 1:
            title, sub, link = new_high[0]["title"], name, f"{overview}?focus={new_high[0]['_id']}"
        else:
            title = f"{len(new_high)} new high-significance events for {name}"
            sub, link = "; ".join(e["title"] for e in new_high[:2]), overview
        sent += push(db, "highEvents", "high_event", title, sub, link)
    return sent
```

- [ ] **Step 4: Wire it into `crawler/service/worker.py`**

Add imports:

```python
from . import notify  # noqa: E402
from .progress import measure  # noqa: E402
```

and `log = logging.getLogger("crawl.worker")` after `logging.basicConfig(...)`. Replace `_finished` and `run_job_task`:

```python
def _high_ids(db, asset_id: str) -> set:
    return {e["_id"] for e in db.journey_events.find({"asset": asset_id, "significance": "High"}, {"_id": 1})}


def _finished(job: Dict[str, Any], high_before: Optional[set] = None) -> None:
    db, asset_id = get_db(), job["asset"]
    db.assets.update_one({"_id": asset_id}, {"$set": {"last_crawled_at": datetime.now(timezone.utc)}})
    # finalize marks the asset ready; a job that ended without it (cancelled, or finalize failed / not planned)
    # leaves a new asset unusable, so say so instead of showing "onboarding" forever.
    if not any(s["name"] == "finalize" and s["status"] == "done" for s in job["steps"]):
        db.assets.update_one({"_id": asset_id, "status": "onboarding"}, {"$set": {"status": "failed"}})
    try:
        asset = db.assets.find_one({"_id": asset_id}) or {"_id": asset_id}
        new_high = ([{"_id": e["_id"], "title": e.get("title") or e["_id"]}
                     for e in db.journey_events.find({"asset": asset_id, "significance": "High"}, {"title": 1})
                     if e["_id"] not in high_before] if high_before is not None else [])
        notify.job_ended(db, job, asset, new_high)
    except Exception:  # noqa: BLE001 - notifications are best effort
        log.warning("notifications failed for job %s", job.get("_id"), exc_info=True)
    bump_asset_version(asset_id)


async def run_job_task(ctx, job_id: str) -> str:
    db = get_db()
    store = MongoJobStore(db)
    job = store.get(job_id)
    high_before = _high_ids(db, job["asset"]) if job else set()
    return await run_job(store, job_id, STEPS,
                         load_asset=lambda asset_id: db.assets.find_one({"_id": asset_id}),
                         on_finished=lambda asset_id: _finished(store.get(job_id), high_before),
                         measure=lambda asset_id: measure(db, asset_id))
```

(add `Optional` to the typing import).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd crawler && ../.venv/bin/python -m pytest -q 2>&1 | tail -3`
Expected: full crawler suite passes (including the existing `test_worker_fails_onboarding_assets_whose_job_never_finalized`).

---

### Task 9: Backfill, real-data verification, commit

**Files:**
- Create: `crawler/scripts/v3_backfill.py`

**Interfaces:**
- Consumes: `build_rule_events`, `replace_rule_events`, `derive_journey`, `bump_asset_version`.

- [ ] **Step 1: Create the backfill script**

```python
"""
One-off v3 backfill (spec §4): rebuild every asset's rule events (so they gain details / product / indications /
links), then derive indication branches, key events and enrichment, and bump the API cache. Safe to re-run: LLM
calls are cached by content hash and enrichment only touches events not enriched yet.

    docker compose exec crawler-worker python -m scripts.v3_backfill [asset_id ...]
"""

import sys

from dotenv import load_dotenv

load_dotenv()

from journey.derive import derive_journey  # noqa: E402
from journey.rules import build_rule_events  # noqa: E402
from journey.store import bump_asset_version, replace_rule_events  # noqa: E402
from storage.mongo_storage import get_db  # noqa: E402


def main(ids):
    db = get_db()
    query = {"_id": {"$in": ids}} if ids else {}
    assets = sorted(db.assets.find(query), key=lambda a: (a.get("kind") != "primary", a["_id"]))
    for a in assets:
        rules = replace_rule_events(db, a["_id"], build_rule_events(db, a["_id"], (a.get("company") or {}).get("name")))
        derived = derive_journey(db, a, log=lambda kind, text, **_: print(f"  [{kind}] {text}", flush=True))
        bump_asset_version(a["_id"])
        print(f"{a['_id']}: rules={rules} derived={derived}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
```

- [ ] **Step 2: Full crawler suite and lint-equivalent compile check**

Run: `cd crawler && ../.venv/bin/python -m pytest -q 2>&1 | tail -2 && ../.venv/bin/python -m compileall -q journey ai service scripts`
Expected: all tests pass; compileall prints nothing.

- [ ] **Step 3: Back up the local database**

Run the repo's backup procedure from `infra/mongo/README.md` (e.g. `infra/mongo/backup.sh` if present; otherwise `docker compose exec -T mongo mongodump --archive --gzip ... > backups/pre-v3-<date>.archive.gz`).
Expected: a non-empty archive in `backups/`.

- [ ] **Step 4: Rebuild the crawler containers and run the backfill**

Run: `docker compose build crawler-api crawler-worker && docker compose up -d crawler-api crawler-worker && docker compose exec -T crawler-worker python -m scripts.v3_backfill treprostinil`
Expected: one line `treprostinil: rules={...} derived={'branches': N, 'key_events': K, 'enriched': E}` with N ≥ 6.

- [ ] **Step 5: Verify the Phase 1 data acceptance (crawler side)**

Query Mongo (via `docker exec pharmaedge-hackathon_maverics-api-1 node -e …`):
- `asset_branches` for `treprostinil` contains PAH (`trunk`), PH-ILD (`from` PAH), IPF (`from` PH-ILD), PPF (`from` IPF), CTEPH (`from` PAH), PH-COPD (`from` PAH, `ended: "Terminated"`); extra closed programmes allowed.
- key events for treprostinil: 40–80 (`journey_events.countDocuments({asset:'treprostinil', key:true})`). If outside the range, tune `WINDOW_DAYS` / `candidate` with a ledgered ruling and a test.
- rule events carry `details`; key events carry `impact` (most), `branch` set on every event.
If a fixture branch is missing or mis-parented, adjust the `SYSTEM` prompt in `branches.py` (ledgered ruling), re-run the backfill for treprostinil.

- [ ] **Step 6: Backfill every asset**

Run: `docker compose exec -T crawler-worker python -m scripts.v3_backfill`
Expected: one line per asset (17), no tracebacks.

- [ ] **Step 7: Commit on `main`**

```bash
git add crawler/conftest.py crawler/service crawler/journey crawler/ai crawler/scripts/v3_backfill.py \
  docs/superpowers/plans/2026-10-09-v3-phase-1a-crawler.md
git commit -m "v3 phase 1a: job feed, event enrichment, indication branches, key events, notifications"
```
