"""Onboarding-era steps and the worker's end-of-job status (offline). Run: cd crawler && ../.venv/bin/python -m pytest service -q"""

import asyncio
from datetime import date, timedelta

import pytest

from service import steps, worker
from service.jobs import new_job
from service.pipeline import StepContext, StepSkipped

ASSET = {"_id": "treprostinil", "name": "Treprostinil", "aliases": ["Tyvaso", "Tyvaso DPI", "Remodulin", "Orenitram"],
         "kind": "primary", "status": "onboarding", "company": {"name": "United Therapeutics"}}


def ctx(asset=ASSET, job_type="onboard"):
    return StepContext(asset=asset, is_cancelled=lambda: False, job_type=job_type)


def future(days):
    return (date.today() + timedelta(days=days)).isoformat()


@pytest.fixture
def journey(monkeypatch, db):
    monkeypatch.setattr(steps, "get_db", lambda: db)
    monkeypatch.setattr(steps, "build_rule_events", lambda db, asset_id, company: [{"_id": "rule:patent_expiry"}])
    monkeypatch.setattr(steps, "replace_rule_events", lambda db, asset_id, events: {"events": len(events), "new": 1,
                                                                                     "removed": 0})
    monkeypatch.setattr(steps, "derive_journey", lambda db, asset, log: {"branches": 6, "key_events": 41, "enriched": 3})
    monkeypatch.setattr(steps, "bump_asset_version", lambda asset_id: True)
    return db


def test_finalize_rebuilds_the_journey_and_marks_the_asset_ready(journey):
    journey.assets.insert_one({**ASSET, "competitors": [{"id": "sotatercept", "name": "Sotatercept"}]})
    journey.journey_events.insert_one({"_id": "e0", "asset": "treprostinil", "is_milestone": True, "date": "2020-01-01",
                                       "type": "patent_expiry"})  # past: not next
    journey.journey_events.insert_one({"_id": "e1", "asset": "treprostinil", "is_milestone": True, "date": future(90),
                                       "type": "expected_readout"})
    journey.journey_events.insert_one({"_id": "e2", "asset": "treprostinil", "is_milestone": True, "date": future(400),
                                       "type": "patent_expiry"})
    assert steps.finalize(ctx()) == {"events": 1, "new": 1, "removed": 0, "checks_unconfirmed": 0, "checks_conflict": 0,
                                     "checks_confirmed": 0, "branches": 6, "key_events": 41, "enriched": 3,
                                     "suggested_questions": 4, "summary": "Asset ready · 41 key events · 6 branches"}
    asset = journey.assets.find_one({"_id": "treprostinil"})
    assert asset["status"] == "ready" and asset["last_crawled_at"]
    assert asset["suggested_questions"][1] == "What is expected from Treprostinil's next trial readout, and when?"
    assert asset["suggested_questions"][2] == "How does Treprostinil compare with Sotatercept?"


def test_journey_step_logs_new_high_events(journey, monkeypatch):
    lines = []
    c = StepContext(asset=ASSET, is_cancelled=lambda: False, log=lambda kind, text, **kw: lines.append((kind, text, kw)))
    journey.journey_events.insert_one({"_id": "old", "asset": "treprostinil", "significance": "High", "title": "Old"})

    def rebuild(db, asset_id, events):
        db.journey_events.insert_one({"_id": "new", "asset": "treprostinil", "significance": "High", "date": "2021-03-31",
                                      "title": "FDA approves efficacy supplement for Tyvaso",
                                      "sources": [{}], "merged_sources": [{}, {}]})
        db.journey_events.insert_one({"_id": "low", "asset": "treprostinil", "significance": "Low", "title": "Label"})
        return {"events": 3, "new": 2, "removed": 0}

    monkeypatch.setattr(steps, "replace_rule_events", rebuild)
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


def test_questions_without_milestones_or_competitors_stay_generic(db):
    asset = {"_id": "x", "name": "Xdrug"}
    assert steps.suggested_questions(db, asset)[1:3] == ["What are the upcoming milestones for Xdrug?",
                                                         "Who are Xdrug's main competitors?"]
    db.assets.insert_one({"_id": "treprostinil", "name": "Treprostinil"})
    db.journey_events.insert_one({"asset": "x", "is_milestone": True, "date": future(10), "type": "launch"})
    assert steps.suggested_questions(db, {**asset, "competitor_of": ["treprostinil"]})[1:3] == [
        "What is expected from Xdrug's next launch, and when?", "How does Xdrug compare with Treprostinil?"]


