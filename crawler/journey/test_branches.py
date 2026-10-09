"""Indication branches (offline: the LLM grouping is a fixture). Run: cd crawler && ../.venv/bin/python -m pytest journey -q"""

import pytest

from journey import branches as B

CO = "United Therapeutics"


def trial(id, start, conditions, status="COMPLETED", phase=3, acronym=""):
    return {"id": id, "acronym": acronym, "phase": f"Phase {phase}", "phase_rank": phase, "status": status,
            "start": start, "end": "", "conditions": conditions, "title": ""}


def ev(id, date, type="approval", region="US", indication=""):
    return {"id": id, "date": date, "type": type, "region": region, "title": id, "summary": "", "indication": indication,
            "origin": "rule"}


TRIALS = [
    trial("NCT_TRIUMPH", "2005-06-01", ["Pulmonary Hypertension"], acronym="TRIUMPH"),
    trial("NCT_INCREASE", "2017-02-03", ["Pulmonary Hypertension", "Interstitial Lung Disease"], acronym="INCREASE"),
    trial("NCT_PERFECT", "2018-05-08", ["Pulmonary Hypertension", "COPD"], status="TERMINATED", acronym="PERFECT"),
    trial("NCT_PERFECT_OLE", "2018-12-21", ["Pulmonary Hypertension", "COPD"], status="TERMINATED", acronym="PERFECT OLE"),
    trial("NCT_TETON1", "2021-06-01", ["Idiopathic Pulmonary Fibrosis"], acronym="TETON-1"),
    trial("NCT_TETON_PPF", "2023-10-30", ["Progressive Pulmonary Fibrosis"], status="RECRUITING", acronym=""),
]
EVENTS = [
    ev("remodulin", "2002-05-21"),
    ev("tyvaso_ild", "2021-03-31", type="label_expansion"),
    ev("trepulmix", "2020-04-03", region="EU", indication="CTEPH"),
    ev("ipf_snda", "2026-09-30", type="regulatory_submission"),
]
PROPOSED = [
    {"id": "PAH", "full": "Pulmonary arterial hypertension", "members": ["NCT_TRIUMPH", "remodulin"], "parent": "",
     "why": "", "partner": "", "aliases": ["pulmonary arterial hypertension", "pah"]},
    {"id": "PH-ILD", "full": "PH due to interstitial lung disease", "members": ["NCT_INCREASE", "tyvaso_ild", "ghost"],
     "parent": "PAH", "why": "INCREASE took inhaled treprostinil into WHO Group 3", "partner": "",
     "aliases": ["interstitial lung disease", "ph-ild"]},
    {"id": "IPF", "full": "Idiopathic pulmonary fibrosis", "members": ["NCT_TETON1", "ipf_snda"], "parent": "PH-ILD",
     "why": "FVC gains in INCREASE led to TETON", "partner": "", "aliases": ["idiopathic pulmonary fibrosis", "ipf"]},
    {"id": "PPF", "full": "Progressive pulmonary fibrosis", "members": ["NCT_TETON_PPF"], "parent": "IPF",
     "why": "TETON-PPF extends the IPF approach", "partner": "", "aliases": ["progressive pulmonary fibrosis", "ppf"]},
    {"id": "CTEPH", "full": "Chronic thromboembolic PH", "members": ["trepulmix"], "parent": "PAH",
     "why": "SC treprostinil studied in inoperable CTEPH", "partner": "SciPharm", "aliases": ["cteph"]},
    {"id": "PH-COPD", "full": "PH due to COPD", "members": ["NCT_PERFECT", "NCT_PERFECT_OLE"], "parent": "PAH",
     "why": "PERFECT tested inhaled treprostinil in PH-COPD", "partner": "", "aliases": ["copd", "ph-copd"]},
    {"id": "PH-SCD", "full": "PH in sickle cell disease", "members": [], "parent": "PAH", "why": "", "partner": "",
     "aliases": ["sickle cell"]},  # withdrawn trial only: not a member, so it doesn't qualify
    {"id": "PAH", "full": "dup", "members": [], "parent": "", "why": "", "partner": "", "aliases": []},  # duplicate id
]


def built(existing=()):
    return {b["id"]: b for b in B.build(PROPOSED, TRIALS, EVENTS, CO, list(existing))}


def test_trunk_is_the_indication_of_the_first_approval():
    out = built()
    assert out["PAH"]["trunk"] and out["PAH"]["off"] == 0 and out["PAH"]["from"] is None
    assert list(out)[0] == "PAH"


