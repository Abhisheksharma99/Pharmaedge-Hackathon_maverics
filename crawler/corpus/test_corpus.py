"""Corpus crawl tests (offline, mongomock). Run: cd crawler && ../.venv/bin/python -m pytest corpus -q"""

from datetime import datetime, timedelta, timezone

import pytest

import corpus
from corpus import company_pr, conferences, ema


@pytest.fixture
def source(monkeypatch):
    """A fake source 'demo' whose crawl records its calls; set .result to change what it returns."""
    calls = []

    def crawl(db, *, full, progress, should_stop):
        calls.append({"full": full, "progress": progress})
        if isinstance(crawl.result, Exception):
            raise crawl.result
        return dict(crawl.result)

    crawl.result = {"items": 1}
    monkeypatch.setattr(corpus, "sources", lambda: {"demo": corpus.Source(crawl),
                                                     "once": corpus.Source(crawl, once=True)})
    crawl.calls = calls
    return crawl


def test_full_crawl_first_then_daily_incremental(mongo, source):
    first = corpus.run_source(mongo, "demo")
    assert first == {"items": 1, "status": "done", "mode": "full"} and source.calls[0]["full"]
    assert corpus.complete(mongo, "demo")
    assert "skipped" in corpus.run_source(mongo, "demo")  # refreshed less than 20 h ago
    states = mongo.client[corpus.CORPUS_DB]["corpus_sources"]
    states.update_one({"_id": "demo"}, {"$set": {"last_success_at": datetime.now(timezone.utc) - timedelta(hours=21)}})
    assert corpus.run_source(mongo, "demo")["mode"] == "incremental" and not source.calls[1]["full"]
    assert corpus.run_source(mongo, "demo", force_full=True)["mode"] == "full"


def test_once_only_sources_are_never_crawled_again(mongo, source):
    corpus.run_source(mongo, "once")
    mongo.client[corpus.CORPUS_DB]["corpus_sources"].update_one(
        {"_id": "once"}, {"$set": {"last_success_at": datetime(2020, 1, 1, tzinfo=timezone.utc)}})
    assert corpus.run_source(mongo, "once") == {"skipped": "crawled once (once-only source)"}
    assert len(source.calls) == 1


def test_unfinished_full_crawls_resume_and_running_sources_are_left_alone(mongo, source):
    source.result = {"items": 1, "complete": False}  # e.g. spiders left to crawl
    assert corpus.run_source(mongo, "demo")["status"] == "partial" and not corpus.complete(mongo, "demo")
    corpus.progress_add(mongo, "demo", "spiders_done", "abbvie")
    source.result = {"items": 2}
    assert corpus.run_source(mongo, "demo")["mode"] == "full"  # still full: it never completed
    assert source.calls[1]["progress"] == {"spiders_done": ["abbvie"]}
    states = mongo.client[corpus.CORPUS_DB]["corpus_sources"]
    states.update_one({"_id": "demo"}, {"$set": {"status": "running", "heartbeat_at": datetime.now(timezone.utc)}})
    assert corpus.run_source(mongo, "demo", force_full=True) == {"skipped": "running in another worker"}
    states.update_one({"_id": "demo"}, {"$set": {"heartbeat_at": datetime.now(timezone.utc) - timedelta(minutes=10)}})
    assert corpus.run_source(mongo, "demo", force_full=True)["status"] == "done"  # its worker died


def test_a_failing_crawl_is_recorded_and_raised(mongo, source):
    source.result = RuntimeError("EMA down")
    with pytest.raises(RuntimeError):
        corpus.run_source(mongo, "demo")
    assert corpus.state(mongo, "demo")["status"] == "failed" and "EMA down" in corpus.state(mongo, "demo")["error"]


def item(spider, n, title="News"):
    return {"news_url": f"https://{spider}.com/{n}", "spider": spider, "title": title, "content": "...",
            "news_date": "2026-01-01"}


@pytest.fixture
def spiders(monkeypatch):
    runs = []

    def run(names, *, known_urls, limit=25, timeout_min=10, is_cancelled=lambda: False, keywords=()):
        runs.append({"spiders": names, "known": sorted(known_urls), "limit": limit})
        if "broken" in names and limit == 0:
            raise RuntimeError("spider crashed")
        return [item(s, n) for s in names for n in range(2 if limit == 0 else 3)], [{"errors": 0} for _ in names]

    monkeypatch.setattr(company_pr.newsroom, "run", run)
    monkeypatch.setattr(company_pr.newsroom, "catalog", lambda: (
        {"name": "abbvie", "category": "company"}, {"name": "fierce", "category": "news"},
        {"name": "broken", "category": "company"}, {"name": "google_news", "category": "news"}))
    return runs


