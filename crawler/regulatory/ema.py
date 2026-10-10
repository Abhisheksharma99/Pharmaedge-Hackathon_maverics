"""
EMA fetchers for an asset's EU regulatory history.

EMA publishes its medicine data as full JSON reports (refreshed daily) rather
than a search API, so each report is downloaded once per process and filtered
locally by asset name. ema.europa.eu rate-limits aggressively (HTTP 429), hence
the backoff.
"""

import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

BASE_URL = "https://www.ema.europa.eu/en/documents/report/"

# report -> (file, record_type, key fields, date field(s), name fields to match on).
# With several date fields the first non-empty one wins.
REPORTS = {
    "medicines": (
        "medicines-output-medicines_json-report_en.json", "ema_epar",
        ("ema_product_number", "name_of_medicine"),
        ("marketing_authorisation_date", "withdrawal_of_application_date",
         "refusal_of_marketing_authorisation_date", "opinion_adopted_date"),
        ("name_of_medicine", "active_substance", "international_non_proprietary_name_common_name"),
    ),
    "post_authorisation": (
        "medicines-output-post_authorisation_json-report_en.json", "ema_post_authorisation",
        ("ema_product_number", "medicine_url", "post_authorisation_opinion_date"),
        "post_authorisation_opinion_date",
        ("name_of_medicine", "active_substance", "international_non_proprietary_name_common_name"),
    ),
    "dhpc": (
        "dhpc-output-json-report_en.json", "ema_dhpc",
        ("dhpc_url",), "dissemination_date",
        ("name_of_medicine", "active_substances"),
    ),
    "orphan_designations": (
        "medicines-output-orphan_designations-json-report_en.json", "ema_orphan_designation",
        ("eu_designation_number",), "date_of_designation_or_refusal",
        ("medicine_name", "active_substance"),
    ),
    "referrals": (
        "referrals-output-json-report_en.json", "ema_referral",
        ("reference_number",), "procedure_start_date",
        ("referral_name", "international_non_proprietary_name_inn_common_name",
         "associated_names_centrally_authorised_medicines"),
    ),
}

_downloaded: Dict[str, List[Dict[str, Any]]] = {}


def _download(filename: str, retries: int = 5) -> List[Dict[str, Any]]:
    if filename not in _downloaded:
        for attempt in range(retries):
            resp = requests.get(BASE_URL + filename, timeout=120)
            if resp.status_code != 429:
                break
            time.sleep(10 * 2 ** attempt)
        resp.raise_for_status()
        _downloaded[filename] = resp.json()["data"]
    return _downloaded[filename]


def _iso(ddmmyyyy: str) -> str:
    try:
        return datetime.strptime(ddmmyyyy, "%d/%m/%Y").date().isoformat()
    except (TypeError, ValueError):
        return ""


def name_patterns(names: List[str]) -> List[re.Pattern]:
    return [re.compile(rf"\b{re.escape(n)}\b", re.I) for n in names]


def matches(report: str, record: Dict[str, Any], patterns: List[re.Pattern]) -> bool:
    """One of the names, as a whole word, in the report's name fields (medicine, substance, INN)."""
    haystack = " ".join(record.get(f) or "" for f in REPORTS[report][4])
    return any(p.search(haystack) for p in patterns)


def to_record(report: str, row: Dict[str, Any]) -> Dict[str, Any]:
    _, record_type, key_fields, date_fields, _ = REPORTS[report]
    if isinstance(date_fields, str):
        date_fields = (date_fields,)
    return {
        "record_key": f"ema:{report}:" + ":".join(str(row.get(k, "")) for k in key_fields),
        "record_type": record_type,
        "source": "ema",
        "date": next((d for d in (_iso(row.get(f, "")) for f in date_fields) if d), ""),
        **row,
    }


def fetch_report(report: str, names: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """The report's rows naming the asset, as records; every row when `names` is None (the corpus crawl)."""
    records = [to_record(report, row) for row in _download(REPORTS[report][0])]
    if names is None:
        return records
    patterns = name_patterns(names)
    return [r for r in records if matches(report, r, patterns)]


def fetch_all(names: List[str]) -> List[Dict[str, Any]]:
    records = []
    for report in REPORTS:
        records.extend(fetch_report(report, names))
        time.sleep(3)  # stay under EMA's rate limit
    return records
