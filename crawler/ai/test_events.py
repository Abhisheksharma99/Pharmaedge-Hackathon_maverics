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
