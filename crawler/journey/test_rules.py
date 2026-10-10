"""Rule-event tests. Run: cd crawler && ../.venv/bin/python -m pytest journey -q"""

from journey.rules import ema_events, fda_events, trial_events

A = "treprostinil"


def sub(key, app_no, sub_type, status, cls, date="2021-03-31", brand="TYVASO"):
    return {"record_key": key, "record_type": "fda_submission", "application_number": app_no,
            "submission_type": sub_type, "submission_status": status, "submission_class": cls,
            "submission_number": "1", "date": date, "brand_names": [brand], "sponsor_name": "UNITED THERAP"}


def by_type(events):
    return {e["type"]: e for e in events}


def test_fda_rules_map_submissions_to_journey_events():
    events = fda_events(A, [
        sub("k1", "NDA022387", "ORIG", "AP", "Type 1 - New Molecular Entity"),
        sub("k2", "ANDA203649", "ORIG", "AP", None, brand="TREPROSTINIL"),
        sub("k3", "NDA022387", "SUPPL", "AP", "Efficacy"),
        sub("k4", "NDA214324", "SUPPL", "AP", "Type 3 - New Dosage Form"),
        sub("k5", "NDA022387", "SUPPL", "AP", "Labeling"),
        sub("k6", "NDA022387", "SUPPL", "AP", "Manufacturing (CMC)"),
        sub("k7", "NDA213005", "SUPPL", "TA", None),
        sub("k8", "NDA022387", "ORIG", "AP", None, date=""),  # undated: can't be placed on a timeline
    ])
    types = by_type(events)
    assert set(types) == {"approval", "generic_approval", "label_expansion", "new_formulation",
                          "label_update", "tentative_approval"}
    assert types["approval"]["significance"] == "High"
    assert types["approval"]["title"] == "FDA approves Tyvaso"
    dpi = fda_events(A, [{**sub("k9", "NDA214324", "ORIG", "AP", None), "brand_names": ["TYVASO DPI", "TYVASO DPI KIT"]}])
    assert dpi[0]["title"] == "FDA approves Tyvaso DPI"
    assert types["generic_approval"]["significance"] == "Medium"
    assert types["label_expansion"]["significance"] == "High"
    assert types["label_update"]["significance"] == "Low"
    assert all(e["region"] == "US" and e["category"] == "regulatory" for e in events)


def test_events_keep_their_evidence_and_are_stable_across_runs():
    record = sub("fda:drugsfda:NDA022387:ORIG1", "NDA022387", "ORIG", "AP", None)
    first, second = fda_events(A, [record]), fda_events(A, [record])
    assert first[0]["_id"] == second[0]["_id"] == f"rule:{A}:approval:fda:drugsfda:NDA022387:ORIG1"
    assert first[0]["sources"] == [{"collection": "fda_records", "record_key": "fda:drugsfda:NDA022387:ORIG1"}]


def test_ema_rules():
    events = ema_events(A, [
        {"record_key": "e1", "record_type": "ema_epar", "medicine_status": "Authorised", "date": "2020-04-03",
         "name_of_medicine": "Trepulmix", "marketing_authorisation_developer_applicant_holder": "SciPharm Sàrl",
         "therapeutic_area_mesh": "Hypertension, Pulmonary"},
        {"record_key": "e2", "record_type": "ema_epar", "medicine_status": "Application withdrawn",
         "date": "2010-02-17", "name_of_medicine": "Tyvaso"},
        {"record_key": "e3", "record_type": "ema_orphan_designation", "status": "Positive", "date": "2004-04-14",
         "intended_use": "Treatment of pulmonary arterial hypertension", "eu_designation_number": "EU/3/04/199"},
    ])
    types = by_type(events)
    assert types["approval"]["region"] == "EU" and types["approval"]["significance"] == "High"
    assert types["application_withdrawn"]["title"] == "EU application withdrawn: Tyvaso"
    assert types["orphan_designation"]["significance"] == "Medium"



def calendar(key, event_type, when):
    return {"record_key": key, "record_type": "fda_calendar_event", "event_type": event_type, "date": when,
            "drugs": ["Tyvaso DPI"], "company": "United Therapeutics Corporation", "sponsor_is_company": True,
            "description": "2026-05-24 The FDA set a PDUFA date https://ir.unither.com/news/x"}


