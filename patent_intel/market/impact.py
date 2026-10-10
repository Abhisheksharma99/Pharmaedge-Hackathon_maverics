"""How the price moved after each event. Pure functions: no I/O, no network.

Day 0 = the first trading day on/after the event date (a weekend PDUFA date counts from Monday). Every move is the
% change of a close against the last close BEFORE day 0, so day 0 includes the event-day reaction.
"""

from __future__ import annotations

from bisect import bisect_left
from datetime import date
from typing import Any

HORIZON = 20  # trading days measured after day 0


def _pct(a: float, b: float) -> float:
    return round((a / b - 1) * 100, 2)


def measure(bars: list[dict[str, Any]], events: list[dict[str, Any]], today: str | None = None) -> list[dict[str, Any]]:
    """Each event + {"impact": {...}} or {"impact": None, "note": why it cannot be measured}. `bars` ascending by date."""
    dates = [b["date"] for b in bars]
    today = today or date.today().isoformat()
    out = []
    for e in events:
        i = bisect_left(dates, e["date"])
        if not bars:
            out.append({**e, "impact": None, "note": "no price history"})
        elif i == 0:
            out.append({**e, "impact": None, "note": "before price history"})
        elif i == len(bars):
            out.append({**e, "impact": None, "note": "upcoming" if e["date"] > today else "no trading day after it yet"})
        else:
            base = bars[i - 1]["close"]
            win = bars[i: i + HORIZON + 1]
            moves = [_pct(b["close"], base) for b in win]
            lo = min(range(len(moves)), key=moves.__getitem__)
            hi = max(range(len(moves)), key=moves.__getitem__)
            out.append({**e, "note": None, "impact": {
                "trading_day": dates[i], "base_close": base, "days_measured": len(moves) - 1,
                "day0": moves[0], "day5": moves[5] if len(moves) > 5 else None, "day20": moves[20] if len(moves) > 20 else None,
                "dip": moves[lo] if moves[lo] < 0 else None, "dip_day": lo if moves[lo] < 0 else None, "dip_close": win[lo]["close"],
                "peak": moves[hi] if moves[hi] > 0 else None, "peak_day": hi if moves[hi] > 0 else None, "peak_close": win[hi]["close"],
            }})
    return out
