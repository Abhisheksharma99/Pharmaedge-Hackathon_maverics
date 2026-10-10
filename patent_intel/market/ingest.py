"""run_drug step: which listed companies own this drug's events, and their daily prices.

drug_listings  one doc per (drug, ticker): the drug's own companies (resolved by name, verified with the same
               company matcher as regulatory events) + every ticker that appears on the drug's matched FDA calendar
               events (e.g. a competitor's PDUFA date for the same molecule). Listings a run no longer finds are
               flagged stale, never deleted.
market_prices  one doc per ticker: adjusted daily closes from REG_START (the event window start) to today.
A company or ticker that cannot be resolved/priced is reported, never fatal: the rest of the run is unaffected.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from ..config import settings
from ..net import Http
from ..regulatory import is_company
from ..store import Store
from . import prices

log = logging.getLogger("patent_intel.market")
MAX_CAL_EVENTS = 1000


# Subsidiaries FDA/EMA name as the sponsor, which are not listed themselves: their listed parent, stated explicitly
# (a search for the parent's name can rank a secondary share line first, e.g. Roche's bearer share ROP.SW;
# Roche's US ADR is used: USD prices, and Yahoo serves it).
PARENT_LISTINGS: list[tuple[re.Pattern[str], dict[str, str]]] = [
    (re.compile(r"\bmerck sharp|\bmsd\b", re.I), {"ticker": "MRK", "name": "Merck & Co., Inc.", "exchange": "NYSE"}),
    (re.compile(r"\bactelion\b|\bjanssen\b", re.I), {"ticker": "JNJ", "name": "Johnson & Johnson", "exchange": "NYSE"}),
    (re.compile(r"\bhoffmann-la roche\b|\bgenentech\b", re.I), {"ticker": "RHHBY", "name": "Roche Holding AG (ADR)", "exchange": "OTC"}),
]


def parent_listing(company: str) -> dict[str, Any] | None:
    for rx, listing in PARENT_LISTINGS:
        if rx.search(company):
            return {**listing, "via_parent": True}
    return None


async def resolve_listing(http: Http, company: str, ttl_s: float) -> dict[str, Any] | None:
    """First search hit whose listed name IS this company (normalized exact match / truncated name) - never a
    lookalike ('United Health' for 'United Therapeutics'); else a known subsidiary's listed parent."""
    for hit in await prices.search(http, company, ttl_s):
        if is_company([company], hit["name"]) or is_company([hit["name"]], company):
            return hit
    return parent_listing(company)


async def refresh_prices(http: Http, store: Store, ticker: str) -> dict[str, Any]:
    cfg = settings()
    doc = await prices.daily_closes(http, ticker, cfg.reg_start, cfg.market_price_ttl_s)
    await store.upsert("market_prices", [{"_id": ticker, **doc}])
    return doc


async def collect(http: Http, store: Store, *, drug: dict[str, Any], companies: list[str]) -> dict[str, Any]:
    did, ttl = drug["_id"], settings().market_price_ttl_s
    listings: dict[str, dict[str, Any]] = {}
    report: dict[str, Any] = {"unlisted_companies": [], "errors": []}

    for company in dict.fromkeys(companies):
        try:
            hit = await resolve_listing(http, company, ttl)
        except Exception as e:  # search down: this company stays unlisted this run, nothing else is affected
            report["errors"].append(f"search {company!r}: {type(e).__name__}: {e}"[:300])
            continue
        if hit:
            listings[hit["ticker"]] = {"company": company, "listed_name": hit["name"], "exchange": hit["exchange"],
                                       "roles": ["drug_company"], "via_parent": bool(hit.get("via_parent"))}
        else:
            report["unlisted_companies"].append(company)  # private, or listed under another name

    cal, _ = await store.find("fda_calendar_events", {"drug_id": did, "status": "matched", "stale": False}, 0, MAX_CAL_EVENTS)
    for e in cal:
        t = (e.get("ticker") or "").upper()
        if not prices.SYMBOL.match(t):
            continue
        lst = listings.setdefault(t, {"company": e.get("company") or t, "listed_name": None, "exchange": None, "roles": []})
        if "fda_calendar_event" not in lst["roles"]:
            lst["roles"].append("fda_calendar_event")

    report["prices"] = {}
    for t in listings:
        try:
            doc = await refresh_prices(http, store, t)
            report["prices"][t] = {"bars": len(doc["bars"]), "as_of": doc["as_of"], "source": doc["source"]}
        except Exception as e:  # unpriced ticker: listing kept, impact shows "no price history"
            report["prices"][t] = {"error": f"{type(e).__name__}: {e}"[:200]}

    docs = [{"_id": f"{did}:{t}", "drug_id": did, "ticker": t, **v, "stale": False, "stale_since": None}
            for t, v in listings.items()]
    await store.upsert("drug_listings", docs)
    report["listings_marked_stale"] = await store.mark_stale("drug_listings", {"drug_id": did}, {d["_id"] for d in docs})
    report["listings"] = {t: v["roles"] for t, v in listings.items()}
    log.info("market %s | listings %s | unlisted %s", drug["name"], report["listings"], report["unlisted_companies"])
    return report
