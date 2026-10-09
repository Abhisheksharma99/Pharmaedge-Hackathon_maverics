"""Key-event enrichment (offline: the model call is stubbed)."""

import json

from ai import enrich

ASSET = {"_id": "trep", "name": "Treprostinil", "aliases": [], "company": {"name": "United Therapeutics"}, "tags": {}}


def seed(db, n):
    for i in range(n):
        db.journey_events.insert_one({"_id": f"e{i}", "asset": "trep", "key": True, "date": f"20{10 + i % 10}-01-01",
                                      "type": "approval", "title": f"Event {i}", "summary": "s"})


def batch_ids(user):
    return [e["id"] for e in json.loads(user.split("Events: ")[1].split("\nAll key events: ")[0])]


def test_enriches_missing_fields_in_batches_and_marks_them_done(db, monkeypatch):
    seed(db, 25)
    db.journey_events.docs[0]["product"] = "Remodulin"  # rules already knew it: kept
    db.journey_events.insert_one({"_id": "low", "asset": "trep", "key": False, "date": "2010-01-01", "title": "Low"})
    calls = []

    def fake(model, system, user, name, schema, **kw):
        calls.append(user)
        return {"events": [{"id": i, "indications": ["PAH"], "product": "Tyvaso", "impact": "First approval.",
                            "links": ["e1", "nope", i]} for i in batch_ids(user)]}

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


def test_impact_written_at_extraction_is_kept(db, monkeypatch):
    seed(db, 2)
    db.journey_events.docs[0]["impact"] = "Extracted impact."
    monkeypatch.setattr(enrich.llm, "structured", lambda m, s, user, *a, **k: {"events": [
        {"id": i, "indications": [], "product": "", "impact": "Enriched impact.", "links": []} for i in batch_ids(user)]})
    assert enrich.enrich_events(db, ASSET) == 2
    by_id = {d["_id"]: d for d in db.journey_events.docs}
    assert by_id["e0"]["impact"] == "Extracted impact." and by_id["e1"]["impact"] == "Enriched impact."


def test_a_failing_batch_does_not_stop_the_next_ones(db, monkeypatch):
    seed(db, 25)
    calls = []

    def fake(model, system, user, *a, **k):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom")
        return {"events": [{"id": i, "indications": [], "product": "", "impact": "ok.", "links": []}
                           for i in batch_ids(user)]}

    monkeypatch.setattr(enrich.llm, "structured", fake)
    assert enrich.enrich_events(db, ASSET) == 5 and len(calls) == 2
