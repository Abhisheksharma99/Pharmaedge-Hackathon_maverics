"""
FDA actions the company itself reported to the SEC, for an asset, from the team's
regulatory crawler (patent_intel/regulatory.py): PDUFA target dates and complete
response letters (CRLs) stated in 8-K / 6-K / 10-K / 10-Q / 20-F / 40-F filings.

Only SEC EDGAR is read here: Drugs@FDA approvals come from the `regulatory` step,
and PDUFA/AdCom listings from `fda_calendar`. CRLs have no other source: openFDA
publishes approvals only and the FDA calendar lists goal dates and meetings.

A sentence counts only when it states the action (a received/issued CRL, a
PDUFA/target action date), names the asset (any of its names) in that sentence or
the one before it, never another substance containing the name ("treprostinil
palmitil"), and the filer is the asset's company. One record per (type, date,
company); every filing sentence that reported it is kept as evidence.

Records go to `fda_records` (record_type `sec_fda_action`), keyed by that
(type, date, company) identity, so a refresh updates the same record.

SEC requires a declared User-Agent ("Company contact@email") - SEC_USER_AGENT in
the crawler's environment. Without it the step is skipped, never guessed.
"""

import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import TEAM_ROOT  # noqa: F401  (puts the team packages on sys.path)
from patent_intel import fdacal, regulatory
from patent_intel.config import settings
from patent_intel.ctgov import other_products
from patent_intel.net import Cache, Http

CACHE_DIR = Path(os.getenv("SEC_REGULATORY_CACHE_DIR", "cache/sec_regulatory"))
EVENT_LABELS = {"pdufa_date": "PDUFA target date", "complete_response_letter": "Complete response letter"}
MAX_EVIDENCE = 10


def _filing(source: Dict[str, Any]) -> Dict[str, Any]:
    return source.get("source") or {}


def to_record(event: Dict[str, Any], names: List[str]) -> Dict[str, Any]:
    sources = event.get("sources") or []
    terms = {t.lower() for s in sources for t in s.get("drug_terms") or []}
    # The asset's own spelling of each matched name ("Tyvaso DPI", not "tyvaso dpi").
    drugs = [n for n in names if n.lower() in terms] or sorted(terms) or names[:1]
    return {
        "record_key": f"sec:{event['_id']}",
        "record_type": "sec_fda_action",
        "source": "sec_edgar",
        "date": event["date"],
        "event_type": event["type"],
        "title": f"{EVENT_LABELS.get(event['type'], 'FDA action')}: {', '.join(drugs)} ({event['sponsor']})",
        "drugs": drugs,
        "company": event["sponsor"],
        "sponsor_is_company": True,  # the timeline keeps the asset company's own filings only
        "status": event.get("status"),
        "first_reported": event.get("first_reported"),
        "last_reported": event.get("last_reported"),
        "description": (sources[0].get("sentence") if sources else "")[:600],
        "url": next((_filing(s).get("url") for s in sources if _filing(s).get("url")), None),
        "evidence": [{"sentence": s.get("sentence", "")[:600],
                      **{k: _filing(s).get(k) for k in ("url", "form", "filed", "cik")}} for s in sources[:MAX_EVIDENCE]],
        "evidence_count": event.get("evidence_count", len(sources)),
    }


async def fetch(asset: Dict[str, Any], names: List[str],
                sec_user_agent: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """SEC-reported FDA actions for the asset, as records, plus the crawler's report.
    ([], report with `skipped`) when no SEC User-Agent is configured."""
    cfg = settings()
    ua = sec_user_agent or cfg.sec_user_agent
    if not ua:
        return [], {"skipped": "SEC_USER_AGENT not configured"}
    company = (asset.get("company") or {}).get("name")
    if not company:
        return [], {"skipped": "the asset has no company name (filings are matched to the asset's company)"}
    start, end = cfg.reg_window()
    http = Http(Cache(CACHE_DIR))
    try:
        events, report = await regulatory.collect(
            http, drug_id=asset["_id"], terms=fdacal.drug_terms(asset["name"], names[1:]), companies=[company],
            sec_user_agent=ua, start=start, end=end, max_docs=cfg.reg_max_filings,
            # Other substances containing the name ("treprostinil palmitil") must not count as this asset.
            exclude=await other_products(http, asset["name"]), openfda=False)
    finally:
        await http.aclose()
    return [to_record(e, names) for e in events], report
