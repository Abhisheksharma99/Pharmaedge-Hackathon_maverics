"""A failed LLM / embedding call must not lose the rest of a step. Run: cd crawler && ../.venv/bin/python -m pytest ai -q"""

import json

import pytest

from ai import events, index

ASSET = {"_id": "trep", "name": "Treprostinil"}


class FakeCollection:
    def __init__(self, docs=()):
        self.docs = list(docs)
        self.updates, self.writes = [], []

    def find(self, query, projection=None):
        return [d for d in self.docs if d.get("collection_hint", True)]

    def update_one(self, flt, update):
        self.updates.append(flt)

    def bulk_write(self, ops, ordered=False):
        self.writes.extend(ops)

    def delete_many(self, flt):
        pass

    def create_index(self, *a, **k):
        pass


class FakeDb(dict):
    def __getattr__(self, name):
        return self.setdefault(name, FakeCollection())

    def __getitem__(self, name):
        return self.setdefault(name, FakeCollection())


def fake_db(n):
    db = FakeDb()
    db["articles"] = FakeCollection([{"url": f"u{i}", "title": f"t{i}", "date": "2026-01-01", "content": "x"}
                                     for i in range(n)])
    return db


def test_extraction_keeps_going_past_a_failed_call(monkeypatch):
    db = fake_db(3)
    monkeypatch.setattr(events, "get_db", lambda: db)
    monkeypatch.setattr(events, "TRIAGED_SOURCES", {"articles": ("url", {}, "content")})

    def flaky(asset, coll, key_field, text_field, record):
        if record["url"] == "u1":
            raise ConnectionError("dns blip")
        return [{"_id": f"ai:{record['url']}"}]

    monkeypatch.setattr(events, "_extract_one", flaky)
    counts = events.extract_events(ASSET, workers=2)
    assert counts == {"documents": 2, "events": 2, "failed": 1}
    # Only successful records are marked done, so u1 is retried on the next run.
    assert [u["url"] for u in db["articles"].updates] == ["u0", "u2"]
    assert len(db.journey_events.writes) == 2


def test_extraction_fails_when_every_call_fails(monkeypatch):
    db = fake_db(2)
    monkeypatch.setattr(events, "get_db", lambda: db)
    monkeypatch.setattr(events, "TRIAGED_SOURCES", {"articles": ("url", {}, "content")})
    monkeypatch.setattr(events, "_extract_one", lambda *a: (_ for _ in ()).throw(ConnectionError("offline")))
    with pytest.raises(ConnectionError):
        events.extract_events(ASSET)


def test_indexing_skips_records_whose_embedding_failed(monkeypatch):
    db = fake_db(3)
    monkeypatch.setattr(index, "get_db", lambda: db)
    monkeypatch.setattr(index, "_sources", lambda asset_id: [("articles", "url", "content", {})])
    monkeypatch.setattr(index, "ensure_vector_index", lambda db: None)
    calls = iter([[[0.1]], ConnectionError("dns blip"), [[0.2]]])

    def embed(parts):
        result = next(calls)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(index.llm, "embed", embed)
    counts = index.index_asset("trep")
    assert counts == {"records": 2, "chunks": 2, "failed": 1}
    assert [u["url"] for u in db["articles"].updates] == ["u0", "u2"]  # u1 keeps no indexed_hash: retried


def test_consolidation_skips_a_cluster_whose_call_failed(monkeypatch):
    db = FakeDb()
    ev = lambda i, date, origin="ai": {"_id": f"e{i}", "asset": "trep", "category": "regulatory", "type": "approval",
                                       "date": date, "title": f"t{i}", "origin": origin, "sources": [{"k": i}]}
    db["journey_events"] = FakeCollection([ev(1, "2020-01-01"), ev(2, "2020-01-02"),     # cluster A (call fails)
                                           ev(3, "2022-05-01"), ev(4, "2022-05-03")])    # cluster B (merged)
    db["journey_events"].find = lambda q: type("C", (), {"sort": lambda self, *a: db["journey_events"].docs})()
    merged_ids = []
    db["journey_events"].update_one = lambda flt, upd: merged_ids.append(flt["_id"])
    db["journey_events"].delete_many = lambda flt: None
    monkeypatch.setattr(events, "get_db", lambda: db)
    calls = iter([ConnectionError("dns blip"), {"groups": [[0, 1]]}])

    def structured(*a):
        result = next(calls)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(events.llm, "structured", structured)
    assert events.consolidate("trep") == {"merged": 1, "merge_failed": 1}
    assert len(merged_ids) == 1


def test_usage_accounting_handles_embedding_responses():
    from types import SimpleNamespace
    from ai import llm
    before = llm.usage_snapshot()
    llm._record_usage(SimpleNamespace(usage=SimpleNamespace(prompt_tokens=7, total_tokens=7)))  # embeddings
    llm._record_usage(SimpleNamespace(usage=SimpleNamespace(prompt_tokens=5, completion_tokens=3)))  # chat
    after = llm.usage_snapshot()
    assert after["prompt_tokens"] - before["prompt_tokens"] == 12
    assert after["completion_tokens"] - before["completion_tokens"] == 3
    assert after["calls"] - before["calls"] == 2


def test_consolidation_covers_busy_windows_beyond_one_batch(monkeypatch):
    # 32 events within one 10-day window; the duplicate pair sits past the first batch.
    docs = [{"_id": f"e{i}", "asset": "trep", "category": "company", "type": "litigation", "origin": "ai",
             "date": f"2026-09-{20 + i // 4:02d}", "title": f"story {i}", "summary": "s" * (i % 3), "sources": [{"k": i}]}
            for i in range(32)]
    docs[21]["title"] = docs[22]["title"] = "Court rules Liquidia infringed the '327 patent"
    db = FakeDb()
    db["journey_events"] = FakeCollection(docs)
    db["journey_events"].find = lambda q: type("C", (), {"sort": lambda self, *a: docs})()
    absorbed = []
    db["journey_events"].update_one = lambda flt, upd: None
    db["journey_events"].delete_many = lambda flt: absorbed.extend(flt["_id"]["$in"])
    monkeypatch.setattr(events, "get_db", lambda: db)

    def same_title_groups(model, system, listing, *a):
        items = json.loads(listing)
        by_title = {}
        for item in items:
            by_title.setdefault(item["title"], []).append(item["index"])
        return {"groups": list(by_title.values())}

    monkeypatch.setattr(events.llm, "structured", same_title_groups)
    result = events.consolidate("trep")
    assert result["merged"] == 1 and len(absorbed) == 1 and absorbed[0] in ("e21", "e22")