def test_competitor_assets_get_no_competitors_of_their_own():
    with pytest.raises(StepSkipped):
        asyncio.run(steps.competitors(ctx({**ASSET, "kind": "competitor"}, "competitor")))


def test_company_site_uses_the_generic_crawler_for_other_websites(monkeypatch):
    from company import generic
    calls = {}

    def crawl(company, names, press_releases):
        calls.update(names=names, press_releases=press_releases)
        return [{"record_type": "company_page"}, {"record_type": "company_page"}, {"record_type": "press_release"}]

    monkeypatch.setattr(generic, "crawl", crawl)
    monkeypatch.setattr(steps.newsroom, "spiders_for_domain", lambda domain: [])
    monkeypatch.setattr(steps, "upsert_records", lambda coll, records, asset_id: {"inserted": 2, "updated": 1})
    asset = {**ASSET, "company": {"name": "Merck & Co.", "website": "https://www.merck.com/"}}
    assert steps.company_site(ctx(asset)) == {"company_page": 2, "press_release": 1, "new": 2}
    assert calls == {"names": ctx(asset).names, "press_releases": True}  # no newsroom spider for merck.com here
    with pytest.raises(StepSkipped):
        steps.company_site(ctx({**ASSET, "company": {"name": "X"}}))


@pytest.mark.parametrize("job_type, limit", [("competitor", 300), ("onboard", None)])
def test_competitor_jobs_take_the_newest_300_publications(monkeypatch, db, job_type, limit):
    from regulatory import pubmed_source
    seen = {}
    monkeypatch.setattr(steps, "get_db", lambda: db)
    monkeypatch.setattr(pubmed_source, "fetch", lambda names, known, max_results: seen.update(n=max_results) or [])
    steps.publications(ctx(job_type=job_type))
    assert seen["n"] == (limit or pubmed_source.MAX_RESULTS)


@pytest.mark.parametrize("job_type, searched", [("competitor", 3), ("refresh", 5)])
def test_competitor_jobs_search_newswires_for_three_names(monkeypatch, job_type, searched):
    import services.search_listing_crawler as listing
    terms = []

    class Crawler:
        async def run_rss_crawler(self, config, max_articles):
            terms.append(config["keyword"])
            feeds.append(config["rss_feed_urls"])
            return {}

    feeds = []
    monkeypatch.setattr(listing, "SearchListingCrawler", Crawler)
    asyncio.run(steps.news(ctx(job_type=job_type)))
    assert terms == ctx().names[:searched]
    assert any("bing.com/news/search" in url and "format=rss" in url for url in feeds[0])


@pytest.mark.parametrize("status, finalized, expected", [
    ("onboarding", False, "failed"),    # cancelled or finalize failed: the new asset is unusable
    ("onboarding", True, "onboarding"),  # (finalize itself sets "ready")
    ("ready", False, "ready"),          # a refresh that went wrong doesn't break an existing asset
])
def test_worker_fails_onboarding_assets_whose_job_never_finalized(monkeypatch, db, status, finalized, expected):
    monkeypatch.setattr(worker, "get_db", lambda: db)
    monkeypatch.setattr(worker, "bump_asset_version", lambda asset_id: True)
    db.assets.insert_one({"_id": "treprostinil", "status": status})
    job = new_job("treprostinil", "onboard", steps.PLANS["onboard"], None)
    job["steps"][-1]["status"] = "done" if finalized else "skipped"
    worker._finished(job)
    asset = db.assets.find_one({"_id": "treprostinil"})
    assert asset["status"] == expected and asset["last_crawled_at"]


def test_finalize_bumps_the_cache_version_after_marking_the_asset_ready(journey, monkeypatch):
    journey.assets.insert_one(dict(ASSET))
    seen = []
    monkeypatch.setattr(steps, "bump_asset_version",
                        lambda asset_id: seen.append((asset_id, journey.assets.find_one({"_id": asset_id})["status"])) or True)
    steps.finalize(ctx())
    assert seen == [("treprostinil", "ready")]


def _finish(monkeypatch, db, job, high_before, calls=None):
    monkeypatch.setattr(worker, "get_db", lambda: db)
    monkeypatch.setattr(worker, "bump_asset_version", lambda asset_id: (calls is not None and calls.append("bump")) or True)
    worker._finished(job, high_before)


def _refresh_job():
    job = new_job("treprostinil", "refresh", steps.PLANS["refresh"], None)
    for s in job["steps"]:
        s["status"] = "done"
    return job