def test_fixture_branches_with_parents_and_status():
    out = built()
    assert set(out) == {"PAH", "PH-ILD", "IPF", "PPF", "CTEPH", "PH-COPD"}
    assert (out["PH-ILD"]["from"], out["IPF"]["from"], out["PPF"]["from"]) == ("PAH", "PH-ILD", "IPF")
    assert out["CTEPH"]["from"] == "PAH" and out["PH-COPD"]["from"] == "PAH"
    assert out["PAH"]["status"] == "Approved · US"
    assert out["CTEPH"]["status"] == "Approved · EU (SciPharm)"
    assert out["IPF"]["status"] == "Filed · under review"
    assert out["PPF"]["status"] == "Phase 3 recruiting"
    assert out["PH-COPD"]["status"] == "Closed · PERFECT terminated"
    assert out["PH-COPD"]["ended"] == "Terminated" and out["PH-ILD"]["ended"] is None
    assert out["PH-ILD"]["start"] == "2017-02-03"
    assert out["PH-ILD"]["members"] == ["NCT_INCREASE", "tyvaso_ild"]  # unknown "ghost" dropped


def test_lane_sides_put_active_branches_right_and_closed_or_partner_left():
    out = built()
    assert [out[b]["off"] for b in ("PH-ILD", "IPF", "PPF")] == [1, 2, 3]
    assert {out["PH-COPD"]["off"], out["CTEPH"]["off"]} == {-1, -2}


def test_colours_come_from_the_palette_and_stay_stable():
    first = built()
    assert first["PAH"]["color"] == B.PALETTE[0]
    assert len({b["color"] for b in first.values()}) == 6
    again = built(existing=[{"id": "IPF", "color": "#0e7490", "origin": "ai"}])
    assert again["IPF"]["color"] == "#0e7490"
    assert again["PAH"]["color"] == B.PALETTE[0]
    assert len({b["color"] for b in again.values()}) == 6


def test_bad_parents_fall_back_to_the_trunk():
    proposed = [dict(p) for p in PROPOSED[:3]]
    proposed[1]["parent"] = "IPF"  # IPF starts after PH-ILD: can't be its parent
    proposed[2]["parent"] = "NOPE"
    out = {b["id"]: b for b in B.build(proposed, TRIALS, EVENTS, CO, [])}
    assert out["PH-ILD"]["from"] == "PAH" and out["IPF"]["from"] == "PAH"


def test_user_branches_are_never_overwritten():
    user = {"id": "PAH", "label": "PAH", "full": "Mine", "color": "#000000", "off": 0, "origin": "user"}
    out = B.build(PROPOSED, TRIALS, EVENTS, CO, [user])
    assert [b for b in out if b["id"] == "PAH"] == [user]


def test_no_qualifying_programme_means_no_branches():
    assert B.build([], [], [], CO, []) == []
    assert B.build([{"id": "X", "full": "x", "members": ["nothing"], "parent": "", "why": "", "partner": "",
                     "aliases": []}], [], [], CO, []) == []


def test_match_branches_uses_the_most_specific_alias_and_word_boundaries():
    brs = list(built().values())
    assert B.match_branches(["PH due to interstitial lung disease (PH‑ILD)"], brs) == ["PH-ILD"]
    assert B.match_branches(["Spahn syndrome"], brs) == []
    assert B.match_branches(["PH-ILD", "PAH"], brs) == ["PH-ILD", "PAH"]


def test_place_prefers_members_then_nct_then_text():
    brs = list(built().values())
    by_member = {m: b["id"] for b in brs for m in b["members"]}
    assert B.place({"_id": "trepulmix"}, brs, by_member) == ("CTEPH", [])
    assert B.place({"_id": "rule:x", "nct_id": "NCT_TETON1"}, brs, by_member) == ("IPF", [])
    assert B.place({"_id": "ai:1", "indications": ["PH-ILD", "PAH"]}, brs, by_member) == ("PH-ILD", ["PAH"])
    assert B.place({"_id": "ai:2", "title": "TETON-2 meets endpoint in IPF"}, brs, by_member) == ("IPF", [])
    assert B.place({"_id": "ai:3", "title": "Quarterly results"}, brs, by_member) == (None, [])


