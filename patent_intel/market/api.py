"""Stock-impact endpoints, mounted by patent_intel/api.py (one include block, removable like presentations).

GET /v1/market/search?q=                     listed companies (live search, any exchange)
GET /v1/market/{ticker}/drugs                drugs in our data whose events belong to this listed company,
                                             with event counts per type
GET /v1/market/{ticker}/impact?drug_ids=a,b[&kinds=approval,pdufa][&start=YYYY-MM-DD][&end=YYYY-MM-DD]
                                             daily closes + those drugs' events for this company, each with its
                                             measured move (day 0 / +5 / +20, deepest dip, highest peak).
                                             kinds omitted = every type; kinds= (empty) = none. kind_counts are
                                             counted before the type/date filters, so a UI can offer every type.
GET /market                                  the chart page (static HTML, no data; it calls the API with X-API-Key)
"""

from __future__ import annotations

import contextlib
import logging
import re
from collections import Counter
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path as FsPath
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, status
from fastapi.responses import FileResponse

from ..config import settings
from ..matching import normalize
from ..net import Http
from ..store import Store
from . import prices
from .events import drug_events, merge
from .impact import measure
from .ingest import refresh_prices

log = logging.getLogger("patent_intel.market")
TICKER = r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,11}$"
DRUG_ID = re.compile(r"^(\d{9}|name:[a-z0-9-]{1,80})$")  # same ids as /v1/drugs/{drug_id}
KIND = re.compile(r"^[a-z][a-z_]{1,39}$")  # event types come from the data (pdufa, approval, patent_expiry, ...)
ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"
MAX_DRUGS = MAX_KINDS = 20
MAX_OUTBOUND = 4  # concurrent requests that reach a price/search source; more -> 429 (sources are paced anyway)
PAGE = FsPath(__file__).parent / "static" / "index.html"
NOTE = "Moves are measured after each event date; they show timing, not that the event caused the move."


def _fresh(doc: dict[str, Any] | None) -> bool:
    if not doc or not doc.get("fetched_at"):
        return False
    age = datetime.now(UTC) - datetime.fromisoformat(doc["fetched_at"])
    return age < timedelta(seconds=settings().market_price_ttl_s)


def _csv(v: str, rx: re.Pattern[str], limit: int, what: str) -> list[str]:
    items = [i for i in v.split(",") if i]
    if len(items) > limit or not all(rx.match(i) for i in items):  # counted before de-duplication: bounded input
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{what}: up to {limit} valid values")
    return list(dict.fromkeys(items))


def _day(v: str | None, what: str) -> str | None:
    if v is None:
        return None
    try:
        return date.fromisoformat(v).isoformat()  # rejects 2024-02-30
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{what}: not a calendar date") from None


class _Outbound:
    """Caps requests waiting on external sources: an authenticated client cannot queue unbounded work behind the
    per-host pacing. Single event loop -> a plain counter is race-free."""

    def __init__(self, limit: int) -> None:
        self.limit, self.used = limit, 0

    @contextlib.contextmanager
    def slot(self) -> Iterator[None]:
        if self.used >= self.limit:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "price source busy, retry shortly")
        self.used += 1
        try:
            yield
        finally:
            self.used -= 1