def test_worker_bumps_the_cache_version_before_notifying(monkeypatch, db):
    db.assets.insert_one({"_id": "treprostinil", "name": "Treprostinil", "status": "ready", "kind": "primary"})
    calls = []
    monkeypatch.setattr(worker.notify, "job_ended", lambda *a, **k: calls.append("notify") or 0)
    _finish(monkeypatch, db, _refresh_job(), set(), calls)
    assert calls == ["bump", "notify"]


def test_worker_logs_when_the_cache_bump_fails(monkeypatch, db, caplog):
    db.assets.insert_one({"_id": "treprostinil", "name": "Treprostinil", "status": "ready", "kind": "primary"})
    monkeypatch.setattr(worker, "get_db", lambda: db)
    monkeypatch.setattr(worker, "bump_asset_version", lambda asset_id: False)
    with caplog.at_level("WARNING", logger="crawl.worker"):
        worker._finished(_refresh_job(), set())
    assert "cache version" in caplog.text


def test_only_recent_key_high_events_notify(monkeypatch, db):
    db.assets.insert_one({"_id": "treprostinil", "name": "Treprostinil", "status": "ready", "kind": "primary"})
    db.user_prefs.insert_one({"user": "u1", "notify": {}})
    db.users.insert_one({"_id": "u1", "active": True})
    job = _refresh_job()
    day = date.today()
    ev = lambda i, **kw: db.journey_events.insert_one({"_id": i, "asset": "treprostinil", "significance": "High",
                                                       "title": i, "key": True, "date": day.isoformat(), **kw})
    ev("old2015", date="2015-03-01")                               # moved between assets: not news
    ev("fresh", title="FDA approves Tyvaso DPI")                   # recent key High
    ev("notkey", key=False)                                        # not a key event
    ev("future", date=future(60), is_milestone=True, title="PDUFA date")
    ev("dup", title="FDA approves Tyvaso DPI")                     # near-duplicate title
    _finish(monkeypatch, db, job, set())
    [doc] = db.notifications.docs
    assert doc["title"] == "2 new high-significance events for Treprostinil"  # old, non-key and duplicate dropped
    assert sorted(doc["sub"].split("; ")) == ["FDA approves Tyvaso DPI", "PDUFA date"]


def test_a_reappearing_old_high_event_does_not_notify(monkeypatch, db):
    db.assets.insert_one({"_id": "treprostinil", "name": "Treprostinil", "status": "ready", "kind": "primary"})
    db.users.insert_one({"_id": "u1", "active": True})
    db.journey_events.insert_one({"_id": "old", "asset": "treprostinil", "significance": "High", "title": "TRANSIT-1",
                                  "key": True, "date": "2015-03-01"})
    _finish(monkeypatch, db, _refresh_job(), set())
    assert db.notifications.docs == []


def _event_lines(db, n):
    for i in range(n):
        db.journey_events.insert_one({"_id": f"e{i:02d}", "asset": "treprostinil", "significance": "High",
                                      "title": f"t{i:02d}", "date": f"2020-01-{i + 1:02d}"})


def test_log_new_events_shows_key_events_first_then_newest(db):
    _event_lines(db, 5)
    db.journey_events.docs[0]["key"] = True   # oldest, but key
    lines = []
    ctx_ = StepContext(asset=ASSET, is_cancelled=lambda: False, log=lambda kind, text, **x: lines.append((text, x["event_id"])))
    steps._log_new_events(ctx_, db, set(), cap=3)
    assert [i for _, i in lines] == ["e00", "e04", "e03"]
    assert lines[0][0] == "t00"


def test_finalize_reports_feedback_counts_in_the_step_result(journey):
    journey.assets.insert_one(dict(ASSET))
    journey.journey_events.insert_one({"_id": "ev1", "asset": "treprostinil", "date": "2024-03-01",
                                       "title": "Topline results from the Phase 3 trial announced"})
    journey.crawl_feedback.insert_one({"_id": "fb1", "asset": "treprostinil", "status": "open", "note_id": "n1",
                                       "title": "Phase 3 topline results"})
    journey.crawl_feedback.insert_one({"_id": "fb2", "asset": "treprostinil", "status": "open", "note_id": "n2",
                                       "title": "Zzz qqq"})
    result = steps.finalize(ctx())
    assert (result["feedback_checked"], result["feedback_resolved"], result["feedback_events_created"]) == (2, 1, 0)
    assert journey.crawl_feedback.find_one({"_id": "fb1"})["status"] == "resolved"
    assert journey.crawl_feedback.find_one({"_id": "fb2"})["status"] == "open"