def test_refresh_saves_assigns_and_drops_stale_branches(db, monkeypatch):
    asset = {"_id": "trep", "name": "Treprostinil", "company": {"name": CO}, "tags": {}}
    db.trial_records.insert_one({"record_key": "ctgov:NCT_TETON1", "nct_id": "NCT_TETON1", "assets": ["trep"],
                                 "lead_sponsor": CO, "phases": ["PHASE3"], "overall_status": "COMPLETED",
                                 "start_date": "2021-06-01", "conditions": ["Idiopathic Pulmonary Fibrosis"]})
    db.trial_records.insert_one({"record_key": "ctgov:NCT_W", "nct_id": "NCT_W", "assets": ["trep"], "lead_sponsor": CO,
                                 "phases": ["PHASE3"], "overall_status": "WITHDRAWN", "start_date": "2017-06-01",
                                 "conditions": ["Sickle cell"]})
    db.journey_events.insert_one({"_id": "remodulin", "asset": "trep", "category": "regulatory", "type": "approval",
                                  "origin": "rule", "date": "2002-05-21", "region": "US", "title": "FDA approves Remodulin"})
    db.journey_events.insert_one({"_id": "rule:trial_start:ctgov:NCT_TETON1", "asset": "trep", "nct_id": "NCT_TETON1",
                                  "date": "2021-06-01", "type": "trial_start", "category": "clinical"})
    db.asset_branches.insert_one({"_id": "trep:OLD", "asset": "trep", "id": "OLD", "origin": "ai"})
    seen = {}

    def fake(model, system, user, name, schema, **kw):
        seen["payload"] = user
        return {"branches": [PROPOSED[0], PROPOSED[2]]}

    monkeypatch.setattr(B.llm, "structured", fake)
    out = B.refresh(db, asset, today="2026-10-09")
    assert [b["id"] for b in out] == ["PAH", "IPF"]
    assert "NCT_W" not in seen["payload"]  # withdrawn trials never started
    assert {d["id"] for d in db.asset_branches.docs} == {"PAH", "IPF"}
    assert B.assign_all(db, "trep") == 2
    placed = {e["_id"]: e["branch"] for e in db.journey_events.docs}
    assert placed == {"remodulin": "PAH", "rule:trial_start:ctgov:NCT_TETON1": "IPF"}


def test_partner_comes_from_the_approval_holder_when_the_llm_misses_it():
    events = [ev("remodulin", "2002-05-21"), {**ev("trepulmix", "2020-04-03", region="EU"), "holder": "SciPharm Sàrl"}]
    proposed = [PROPOSED[0], {**PROPOSED[4], "partner": ""}]
    out = {b["id"]: b for b in B.build(proposed, TRIALS[:1], events, CO, [])}
    assert out["CTEPH"]["partner"] == "SciPharm Sàrl" and out["CTEPH"]["off"] < 0
    assert out["CTEPH"]["status"] == "Approved · EU (SciPharm Sàrl)"


def test_programmes_with_only_finished_trials_say_so():
    trials = [trial("NCT_DISTOL", "2009-05-01", ["Systemic Sclerosis"], status="COMPLETED", phase=2)]
    proposed = [PROPOSED[0], {"id": "SSc", "full": "Systemic sclerosis", "members": ["NCT_DISTOL"], "parent": "PAH",
                              "why": "", "partner": "", "aliases": ["scleroderma"]}]
    out = {b["id"]: b for b in B.build(proposed, TRIALS[:1] + trials, EVENTS[:1], CO, [])}
    assert out["SSc"]["status"] == "No active trials since 2009" and out["SSc"]["ended"] is None


def test_a_specific_branch_wins_over_the_trunk():
    brs = [{**b, "aliases": b["aliases"] + (["pulmonary hypertension"] if b["id"] == "PAH" else [])}
           for b in built().values()]
    event = {"_id": "rule:expected_readout:x", "indications": ["Pulmonary Hypertension", "Interstitial Lung Disease"]}
    assert B.place(event, brs, {}) == ("PH-ILD", ["PAH"])


def test_colours_stay_distinct_beyond_the_palette_and_active_branches_get_it_first():
    extra = [trial(f"NCT_X{i}", f"201{i}-01-01", [f"Disease {i}"], status="TERMINATED") for i in range(4)]
    proposed = PROPOSED[:6] + [{"id": f"X{i}", "full": f"Disease {i}", "members": [f"NCT_X{i}"], "parent": "PAH",
                                "why": "", "partner": "", "aliases": [f"disease {i}"]} for i in range(4)]
    dup = [{"id": "PH-COPD", "color": "#0b7a6f", "origin": "ai"}, {"id": "PH-ILD", "color": "#0b7a6f", "origin": "ai"}]
    out = {b["id"]: b for b in B.build(proposed, TRIALS + extra, EVENTS, CO, dup)}
    assert len({b["color"] for b in out.values()}) == len(out) == 10
    assert {out[i]["color"] for i in ("PAH", "PH-ILD", "IPF", "PPF")} <= set(B.PALETTE)


