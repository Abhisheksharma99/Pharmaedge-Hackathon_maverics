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
