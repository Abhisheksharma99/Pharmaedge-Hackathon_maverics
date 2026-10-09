"""Adapter tests for the team crawlers. Run: cd crawler && ../.venv/bin/python -m pytest integrations -q"""

import asyncio

import pytest

from integrations import chmp, conferences, fda_calendar, newsroom, patents

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


MEETING = {
    "id": "meeting-highlights-chmp-24-27-june-2024", "url": "https://www.ema.europa.eu/en/news/m",
    "title": "Meeting highlights from the CHMP 24-27 June 2024", "published_at": "2024-06-28T12:01:00+02:00",
    "meeting": {"label": "24-27 June 2024", "start_date": "2024-06-24", "end_date": "2024-06-27"},
    "highlights": [{"heading": "New medicines", "text": "The committee recommended Winrevair (sotatercept) for PAH.\n"
                                                         "Ozempic got a new indication."}],
    "outcomes": [
        {"medicine_name": "Winrevair", "section": "Positive recommendations on new medicines", "opinion": "positive",
         "procedure": "new_medicine", "inn": None, "common_name": "sotatercept", "company": "Merck Sharp & Dohme B.V.",
         "therapeutic_indication": "Treatment of pulmonary arterial hypertension in adults",
         "status": "Pending EC decision", "ema_url": "https://www.ema.europa.eu/en/medicines/human/EPAR/winrevair"},
        {"medicine_name": "Ozempic", "section": "Extensions", "opinion": "positive",
         "procedure": "extension_of_indication", "inn": "semaglutide"},
    ],
}


def test_chmp_opinions_naming_the_asset_become_ema_records():
    [r] = chmp.to_records(MEETING, chmp.name_regex(["Sotatercept", "Winrevair"]))
    assert r["record_key"] == ("ema:chmp:meeting-highlights-chmp-24-27-june-2024:"
                               "positive-recommendations-on-new-medicines:winrevair")
    assert r["record_type"] == "ema_chmp_opinion" and r["source"] == "ema" and r["date"] == "2024-06-27"
    assert r["title"] == "CHMP recommends approval of Winrevair (sotatercept)"
    assert r["mentions"] == ["sotatercept", "Winrevair"] and r["status"] == "Pending EC decision"
    # Text for AI triage and extraction: this medicine's card and paragraphs, not the rest of the meeting.
    assert "Treatment of pulmonary arterial hypertension in adults" in r["content"]
    assert "recommended Winrevair (sotatercept)" in r["content"] and "Ozempic" not in r["content"]


def test_chmp_narrative_only_meetings_give_a_highlights_record():
    old = {**MEETING, "id": "m-2008", "outcomes": [], "meeting": {"label": "May 2008", "end_date": "2008-05-29"}}
    [r] = chmp.to_records(old, chmp.name_regex(["Ozempic"]))
    assert r["record_type"] == "ema_chmp_highlight" and r["record_key"] == "ema:chmp:m-2008:highlights"
    assert r["content"].endswith("Ozempic got a new indication.") and r["date"] == "2008-05-29"
    assert chmp.to_records(old, chmp.name_regex(["Tyvaso"])) == []


def test_chmp_names_match_whole_words_only():
    rx = chmp.name_regex(["Tyvaso", "ab"])  # names under 3 characters are ignored
    assert rx.search("Tyvaso DPI") and not rx.search("Tyvasox") and not rx.search("about")


def test_fda_calendar_record_uses_the_assets_spelling():
    event = {"date": "2026-05-24", "event_type": "pdufa", "calendar": "pdufa", "matched_terms": ["tyvaso dpi"],
             "ticker": "UTHR", "company": "United Therapeutics Corporation", "is_company": True,
             "title": "UTHR United Therapeutics Corporation PDUFA", "description": "d", "links": [],
             "evidence": [], "provenance": {"uid": "abc@google.com"}}
    r = fda_calendar.to_record(event, NAMES)
    assert r["record_key"] == "fda_calendar:abc@google.com" and r["record_type"] == "fda_calendar_event"
    assert r["title"] == "PDUFA date: Tyvaso DPI (United Therapeutics Corporation)" and r["drugs"] == ["Tyvaso DPI"]
    assert r["url"] == "https://www.fdatracker.com/fda-calendar/" and r["sponsor_is_company"] is True


def test_fda_calendar_source_links_remember_failures(tmp_path, monkeypatch):
    calls = []

    async def fetch(self, url, ttl_s, ctype="html", headers=None, attempts=6):
        calls.append(url)
        if url.endswith("/wrong-type"):
            raise ValueError("unexpected content-type 'application/pdf'")
        return {"/dead": 404, "/busy": 429}.get(url[url.rindex("/"):], 200), "page"

    monkeypatch.setattr(fda_calendar.Http, "get_html", fetch)
    web = fda_calendar.RemembersFailures(fda_calendar.Cache(tmp_path), public_web=True)

    async def twice(url):
        return [await web.get_html(url, 60) for _ in range(2)]

    assert asyncio.run(twice("https://x.com/dead")) == [(404, "page"), (404, "")]
    assert asyncio.run(twice("https://x.com/busy")) == [(429, "page"), (429, "page")]  # rate limits are retried
    assert asyncio.run(twice("https://x.com/ok")) == [(200, "page"), (200, "page")]  # successes: the crawler's cache
    for _ in range(2):
        with pytest.raises(ValueError, match="content-type"):
            asyncio.run(web.get_html("https://x.com/wrong-type", 60))
    # Successes are left to the crawler's own cache (stubbed out here, so /ok is fetched twice).
    assert calls == ["https://x.com/dead", "https://x.com/busy", "https://x.com/busy", "https://x.com/ok",
                     "https://x.com/ok", "https://x.com/wrong-type"]


def test_fda_calendar_skips_hosts_that_time_out(tmp_path, monkeypatch):
    calls = []

    async def fetch(self, url, ttl_s, ctype="html", headers=None, attempts=6):
        calls.append(url)
        return (0, "") if "tarpit" in url else (200, "page")

    monkeypatch.setattr(fda_calendar.Http, "get_html", fetch)
    web = fda_calendar.RemembersFailures(fda_calendar.Cache(tmp_path), public_web=True)

    async def links():  # concurrently, as fdacal fetches them
        return await asyncio.gather(*(web.get_html(f"https://tarpit.com/{n}", 60) for n in range(5)),
                                    web.get_html("https://ok.com/1", 60))

    assert asyncio.run(links()) == [(0, "")] * 5 + [(200, "page")]
    # One tarpit link waited for the timeout; the ones queued behind it skipped the host.
    assert len(calls) == 2 and "https://ok.com/1" in calls
    fresh = fda_calendar.RemembersFailures(fda_calendar.Cache(tmp_path), public_web=True)  # the next run
    assert asyncio.run(fresh.get_html("https://tarpit.com/9", 60)) == (0, "") and len(calls) == 2