def test_fda_calendar_rules_make_upcoming_dates_milestones():
    events = fda_events(A, [calendar("c1", "pdufa", "2026-05-24"), calendar("c2", "pdufa", "2025-01-10"),
                            calendar("c3", "adcom", "2026-03-02")], today="2026-01-01")
    ahead, past, adcom = events
    assert ahead["type"] == "regulatory_decision_expected" and ahead["is_milestone"] and ahead["expected_date"] == "2026-05-24"
    assert ahead["title"] == "FDA decision expected (PDUFA date): Tyvaso DPI" and ahead["region"] == "US"
    assert ahead["summary"] == "2026-05-24 The FDA set a PDUFA date"  # links stripped
    assert past["type"] == "pdufa_date" and not past["is_milestone"] and past["significance"] == "Medium"
    assert adcom["type"] == "advisory_committee" and adcom["is_milestone"] and adcom["sources"][0]["record_key"] == "c3"


def test_fda_calendar_listings_of_one_pdufa_date_make_one_event():
    partner = {**calendar("c9", "pdufa", "2020-04-27"), "company": "Correvio Pharma Corp", "sponsor_is_company": False,
               "drugs": ["Treprostinil", "Trevyent"]}
    [event] = fda_events(A, [partner, calendar("c8", "pdufa", "2020-04-27")], today="2026-01-01")
    assert event["_id"] == f"rule:{A}:pdufa_date:c8" and event["sponsor"] == "United Therapeutics Corporation"
    assert [s["record_key"] for s in event["sources"]] == ["c8", "c9"]
    assert event["title"] == "PDUFA goal date: Tyvaso DPI, Treprostinil, Trevyent"


def chmp(key, opinion, procedure, when, name="Winrevair", status="pending EC decision", indication=None):
    return {"record_key": key, "record_type": "ema_chmp_opinion", "opinion": opinion, "procedure": procedure,
            "date": when, "name_of_medicine": name, "status": status, "therapeutic_indication": indication,
            "title": f"CHMP opinion on {name}", "company": "MSD"}


def test_chmp_positive_opinion_adds_the_ec_decision_milestone():
    events = ema_events(A, [chmp("o1", "positive", "new_medicine", "2026-06-26", indication="PAH")],
                        today="2026-07-01")
    opinion, decision = events
    assert opinion["type"] == "regulatory_opinion" and opinion["significance"] == "High" and opinion["region"] == "EU"
    assert opinion["summary"] == "PAH · MSD · pending EC decision"
    assert decision["type"] == "regulatory_decision_expected" and decision["is_milestone"]
    assert decision["date"] == "2026-09-01" and decision["sources"] == [{"collection": "ema_records", "record_key": "o1"}]
    # Past the 67 days, or once the EPAR shows the authorisation, there is nothing left to expect.
    assert len(ema_events(A, [chmp("o1", "positive", "new_medicine", "2026-06-26")], today="2026-09-02")) == 1
    approved = {"record_key": "e1", "record_type": "ema_epar", "medicine_status": "Authorised", "date": "2026-08-20",
                "name_of_medicine": "Winrevair"}
    assert [e["type"] for e in ema_events(A, [approved, chmp("o1", "positive", "new_medicine", "2026-06-26")],
                                          today="2026-08-25")] == ["approval", "regulatory_opinion"]


def test_chmp_opinions_already_in_the_ema_reports_become_extra_evidence():
    post = {"record_key": "p1", "record_type": "ema_post_authorisation", "date": "2025-12-11",
            "name_of_medicine": "Winrevair", "post_authorisation_opinion_status": "Positive"}
    withdrawn = {"record_key": "w1", "record_type": "ema_epar", "medicine_status": "Application withdrawn",
                 "date": "2022-10-20", "name_of_medicine": "Orepaxam"}
    events = ema_events(A, [chmp("o2", "positive", "extension_of_indication", "2025-12-11", status="",
                                 indication="PAH in children"),
                            chmp("o3", "withdrawn", "new_medicine", "2022-11-10", name="Orepaxam", status=""),
                            post, withdrawn], today="2026-07-01")
    assert [e["type"] for e in events] == ["label_expansion", "application_withdrawn"]
    label, gone = events
    assert [s["record_key"] for s in label["sources"]] == ["p1", "o2"] and label["indication"] == "PAH in children"
    assert [s["record_key"] for s in gone["sources"]] == ["w1", "o3"]


