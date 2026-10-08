"""
ClinicalTrials.gov fetcher (API v2, https://clinicaltrials.gov/data-api/api).

Every study whose intervention matches one of the asset's names: phase, status,
start / completion dates, sponsor, conditions, enrollment, and whether results
are posted. The full study JSON is kept under `study` for anything not flattened.
"""

from typing import Any, Dict, List

import requests

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"


def _date(struct: Dict[str, Any]) -> str:
    """'2021-03' -> '2021-03-01'; '' when absent."""
    d = (struct or {}).get("date", "")
    return f"{d}-01" if len(d) == 7 else d


def _search(term: str) -> List[Dict[str, Any]]:
    studies, token = [], None
    while True:
        params = {"query.intr": term, "pageSize": 100}
        if token:
            params["pageToken"] = token
        resp = requests.get(BASE_URL, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        studies.extend(data.get("studies", []))
        token = data.get("nextPageToken")
        if not token:
            return studies


def fetch_all(names: List[str]) -> List[Dict[str, Any]]:
    records: Dict[str, Dict[str, Any]] = {}
    for name in names:
        for study in _search(name):
            p = study["protocolSection"]
            nct = p["identificationModule"]["nctId"]
            if nct in records:
                continue
            status = p.get("statusModule", {})
            design = p.get("designModule", {})
            records[nct] = {
                "record_key": f"ctgov:{nct}",
                "record_type": "clinical_trial",
                "source": "clinicaltrials.gov",
                "date": _date(status.get("startDateStruct")),
                "nct_id": nct,
                "url": f"https://clinicaltrials.gov/study/{nct}",
                "title": p["identificationModule"].get("briefTitle"),
                "official_title": p["identificationModule"].get("officialTitle"),
                "acronym": p["identificationModule"].get("acronym"),
                "overall_status": status.get("overallStatus"),
                "why_stopped": status.get("whyStopped"),
                "start_date": _date(status.get("startDateStruct")),
                "primary_completion_date": _date(status.get("primaryCompletionDateStruct")),
                "completion_date": _date(status.get("completionDateStruct")),
                "phases": design.get("phases", []),
                "enrollment": design.get("enrollmentInfo", {}).get("count"),
                "lead_sponsor": p.get("sponsorCollaboratorsModule", {}).get("leadSponsor", {}).get("name"),
                "conditions": p.get("conditionsModule", {}).get("conditions", []),
                "interventions": [i.get("name") for i in
                                  p.get("armsInterventionsModule", {}).get("interventions", [])],
                "has_results": study.get("hasResults", False),
                "study": study,
            }
    return list(records.values())
