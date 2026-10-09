"""Adapter tests for the team crawlers. Run: cd crawler && ../.venv/bin/python -m pytest integrations -q"""

import asyncio

import pytest

from integrations import conferences, newsroom, patents

NAMES = ["Treprostinil", "Tyvaso", "Tyvaso DPI"]


def test_conference_dates_prefer_session_then_publication_then_year():
    assert conferences._date({"session": {"start": "2026-05-17T12:15:00"}, "year": 2026}) == "2026-05-17"
    assert conferences._date({"session": {"start": None}, "publication": {"date": "2025-10-01"}, "year": 2025}) == "2025-10-01"
    assert conferences._date({"session": None, "publication": None, "year": 2024}) == "2024"


def test_conference_record_maps_the_shared_schema():
    doc = {"id": "ers-2025-PA1", "conference": "ERS", "meeting": "ERS Congress", "year": 2025, "title": "T",
           "abstract": "A", "authors": [{"name": "Ana C"}, {"name": None}, "junk"], "session": {"title": "PH"},
           "publication": {"journal": "ERJ", "date": "2025-11-18"}, "url": "https://x", "doi": "10.1/x"}
    r = conferences.to_record(doc, ["Tyvaso"])
    assert r["record_key"] == "conference:ers-2025-PA1" and r["source"] == "ers"
    assert r["record_type"] == "conference_abstract" and r["date"] == "2025-11-18"
    assert r["authors"] == ["Ana C"] and r["journal"] == "ERJ" and r["mentions"] == ["Tyvaso"]


def test_conference_prefilter_is_regex_safe():
    q = conferences._prefilter(["[177Lu]Lu-PSMA-617", "Tyvaso DPI"])
    assert q["$or"][0]["title"]["$regex"] == r"Tyvaso|\[177Lu\]Lu\-PSMA\-617"


def test_newsroom_spiders_match_company_domains(monkeypatch):
    monkeypatch.setattr(newsroom, "catalog", lambda: (
        {"name": "united_therapeutics", "category": "company", "domains": ["ir.unither.com"]},
        {"name": "fierce", "category": "news", "domains": ["www.fiercepharma.com"]},
        {"name": "nottheone", "category": "company", "domains": ["notunither.com"]},
    ))
    assert newsroom.spiders_for_domain("unither.com") == ["united_therapeutics"]
    assert newsroom.spiders_for_domain("") == []
    assert newsroom.spiders_for_domain("fiercepharma.com") == []  # news spiders are not newsrooms


def test_newsroom_items_map_to_press_releases_and_articles():
    item = {"spider": "united_therapeutics", "news_url": "https://ir.unither.com/press-releases/2026/1",
            "news_date": "2026-09-30", "title": "Tyvaso DPI data", "content": "treprostinil inhalation powder",
            "channel": "UT", "aggregator_source": "united_therapeutics", "tags": None}
    pr = newsroom.press_release(item, "United Therapeutics", NAMES)
    # Same key scheme as the records our UT adapter already stored, so upserts de-duplicate.
    assert pr["record_key"] == "united_therapeutics:press_release:https://ir.unither.com/press-releases/2026/1"
    assert pr["record_type"] == "press_release" and pr["mentions"] == NAMES and pr["tags"] == []
    art = newsroom.article(item, ["Tyvaso"])
    assert art["url"] == item["news_url"] and art["keyword"] == "Tyvaso" and art["date"] == "2026-09-30"


def test_mentions_are_whole_words():
    assert newsroom.mentions({"title": "Tyvasoxyz trial", "content": "pretreprostinil"}, NAMES) == []
    assert newsroom.mentions({"title": "TYVASO-DPI launch", "content": None}, NAMES) == ["Tyvaso", "Tyvaso DPI"]


def gp(number, events):
    return {"_id": f"GP:{number}", "publication_number": number, "title": "t", "events": events,
            "assignee_current": [], "assignee_original": ["UTC"], "cpc": [f"c{i}" for i in range(20)]}


def test_patent_record_prefers_adjusted_expiry_and_reads_grant():
    p = gp("US1B2", [{"type": "granted", "date": "2015-06-02", "title": "Application granted"},
                     {"type": "legal-status", "date": "2031-03-14", "title": "Anticipated expiration"},
                     {"type": "legal-status", "date": "2032-08-01", "title": "Adjusted expiration"}])
    r = patents.to_record(p, {"score": 1.0})
    assert r["grant_date"] == "2015-06-02" and r["expiry_date"] == "2032-08-01"
    assert r["assignees"] == ["UTC"] and len(r["cpc"]) == 10 and r["record_key"] == "patent:US1B2"
    assert patents.to_record(gp("US2A1", []), {})["expiry_date"] is None


def test_patent_fetch_keeps_only_included_links(monkeypatch):
    async def fake_run_drug(*, http, store, **kwargs):
        assert kwargs["adis_ref"] is None and kwargs["companies"] == ["United Therapeutics Corp", "United Therapeutics"]
        assert kwargs["seeds"] == ["US1B2"]
        await store.upsert("patents", [gp("US1B2", []), gp("US9B2", [])])
        await store.upsert("drug_patents", [
            {"patent_id": "GP:US1B2", "decision": "include", "match": {"score": 1.0}},
            {"patent_id": None, "decision": "uncertain", "match": {"score": 0.9}},
        ])
        return {"coverage": {"pages_fetched": 3}}

    class FakeHttp:
        def __init__(self, cache): pass
        async def aclose(self): pass

    monkeypatch.setattr(patents.llm, "structured", lambda *a, **k: {"assignees": ["United Therapeutics Corp", " "]})
    monkeypatch.setattr(patents, "search_seeds", lambda names: ["US1B2"])
    monkeypatch.setattr(patents, "run_drug", fake_run_drug)
    monkeypatch.setattr(patents, "Http", FakeHttp)
    monkeypatch.setattr(patents, "Cache", lambda root: None)
    asset = {"_id": "treprostinil", "name": "Treprostinil", "company": {"name": "United Therapeutics"}}
    records, coverage = asyncio.run(patents.fetch(asset, NAMES))
    assert [r["record_key"] for r in records] == ["patent:US1B2"] and coverage["pages_fetched"] == 3
    with pytest.raises(ValueError):
        asyncio.run(patents.fetch({"_id": "x", "name": "X", "company": {}}, ["X"]))


def test_patent_assignees_fall_back_to_the_company_when_the_model_fails(monkeypatch):
    monkeypatch.setattr(patents.llm, "structured", lambda *a, **k: (_ for _ in ()).throw(ConnectionError("offline")))
    assert patents.patent_assignees({"name": "X", "company": {"name": "Acme"}}, ["X"]) == ["Acme"]


def test_patent_search_seeds_are_publication_numbers_and_never_fail(monkeypatch):
    seen = {}

    class Resp:
        def json(self):
            return {"results": {"cluster": [{"result": [{"patent": {"publication_number": "US10016159B2"}},
                                                        {"patent": {"publication_number": "WO2022192420A2"}}]}]}}

    monkeypatch.setattr(patents.requests, "get", lambda url, **kw: seen.update(url=url) or Resp())
    assert patents.search_seeds(["Sotatercept", "MK-7962"]) == ["US10016159B2", "WO2022192420A2"]
    assert "%22Sotatercept%22%20OR%20%22MK-7962%22" in seen["url"]
    monkeypatch.setattr(patents.requests, "get", lambda url, **kw: (_ for _ in ()).throw(ConnectionError()))
    assert patents.search_seeds(["X"]) == []
