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


def test_sec_events_map_to_fda_records_with_evidence():
    from integrations import sec_regulatory
    event = {"_id": "abc123", "type": "complete_response_letter", "date": "2021-11-08",
             "sponsor": "United Therapeutics Corp", "status": "past", "first_reported": "2021-11-09",
             "last_reported": "2022-02-24", "evidence_count": 12,
             "sources": [{"sentence": "We received a complete response letter for Tyvaso DPI.", "drug_terms": ["tyvaso dpi"],
                          "source": {"url": "https://www.sec.gov/Archives/x.htm", "form": "8-K", "filed": "2021-11-09",
                                     "cik": "1082554", "company": "United Therapeutics Corp"}}] * 12}
    r = sec_regulatory.to_record(event, NAMES)
    assert r["record_key"] == "sec:abc123" and r["record_type"] == "sec_fda_action" and r["source"] == "sec_edgar"
    assert r["drugs"] == ["Tyvaso DPI"]                      # the asset's own spelling
    assert r["title"] == "Complete response letter: Tyvaso DPI (United Therapeutics Corp)"
    assert r["url"] == "https://www.sec.gov/Archives/x.htm" and r["evidence_count"] == 12
    assert len(r["evidence"]) == sec_regulatory.MAX_EVIDENCE  # bounded document
    assert r["evidence"][0] == {"sentence": "We received a complete response letter for Tyvaso DPI.",
                                "url": "https://www.sec.gov/Archives/x.htm", "form": "8-K", "filed": "2021-11-09", "cik": "1082554"}


def test_sec_step_reads_sec_only_and_skips_without_user_agent(monkeypatch):
    from types import SimpleNamespace

    from integrations import sec_regulatory
    cfg = SimpleNamespace(sec_user_agent=None, reg_max_filings=300, reg_window=lambda: ("2013-01-01", "2027-12-31"))
    monkeypatch.setattr(sec_regulatory, "settings", lambda: cfg)
    asset = {"_id": "treprostinil", "name": "Treprostinil", "company": {"name": "United Therapeutics"}}
    assert asyncio.run(sec_regulatory.fetch(asset, NAMES)) == ([], {"skipped": "SEC_USER_AGENT not configured"})
    seen = {}

    async def collect(http, **kw):
        seen.update(kw)
        return [], {"filings_read": 3}

    async def no_others(http, name):
        return ["treprostinil palmitil"]
    monkeypatch.setattr(sec_regulatory.regulatory, "collect", collect)
    monkeypatch.setattr(sec_regulatory, "other_products", no_others)
    cfg.sec_user_agent = "Acme Research ops@acme.example"
    assert asyncio.run(sec_regulatory.fetch(asset, NAMES)) == ([], {"filings_read": 3})
    assert seen["openfda"] is False and seen["companies"] == ["United Therapeutics"]   # SEC only, own company only
    assert seen["exclude"] == ["treprostinil palmitil"] and "Tyvaso" in seen["terms"]
    no_company = {"_id": "x", "name": "X", "company": {}}
    assert "skipped" in asyncio.run(sec_regulatory.fetch(no_company, ["X"]))[1]


def test_patent_refresh_runs_patents_only(monkeypatch):
    seen = {}

    async def run_drug(**kw):
        seen.update(kw)
        return {"coverage": {}}
    monkeypatch.setattr(patents, "run_drug", run_drug)
    asyncio.run(patents.fetch({"_id": "t", "name": "Treprostinil", "ids": {"adis": "800010447"}}, NAMES))
    assert (seen["regulatory"], seen["fda_calendar"], seen["market"]) == (False, False, False)


# ---------------------------------------------------------------- presentations + market (patent_intel data -> platform)

