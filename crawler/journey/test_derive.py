"""Finalize-time derivation (offline)."""

from journey import derive


def test_derive_runs_branches_keys_and_enrichment_in_order(db, monkeypatch):
    calls = []
    monkeypatch.setattr(derive.branches, "refresh", lambda db, asset: calls.append("refresh") or [{"id": "PAH"}, {"id": "IPF"}])
    monkeypatch.setattr(derive.branches, "assign_all", lambda db, asset_id: calls.append("assign") or 3)
    monkeypatch.setattr(derive.key_events, "mark", lambda db, asset_id: calls.append("key") or 7)
    monkeypatch.setattr(derive.enrich, "enrich_events", lambda db, asset: calls.append("enrich") or 5)
    lines = []
    out = derive.derive_journey(db, {"_id": "trep"}, log=lambda kind, text, **kw: lines.append((kind, text)))
    assert out == {"branches": 2, "key_events": 7, "enriched": 5}
    assert calls == ["refresh", "assign", "key", "enrich", "assign", "key"]
    assert lines[-1] == ("info", "2 indication branches · 7 key events")


def test_derive_keeps_previous_branches_when_the_llm_fails(db, monkeypatch):
    db.asset_branches.insert_one({"_id": "trep:PAH", "asset": "trep", "id": "PAH"})

    def down(*a, **k):
        raise RuntimeError("OPENAI_API_KEY is not set")

    monkeypatch.setattr(derive.branches, "refresh", down)
    monkeypatch.setattr(derive.enrich, "enrich_events", down)
    monkeypatch.setattr(derive.branches, "assign_all", lambda db, asset_id: 0)
    monkeypatch.setattr(derive.key_events, "mark", lambda db, asset_id: 4)
    lines = []
    out = derive.derive_journey(db, {"_id": "trep"}, log=lambda kind, text, **kw: lines.append((kind, text)))
    assert out == {"branches": 1, "branch_errors": 1, "enriched": 0, "enrich_errors": 1, "key_events": 4}
    assert [k for k, _ in lines] == ["warn", "warn", "info"]