def test_a_failed_feedback_recheck_still_leaves_the_asset_ready(journey, monkeypatch):
    journey.assets.insert_one(dict(ASSET))
    lines = []

    def boom(db, asset_id, log):
        raise RuntimeError("mongo down")

    monkeypatch.setattr(steps, "recheck_feedback", boom)
    result = steps.finalize(StepContext(asset=ASSET, is_cancelled=lambda: False, job_type="onboard",
                                        log=lambda kind, text, **x: lines.append((kind, text))))
    assert journey.assets.find_one({"_id": "treprostinil"})["status"] == "ready"
    assert "feedback_checked" not in result and result["branches"] == 6
    assert ("warn", "Couldn't re-check notes marked ‘Missed by AI’ (RuntimeError); they stay open") in lines
@pytest.fixture
def newsrooms(monkeypatch, mongo):
    """company_pr: abbvie's and fierce's full history in the corpus; live runs recorded."""
    from corpus import company_pr
    from storage import mongo_storage

    monkeypatch.setattr(steps, "get_db", lambda: mongo)
    monkeypatch.setattr(mongo_storage, "_db", mongo)  # upsert_records
    company_pr.store(mongo, [
        {"news_url": "https://abbvie.com/1", "spider": "abbvie", "title": "Treprostinil deal", "content": ""},
        {"news_url": "https://fierce.com/1", "spider": "fierce", "title": "Tyvaso data", "content": ""},
        {"news_url": "https://fierce.com/2", "spider": "fierce", "title": "Other drug", "content": ""}], {})
    mongo.client["pharmaedge"]["corpus_sources"].insert_one({"_id": "company_pr",
                                                             "progress": {"spiders_done": ["abbvie", "fierce"]}})
    runs = []

    def run(names, *, known_urls, keywords=(), limit=25, timeout_min=10, is_cancelled=lambda: False):
        runs.append({"spiders": names, "keywords": list(keywords)})
        return [{"news_url": f"https://{n}.com/live", "spider": n, "title": "Tyvaso news", "content": ""}
                for n in names], [{"errors": 0} for _ in names]

    monkeypatch.setattr(steps.newsroom, "run", run)
    return runs


def test_company_news_reads_spiders_in_the_corpus_and_crawls_the_others(newsrooms, monkeypatch, mongo):
    monkeypatch.setattr(steps.newsroom, "spiders_for_domain", lambda domain: ["abbvie", "abbvie_ir"])
    asset = {**ASSET, "company": {"name": "AbbVie", "website": "https://www.abbvie.com"}}
    counts = steps.company_news(ctx(asset))
    assert newsrooms == [{"spiders": ["abbvie_ir"], "keywords": []}]
    assert counts["from_corpus"] == 1 and counts["press_releases_new"] == 2
    assert {r["url"] for r in mongo.company_records.find()} == {"https://abbvie.com/1", "https://abbvie_ir.com/live"}


def test_industry_news_matches_the_corpus_and_searches_google_news_live(newsrooms, monkeypatch, mongo):
    monkeypatch.setattr(steps.newsroom, "news_spiders", lambda: ["fierce", "google_news"])
    monkeypatch.setattr(steps, "insert_article", lambda record, asset: mongo.articles.insert_one(record) and 1)
    counts = steps.industry_news(ctx())
    assert newsrooms == [{"spiders": ["google_news"], "keywords": ["Treprostinil", *ASSET["aliases"]]}]
    assert counts["from_corpus"] == 1 and counts["mentioning_asset"] == 2  # fierce/1 (corpus) + google_news (live)
    assert sorted(a["url"] for a in mongo.articles.find()) == ["https://fierce.com/1", "https://google_news.com/live"]


@pytest.mark.parametrize("interrupted", [False, True])
def test_corpus_worker_queues_every_group_on_startup(monkeypatch, interrupted):
    from service import corpus_worker

    queued = []

    class Redis:
        async def enqueue_job(self, fn, group, **opts):
            queued.append((fn, group, opts["_queue_name"], opts["_defer_by"]))

    monkeypatch.setattr(corpus_worker, "interrupted", lambda: interrupted)
    asyncio.run(corpus_worker.startup({"redis": Redis()}))
    assert [g for _, g, _, _ in queued] == corpus_worker.ENABLED == list(corpus_worker.GROUPS)
    assert {(fn, q) for fn, _, q, _ in queued} == {("corpus_group", "arq:corpus")}
    # After a killed worker, wait until its sources' heartbeats are stale, so they are resumed, not skipped.
    assert all((d > corpus_worker.STALE_AFTER) == interrupted for *_, d in queued)


