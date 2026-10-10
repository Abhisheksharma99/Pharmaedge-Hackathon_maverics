"""Cross-source checks on journey events (offline). Run: cd crawler && ../.venv/bin/python -m pytest journey -q"""

from journey.checks import apply_checks, fold_confirmed, verify


def ev(id, type, date, origin="rule", region="US", title=None, **over):
    return {"_id": id, "asset": "treprostinil", "origin": origin, "type": type, "date": date, "region": region,
            "title": title or id, "is_milestone": False, **over}


AI_CLAIM = ev("ai:1", "approval", "2026-03-09", "ai", title="FDA approves inhaled treprostinil for PH-ILD")
LABEL_2021 = ev("rule:2021", "label_expansion", "2021-03-31", title="Tyvaso label expansion")


def test_an_ai_approval_far_from_any_fda_record_is_unconfirmed():
    out = verify([AI_CLAIM, LABEL_2021])
    assert out["ai:1"] == {"status": "unconfirmed", "against": ["rule:2021"],
                           "note": "No FDA approval record within 45 days of this date; nearest is "
                                   "Tyvaso label expansion on 2021-03-31"}
    assert out["rule:2021"] is None


def test_an_ai_approval_near_a_regulator_record_is_confirmed():
    out = verify([AI_CLAIM, ev("rule:near", "approval", "2026-02-01", title="Tyvaso DPI approval")])
    assert out["ai:1"] == {"status": "confirmed", "note": "Matches Tyvaso DPI approval (2026-02-01)",
                           "against": ["rule:near"]}


def test_region_names_are_normalised_and_eu_names_the_ema():
    out = verify([{**AI_CLAIM, "region": "European Union"}, ev("rule:eu", "approval", "2019-01-01", region="EU")])
    assert out["ai:1"]["status"] == "unconfirmed" and "No EMA approval record" in out["ai:1"]["note"]


def test_no_regulator_events_in_that_region_means_unknown():
    assert verify([AI_CLAIM, ev("rule:eu", "approval", "2019-01-01", region="EU")])["ai:1"] is None
    assert verify([AI_CLAIM])["ai:1"] is None
    assert verify([{**AI_CLAIM, "region": "Japan"}, LABEL_2021])["ai:1"] is None
    assert verify([{**AI_CLAIM, "region": None}, LABEL_2021])["ai:1"] is None
    assert verify([{**AI_CLAIM, "is_milestone": True}, LABEL_2021])["ai:1"] is None  # a plan, not a claim
    assert verify([{**AI_CLAIM, "type": "launch"}, LABEL_2021])["ai:1"] is None


def test_different_decision_dates_close_together_conflict():
    a = ev("rule:pdufa", "pdufa_date", "2026-12-01")
    b = ev("ai:pdufa", "regulatory_decision_expected", "2027-01-15", "ai")
    out = verify([a, b])
    assert out["rule:pdufa"] == {"status": "conflict", "against": ["ai:pdufa"],
                                 "note": "Sources give different decision dates: 2026-12-01 vs 2027-01-15"}
    assert out["ai:pdufa"]["against"] == ["rule:pdufa"]


def test_same_date_or_far_apart_decision_dates_do_not_conflict():
    same = verify([ev("a", "pdufa_date", "2026-12-01"), ev("b", "regulatory_decision_expected", "2026-12-01", "ai")])
    far = verify([ev("a", "pdufa_date", "2026-12-01"), ev("b", "pdufa_date", "2027-12-01")])
    assert same == {"a": None, "b": None} and far == {"a": None, "b": None}


def test_blank_dates_are_skipped():
    assert verify([{**AI_CLAIM, "date": ""}, LABEL_2021])["ai:1"] is None
    assert verify([ev("a", "pdufa_date", ""), ev("b", "pdufa_date", "2026-12-01")]) == {"a": None, "b": None}


def test_apply_checks_stores_counts_and_clears_flags_that_no_longer_hold(mongo):
    mongo.journey_events.insert_many([AI_CLAIM, LABEL_2021, ev("old", "launch", "2025-01-01", "ai",
                                                                verification={"status": "conflict", "note": "stale"})])
    assert apply_checks(mongo, "treprostinil") == {"unconfirmed": 1, "conflict": 0, "confirmed": 0}
    assert mongo.journey_events.find_one({"_id": "ai:1"})["verification"]["status"] == "unconfirmed"
    assert "verification" not in mongo.journey_events.find_one({"_id": "old"})
    # A later rule event lands next to the claim: the flag turns into a confirmation.
    mongo.journey_events.insert_one(ev("rule:2026", "approval", "2026-03-10"))
    assert apply_checks(mongo, "treprostinil") == {"unconfirmed": 0, "conflict": 0, "confirmed": 1}
    assert mongo.journey_events.find_one({"_id": "ai:1"})["verification"]["against"] == ["rule:2026"]
    mongo.journey_events.delete_one({"_id": "rule:2026"})
    mongo.journey_events.delete_one({"_id": "rule:2021"})  # no regulator records left: unknown, so cleared
    assert apply_checks(mongo, "treprostinil") == {"unconfirmed": 0, "conflict": 0, "confirmed": 0}
    assert "verification" not in mongo.journey_events.find_one({"_id": "ai:1"})