def test_chmp_highlights_without_an_opinion_are_left_to_ai_extraction():
    assert ema_events(A, [{"record_key": "h1", "record_type": "ema_chmp_highlight", "date": "2008-05-29"}]) == []

def trial(key, phases, status, start, primary_completion, sponsor="United Therapeutics", **extra):
    return {"record_key": key, "nct_id": key, "title": f"Study {key}", "phases": phases, "overall_status": status,
            "start_date": start, "primary_completion_date": primary_completion, "lead_sponsor": sponsor,
            "conditions": ["Pulmonary Arterial Hypertension"], **extra}


def test_trial_rules_cover_history_and_upcoming_milestones():
    events = trial_events(A, [
        trial("NCT1", ["PHASE3"], "COMPLETED", "2017-01-01", "2020-06-01", acronym="INCREASE"),
        trial("NCT2", ["PHASE3"], "RECRUITING", "2025-01-01", "2027-09-01", acronym="TETON-PPF"),
        trial("NCT3", ["PHASE2"], "NOT_YET_RECRUITING", "2027-01-01", "2028-01-01"),
        trial("NCT4", ["PHASE3"], "TERMINATED", "2012-01-01", "2013-01-01", why_stopped="Slow enrolment"),
        trial("NCT5", ["PHASE1"], "COMPLETED", "2019-01-01", "2019-06-01", sponsor="Insmed Incorporated"),
    ], company="United Therapeutics", today="2026-10-08")

    kinds = sorted((e["nct_id"], e["type"]) for e in events)
    assert kinds == [
        ("NCT1", "trial_completion"), ("NCT1", "trial_start"),
        ("NCT2", "expected_readout"), ("NCT2", "trial_start"),
        # NCT3 hasn't started: no start event yet, but its planned readout is already a milestone
        ("NCT3", "expected_readout"),
        ("NCT4", "trial_start"), ("NCT4", "trial_stopped"),
        ("NCT5", "trial_completion"), ("NCT5", "trial_start"),
    ]
    readout = next(e for e in events if e["nct_id"] == "NCT2" and e["type"] == "expected_readout")
    assert readout["is_milestone"] and readout["expected_date"] == "2027-09-01"
    assert readout["title"] == "Phase 3 primary completion expected: TETON-PPF"
    stopped = next(e for e in events if e["type"] == "trial_stopped")
    assert stopped["summary"] == "Slow enrolment" and stopped["significance"] == "Medium"
    assert {e["nct_id"]: e["sponsor_is_company"] for e in events}["NCT5"] is False
    assert {e["nct_id"]: e["sponsor_is_company"] for e in events}["NCT1"] is True


def patent(number, *, kind="B2", country="US", status="Active", granted="2015-06-02", expires="2031-03-14"):
    return {"record_key": f"patent:{number}", "publication_number": number, "title": f"Title {number}",
            "country": country, "kind": kind, "legal_status": status, "grant_date": granted,
            "expiry_date": expires, "assignees": ["United Therapeutics Corp"]}


def test_patent_rules_grants_history_and_expiry_milestones():
    from journey.rules import patent_events
    events = patent_events(A, [
        patent("US1B2"), patent("US2B2"),                      # same family: expire together
        patent("US3B1", expires="2034-01-20"),                 # the last expiry: loss of exclusivity
        patent("US4B2", expires="2020-01-01"),                 # already expired: grant only
        patent("US5A1", kind="A1", granted=None),              # application, not a grant
        patent("EP6B1", country="EP"),                         # non-US
        patent("US7B2", status="Expired - Fee Related"),       # lapsed
    ], today="2026-10-08")
    grants = sorted(e["sources"][0]["record_key"] for e in events if e["type"] == "patent_grant")
    assert grants == ["patent:US1B2", "patent:US2B2", "patent:US3B1", "patent:US4B2"]
    expiries = {e["date"]: e for e in events if e["type"] == "patent_expiry"}
    assert sorted(expiries) == ["2031-03-14", "2034-01-20"]
    shared = expiries["2031-03-14"]
    assert shared["title"].startswith("2 US patents expire")
    assert [s["record_key"] for s in shared["sources"]] == ["patent:US1B2", "patent:US2B2"]
    assert shared["significance"] == "Medium" and shared["is_milestone"] and shared["category"] == "ip"
    assert expiries["2034-01-20"]["significance"] == "High"
    assert "loss of exclusivity" in expiries["2034-01-20"]["summary"]
    # Stable ids: re-running updates rather than duplicates.
    again = patent_events(A, [patent("US1B2"), patent("US2B2"), patent("US3B1", expires="2034-01-20")], today="2026-10-08")
    assert {e["_id"] for e in again} <= {e["_id"] for e in events}