def test_stopping_a_corpus_job_stops_its_crawl(monkeypatch):
    import sys

    from service import corpus_worker

    started = []
    real_exec = asyncio.create_subprocess_exec

    async def child(*args, **kwargs):  # stands in for `python -m corpus <group>`: exits cleanly on SIGTERM
        proc = await real_exec(sys.executable, "-c", "import signal, sys, time\n"
                               "signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))\ntime.sleep(60)")
        started.append(proc)
        return proc

    monkeypatch.setattr(corpus_worker.asyncio, "create_subprocess_exec", child)

    async def run_then_cancel():
        task = asyncio.create_task(corpus_worker.corpus_group({}, "ema"))
        while not started:
            await asyncio.sleep(0.05)
        await asyncio.sleep(0.5)  # let the child install its handler
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run_then_cancel())
    assert started[0].returncode == 0  # terminated gracefully, not killed


def test_ema_chmp_matches_the_corpus_and_never_crawls(monkeypatch, mongo):
    from integrations import chmp
    from storage import mongo_storage

    monkeypatch.setattr(steps, "get_db", lambda: mongo)
    monkeypatch.setattr(mongo_storage, "_db", mongo)
    monkeypatch.setattr(chmp, "refresh_corpus", lambda *a, **k: pytest.fail("the step must not crawl CHMP"))
    chmp.store_meetings(mongo, [{"id": "m1", "url": "https://ema/m1", "title": "CHMP 24-27 June 2024",
                                 "meeting": {"label": "24-27 June 2024", "end_date": "2024-06-27"},
                                 "outcomes": [{"medicine_name": "Tyvaso", "section": "Positive", "opinion": "positive",
                                               "procedure": "new_medicine"}]}])
    assert steps.ema_chmp(ctx()) == {"ema_chmp_opinion": 1, "new": 1, "corpus": "still being crawled"}
    mongo.client["pharmaedge"]["corpus_sources"].insert_one({"_id": "ema_chmp", "full_done_at": "2026-10-09"})
    assert steps.ema_chmp(ctx()) == {"ema_chmp_opinion": 1, "new": 0}


def test_jobs_interrupted_by_a_worker_restart_are_failed_and_unlock_their_asset(db):
    from service.jobs import INTERRUPTED, fail_interrupted

    job = new_job("treprostinil", "onboard", steps.PLANS["onboard"][:3], None)
    job["status"] = "running"
    job["steps"][0]["status"], job["steps"][1]["status"] = "done", "running"
    db.jobs.insert_one(job)
    db.jobs.insert_one({**new_job("other", "refresh", steps.PLANS["refresh"][:1], None), "status": "completed"})
    assert fail_interrupted(db) == ["treprostinil"]
    saved = db.jobs.find_one({"_id": job["_id"]})
    assert saved["status"] == "failed" and [s["status"] for s in saved["steps"]] == ["done", "failed", "skipped"]
    assert saved["steps"][1]["error"] == INTERRUPTED and saved["finished_at"]


def test_finalize_catches_up_on_records_stored_after_the_ai_steps(journey, monkeypatch):
    journey.assets.insert_one(ASSET)
    # stored after this job's AI steps ran: never triaged
    journey.company_records.insert_one({"record_key": "pr:late", "assets": ["treprostinil"], "record_type": "press_release", "title": "Late"})
    calls = []
    monkeypatch.setattr(steps, "triage_stored", lambda asset: calls.append("triage") or {"company_records_ingest": 1})
    monkeypatch.setattr(steps, "extract_events", lambda asset: calls.append("extract") or {"events": 2, "documents": 1})
    monkeypatch.setattr(steps, "consolidate", lambda asset_id: calls.append("consolidate") or {})
    monkeypatch.setattr(steps, "index_asset", lambda asset_id: calls.append("index") or {})
    out = steps.finalize(ctx())
    assert calls == ["triage", "extract", "consolidate", "index"]
    assert out["catch_up_untriaged"] == 1 and out["catch_up_kept"] == 1 and out["catch_up_events"] == 2


def test_finalize_survives_a_failed_catch_up(journey, monkeypatch):
    journey.assets.insert_one(ASSET)
    journey.company_records.insert_one({"record_key": "pr:late", "assets": ["treprostinil"], "record_type": "press_release"})
    monkeypatch.setattr(steps, "triage_stored", lambda asset: (_ for _ in ()).throw(RuntimeError("model down")))
    out = steps.finalize(ctx())
    assert out["catch_up_error"] == "RuntimeError: model down" and out["suggested_questions"] == 4
