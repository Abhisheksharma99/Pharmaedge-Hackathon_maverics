"""Key-event selection (offline)."""

from journey.key_events import mark, select

TODAY = "2026-10-09"


def e(id, date, type="approval", sig="High", origin="rule", branch="PAH", **kw):
    return {"_id": id, "date": date, "type": type, "significance": sig, "origin": origin, "branch": branch,
            "category": kw.pop("category", "regulatory"), "sources": kw.pop("sources", [{}]), **kw}


HIGHS = [e(f"h{i}", f"20{10 + i}-06-01", type=f"approval_{i}") for i in range(10)]  # a full journey: no top-up


def test_high_company_events_are_key_and_low_ones_are_not():
    events = [e("a", "2002-05-21"), e("b", "2016-08-12", sig="Low"), e("c", "2009-07-30", sig="Medium"), *HIGHS]
    assert select(events, TODAY) == ["a"] + [h["_id"] for h in HIGHS]


def test_investigator_trials_are_not_key_but_company_and_ai_clinical_events_are():
    events = [e("inv", "2015-01-01", type="trial_start", category="clinical", sponsor_is_company=False),
              e("co", "2017-02-01", type="trial_start", category="clinical", sponsor_is_company=True),
              e("ai", "2020-02-24", type="trial_readout", category="clinical", origin="ai")]
    assert select(events, TODAY) == ["co", "ai"]


def test_ai_coverage_of_a_rule_event_collapses_into_it():
    events = [e("rule", "2021-03-31", type="label_expansion"),
              e("ai1", "2021-04-02", type="label_expansion", origin="ai", sources=[{}, {}, {}])]
    assert select(events, TODAY) == ["rule"]


def test_ai_duplicates_keep_the_best_sourced_one():
    events = [e("x1", "2025-07-31", type="trial_readout", origin="ai", category="clinical", sources=[{}]),
              e("x2", "2025-09-02", type="trial_readout", origin="ai", category="clinical", sources=[{}, {}],
                merged_sources=[{}]),
              e("x3", "2026-03-11", type="trial_readout", origin="ai", category="clinical")]  # > 45 days later
    assert select(events, TODAY) == ["x2", "x3"]


def test_distinct_rule_events_never_collapse():
    events = [e("freedom_c", "2006-10-01", type="trial_start", category="clinical", sponsor_is_company=True),
              e("freedom_m", "2006-10-01", type="trial_start", category="clinical", sponsor_is_company=True)]
    assert select(events, TODAY) == ["freedom_c", "freedom_m"]


def test_upcoming_milestones_count_from_medium_and_past_ones_do_not():
    events = [e("next", "2027-07-30", type="regulatory_decision_expected", sig="Medium", is_milestone=True),
              e("stale", "2025-01-01", type="expected_readout", sig="Medium", is_milestone=True)]
    assert select(events, TODAY) == ["next"]


def test_undated_or_partial_dates_are_skipped():
    assert select([e("u", ""), e("p", "2021"), e("ok", "2021-03-31")], TODAY) == ["ok"]


def test_mark_writes_flags(db):
    for x in [e("a", "2002-05-21"), e("b", "2016-08-12", sig="Low")]:
        db.journey_events.insert_one({**x, "asset": "trep"})
    assert mark(db, "trep", today=TODAY) == 1
    assert {d["_id"]: d["key"] for d in db.journey_events.docs} == {"a": True, "b": False}


def test_completions_and_extension_studies_are_not_key():
    events = [e("start", "2021-06-01", type="trial_start", category="clinical", sponsor_is_company=True,
                title="Phase 3 trial started: TETON-1"),
              e("done", "2026-02-02", type="trial_completion", category="clinical", sponsor_is_company=True,
                title="Phase 3 trial completed: TETON-1"),
              e("ole", "2022-09-06", type="trial_start", category="clinical", sponsor_is_company=True,
                title="Phase 3 trial started: An Open-Label Extension Study of Inhaled Treprostinil")]
    assert select(events, TODAY) == ["start"]


def test_medium_milestones_are_key_only_when_regulatory():
    events = [e("pdufa", "2027-07-30", type="regulatory_decision_expected", sig="Medium", is_milestone=True),
              e("expiry", "2028-03-10", type="patent_expiry", sig="Medium", is_milestone=True, category="ip"),
              e("p2", "2027-02-01", type="expected_readout", sig="Medium", is_milestone=True, category="clinical"),
              e("loe", "2042-04-22", type="patent_expiry", sig="High", is_milestone=True, category="ip")]
    assert select(events, TODAY) == ["pdufa", "loe"]


def test_ai_coverage_months_apart_still_collapses_within_90_days():
    events = [e("a", "2025-07-31", type="trial_readout", origin="ai", category="clinical", sources=[{}, {}]),
              e("b", "2025-10-15", type="trial_readout", origin="ai", category="clinical")]  # 76 days later
    assert select(events, TODAY) == ["a"]


def test_sparse_journeys_are_filled_with_their_best_medium_events():
    events = [e(f"m{i}", f"20{10 + i}-01-01", sig="Medium", sources=[{}] * (i % 3 + 1)) for i in range(14)]
    events.append(e("low", "2009-01-01", sig="Low"))
    picked = select(events, TODAY)
    assert len(picked) == 10 and "low" not in picked
    assert picked == sorted(picked, key=lambda i: next(x["date"] for x in events if x["_id"] == i))  # date order


def test_extension_study_readouts_are_not_key_milestones():
    events = [e("ole", "2031-01-22", type="expected_readout", is_milestone=True, category="clinical",
                sponsor_is_company=True, title="Phase 3 primary completion expected: An Open-Label Extension Study"),
              *HIGHS]
    assert "ole" not in select(events, TODAY)


def test_impossible_calendar_dates_are_not_dated():
    assert select([e("bad", "2021-02-30"), e("ok", "2021-03-31")], TODAY) == ["ok"]


def test_trial_events_match_the_company_sponsor_loosely():
    from journey.rules import trial_events
    rec = {"record_key": "k", "nct_id": "NCT1", "phases": ["PHASE3"], "start_date": "2010-01-01", "lead_sponsor": "Biogen"}
    assert trial_events("nat", [rec], "Biogen Inc.")[0]["sponsor_is_company"] is True
