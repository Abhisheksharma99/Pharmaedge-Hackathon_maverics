"""
openFDA fetchers for an asset's US regulatory history (https://open.fda.gov).

No API key is needed (240 req/min, 1k/day per IP); set OPENFDA_API_KEY to raise
the limits. Each fetcher returns records ready for mongo_storage.upsert_records:
a stable `record_key`, a `record_type`, an ISO `date`, and the source fields.
"""

import os
from collections import Counter
from typing import Any, Dict, List

import requests

BASE_URL = "https://api.fda.gov/drug"
PAGE_SIZE = 100
MAX_SKIP = 25000  # openFDA hard limit on `skip`


def _iso(yyyymmdd: str) -> str:
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}" if yyyymmdd else ""


def _name_query(names: List[str], prefix: str = "") -> str:
    """Match any name against brand, generic or substance (space = OR)."""
    fields = ("openfda.brand_name", "openfda.generic_name", "openfda.substance_name")
    return " ".join(f'{prefix}{f}:"{n}"' for n in names for f in fields)


def _get(endpoint: str, params: Dict[str, Any]) -> Dict[str, Any]:
    if os.getenv("OPENFDA_API_KEY"):
        params = {**params, "api_key": os.environ["OPENFDA_API_KEY"]}
    resp = requests.get(f"{BASE_URL}/{endpoint}.json", params=params, timeout=60)
    if resp.status_code == 404:  # openFDA's "No matches found!"
        return {"results": [], "meta": {"results": {"total": 0}}}
    resp.raise_for_status()
    return resp.json()


def _search_all(endpoint: str, search: str) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    skip = 0
    while skip <= MAX_SKIP:
        data = _get(endpoint, {"search": search, "limit": PAGE_SIZE, "skip": skip})
        results.extend(data["results"])
        total = data["meta"]["results"]["total"]
        skip += PAGE_SIZE
        if skip >= total:
            break
    return results


def fetch_approvals(names: List[str]) -> List[Dict[str, Any]]:
    """Drugs@FDA: one record per submission (original approval, supplements,
    label changes) - the US approval timeline of the asset."""
    records = []
    for app in _search_all("drugsfda", _name_query(names)):
        openfda = app.get("openfda", {})
        for sub in app.get("submissions", []):
            records.append({
                "record_key": f"fda:drugsfda:{app['application_number']}:"
                              f"{sub.get('submission_type')}{sub.get('submission_number')}",
                "record_type": "fda_submission",
                "source": "fda",
                "date": _iso(sub.get("submission_status_date", "")),
                "application_number": app["application_number"],
                "sponsor_name": app.get("sponsor_name"),
                "brand_names": openfda.get("brand_name", []),
                "generic_names": openfda.get("generic_name", []),
                "submission_type": sub.get("submission_type"),
                "submission_number": sub.get("submission_number"),
                "submission_status": sub.get("submission_status"),
                "review_priority": sub.get("review_priority"),
                "submission_class": sub.get("submission_class_code_description"),
                "documents": sub.get("application_docs", []),
                "products": app.get("products", []),
            })
    return records


def fetch_recalls(names: List[str]) -> List[Dict[str, Any]]:
    """Drug enforcement reports (recalls)."""
    return [{
        "record_key": f"fda:recall:{r['recall_number']}",
        "record_type": "fda_recall",
        "source": "fda",
        "date": _iso(r.get("recall_initiation_date") or r.get("report_date", "")),
        **r,
    } for r in _search_all("enforcement", _name_query(names))]


def fetch_adverse_event_counts(asset: str, names: List[str]) -> List[Dict[str, Any]]:
    """FAERS adverse-event reports received, aggregated per month."""
    data = _get("event", {
        "search": _name_query(names, prefix="patient.drug."),
        "count": "receivedate",
    })
    monthly: Counter = Counter()
    for row in data["results"]:
        monthly[row["time"][:6]] += row["count"]
    return [{
        "record_key": f"fda:faers:{asset.lower()}:{month}",
        "record_type": "fda_adverse_events_monthly",
        "source": "fda",
        "date": f"{month[:4]}-{month[4:]}-01",
        "month": f"{month[:4]}-{month[4:]}",
        "report_count": count,
    } for month, count in sorted(monthly.items())]


def fetch_all(asset: str, names: List[str]) -> List[Dict[str, Any]]:
    return (fetch_approvals(names)
            + fetch_recalls(names)
            + fetch_adverse_event_counts(asset, names))