def test_presentation_slides_are_mapped_for_the_company_asset_only(mongo):
    from integrations import presentations
    src = mongo.client[presentations.PRESENTATIONS_DB]
    src.presentations.insert_many([
        {"_id": "pres_a", "company_id": "united-therapeutics", "status": "done", "title": "Q4 deck", "date": "2026-02-25",
         "source_url": "https://ir.example/q4.pdf"},
        {"_id": "pres_old", "company_id": "united-therapeutics", "status": "done", "superseded_by": "pres_a", "title": "old"},
        {"_id": "pres_other", "company_id": "merck", "status": "done", "title": "Merck deck"},
    ])
    src.presentation_pages.insert_many([
        {"_id": "pres_a:3", "presentation_id": "pres_a", "page": 3, "title": "TETON", "text": "Tyvaso in IPF\r\nTETON-2 met its endpoint"},
        {"_id": "pres_a:4", "presentation_id": "pres_a", "page": 4, "title": "Pipeline", "text": "Other programmes"},
        {"_id": "pres_a:5", "presentation_id": "pres_a", "page": 5, "title": "Financials", "text": "Revenue"},
        {"_id": "pres_old:1", "presentation_id": "pres_old", "page": 1, "text": "Tyvaso"},
        {"_id": "pres_other:1", "presentation_id": "pres_other", "page": 1, "text": "Tyvaso comparison"},
    ])
    src.presentation_claims.insert_many([
        {"presentation_id": "pres_a", "page": 3, "statement": "TETON-2 met its primary endpoint", "category": "efficacy", "stale": False},
        {"presentation_id": "pres_a", "page": 3, "statement": "retired claim", "stale": True},
        {"presentation_id": "pres_a", "page": 5, "statement": "Tyvaso revenue grew", "drug": "Tyvaso", "stale": False},
    ])
    src.presentation_metrics.insert_one({"presentation_id": "pres_a", "page": 3, "metric": "FVC change", "value": 95.6, "unit": "mL",
                                         "arm": "Tyvaso", "validation": {"status": "validated"}, "bbox": [0.1, 0.2, 0.3, 0.4], "stale": False})
    asset = {"_id": "treprostinil", "name": "Treprostinil", "company": {"name": "United Therapeutics Corp"}}
    records = {r["record_key"]: r for r in presentations.fetch(mongo, asset, ["Treprostinil", "Tyvaso"])}
    # slide 3 (text) and 5 (a claim names it); not slide 4, the superseded deck or another company's deck
    assert set(records) == {"presentation:pres_a:3", "presentation:pres_a:5"}
    slide = records["presentation:pres_a:3"]
    assert slide["record_type"] == "presentation_slide" and slide["url"] == "https://ir.example/q4.pdf" and slide["date"] == "2026-02-25"
    assert "TETON-2 met its primary endpoint" in slide["content"] and "retired claim" not in slide["content"]
    assert "- FVC change: 95.6 mL (Tyvaso) [validated]" in slide["content"]
    # readable for the panel: deck/slide titles, the company's name, the slide's own text without the facts
    assert (slide["deck_title"], slide["slide_title"], slide["title"]) == ("Q4 Deck", "TETON", "Q4 Deck, slide 3: TETON")
    assert slide["company"] == "United Therapeutics Corp" and slide["company_id"] == "united-therapeutics"
    assert slide["slide_text"] == "Tyvaso in IPF\nTETON-2 met its endpoint" and "Claims:" not in slide["slide_text"]
    assert slide["mentions"] == ["Tyvaso"] and records["presentation:pres_a:5"]["mentions"] == ["Tyvaso"]  # Company IR filter

    assert slide["metrics"][0]["bbox"] == [0.1, 0.2, 0.3, 0.4] and slide["evidence"]["page"] == 3
    assert list(presentations.fetch(mongo, {"_id": "x", "name": "X"}, ["X"])) == []  # no company: nothing