def routers(auth: Any, get_store: Callable[[], Store], get_http: Callable[[], Http]) -> list[APIRouter]:
    r = APIRouter(prefix="/v1/market", dependencies=[auth])
    ui = APIRouter()
    outbound = _Outbound(MAX_OUTBOUND)

    async def listings_for(ticker: str) -> list[dict[str, Any]]:
        rows, _ = await get_store().find("drug_listings", {"ticker": ticker, "stale": False}, 0, 500)
        return rows

    @ui.get("/market", include_in_schema=False)
    async def page() -> FileResponse:
        return FileResponse(PAGE, media_type="text/html; charset=utf-8")

    @r.get("/search")
    async def search(q: Annotated[str, Query(min_length=1, max_length=80, pattern=r"^[\w][\w .,'()&+-]*$")]) -> dict[str, Any]:
        with outbound.slot():
            try:
                hits = await prices.search(get_http(), q.strip(), settings().market_price_ttl_s)
            except Exception:
                log.exception("listing search failed")
                raise HTTPException(status.HTTP_502_BAD_GATEWAY, "listing search unavailable, retry later") from None
        return {"results": hits, "source": "Yahoo Finance search (unofficial: local testing only)"}

    @r.get("/{ticker}/drugs")
    async def drugs(ticker: Annotated[str, Path(pattern=TICKER)]) -> dict[str, Any]:
        t = ticker.upper()
        lst = await listings_for(t)
        docs = await get_store().get_many("drugs", [x["drug_id"] for x in lst])
        groups: dict[str, dict[str, Any]] = {}
        for x in lst:
            if not (d := docs.get(x["drug_id"])):
                continue
            g = groups.setdefault(normalize(d["name"]), {"name": d["name"], "drug_ids": [], "roles": set(), "events": []})
            if d.get("adis_id"):
                g["name"] = d["name"]  # the AdisInsight spelling wins over a typed name
            g["drug_ids"].append(d["_id"])
            g["roles"].update(x.get("roles") or [])
            g["events"] += await drug_events(get_store(), x, d)
        out = []
        for g in groups.values():
            ev = merge(g["events"])
            out.append({"name": g["name"], "drug_ids": g["drug_ids"], "roles": sorted(g["roles"]), "events": len(ev),
                        "events_by_kind": dict(Counter(e["kind"] for e in ev))})
        return {"ticker": t, "company": lst[0]["company"] if lst else None, "drugs": out}

    @r.get("/{ticker}/impact")
    async def impact(ticker: Annotated[str, Path(pattern=TICKER)],
                     drug_ids: Annotated[str, Query(max_length=2000)] = "",
                     kinds: Annotated[str | None, Query(max_length=1000)] = None,
                     start: Annotated[str | None, Query(pattern=ISO_DATE)] = None,
                     end: Annotated[str | None, Query(pattern=ISO_DATE)] = None) -> dict[str, Any]:
        t, store = ticker.upper(), get_store()
        ids = _csv(drug_ids, DRUG_ID, MAX_DRUGS, "drug_ids")
        want = None if kinds is None else set(_csv(kinds, KIND, MAX_KINDS, "kinds"))
        lo, hi = _day(start, "start"), _day(end, "end")
        if lo and hi and lo > hi:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "start must not be after end")

        lst = [x for x in await listings_for(t) if x["drug_id"] in ids]
        docs = await store.get_many("drugs", [x["drug_id"] for x in lst])
        every = merge([e for x in lst if (d := docs.get(x["drug_id"])) for e in await drug_events(store, x, d)])
        events = [e for e in every if (want is None or e["kind"] in want)
                  and (lo is None or e["date"] >= lo) and (hi is None or e["date"] <= hi)]

        px, price_error = await store.get("market_prices", t), None
        if not _fresh(px):
            with outbound.slot():
                try:
                    px = await refresh_prices(get_http(), store, t)
                except Exception as e:  # keep serving the last stored prices (if any), say why they are not fresh
                    log.warning("prices %s: %s", t, e)
                    price_error = "price source unavailable" + (" - showing the last stored prices" if px else "")
        bars = (px or {}).get("bars") or []
        return {"ticker": t, "company": lst[0]["company"] if lst else None,
                "prices": {k: px.get(k) for k in ("source", "currency", "exchange", "as_of", "fetched_at")} if px else None,
                "price_error": price_error, "bars": bars,
                "kind_counts": dict(Counter(e["kind"] for e in every)),
                "filters": {"kinds": sorted(want) if want is not None else None, "start": lo, "end": hi},
                "events": measure(bars, events), "note": NOTE}

    return [r, ui]
