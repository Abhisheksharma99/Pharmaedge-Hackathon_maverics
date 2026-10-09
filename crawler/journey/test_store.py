"""Asset ids (contract slug rule). Run: cd crawler && ../.venv/bin/python -m pytest journey -q"""

import pytest

from journey.store import asset_id


@pytest.mark.parametrize("name, slug", [
    ("Treprostinil", "treprostinil"), ("treprostinil", "treprostinil"), ("Tyvaso DPI", "tyvaso-dpi"),
    ("Merck & Co.", "merck-co"), (" -ACE-011- ", "ace-011"), ("[177Lu]Lu-PSMA-617", "177lu-lu-psma-617"),
    ("Sotatercept–csrk", "sotatercept-csrk"),
])
def test_asset_ids_are_contract_slugs(name, slug):
    assert asset_id(name) == slug


def test_rebuild_unsets_links_when_no_related_events_remain(db):
    from journey.store import replace_rule_events
    db.journey_events.insert_one({"_id": "rule:a", "asset": "x", "origin": "rule", "links": ["rule:b"], "ai_links": ["z"]})
    replace_rule_events(db, "x", [{"_id": "rule:a", "asset": "x", "origin": "rule", "title": "t"}])
    doc = db.journey_events.docs[0]
    assert "links" not in doc and doc["ai_links"] == ["z"]
