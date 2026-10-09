"""Competitor candidates, ranking clean-up, storage and jobs (offline). Run: cd crawler && ../.venv/bin/python -m pytest onboarding -q"""

import asyncio
from datetime import datetime, timedelta, timezone

from onboarding import competitors as scan
from service.jobs import new_job

TREP = {"_id": "treprostinil", "name": "Treprostinil", "aliases": ["Tyvaso", "Tyvaso DPI"], "kind": "primary",
        "company": {"name": "United Therapeutics"},
        "tags": {"indications": ["Pulmonary arterial hypertension (PAH)", "PH-ILD"],
                 "investigational_indications": ["Idiopathic pulmonary fibrosis (IPF)"]}}


def study(nct, phases, sponsor, *interventions):
    return {"protocolSection": {"identificationModule": {"nctId": nct}, "designModule": {"phases": phases},
                                "sponsorCollaboratorsModule": {"leadSponsor": {"name": sponsor}},
                                "armsInterventionsModule": {"interventions": list(interventions)}}}


def drug(name, *other_names, kind="DRUG"):
    return {"type": kind, "name": name, "otherNames": list(other_names)}


def test_interventions_are_counted_per_trial_without_placebo_or_the_asset_itself():
    found = {}
    scan.count_interventions([
        study("NCT1", ["PHASE3"], "Merck", drug("Sotatercept 0.7 mg/kg", kind="BIOLOGICAL"), drug("Placebo")),
        study("NCT2", ["PHASE2"], "Merck", drug("Sotatercept (MK-7962)", kind="BIOLOGICAL"),
              drug("Sotatercept 0.3 mg/kg", kind="BIOLOGICAL")),  # two arms, one trial
        study("NCT3", ["PHASE2", "PHASE3"], "Gossamer", drug("Seralutinib"), drug("Standard of care")),
        study("NCT4", ["PHASE3"], "UTC", drug("Inhaled powder", "Tyvaso DPI"), drug("Exercise", kind="BEHAVIORAL")),
    ], "Pulmonary arterial hypertension", scan._own(TREP), found)
    assert set(found) == {"sotatercept", "seralutinib"}
    assert len(found["sotatercept"]["trials"]) == 2 and found["sotatercept"]["phase"] == 3
    assert found["sotatercept"]["sponsors"] == {"Merck": 2}
    assert found["seralutinib"]["phase"] == 3


def test_candidates_query_reference_indications_and_studied_conditions(monkeypatch, db):
    for conditions in (["Pulmonary Arterial Hypertension", "PH-ILD"], ["Pulmonary Hypertension", "Sarcoidosis"],
                       ["Pulmonary Hypertension", "Sarcoidosis"], ["Pulmonary Hypertension"]):
        db.trial_records.insert_one({"assets": ["treprostinil"], "conditions": conditions})
    calls = []

    class Client:
        def __init__(self, timeout):
            pass

        def get(self, path, params):
            calls.append(dict(params))
            if params["query.cond"] == "PH-ILD":
                raise ConnectionError("api down")  # best effort: the other conditions still count
            token = params.get("pageToken")
            return {"studies": [study(f"{params['query.cond']}{token}", ["PHASE3"], "Merck", drug("Sotatercept"))],
                    "nextPageToken": None if token else "p2"}

    monkeypatch.setattr(scan, "ClinicalTrialsClient", Client)
    candidates = scan.trial_candidates(db, TREP)
    queried = [c["query.cond"] for c in calls]
    # abbreviations dropped, case-insensitive duplicates dropped, top 3 studied conditions added, 2 pages each
    assert list(dict.fromkeys(queried)) == ["Pulmonary arterial hypertension", "PH-ILD", "Idiopathic pulmonary fibrosis",
                                            "Pulmonary Hypertension", "Sarcoidosis"]
    assert queried.count("Pulmonary Hypertension") == 2 and calls[0]["filter.advanced"] == scan.LATE_PHASE_TRIALS
    assert candidates == [{"name": "Sotatercept", "trials": 8, "max_phase": "PHASE3", "top_sponsor": "Merck",
                           "conditions": ["Idiopathic pulmonary fibrosis", "Pulmonary Hypertension",
                                          "Pulmonary arterial hypertension", "Sarcoidosis"]}]


def ranked(name, coverage=(), **fields):
    return {"name": name, "aliases": [], "company": "Co", "mechanism": "m", "modality": "Small molecule",
            "indications": [], "investigational_indications": [], "basis": "indication", "stage": "approved",
            "reason": "r", "coverage": [{"indication": i, "status": s} for i, s in coverage],
            "other_indications": [], **fields}


