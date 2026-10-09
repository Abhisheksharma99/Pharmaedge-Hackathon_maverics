"""Resolve: facts -> model -> verified identity card (offline). Run: cd crawler && ../.venv/bin/python -m pytest onboarding -q"""

import json

import pytest
from fastapi.testclient import TestClient

from onboarding import resolve
from service import api
from service.steps import PLANS

NEWS_PAGE = "<h1>News</h1> Press release Jan 5, 2026 ... Feb 12, 2026 ... March 3, 2026 ... 2025-12-01"


def model_says(**overrides):
    answer = {"found": True, "name": "Sotatercept", "aliases": ["Winrevair", "sotatercept", "MK-7962", "WINREVAIR"],
              "company": {"name": "Merck & Co.", "websites": ["https://www.merck-wrong.com", "merck.com"],
                          "ir_url": "https://www.merck.com/media/news/"},
              "indications": ["Pulmonary arterial hypertension (PAH)"], "investigational_indications": [],
              "mechanism": "Activin signaling inhibitor", "modality": "Biologic", **overrides}

    def structured(model, system, user, schema_name, schema, reasoning_effort=None):
        model_says.facts = json.loads(user)["facts"]
        return answer
    return structured


@pytest.fixture
def offline(monkeypatch, db):
    """Sources, model, web and spider list stubbed: FDA answers, EMA is down, trials answer."""
    monkeypatch.setattr(resolve, "_fda_facts", lambda q: (2, {"applications": [{"sponsor_name": "MERCK SHARP DOHME"}]}))
    monkeypatch.setattr(resolve, "_ema_facts", lambda q: (_ for _ in ()).throw(ConnectionError("EMA down")))
    monkeypatch.setattr(resolve, "_trial_facts", lambda q: (23, {"lead_sponsors": ["Merck Sharp & Dohme LLC"]}))
    monkeypatch.setattr(resolve.newsroom, "catalog", lambda: ())
    monkeypatch.setattr(resolve.newsroom, "spiders_for_domain", lambda d: ["merck"] if d == "merck.com" else [])
    monkeypatch.setattr(resolve.llm, "structured", model_says())
    monkeypatch.setattr(resolve, "get_db", lambda: db)
    pages = {"https://merck.com": ("https://www.merck.com/", "<title>Merck.com</title> Merck & Co., Inc."),
             "https://www.merck.com/news": ("https://www.merck.com/news", NEWS_PAGE)}
    monkeypatch.setattr(resolve, "_fetch", lambda url, timeout: pages.get(url))
    return pages


def test_identity_merges_facts_and_verifies_the_company(offline):
    identity = resolve.resolve("winrevair")
    assert identity["id"] == "sotatercept" and identity["name"] == "Sotatercept"
    assert identity["aliases"] == ["Winrevair", "MK-7962"]  # no duplicates, not the name itself
    assert model_says.facts["ema"] == {} and model_says.facts["trials"]["lead_sponsors"]
    assert identity["sources"] == {"fda": 2, "ema": 0, "trials": 23}  # a failing source counts 0
    # The first candidate website doesn't answer; the second does and names the company (kept as redirected).
    assert identity["company"] == {"name": "Merck & Co.", "website": "https://www.merck.com",
                                   "ir_url": "https://www.merck.com/news"}  # model's IR page fails, /news verifies
    assert identity["website_verified"] and identity["ir_verified"]
    assert identity["tags"]["modality"] == "Biologic"
    assert identity["exists"] is False and identity["existing"] is None
    assert [s["name"] for s in identity["plan"]] == [s["name"] for s in PLANS["onboard"]]
    notes = {s["name"]: s["note"] for s in identity["plan"]}
    assert notes["clinical"] == "23 trials found"
    assert notes["company_site"] == "generic crawler: product pages and PDFs from merck.com"
    assert notes["company_news"] == "newsroom spider merck"
    assert identity["plan_summary"] == ("FDA, 23 trials, PubMed, merck.com site, Merck & Co. newsroom (merck spider), "
                                        "newswires, competitors, patents")
    assert identity["notes"] == ["No AdisInsight id: patents are searched by name and company"]


