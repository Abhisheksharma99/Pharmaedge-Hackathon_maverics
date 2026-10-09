"""
v3 journey derivation, run at finalize after the rule rebuild (spec §4): indication branches, key events and the
enrichment of key events. Branch assignment and key selection run twice: enrichment adds indications to AI events,
which can move them to a branch. LLM failures keep the previous branches / enrichment and are logged, never fatal.
"""

import logging
from typing import Any, Callable, Dict

from ai import enrich

from . import branches, key_events

logger = logging.getLogger("crawl.journey")


def _no_log(kind: str, text: str, **extra: Any) -> None:
    pass


def derive_journey(db, asset: Dict[str, Any], log: Callable[..., None] = _no_log) -> Dict[str, int]:
    asset_id = asset["_id"]
    counts: Dict[str, int] = {}
    try:
        counts["branches"] = len(branches.refresh(db, asset))
    except Exception as e:  # noqa: BLE001 - the LLM is optional; keep what we had
        logger.warning("branch derivation failed for %s", asset_id, exc_info=True)
        counts["branches"] = db.asset_branches.count_documents({"asset": asset_id})
        counts["branch_errors"] = 1
        log("warn", f"Couldn't re-derive indication branches ({type(e).__name__}); kept the previous ones")
    branches.assign_all(db, asset_id)
    key_events.mark(db, asset_id)
    try:
        counts["enriched"] = enrich.enrich_events(db, asset)
    except Exception as e:  # noqa: BLE001
        logger.warning("event enrichment failed for %s", asset_id, exc_info=True)
        counts["enriched"] = 0
        counts["enrich_errors"] = 1
        log("warn", f"Couldn't enrich key events ({type(e).__name__}); they'll be retried on the next refresh")
    branches.assign_all(db, asset_id)
    counts["key_events"] = key_events.mark(db, asset_id)
    log("info", f"{counts['branches']} indication branches · {counts['key_events']} key events")
    return counts