def test_ranking_drops_the_asset_and_duplicates_and_keys_coverage_by_reference():
    refs = scan.reference_indications(TREP)
    out = scan._clean([ranked("Tyvaso DPI"), ranked("Sotatercept", [("pulmonary arterial hypertension (PAH)", "approved")],
                               aliases=["Sotatercept", "Winrevair"]),
                       ranked("sotatercept"), *[ranked(f"Drug {n}") for n in range(6)]], TREP, refs)
    assert [c["id"] for c in out] == ["sotatercept", "drug-0", "drug-1", "drug-2", "drug-3"]
    assert out[0]["aliases"] == ["Winrevair"]
    assert out[0]["coverage"] == {"Pulmonary arterial hypertension (PAH)": "approved", "PH-ILD": "none",
                                  "Idiopathic pulmonary fibrosis (IPF)": "none"}


def test_save_links_existing_assets_without_overwriting_them(db):
    db.assets.insert_one({**TREP})
    db.assets.insert_one({"_id": "sotatercept", "name": "Sotatercept", "kind": "primary", "status": "ready",
                          "company": {"name": "Merck & Co.", "website": "https://www.merck.com"}})
    db.assets.insert_one({"_id": "old-drug", "kind": "competitor", "competitor_of": ["treprostinil", "other"]})
    refs = scan.reference_indications(TREP)
    entries = scan._clean([ranked("Sotatercept", company="Merck"), ranked("Ralinepag", company="UTC",
                                                                          indications=["PAH"])], TREP, refs)
    assert scan.save(db, TREP, entries, candidates=41) == 1
    sota, rali = db.assets.find_one({"_id": "sotatercept"}), db.assets.find_one({"_id": "ralinepag"})
    assert sota["kind"] == "primary" and sota["company"]["website"] == "https://www.merck.com"  # identity kept
    assert sota["competitor_of"] == ["treprostinil"]
    assert rali["kind"] == "competitor" and rali["status"] == "onboarding" and rali["company"] == {"name": "UTC"}
    assert rali["tags"]["indications"] == ["PAH"] and rali["competitor_of"] == ["treprostinil"]
    assert db.assets.find_one({"_id": "old-drug"})["competitor_of"] == ["other"]  # dropped from the ranking
    primary = db.assets.find_one({"_id": "treprostinil"})
    assert [c["id"] for c in primary["competitors"]] == ["sotatercept", "ralinepag"]
    assert set(primary["competitors"][0]) == set(scan.ENTRY_FIELDS)
    assert primary["competitor_scan"]["candidates"] == 41


def test_a_recent_scan_is_reused():
    now = datetime.now(timezone.utc)
    assert scan.is_fresh({"competitors": [{"id": "x"}], "competitor_scan": {"at": now - timedelta(days=3)}})
    assert not scan.is_fresh({"competitors": [{"id": "x"}], "competitor_scan": {"at": now - timedelta(days=31)}})
    assert not scan.is_fresh({"competitors": [], "competitor_scan": {"at": now}})
    naive = (now - timedelta(days=1)).replace(tzinfo=None)  # as pymongo returns it
    assert scan.is_fresh({"competitors": [{"id": "x"}], "competitor_scan": {"at": naive}})


class Queue:
    def __init__(self):
        self.enqueued = []

    async def enqueue_job(self, fn, job_id, _job_id):
        self.enqueued.append(job_id)


def test_jobs_start_only_for_competitors_not_crawled_or_running(db):
    recent = (datetime.now(timezone.utc) - timedelta(hours=2)).replace(tzinfo=None)
    stale = datetime.now(timezone.utc) - timedelta(days=2)
    for doc in ({"_id": "new", "kind": "competitor"}, {"_id": "stale", "kind": "competitor", "last_crawled_at": stale},
                {"_id": "recent", "kind": "competitor", "last_crawled_at": recent},
                {"_id": "running", "kind": "competitor"}, {"_id": "primary", "kind": "primary"}):
        db.assets.insert_one(doc)
    db.jobs.insert_one({**new_job("running", "competitor", [], None)})
    queue, plan = Queue(), [{"name": "regulatory", "label": "Regulatory"}]
    started = asyncio.run(scan.start_jobs(db, queue, TREP, ["new", "stale", "recent", "running", "primary", "gone"], plan))
    assert started == 2 and len(queue.enqueued) == 2
    jobs = [j for j in db.jobs.docs if j["_id"] in queue.enqueued]
    assert {j["asset"] for j in jobs} == {"new", "stale"}
    assert all(j["type"] == "competitor" and j["requested_by"]["name"] == "Competitors of Treprostinil" for j in jobs)