from journey.rules import build_rule_events, link_events, patent_events, short_indication


def test_short_indication_prefers_the_disease_abbreviation():
    text = ("Treatment of adult patients with WHO Functional Class (FC) III or IV and: inoperable chronic "
            "thromboembolic pulmonary hypertension (CTEPH), or persistent CTEPH after surgery.")
    assert short_indication(text) == "CTEPH"
    assert short_indication("Treatment of pulmonary arterial hypertension; to improve exercise") == \
        "Treatment of pulmonary arterial hypertension"
    assert short_indication("") == ""


def test_trial_events_carry_indications_and_details():
    record = {"record_key": "ctgov:NCT04708782", "nct_id": "NCT04708782", "acronym": "TETON-1", "phases": ["PHASE3"],
              "overall_status": "COMPLETED", "start_date": "2021-06-01", "primary_completion_date": "2026-02-02",
              "conditions": ["Idiopathic Pulmonary Fibrosis", "Interstitial Lung Disease"], "enrollment": 598,
              "lead_sponsor": "United Therapeutics", "title": "Inhaled treprostinil in IPF"}
    start, done = trial_events(A, [record], "United Therapeutics", today="2026-10-09")
    assert start["indications"] == ["Idiopathic Pulmonary Fibrosis", "Interstitial Lung Disease"]
    assert start["details"] == {"Trial": "NCT04708782", "Phase": "Phase 3", "Enrollment": "598",
                                "Status": "Completed", "Sponsor": "United Therapeutics"}
    assert "product" not in start


def test_fda_events_carry_product_and_details():
    record = {**sub("k3", "NDA022387", "SUPPL", "AP", "Efficacy"), "submission_number": "17",
              "products": [{"route": "INHALATION"}, {"route": "INHALATION"}]}
    e = fda_events(A, [record])[0]
    assert e["product"] == "Tyvaso"
    assert e["details"] == {"Application": "NDA022387 S-17", "Class": "Efficacy", "Route": "Inhalation",
                            "Sponsor": "United Therap"}


def test_rule_events_omit_unknown_indications_and_product():
    e = fda_events(A, [sub("k1", "NDA022387", "ORIG", "AP", None)])[0]
    assert "indications" not in e  # left for AI enrichment, which a rebuild must not wipe
    p = patent_events(A, [{"record_key": "patent:US1", "country": "US", "kind": "B2", "legal_status": "Active",
                           "grant_date": "2015-01-27", "expiry_date": "2032-04-20", "publication_number": "US1",
                           "assignees": ["United Therapeutics Corp"], "title": "Treprostinil production"}],
                      today="2026-10-09")
    assert all("product" not in x and "indications" not in x for x in p)
    assert p[0]["details"]["Patent"] == "US1"


def test_ema_approval_gets_its_label_indication():
    events = ema_events(A, [{"record_key": "e1", "record_type": "ema_epar", "medicine_status": "Authorised",
                             "date": "2020-04-03", "name_of_medicine": "Trepulmix",
                             "marketing_authorisation_developer_applicant_holder": "SciPharm Sàrl",
                             "ema_product_number": "EMEA/H/C/005207",
                             "therapeutic_indication": "inoperable chronic thromboembolic pulmonary hypertension (CTEPH)"}])
    assert events[0]["indications"] == ["CTEPH"]
    assert events[0]["product"] == "Trepulmix"
    assert events[0]["details"]["Holder"] == "SciPharm Sàrl"