def test_company_pr_crawls_each_spiders_history_then_newest_articles(mongo, spiders):
    counts = company_pr.crawl(mongo, full=True, progress={}, should_stop=lambda: False)
    assert [r["spiders"] for r in spiders] == [["abbvie"], ["fierce"], ["broken"]]  # google_news runs per asset
    assert counts == {"articles_new": 4, "spiders_crawled_full": 2, "spider_errors": 1, "complete": False}
    progress = {"spiders_done": ["abbvie", "fierce"]}
    assert company_pr.stored_spiders(mongo) == set()  # progress lives on the source state (run_source)
    spiders.clear()
    counts = company_pr.crawl(mongo, full=False, progress=progress, should_stop=lambda: False)
    # the failed spider's full history again, then the newest articles of the done ones, skipping stored URLs
    assert [(r["spiders"], r["limit"]) for r in spiders] == [(["broken"], 0), (["abbvie", "fierce"], 100)]
    assert spiders[1]["known"] == [f"https://{s}.com/{n}" for s in ("abbvie", "fierce") for n in range(2)]
    assert counts["articles_new"] == 2 and counts["complete"] is False  # broken still crashes
    stored = mongo.client["pharmaedge"]["company_pr_news"].find_one({"_id": "https://abbvie.com/2"})
    assert stored["category"] == "company" and stored["first_seen"]


def test_company_pr_items_match_the_asset_by_whole_word(mongo):
    company_pr.store(mongo, [item("fierce", 1, "Tyvaso DPI approved"), item("fierce", 2, "Tyvasomething else"),
                             item("reuters", 3, "Tyvaso sales")], {})
    assert [i["news_url"] for i in company_pr.items(mongo, ["fierce"], ["Tyvaso"])] == ["https://fierce.com/1"]
    assert len(list(company_pr.items(mongo, ["fierce", "reuters"]))) == 3


@pytest.fixture
def conference(monkeypatch, tmp_path):
    crawled = []

    def run(payload, out):
        year = payload["years"]
        crawled.append(year)
        if year == 2019:
            raise conferences.common.CrawlError("listing page failed")
        path = tmp_path / f"{year}.jsonl"
        rows = [] if year == 2027 else [{"id": f"ers-{year}-{n}", "title": f"A{n}", "matched_keywords": []}
                                        for n in range(2)]
        path.write_text("".join(conferences.json.dumps(r) + "\n" for r in rows))
        return {"abstracts_file": str(path)}

    monkeypatch.setitem(conferences.CONFERENCES, "ers", (run, lambda: {2027: {}, 2026: {}, 2025: {}, 2019: {}}))
    return crawled


def test_conferences_crawl_year_by_year_and_resume(mongo, conference):
    coll = mongo.client["pharmaedge"]["conference_abstracts"]
    coll.insert_one({"id": "ers-2025-0", "title": "copied from Atlas"})  # other _id: upserted on `id`
    crawl = conferences.crawler("ers")
    corpus.claim(mongo, "conference_ers")  # as run_source does: progress is kept on the source's state
    counts = crawl(mongo, full=True, progress={}, should_stop=lambda: False)
    assert conference == [2027, 2026, 2025, 2019]
    assert counts == {"years_crawled": 3, "abstracts": 4, "abstracts_new": 3, "year_errors": 1, "complete": False}
    assert coll.count_documents({}) == 4 and coll.find_one({"id": "ers-2025-0"})["title"] == "A0"
    assert "matched_keywords" not in coll.find_one({"id": "ers-2026-1"})
    done = corpus.state(mongo, "conference_ers")["progress"]
    assert sorted(done["years_done"]) == [2025, 2026] and "2019" in done["errors"]  # 2027 is empty: not done
    conference.clear()
    crawl(mongo, full=False, progress={"years_done": [2026, 2025, 2019]}, should_stop=lambda: False)
    assert conference == [2027]  # the newest year (empty, so also not done) is the only one left


def test_ema_reports_come_from_the_corpus_once_crawled(mongo, monkeypatch):
    live = []
    monkeypatch.setattr(ema.reports, "fetch_all", lambda names: live.append(names) or [{"record_key": "live"}])
    rows = [ema.reports.to_record("medicines", {"ema_product_number": "1", "name_of_medicine": "Tyvaso",
                                                "marketing_authorisation_date": "02/01/2020"}),
            ema.reports.to_record("medicines", {"ema_product_number": "2", "name_of_medicine": "Tyvasol"})]
    ema.store(mongo, rows)
    assert ema.for_asset(mongo, ["Tyvaso"]) == [{"record_key": "live"}]  # not crawled yet: straight from EMA
    corpus._states(mongo).insert_one({"_id": "ema_reports", "full_done_at": datetime.now(timezone.utc)})
    records = ema.for_asset(mongo, ["Tyvaso"])
    assert [r["record_key"] for r in records] == ["ema:medicines:1:Tyvaso"] and records[0]["date"] == "2020-01-02"
    assert live == [["Tyvaso"]]


