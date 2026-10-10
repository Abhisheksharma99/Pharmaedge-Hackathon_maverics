"""Listing search and daily closing prices, through the allow-listed, paced, cached `Http` client.

Provider: Yahoo Finance's keyless chart/search endpoints - unofficial and not licensed for production: local testing
only. The label travels with the data (`source`).
"""

from __future__ import annotations

import json
import re
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode

from ..net import Http

SEARCH = "https://query2.finance.yahoo.com/v1/finance/search"
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{t}"
SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")  # UTHR, 4568.T, BRK-B
YAHOO_SOURCE = "Yahoo Finance daily close, split/dividend-adjusted (unofficial: local testing only)"


class PriceError(RuntimeError):
    pass


async def search(http: Http, query: str, ttl_s: float) -> list[dict[str, Any]]:
    """Listed equities matching a company name or ticker, any exchange, best match first."""
    url = SEARCH + "?" + urlencode({"q": query, "quotesCount": 10, "newsCount": 0, "listsCount": 0})
    status, text = await http.get_html(url, ttl_s, ctype="json")
    if status != 200:
        raise PriceError(f"listing search: HTTP {status}")
    out = []
    for q in json.loads(text).get("quotes", []):
        sym = str(q.get("symbol") or "").upper()
        if q.get("quoteType") == "EQUITY" and SYMBOL.match(sym):
            out.append({"ticker": sym, "name": q.get("longname") or q.get("shortname") or sym,
                        "exchange": q.get("exchDisp") or q.get("exchange")})
    return out


async def daily_closes(http: Http, ticker: str, start: str, ttl_s: float) -> dict[str, Any]:
    """{ticker, source, currency, exchange, as_of, fetched_at, bars: [{date, close}]} from `start` to today, oldest first.
    Closes are split/dividend-adjusted so % moves across a split stay true. The latest bar may be today's, still moving."""
    if not SYMBOL.match(ticker):
        raise PriceError(f"invalid ticker {ticker!r}")
    p1 = int(datetime.fromisoformat(start).replace(tzinfo=UTC).timestamp())
    p2 = int(datetime.combine(date.today() + timedelta(days=1), datetime.min.time(), UTC).timestamp())  # stable per day -> cacheable
    url = YAHOO_CHART.format(t=quote(ticker)) + "?" + urlencode({"period1": p1, "period2": p2, "interval": "1d",
                                                                 "events": "split,div"})
    status, text = await http.get_html(url, ttl_s, ctype="json")
    if status != 200:
        raise PriceError(f"{ticker}: Yahoo HTTP {status}")
    res = (json.loads(text).get("chart") or {}).get("result") or []
    if not res or not res[0].get("timestamp"):
        raise PriceError(f"{ticker}: no price history")
    r = res[0]
    ind = r.get("indicators") or {}
    closes = ((ind.get("adjclose") or [{}])[0].get("adjclose") or (ind.get("quote") or [{}])[0].get("close") or [])
    bars = [{"date": datetime.fromtimestamp(t, UTC).date().isoformat(), "close": round(c, 4)}
            for t, c in zip(r["timestamp"], closes, strict=False) if c is not None]  # holidays/halts are null
    m = r.get("meta") or {}
    meta = {"source": YAHOO_SOURCE, "currency": m.get("currency"), "exchange": m.get("exchangeName")}
    bars = sorted({b["date"]: b for b in bars}.values(), key=lambda b: b["date"])  # one bar per day, ascending
    if not bars:
        raise PriceError(f"{ticker}: no price history")
    return {"ticker": ticker, **meta, "as_of": bars[-1]["date"], "bars": bars,
            "fetched_at": datetime.now(UTC).isoformat(timespec="seconds")}
