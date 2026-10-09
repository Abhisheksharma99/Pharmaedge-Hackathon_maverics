"""
ClinicalTrials.gov studies for an asset, fetched with the team's crawler
(clinicalTrialgov/: API v2 client with pacing, retries and phrase-quoted names).

Every study whose intervention matches one of the asset's names: phase, status,
start / completion dates, sponsor, conditions, enrollment, and whether results
are posted. The full study JSON is kept under `study` for anything not flattened.
"""

from typing import Any, Dict, List

import integrations  # noqa: F401  (puts the team packages on sys.path)
from clinicalTrialgov.clinicaltrials import ClinicalTrialsClient, build_query, iter_pages, parse_payload


def _date(struct: Dict[str, Any]) -> str:
    """'2021-03' -> '2021-03-01'; '' when absent."""
    d = (struct or {}).get("date", "")
    return f"{d}-01" if len(d) == 7 else d


def fetch_all(names: List[str]) -> List[Dict[str, Any]]:
    records: Dict[str, Dict[str, Any]] = {}
    search_names, _ = parse_payload({"asset_name": names[0], "aliases": names[1:]})
    for page in iter_pages(ClinicalTrialsClient(), build_query(search_names)):
        for study in page.get("studies", []):
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