def test_market_reuses_fresh_stored_prices_and_never_matches_a_lookalike(monkeypatch):
    from datetime import datetime, timezone

    from integrations import market

    class FakeHttp:
        def __init__(self, cache): pass
        async def aclose(self): pass

    fetched = []

    async def fake_search(http, query, ttl):
        return [{"ticker": "UNH", "name": "UnitedHealth Group", "exchange": "NYSE"},
                {"ticker": "UTHR", "name": "United Therapeutics Corporation", "exchange": "NASDAQ"}]

    async def fake_closes(http, ticker, start, ttl):
        fetched.append(ticker)
        return {"ticker": ticker, "source": "test", "as_of": "2026-10-09", "bars": [{"date": "2026-10-09", "close": 1.0}],
                "fetched_at": datetime.now(timezone.utc).isoformat()}

    monkeypatch.setattr(market, "Http", FakeHttp)
    monkeypatch.setattr(market, "Cache", lambda root: None)
    monkeypatch.setattr(market.prices, "search", fake_search)
    monkeypatch.setattr(market.prices, "daily_closes", fake_closes)
    stored = {"UTHR": {"_id": "UTHR", "ticker": "UTHR", "source": "stored", "as_of": "2026-10-09", "bars": [{"date": "2026-10-09", "close": 2.0}],
                       "fetched_at": datetime.now(timezone.utc).isoformat()}}
    asset = {"_id": "treprostinil", "name": "Treprostinil", "company": {"name": "United Therapeutics"}}
    calendar = [{"ticker": "LQDA", "company": "Liquidia"}, {"ticker": "not a ticker!"}]
    listings, price_docs, report = asyncio.run(market.fetch(asset, calendar, stored.get))
    by = {d["ticker"]: d for d in listings}
    assert set(by) == {"UTHR", "LQDA"} and by["UTHR"]["roles"] == ["asset_company"] and by["LQDA"]["roles"] == ["fda_calendar_event"]
    assert by["UTHR"]["_id"] == "treprostinil:UTHR" and by["UTHR"]["stale"] is False
    assert fetched == ["LQDA"] and report["reused"] == ["UTHR"]  # fresh stored prices are not fetched again
    assert {d["_id"]: d["source"] for d in price_docs} == {"UTHR": "stored", "LQDA": "test"}


@pytest.mark.parametrize("raw,clean", [("q3 2025 presentation", "Q3 2025 Presentation"),
                                       ("12 01 2026 jpm presentation", "JPM Presentation"),
                                       ("2026 02 25 4q eps presentation", "4Q EPS Presentation"),
                                       ("2026 03 02 advance outcomes presentation", "Advance Outcomes Presentation"),
                                       ("R&D Day 2026", "R&D Day 2026"), ("", "Investor presentation")])
def test_deck_titles_from_file_names_are_readable(raw, clean):
    from integrations.presentations import deck_title
    assert deck_title(raw) == clean


def test_designations_match_the_asset_names_case_insensitively(mongo):
    from integrations import designations
    db_name, coll = designations.COLLECTION.split(".", 1)
    mongo.client[db_name][coll].insert_many([
        {"_id": "bt:1", "names": ["OFEV", "NINTEDANIB"], "approval_date": "2020-03-09", "program": "breakthrough_therapy",
         "program_name": "Breakthrough Therapy", "application_type": "NDA", "application_number": "205832",
         "submission_type": "supplement", "submission_number": 13, "proprietary_name": "OFEV", "established_name": "NINTEDANIB",
         "applicant": "BOEHRINGER", "indication": "Chronic fibrosing ILD", "source": {"file": "x.pdf", "page": 11}},
        {"_id": "pr:2", "names": ["OTHER"], "approval_date": "2020-01-01", "program": "priority_review"},
        {"_id": "pr:3", "names": ["XR"], "approval_date": "2020-01-01", "program": "priority_review"},
    ])
    [r] = list(designations.for_asset(mongo, ["Nintedanib", "Ofev", "XR"]))  # "XR" too short to match on
    assert r["record_key"] == "fda_designation:bt:1" and r["record_type"] == "fda_expedited_approval"
    assert (r["application_number"], r["submission_type"], r["submission_number"]) == ("NDA205832", "SUPPL", 13)
    assert r["title"] == "Breakthrough Therapy: OFEV (Chronic fibrosing ILD)" and r["date"] == "2020-03-09"