def test_link_events_joins_the_same_trial_and_application():
    events = [
        {"_id": "start", "nct_id": "NCT1", "date": "2017-02-01"},
        {"_id": "done", "nct_id": "NCT1", "date": "2019-12-26"},
        {"_id": "approval", "application_number": "NDA022387", "product": "Tyvaso", "date": "2009-07-30"},
        {"_id": "suppl", "application_number": "NDA022387", "product": "Tyvaso", "date": "2021-03-31"},
        {"_id": "other", "product": "Tyvaso", "date": "2010-01-01"},
        {"_id": "lonely", "date": ""},
    ]
    linked = {e["_id"]: e.get("links") for e in link_events(events)}
    assert linked["start"] == ["done"]
    assert linked["suppl"] == ["approval"]
    assert linked["approval"] == ["other", "suppl"]  # same product within 5 years first (nearest), then the application
    assert linked["lonely"] is None


def test_build_rule_events_links_across_sources(db):
    db.trial_records.insert_one({"record_key": "ctgov:NCT1", "nct_id": "NCT1", "assets": [A], "phases": ["PHASE3"],
                                 "overall_status": "COMPLETED", "start_date": "2017-02-01",
                                 "primary_completion_date": "2019-12-26", "conditions": ["PH-ILD"], "title": "INCREASE"})
    events = {e["type"]: e for e in build_rule_events(db, A, "United Therapeutics")}
    assert events["trial_start"]["links"] == [events["trial_completion"]["_id"]]
def sec(key, event_type, when, drugs=("Tyvaso DPI",), description="The FDA set a PDUFA target action date."):
    return {"record_key": key, "record_type": "sec_fda_action", "event_type": event_type, "date": when,
            "drugs": list(drugs), "company": "United Therapeutics Corporation", "sponsor_is_company": True,
            "description": description}


def test_sec_pdufa_date_and_calendar_listing_of_the_same_day_are_one_event():
    events = fda_events(A, [calendar("fda_calendar:u1", "pdufa", "2026-05-24"), sec("sec:e1", "pdufa_date", "2026-05-24")],
                        today="2026-01-01")
    [ev] = events
    assert ev["type"] == "regulatory_decision_expected" and ev["is_milestone"]
    assert [s["record_key"] for s in ev["sources"]] == ["fda_calendar:u1", "sec:e1"]  # cites the filing too
    assert ev["summary"] == "2026-05-24 The FDA set a PDUFA date"                       # worded from the calendar


def test_sec_pdufa_date_alone_is_still_a_pdufa_event():
    upcoming, past = fda_events(A, [sec("sec:e2", "pdufa_date", "2027-03-01"), sec("sec:e3", "pdufa_date", "2024-02-01")],
                                today="2026-01-01")
    assert upcoming["type"] == "regulatory_decision_expected" and upcoming["expected_date"] == "2027-03-01"
    assert past["type"] == "pdufa_date" and past["significance"] == "Medium" and past["sources"][0]["record_key"] == "sec:e3"


def test_complete_response_letter_from_sec_is_a_high_regulatory_event():
    crl = sec("sec:e4", "complete_response_letter", "2021-11-08", drugs=("Tyvaso DPI",),
              description="  We received a complete response\n letter from the FDA for Tyvaso DPI.  ")
    [ev] = fda_events(A, [crl, sec("sec:e5", "complete_response_letter", "")], today="2026-01-01")  # undated: skipped
    assert ev["type"] == "complete_response_letter" and ev["category"] == "regulatory" and ev["significance"] == "High"
    assert ev["title"] == "FDA complete response letter: Tyvaso DPI" and ev["region"] == "US"
    assert ev["summary"] == "We received a complete response letter from the FDA for Tyvaso DPI."
    assert ev["_id"] == f"rule:{A}:complete_response_letter:sec:e4" and not ev["is_milestone"]


def submission(key, app, sub_type, number, when, cls="Efficacy", brand="OFEV"):
    return {"record_key": key, "record_type": "fda_submission", "application_number": app, "submission_type": sub_type,
            "submission_number": number, "submission_status": "AP", "submission_class": cls, "date": when,
            "brand_names": [brand], "sponsor_name": "BOEHRINGER"}