def test_unverified_pages_and_existing_competitors_are_noted(offline, monkeypatch, db):
    offline.clear()  # nothing answers
    db.assets.insert_one({"_id": "sotatercept", "kind": "competitor", "status": "ready"})
    identity = resolve.resolve("sotatercept")
    assert identity["company"]["website"] == "https://www.merck-wrong.com"  # model's first guess, unverified
    assert identity["company"]["ir_url"] == "https://www.merck.com/media/news/"
    assert not identity["website_verified"] and not identity["ir_verified"]
    assert identity["exists"] and identity["existing"] == {"id": "sotatercept", "kind": "competitor", "status": "ready"}
    assert identity["notes"][0] == "Sotatercept is tracked as a competitor; adding it makes it a primary asset"
    assert any("Could not verify https://www.merck-wrong.com" in n for n in identity["notes"])
    assert any("Press-release page not verified" in n for n in identity["notes"])


def test_unknown_drugs_are_not_resolved(offline, monkeypatch):
    monkeypatch.setattr(resolve.llm, "structured", model_says(found=False, name=""))
    assert resolve.resolve("zzzz") is None


def test_resolve_endpoint_returns_404_when_unresolved(monkeypatch):
    monkeypatch.setenv("CRAWLER_SERVICE_KEY", "k")
    monkeypatch.setattr(api, "resolve", lambda q: None)
    resp = TestClient(api.app).post("/resolve", json={"query": " zzzz "}, headers={"x-service-key": "k"})
    assert resp.status_code == 404 and resp.json()["detail"]["code"] == "ASSET_NOT_RESOLVED"
    assert TestClient(api.app).post("/resolve", json={"query": "  "}, headers={"x-service-key": "k"}).status_code == 422


@pytest.mark.parametrize("company, word", [("Merck & Co.", "merck"), ("United Therapeutics", "united"),
                                           ("Gossamer Bio, Inc.", "gossamer")])
def test_company_word_skips_generic_words(company, word):
    assert resolve._distinctive_word(company) == word


def test_news_listing_needs_several_dates():
    assert resolve._is_news_listing(NEWS_PAGE)
    assert not resolve._is_news_listing("<h1>News</h1> Updated Jan 5, 2026")


def test_a_new_inn_known_only_to_the_registries_keeps_the_typed_name(offline, monkeypatch):
    # The model doesn't know the INN yet: it names the drug by its code and lists the INN as an alias.
    monkeypatch.setattr(resolve.llm, "structured", model_says(name="HZN-825", aliases=["fipaxalparant", "HZN-825 BID"]))
    identity = resolve.resolve("fipaxalparant")
    assert identity["id"] == "fipaxalparant" and identity["name"] == "Fipaxalparant"
    assert identity["aliases"] == ["HZN-825"]  # dosing regimen stripped, duplicates dropped


def test_trial_facts_fall_back_to_full_text_for_names_only_in_trial_text(monkeypatch):
    calls = []

    class Client:
        def __init__(self, timeout):
            pass

        def get(self, path, params):
            calls.append(params)
            if "query.intr" in params:
                return {"studies": [], "totalCount": 0}
            return {"totalCount": 1, "studies": [{"protocolSection": {
                "sponsorCollaboratorsModule": {"leadSponsor": {"name": "Amgen"}},
                "conditionsModule": {"conditions": ["Systemic sclerosis"]},
                "statusModule": {"overallStatus": "RECRUITING"}, "designModule": {"phases": ["PHASE2"]},
                "armsInterventionsModule": {"interventions": [{"name": "HZN-825 BID", "type": "DRUG"},
                                                              {"name": "Placebo", "type": "DRUG"}]}}}]}

    monkeypatch.setattr(resolve, "ClinicalTrialsClient", Client)
    count, facts = resolve._trial_facts("fipaxalparant")
    assert [("query.intr" in c, "query.term" in c) for c in calls] == [(True, False), (False, True)]
    assert count == 1 and facts["lead_sponsors"] == ["Amgen"] and facts["intervention_names"] == ["HZN-825 BID"]