def test_decision_dates_of_different_applications_do_not_conflict():
    a = {"_id": "a", "type": "pdufa_date", "date": "2024-03-01", "application_number": "NDA1"}
    b = {"_id": "b", "type": "pdufa_date", "date": "2024-04-01", "application_number": "NDA2"}
    c = {"_id": "c", "type": "regulatory_decision_expected", "date": "2024-04-15"}  # application unknown: still compared
    out = verify([a, b, c])
    assert out["a"]["against"] == ["c"] and out["b"]["against"] == ["c"]
    assert sorted(out["c"]["against"]) == ["a", "b"]


def test_device_clearances_are_not_checked_as_drug_approvals():
    rule = {"_id": "r", "origin": "rule", "type": "approval", "region": "US", "date": "2002-05-21", "title": "FDA approves Remodulin"}
    pump = {"_id": "p", "origin": "ai", "type": "approval", "region": "US", "date": "2020-02-24", "title": "FDA 510(k) clearance for Remunity pump"}
    assert verify([rule, pump])["p"] is None


def test_decision_dates_about_different_subjects_do_not_conflict():
    tyvaso = {"_id": "t", "type": "regulatory_decision_expected", "date": "2027-04-30", "title": "FDA review of Tyvaso sNDA expected to complete in late April"}
    other = {"_id": "y", "type": "regulatory_decision_expected", "date": "2027-05-14", "title": "Expected injunction to block FDA approval of Yutrepia"}
    dpi1 = {"_id": "d1", "type": "regulatory_decision_expected", "date": "2021-10-31", "title": "FDA action on Tyvaso DPI NDA expected"}
    dpi2 = {"_id": "d2", "type": "regulatory_decision_expected", "date": "2021-12-31", "title": "FDA decision on Tyvaso DPI expected by December 2021"}
    out = verify([tyvaso, other, dpi1, dpi2])
    assert out["t"] is None and out["y"] is None
    assert out["d1"]["status"] == "conflict" and out["d1"]["against"] == ["d2"]


def test_a_labeling_only_update_does_not_confirm_an_approval_claim():
    label = {"_id": "l", "origin": "rule", "type": "label_update", "region": "US", "date": "2026-04-03", "title": "Label update for Tyvaso"}
    orig = {"_id": "o", "origin": "rule", "type": "label_expansion", "region": "US", "date": "2021-03-31", "title": "FDA approves efficacy supplement for Tyvaso"}
    claim = {"_id": "c", "origin": "ai", "type": "approval", "region": "US", "date": "2026-03-09", "title": "FDA approves inhaled treprostinil for PH-ILD"}
    out = verify([label, orig, claim])
    assert out["c"]["status"] == "unconfirmed" and out["c"]["against"] == ["o"]


def test_a_confirmed_duplicate_approval_joins_the_regulator_event_and_a_different_product_stays(mongo):
    db = mongo
    db.journey_events.insert_many([
        {"_id": "rule:dpi", "asset": "t", "origin": "rule", "type": "approval", "region": "US", "date": "2022-05-23",
         "title": "FDA approves Tyvaso DPI", "sources": [{"collection": "fda_records", "record_key": "fda:dpi"}]},
        {"_id": "ai:dpi", "asset": "t", "origin": "ai", "type": "approval", "region": "US", "date": "2022-06-01",
         "title": "FDA approval of Tyvaso DPI dry powder inhaler", "sources": [{"collection": "articles", "record_key": "u1"}]},
        {"_id": "ai:other", "asset": "t", "origin": "ai", "type": "approval", "region": "US", "date": "2022-06-02",
         "title": "Liquidia wins FDA nod for Yutrepia", "sources": [{"collection": "articles", "record_key": "u2"}]},
    ])
    apply_checks(db, "t")
    assert fold_confirmed(db, "t") == 1
    assert db.journey_events.find_one({"_id": "ai:dpi"}) is None
    assert db.journey_events.find_one({"_id": "rule:dpi"})["merged_sources"] == [{"collection": "articles", "record_key": "u1"}]
    assert db.journey_events.find_one({"_id": "ai:other"})["verification"]["status"] == "confirmed"  # kept: other product
