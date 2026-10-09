"""
Patents for an asset, from the team's patent crawler (patent_intel/): AdisInsight
(when the asset has an Adis id) or the asset's names and company, PubChem patent
links, then Google Patents pages (DOCDB families and same-company citations) with
deterministic company matching.

run_drug is handed a collecting store instead of its own, so its included patents
come back here and are written as `patent_records` in the shared contract.
"""

import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import TEAM_ROOT  # noqa: F401  (puts the team packages on sys.path)
from patent_intel import google_patents
from patent_intel.net import Cache, Http
from patent_intel.pipeline import run_drug

CACHE_DIR = Path(os.getenv("PATENT_CACHE_DIR", "cache/patents"))
MAX_PAGES = int(os.getenv("PATENT_MAX_PAGES", "600"))
PROBE_PAGES = int(os.getenv("PATENT_PROBE_PAGES", "150"))


class _Collector:
    """The store calls run_drug makes, kept in memory."""

    def __init__(self) -> None:
        self.docs: Dict[str, List[Dict[str, Any]]] = {}

    async def upsert(self, collection: str, docs: List[Dict[str, Any]]) -> None:
        self.docs.setdefault(collection, []).extend(docs)

    async def mark_stale(self, collection: str, where: Dict[str, Any], keep: set) -> int:
        return 0


def _event_date(patent: Dict[str, Any], *, type_: Optional[str] = None, titles: Tuple[str, ...] = ()) -> Optional[str]:
    """Date of the first event of that type, or with the first of `titles` present (in order of preference)."""
    events = patent.get("events") or []
    if type_:
        return next((e.get("date") for e in events if e.get("type") == type_), None)
    for title in titles:
        found = next((e.get("date") for e in events if e.get("title") == title), None)
        if found:
            return found
    return None


def to_record(patent: Dict[str, Any], match: Dict[str, Any]) -> Dict[str, Any]:
    number = patent["publication_number"]
    return {
        "record_key": f"patent:{number}",
        "record_type": "patent",
        "source": "google_patents",
        "date": patent.get("publication_date") or patent.get("filing_date") or "",
        "publication_number": number,
        "title": patent.get("title"),
        "abstract": patent.get("abstract"),
        "country": patent.get("country"),
        "kind": patent.get("kind"),
        "application_number": patent.get("application_number"),
        "filing_date": patent.get("filing_date"),
        "priority_date": patent.get("priority_date"),
        "publication_date": patent.get("publication_date"),
        "grant_date": _event_date(patent, type_="granted"),
        # Adjusted (term extension / adjustment) wins over the anticipated 20-year date.
        "expiry_date": _event_date(patent, titles=("Adjusted expiration", "Anticipated expiration")),
        "legal_status": patent.get("legal_status"),
        "assignees": patent.get("assignee_current") or patent.get("assignee_original") or [],
        "inventors": patent.get("inventors") or [],
        "family_id": patent.get("family_id"),
        "cpc": (patent.get("cpc") or [])[:10],
        "events": patent.get("events") or [],
        "url": google_patents.page_url(number),
        "match": match,
    }


async def fetch(asset: Dict[str, Any], names: List[str]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Included patents for the asset, as records, plus the crawler's coverage report."""
    adis_id = (asset.get("ids") or {}).get("adis")
    company = (asset.get("company") or {}).get("name")
    if not adis_id and not company:
        raise ValueError("the asset needs an AdisInsight id or a company name to search patents")
    store, http = _Collector(), Http(Cache(CACHE_DIR))
    try:
        # With an Adis id the crawler reads the developer and alternative names from the profile.
        run = await run_drug(http=http, store=store, adis_ref=adis_id,
                             drug_name=None if adis_id else asset["name"],
                             companies=None if adis_id else [company],
                             terms=None if adis_id else names,
                             max_pages=MAX_PAGES, probe_budget=PROBE_PAGES)
    finally:
        await http.aclose()
    patents = {p["_id"]: p for p in store.docs.get("patents", [])}
    records = [to_record(patents[link["patent_id"]], link["match"])
               for link in store.docs.get("drug_patents", [])
               if link["decision"] == "include" and link["patent_id"] in patents]
    return records, run["coverage"]