def test_designations_are_parsed_from_the_pdfs_once(mongo, monkeypatch):
    from corpus import fda_designations

    def parse(payload, out):
        rows = [{"id": "breakthrough_therapy:NDA1:ORIG-1:2024-01-02:ab", "program": "breakthrough_therapy",
                 "application": "NDA 1", "names": ["TYVASO", "TREPROSTINIL"]}]
        (fda_designations.Path(out) / "designations.json").write_text(fda_designations.json.dumps(rows))
        return {"records_by_program": {"breakthrough_therapy": 1}, "sources": [{"check": "ok"}]}

    monkeypatch.setattr(fda_designations.parser, "crawl", parse)
    assert corpus.sources()["designations"].once
    assert corpus.run_source(mongo, "designations") == {
        "records": 1, "records_new": 1, "breakthrough_therapy": 1, "pdfs": 1, "pdf_row_mismatches": 0,
        "status": "done", "mode": "full"}
    stored = mongo.client["pharmaedge"]["fda_designations"].find_one()
    assert stored["_id"] == "breakthrough_therapy:NDA1:ORIG-1:2024-01-02:ab" and stored["names"][0] == "TYVASO"
    assert corpus.run_source(mongo, "designations") == {"skipped": "crawled once (once-only source)"}


# ---------------------------------------------------------------- drug master (lookup corpus)

def test_drug_master_parses_arrays_qualified_names_and_keys():
    from corpus import drug_master as dm
    assert dm.pg_array('{SNX-185,"Minocycline, controlled-release",NULL}') == ["SNX-185", "Minocycline, controlled-release"]
    assert dm.pg_array(None) == [] and dm.pg_array("plain") == ["plain"]
    assert dm.base_name("Sotatercept-csrk - Merck & Co") == "Sotatercept-csrk"
    assert dm.key("BI 1015550") == dm.key("BI-1015550") == "bi1015550"
    doc = dm.to_doc({"drug_id": "9", "drug_web_id": "800024655", "drug_name": "Sotatercept - Merck & Co", "competitor_name": "Sotatercept",
                     "alternative_drug_name": "{ACE-011,WINREVAIR,MK-7962,\"Sotatercept-csrk - Merck & Co\",AB}",
                     "competitor_company": "{Merck & Co}", "competitor_moa": "{Activin receptor antagonist}"})
    assert doc["_id"] == doc["adis_id"] == "800024655" and doc["name"] == "Sotatercept"
    assert doc["names"] == ["Sotatercept", "ACE-011", "WINREVAIR", "MK-7962", "Sotatercept-csrk", "AB"]
    assert "winrevair" in doc["keys"] and "mk7962" in doc["keys"] and "ab" not in doc["keys"]  # too short to index
    assert dm.to_doc({"drug_id": "1", "drug_web_id": "n/a", "drug_name": "X-1"})["_id"] == "row:1"


def test_drug_master_resolves_aliases_and_refuses_ambiguity(mongo):
    from corpus import drug_master as dm
    dm.store(mongo, [
        dm.to_doc({"drug_id": "1", "drug_web_id": "800010447", "drug_name": "Treprostinil - United Therapeutics Corporation",
                   "alternative_drug_name": "{Tyvaso,Remodulin}", "competitor_company": "{United Therapeutics}"}),
        dm.to_doc({"drug_id": "2", "drug_web_id": "800040000", "drug_name": "Treprostinil - Liquidia",
                   "alternative_drug_name": "{Yutrepia,LIQ861}", "competitor_company": "{Liquidia Technologies}"}),
        dm.to_doc({"drug_id": "3", "drug_web_id": "800024655", "drug_name": "Sotatercept - Merck & Co", "alternative_drug_name": "{WINREVAIR,MK-7962}"}),
    ])
    assert dm.resolve(mongo, ["winrevair"])["adis_id"] == "800024655"
    assert dm.resolve(mongo, ["MK 7962"])["name"] == "Sotatercept"
    assert dm.resolve(mongo, ["Treprostinil"]) is None  # two companies' entries: not guessed
    assert dm.resolve(mongo, ["Treprostinil"], "United Therapeutics Corp")["adis_id"] == "800010447"
    # the company's own formulation entry also matches a brand: the substance entry (canonical name) wins
    dm.store(mongo, [dm.to_doc({"drug_id": "4", "drug_web_id": "800051419", "drug_name": "Treprostinil dry powder inhalation - MannKind",
                                "alternative_drug_name": "{Tyvaso DPI}", "competitor_company": "{United Therapeutics Corporation}"})])
    assert dm.resolve(mongo, ["Treprostinil", "Tyvaso", "Tyvaso DPI", "Yutrepia"], "United Therapeutics")["adis_id"] == "800010447"
    assert dm.resolve(mongo, ["Treprostinil", "Tyvaso"], "Actelion (Janssen)") is None  # another company's asset: not guessed
    assert dm.resolve(mongo, ["Tyvaso DPI"], "Some Therapeutics Corporation") is not None  # single candidate needs no company
    assert dm.resolve(mongo, ["Yutrepia"])["adis_id"] == "800040000"
    assert dm.resolve(mongo, ["nonexistent drug"]) is None
    assert dm.store(mongo, [])["drugs"] == 0