def test_company_sponsor_matching_is_shared_with_the_trial_candidates(db):
    asset = {"_id": "nat", "name": "Natalizumab", "company": {"name": "Biogen Inc."}}
    db.trial_records.insert_one({"record_key": "k", "nct_id": "NCT1", "assets": ["nat"], "lead_sponsor": "Biogen",
                                 "phases": ["PHASE3"], "overall_status": "COMPLETED", "start_date": "2010-01-01"})
    assert [t["id"] for t in B.candidate_trials(db, asset, "2026-10-09")] == ["NCT1"]


def test_case_mangled_member_ids_still_match():
    proposed = [{**PROPOSED[0], "members": [" nct_triumph ", "REMODULIN"]}]
    out = B.build(proposed, TRIALS, EVENTS, CO, [])
    assert out[0]["members"] == ["NCT_TRIUMPH", "remodulin"]


def _refresh_db(db):
    db.trial_records.insert_one({"record_key": "ctgov:NCT_TETON1", "nct_id": "NCT_TETON1", "assets": ["trep"],
                                 "lead_sponsor": CO, "phases": ["PHASE3"], "overall_status": "COMPLETED",
                                 "start_date": "2021-06-01", "conditions": ["IPF"]})
    db.asset_branches.insert_one({"_id": "trep:IPF", "asset": "trep", "id": "IPF", "origin": "ai", "color": "#0b7a6f",
                                  "members": ["NCT_TETON1"]})
    db.journey_events.insert_one({"_id": "e", "asset": "trep", "title": "x", "branch": "IPF"})
    return {"_id": "trep", "name": "Treprostinil", "company": {"name": CO}, "tags": {}}


def test_a_junk_grouping_keeps_the_previous_branches(db, monkeypatch):
    from journey import derive
    asset = _refresh_db(db)
    junk = {"branches": [{"id": "X", "full": "x", "members": ["nothing"], "parent": "", "why": "", "partner": "",
                          "aliases": []}]}
    monkeypatch.setattr(B.llm, "structured", lambda *a, **k: junk)
    monkeypatch.setattr(derive.enrich, "enrich_events", lambda *a, **k: 0)
    with pytest.raises(RuntimeError):
        B.refresh(db, asset, today="2026-10-09")
    assert [b["id"] for b in db.asset_branches.docs] == ["IPF"]
    counts = derive.derive_journey(db, asset)
    assert counts["branch_errors"] == 1 and db.journey_events.docs[0]["branch"] == "IPF"


def test_the_grouping_call_is_told_the_existing_branches(db, monkeypatch):
    asset = _refresh_db(db)
    seen = {}

    def fake(model, system, user, name, schema, **kw):
        seen["user"] = user
        return {"branches": [PROPOSED[2]]}

    monkeypatch.setattr(B.llm, "structured", fake)
    B.refresh(db, asset, today="2026-10-09")
    assert '"existing_branches"' in seen["user"] and '"IPF"' in seen["user"]


def test_a_renamed_branch_inherits_the_colour_of_the_one_it_overlaps():
    old = [{"id": "IPF-OLD", "color": "#e0620f", "origin": "ai", "members": ["NCT_TETON1", "ipf_snda"]}]
    out = {b["id"]: b for b in B.build(PROPOSED, TRIALS, EVENTS, CO, old)}
    assert out["IPF"]["color"] == "#e0620f" and out["IPF"]["origin"] == "ai"
    assert len({b["color"] for b in out.values()}) == len(out)


def test_branch_ids_are_normalised_to_ascii_dashes():
    proposed = [{**PROPOSED[0]}, {**PROPOSED[1], "id": " PH‑ILD "}]
    assert [b["id"] for b in B.build(proposed, TRIALS, EVENTS, CO, [])] == ["PAH", "PH-ILD"]


def test_same_day_branches_naming_each_other_cannot_form_a_cycle():
    trials = [trial("NCT_A", "2020-01-01", ["A"]), trial("NCT_B", "2020-01-01", ["B"])]
    proposed = [PROPOSED[0],
                {"id": "A", "full": "a", "members": ["NCT_A"], "parent": "B", "why": "", "partner": "", "aliases": []},
                {"id": "B", "full": "b", "members": ["NCT_B"], "parent": "A", "why": "", "partner": "", "aliases": []}]
    out = {b["id"]: b for b in B.build(proposed, TRIALS[:1] + trials, EVENTS[:1], CO, [])}
    assert not (out["A"]["from"] == "B" and out["B"]["from"] == "A")
    assert "PAH" in (out["A"]["from"], out["B"]["from"])
