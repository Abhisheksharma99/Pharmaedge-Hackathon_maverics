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


# ---------------------------------------------------------------- rule-event identity (shared records)

from journey.rules import trial_events  # noqa: E402
from journey.store import replace_rule_events  # noqa: E402

TRIAL = {"record_key": "ctgov:NCT1", "nct_id": "NCT1", "title": "Head-to-head", "phases": ["PHASE3"],
         "overall_status": "COMPLETED", "start_date": "2020-01-01", "primary_completion_date": "2022-01-01",
         "lead_sponsor": "Acme"}


def test_a_shared_record_keeps_an_event_for_each_asset(mongo):
    """Before: ids had no asset, so the second asset's refresh took the event and the first's cleanup deleted it."""
    for asset in ("drug-a", "drug-b", "drug-a"):  # refresh order that used to leave drug-a without its event
        replace_rule_events(mongo, asset, trial_events(asset, [TRIAL], "Acme"))
    held = sorted((e["asset"], e["type"]) for e in mongo.journey_events.find())
    assert held == [("drug-a", "trial_completion"), ("drug-a", "trial_start"),
                    ("drug-b", "trial_completion"), ("drug-b", "trial_start")]


def test_merged_evidence_survives_the_id_change(mongo):
    legacy = {"_id": "rule:trial_start:ctgov:NCT1", "asset": "drug-a", "origin": "rule", "type": "trial_start",
              "sources": [{"collection": "trial_records", "record_key": "ctgov:NCT1"}],
              "merged_sources": [{"collection": "articles", "record_key": "https://news/x"}], "merged_from": ["ai:drug-a:x:0"]}
    other = {**legacy, "_id": "rule:trial_start:ctgov:NCT9", "asset": "drug-b"}  # another asset's: not touched
    mongo.journey_events.insert_many([legacy, other])
    counts = replace_rule_events(mongo, "drug-a", trial_events("drug-a", [TRIAL], "Acme"))
    new = mongo.journey_events.find_one({"_id": "rule:drug-a:trial_start:ctgov:NCT1"})
    assert new["merged_sources"] == legacy["merged_sources"] and new["merged_from"] == legacy["merged_from"]
    assert mongo.journey_events.find_one({"_id": legacy["_id"]}) is None
    assert mongo.journey_events.find_one({"_id": other["_id"]}) is not None
    assert counts["evidence_carried"] == 1 and counts["removed"] == 1


# ---------------------------------------------------------------- change log (journey_changes)

def rule_event(asset="drug-a", n=1, **over):
    return {"_id": f"rule:{asset}:approval:r{n}", "asset": asset, "origin": "rule", "type": "approval",
            "category": "regulatory", "date": "2020-01-01", "title": f"Approval {n}", "significance": "High",
            "is_milestone": False, "expected_date": None, "sources": [{"collection": "fda_records", "record_key": f"r{n}"}],
            **over}


def changes(mongo, **flt):
    return sorted(mongo.journey_changes.find(flt), key=lambda c: (c["kind"], c.get("field") or "", c["event_id"]))


def test_the_first_build_is_logged_as_baseline(mongo):
    counts = replace_rule_events(mongo, "drug-a", [rule_event(n=1), rule_event(n=2)])
    rows = changes(mongo)
    assert [(c["kind"], c["baseline"]) for c in rows] == [("added", True)] * 2
    assert rows[0]["origin"] == "rule" and rows[0]["title"] == "Approval 1" and rows[0]["event_date"] == "2020-01-01"
    assert counts["changes"] == 0
    assert all(e["first_seen"] for e in mongo.journey_events.find())


def test_later_runs_log_added_changed_per_field_and_removed(mongo):
    replace_rule_events(mongo, "drug-a", [rule_event(n=1), rule_event(n=2)])
    first_seen = mongo.journey_events.find_one({"_id": rule_event(n=1)["_id"]})["first_seen"]
    counts = replace_rule_events(mongo, "drug-a", [
        rule_event(n=1, date="2021-06-01", significance="Medium"),  # two fields moved
        rule_event(n=3)])                                           # n=2 vanished, n=3 is new
    rows = changes(mongo, baseline=False)
    assert counts["changes"] == len(rows) == 4
    by_kind = {(c["kind"], c.get("field")): c for c in rows}
    assert by_kind[("changed", "date")]["before"] == "2020-01-01" and by_kind[("changed", "date")]["after"] == "2021-06-01"
    assert by_kind[("changed", "significance")]["before"] == "High"
    assert by_kind[("removed", None)]["event_id"] == rule_event(n=2)["_id"]
    assert by_kind[("removed", None)]["before"] == "2020-01-01"
    assert by_kind[("added", None)]["event_id"] == rule_event(n=3)["_id"] and by_kind[("added", None)]["baseline"] is False
    assert mongo.journey_events.find_one({"_id": rule_event(n=1)["_id"]})["first_seen"] == first_seen  # set once


def test_a_retried_run_does_not_log_the_same_change_twice(mongo):
    replace_rule_events(mongo, "drug-a", [rule_event(n=1)])
    before = [dict(d) for d in mongo.journey_events.find()]
    later = [rule_event(n=1, title="Renamed"), rule_event(n=2)]
    assert replace_rule_events(mongo, "drug-a", later)["changes"] == 2
    # The step died after logging but before the events were stored: the retry starts from the old state.
    mongo.journey_events.delete_many({})
    mongo.journey_events.insert_many(before)
    assert replace_rule_events(mongo, "drug-a", later)["changes"] == 0
    assert mongo.journey_changes.count_documents({"baseline": False}) == 2
    assert replace_rule_events(mongo, "drug-a", later)["changes"] == 0  # and an unchanged run logs nothing


def test_an_id_respelling_is_neither_added_nor_removed(mongo):
    replace_rule_events(mongo, "drug-a", [rule_event(n=1)])
    respelled = rule_event(n=1, _id="rule:drug-a:approval:ctgov:r1")  # same type + source record, new id
    counts = replace_rule_events(mongo, "drug-a", [respelled])
    assert counts["changes"] == 0 and counts["removed"] == 1
    assert mongo.journey_changes.count_documents({"baseline": False}) == 0
