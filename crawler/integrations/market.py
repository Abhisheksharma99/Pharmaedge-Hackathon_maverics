"""
Listed company and daily share prices for an asset, from the team's market module (patent_intel/market): the same
listing match and price providers, written to the platform so Asset AI can measure how the company's shares moved
after the asset's journey events (apps/api get_market_reaction; moves show timing, never causation).

  market_listings  one doc per (asset, ticker): the asset company's own listing (resolved by name with the same strict
                   company matcher as regulatory events - never a lookalike) + tickers named on the asset's FDA
                   calendar records. Listings a run no longer finds are flagged stale, never deleted.
  market_prices    one doc per ticker: split/dividend-adjusted daily closes from REG_START to today.

Provider: Yahoo Finance's keyless endpoints, which the module labels "unofficial: local testing only" - the label travels with the data (`source`).
A company that cannot be resolved or priced is reported, never fatal.
"""

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import TEAM_ROOT  # noqa: F401  (puts the team packages on sys.path)
from patent_intel.config import settings
from patent_intel.market import prices
from patent_intel.market.ingest import resolve_listing
from patent_intel.net import Cache, Http

CACHE_DIR = Path(os.getenv("MARKET_CACHE_DIR", "cache/market"))


def fresh(doc: Optional[Dict[str, Any]], ttl_s: float) -> bool:
    """Prices fetched within the TTL are reused (e.g. the patent_intel run already stored them): no refetch."""
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(doc["fetched_at"]) < timedelta(seconds=ttl_s)
    except (TypeError, KeyError, ValueError):
        return False


async def fetch(asset: Dict[str, Any], calendar_records: List[Dict[str, Any]],
                stored_prices: Callable[[str], Optional[Dict[str, Any]]] = lambda t: None,
                ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """(listings, price docs, report) for the asset. `stored_prices(ticker)` returns an already stored price doc
    (platform or patent_intel's own `market_prices`); a fresh one is reused instead of fetched."""
    cfg = settings()
    ttl = cfg.market_price_ttl_s
    company = (asset.get("company") or {}).get("name")
    listings: Dict[str, Dict[str, Any]] = {}
    report: Dict[str, Any] = {"unlisted": [], "errors": [], "prices": {}}
    http = Http(Cache(CACHE_DIR))
    try:
        if company:
            try:
                hit = await resolve_listing(http, company, ttl)
            except Exception as e:  # noqa: BLE001 - search down: unlisted this run, nothing else affected
                hit = None
                report["errors"].append(f"search {company!r}: {type(e).__name__}: {e}"[:300])
            if hit:
                listings[hit["ticker"]] = {"company": company, "listed_name": hit["name"], "exchange": hit["exchange"],
                                           "roles": ["asset_company"], "via_parent": bool(hit.get("via_parent"))}
            else:
                report["unlisted"].append(company)  # private, or listed under another name
        for r in calendar_records:
            t = (r.get("ticker") or "").upper()
            if not prices.SYMBOL.match(t):
                continue
            lst = listings.setdefault(t, {"company": r.get("company") or t, "listed_name": None, "exchange": None, "roles": []})
            if "fda_calendar_event" not in lst["roles"]:
                lst["roles"].append("fda_calendar_event")
        price_docs = []
        for t in listings:
            try:
                stored = stored_prices(t)
                if fresh(stored, ttl):
                    doc = {k: v for k, v in stored.items() if k != "_id"}
                    report.setdefault("reused", []).append(t)
                else:
                    doc = await prices.daily_closes(http, t, cfg.reg_start, ttl)
                price_docs.append({"_id": t, **doc})
                report["prices"][t] = {"bars": len(doc["bars"]), "as_of": doc["as_of"], "source": doc["source"]}
            except Exception as e:  # noqa: BLE001 - unpriced ticker: listing kept, reactions say "no price history"
                report["prices"][t] = {"error": f"{type(e).__name__}: {e}"[:200]}
    finally:
        await http.aclose()
    now = datetime.now(timezone.utc)
    docs = [{"_id": f"{asset['_id']}:{t}", "asset": asset["_id"], "ticker": t, **v, "stale": False, "stale_since": None,
             "updated_at": now} for t, v in listings.items()]
    return docs, price_docs, report
