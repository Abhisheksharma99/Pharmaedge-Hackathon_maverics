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
    return db


def test_finalize_rebuilds_the_journey_and_marks_the_asset_ready(journey):
    journey.assets.insert_one({**ASSET, "competitors": [{"id": "sotatercept", "name": "Sotatercept"}]})
    journey.journey_events.insert_one({"asset": "treprostinil", "is_milestone": True, "date": "2020-01-01",
                                       "type": "patent_expiry"})  # past: not next
    journey.journey_events.insert_one({"asset": "treprostinil", "is_milestone": True, "date": future(90),
                                       "type": "expected_readout"})
    journey.journey_events.insert_one({"asset": "treprostinil", "is_milestone": True, "date": future(400),
                                       "type": "patent_expiry"})
    assert steps.finalize(ctx()) == {"events": 1, "new": 1, "removed": 0, "suggested_questions": 4}
    asset = journey.assets.find_one({"_id": "treprostinil"})
    assert asset["status"] == "ready" and asset["last_crawled_at"]
    assert asset["suggested_questions"][1] == "What is expected from Treprostinil's next trial readout, and when?"
    assert asset["suggested_questions"][2] == "How does Treprostinil compare with Sotatercept?"


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
