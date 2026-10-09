"""
EMA corpus: every row of EMA's medicine reports (regulatory/ema.py: EPAR, post-authorisation opinions, DHPC
safety letters, orphan designations, referrals) as records keyed by record_key, plus the CHMP meeting highlights
corpus (integrations/chmp.py).

The reports are full snapshots that EMA refreshes daily, so every run downloads them again. for_asset() serves
the regulatory step from the corpus once a report is in it, and from EMA directly until then.
"""

import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List

from pymongo import UpdateOne

from corpus import collection, complete
from integrations import chmp
from regulatory import ema as reports

COLLECTION = os.getenv("EMA_CORPUS", "pharmaedge.ema_reports")
PAUSE_S = 3  # between report downloads: EMA answers bursts with HTTP 429


def _coll(db):
    coll = collection(db, COLLECTION)
    coll.create_index("record_type")
    return coll


def store(db, records: Iterable[Dict[str, Any]]) -> int:
    now = datetime.now(timezone.utc)
    ops = [UpdateOne({"_id": r["record_key"]}, {"$set": {**r, "last_seen": now}, "$setOnInsert": {"first_seen": now}},
                     upsert=True) for r in records]
    return _coll(db).bulk_write(ops, ordered=False).upserted_count if ops else 0


def crawl_reports(db, *, full: bool, progress: Dict[str, Any], should_stop: Callable[[], bool]) -> Dict[str, Any]:
    counts: Dict[str, Any] = {}
    for n, report in enumerate(reports.REPORTS):
        if should_stop():
            return {**counts, "complete": False}
        if n:
            time.sleep(PAUSE_S)
        records = reports.fetch_report(report)
        counts[f"{report}_rows"] = len(records)
        counts[f"{report}_new"] = store(db, records)
    return counts


def crawl_chmp(db, *, full: bool, progress: Dict[str, Any], should_stop: Callable[[], bool]) -> Dict[str, Any]:
    """Every CHMP meeting when the corpus is empty, else the meetings since the newest stored one."""
    return chmp.refresh_corpus(db, claim=False)


def stored(db, report: str, names: List[str]) -> List[Dict[str, Any]]:
    """The report's corpus records naming the asset (same whole-word rule as the live fetcher)."""
    record_type, name_fields = reports.REPORTS[report][1], reports.REPORTS[report][4]
    pattern = {"$regex": "|".join(re.escape(n) for n in names if n.strip()), "$options": "i"}
    query = {"record_type": record_type, "$or": [{f: pattern} for f in name_fields]}
    patterns = reports.name_patterns(names)
    return [r for r in _coll(db).find(query, {"_id": 0, "first_seen": 0, "last_seen": 0})
            if reports.matches(report, r, patterns)]


def for_asset(db, names: List[str]) -> List[Dict[str, Any]]:
    """The asset's EMA report records: from the corpus once its full crawl has completed, else from EMA."""
    if not complete(db, "ema_reports"):
        return reports.fetch_all(names)
    return [r for report in reports.REPORTS for r in stored(db, report, names)]