def expedited(key, app, sub_type, number, when, program="Breakthrough Therapy", brand="OFEV"):
    return {"record_key": key, "record_type": "fda_expedited_approval", "application_number": app,
            "submission_type": sub_type, "submission_number": number, "date": when, "program_name": program,
            "brand_names": [brand], "indication": "Chronic fibrosing ILD with a progressive phenotype"}


def test_expedited_programs_annotate_their_approval_never_duplicate_it():
    events = fda_events("nintedanib", [
        submission("s13", "NDA205832", "SUPPL", "13", "2020-03-09"),
        expedited("d1", "NDA205832", "SUPPL", 13, "2020-03-09"),
        expedited("d2", "NDA205832", "SUPPL", 13, "2020-03-09", program="Priority Review"),
        submission("s1", "NDA205832", "ORIG", "1", "2014-10-15", cls="Type 1 - New Molecular Entity"),
        expedited("d3", "NDA205832", "ORIG", None, "2014-10-15"),
    ], today="2026-01-01")
    assert len(events) == 2  # one per approval, programs attached
    supp = next(e for e in events if e["type"] == "label_expansion")
    assert supp["expedited_programs"] == ["Breakthrough Therapy", "Priority Review"]
    assert [s["record_key"] for s in supp["sources"]] == ["s13", "d1", "d2"] and "Priority Review" in supp["summary"]
    orig = next(e for e in events if e["type"] == "approval")
    assert orig["expedited_programs"] == ["Breakthrough Therapy"] and orig["indication"]


def test_expedited_approval_missing_from_drugs_at_fda_still_appears_once():
    [e] = fda_events("sotatercept", [expedited("d9", "BLA761363", "ORIG", None, "2024-03-26", brand="WINREVAIR"),
                                     expedited("d10", "BLA761363", "ORIG", None, "2024-03-26", program="Priority Review",
                                               brand="WINREVAIR")], today="2026-01-01")
    assert e["type"] == "approval" and e["title"] == "FDA approves Winrevair" and e["significance"] == "High"
    assert e["expedited_programs"] == ["Breakthrough Therapy", "Priority Review"] and len(e["sources"]) == 2


def test_fda_events_tell_the_asset_company_from_other_sponsors_of_the_molecule():
    from journey.rules import fda_events
    recs = [
        {"record_type": "fda_submission", "record_key": "fda:a", "date": "2009-07-30", "submission_status": "AP", "submission_type": "ORIG",
         "application_number": "NDA022387", "sponsor_name": "UNITED THERAP", "brand_names": ["TYVASO"]},
        {"record_type": "fda_submission", "record_key": "fda:b", "date": "2025-05-23", "submission_status": "AP", "submission_type": "ORIG",
         "application_number": "NDA213005", "sponsor_name": "LIQUIDIA TECHNOLOGIES INC", "brand_names": ["YUTREPIA"]},
    ]
    by = {e["sources"][0]["record_key"]: e for e in fda_events("treprostinil", recs, company="United Therapeutics")}
    assert by["fda:a"]["sponsor_is_company"] is True and by["fda:b"]["sponsor_is_company"] is False
    assert by["fda:b"]["sponsor"] == "Liquidia Technologies Inc"
    assert fda_events("treprostinil", recs)[0]["sponsor_is_company"] is None  # company unknown


def test_a_divested_brand_is_unknown_not_another_company():
    from journey.rules import fda_events
    recs = [{"record_type": "fda_submission", "record_key": "fda:e", "date": "2017-01-11", "submission_status": "AP", "submission_type": "ORIG",
             "application_number": "NDA208780", "sponsor_name": "LEGACY PHARMA", "brand_names": ["ESBRIET"]},
            {"record_type": "fda_submission", "record_key": "fda:g", "date": "2022-05-01", "submission_status": "AP", "submission_type": "ORIG",
             "application_number": "ANDA212345", "sponsor_name": "SANDOZ", "brand_names": ["PIRFENIDONE"]}]
    by = {e["sources"][0]["record_key"]: e for e in fda_events("pirfenidone", recs, company="Hoffmann-La Roche")}
    assert by["fda:e"]["sponsor_is_company"] is None and by["fda:g"]["sponsor_is_company"] is False
