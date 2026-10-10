"""The stored events of one drug that belong to one listed company - read side, no network.

A drug's events are attributed to a listing exactly as ingestion attributed them to the drug's companies:
  FDA calendar   the event's own ticker
  regulatory     the event's sponsor IS the listing's company (same matcher as the regulatory timeline)
  presentations  the company's decks with statements about this drug: its name or any alternative name/brand/code
                 (Tyvaso, Remodulin, UT-15C ...), excluding other substances that merely contain the name
                 ('treprostinil palmitil') - the same name rules as the FDA calendar matcher.
  patents        the drug's INCLUDED patents (drug_patents, not stale) assigned to the listing's company: US grant
                 dates and US expiry dates (adjusted, else anticipated) of granted patents - one event per date
                 listing every patent. US only: the stock is US-listed and other offices repeat the same families.
                 Litigation entries carry no dates on Google Patents, so they cannot be placed and are not used.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from ..fdacal import drug_terms, term_regex
from ..regulatory import exclusion_regex, is_company
from ..store import Store

LIMIT = 5000  # >= the largest crawl budget (MAX_PAGES le=5000): a drug's links are never truncated
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PATENT_KINDS = ("patent_granted", "patent_expiry")


async def _find(store: Store, collection: str, where: dict[str, Any], sort: str = "date") -> list[dict[str, Any]]:
    rows, _ = await store.find(collection, where, 0, LIMIT, sort=sort)
    return rows


async def drug_events(store: Store, listing: dict[str, Any], drug: dict[str, Any]) -> list[dict[str, Any]]:
    did, ticker = drug["_id"], listing["ticker"]
    owners = [c for c in (listing.get("company"), listing.get("listed_name")) if c]
    out = []
    for e in await _find(store, "fda_calendar_events", {"drug_id": did, "status": "matched", "stale": False}):
        if (e.get("ticker") or "").upper() == ticker:
            out.append({"date": e["date"], "kind": e["event_type"], "label": e["title"], "source": "FDA Tracker calendar",
                        "detail": None, "url": None, "ref": {"collection": "fda_calendar_events", "id": e["_id"]}})
    for e in await _find(store, "regulatory_events", {"drug_id": did, "stale": False}):
        if is_company(owners, e.get("sponsor") or ""):
            src = (e.get("sources") or [{}])[0]
            brands = ", ".join((src.get("source") or {}).get("brands") or [])
            out.append({"date": e["date"], "kind": e["type"], "label": f"{e['type'].replace('_', ' ')} {brands}".strip(),
                        "source": (src.get("source") or {}).get("type") or "regulatory", "detail": src.get("sentence"),
                        "url": None, "ref": {"collection": "regulatory_events", "id": e["_id"]}})
    out += await _deck_events(store, ticker, owners, drug)
    out += await _patent_events(store, owners, drug)
    return out


async def _patent_events(store: Store, owners: list[str], drug: dict[str, Any]) -> list[dict[str, Any]]:
    links = await _find(store, "drug_patents", {"drug_id": drug["_id"], "decision": "include", "stale": False}, sort="_id")
    pats = await store.get_many("patents", [lk["patent_id"] for lk in links if lk.get("patent_id")])
    out = []
    for p in pats.values():
        # granted documents only (B1/B2, reissue E): an A1 application page also shows its family grant
        if p.get("country") != "US" or not str(p.get("kind") or "").startswith(("B", "E")) or not any(is_company(owners, a) for a in
                                               (p.get("assignee_current") or []) + (p.get("assignee_original") or [])):
            continue
        ev = [e for e in p.get("events") or [] if ISO.match(str(e.get("date") or ""))]
        granted = next((e["date"] for e in ev if e.get("type") == "granted"), None)
        if not granted:
            continue  # applications: an "anticipated expiration" of a pending application is not an event
        exp = {e.get("title"): e["date"] for e in ev if e.get("type") == "legal-status"}
        expiry = exp.get("Adjusted expiration") or exp.get("Anticipated expiration")
        ref = {"collection": "patents", "id": p["_id"]}
        num, title = p.get("publication_number") or p["_id"], (p.get("title") or "")[:120]
        out.append({"date": granted, "kind": "patent_granted", "label": num, "source": "Google Patents",
                    "detail": title, "url": None, "ref": ref})
        if expiry:
            out.append({"date": expiry, "kind": "patent_expiry", "label": num, "source": "Google Patents",
                        "detail": title, "url": None, "ref": ref})
    return out


async def _deck_events(store: Store, ticker: str, owners: list[str], drug: dict[str, Any]) -> list[dict[str, Any]]:
    try:  # optional subsystem: not installed -> no decks to read
        from ..presentations.pipeline import company_key
    except ImportError:
        return []
    terms = drug_terms(drug["name"], drug.get("alternative_names") or [])
    if not terms:
        return []
    rx, excl = term_regex(terms), exclusion_regex(drug.get("other_products") or [])
    decks: dict[str, dict[str, Any]] = {}
    for key in {ticker.lower(), *(company_key(o, ticker) for o in owners)}:  # company_id: name key (or ticker, older runs)
        decks |= {d["_id"]: d for d in await _find(store, "presentations", {"company_id": key}) if d.get("date")}
    out = []
    for d in decks.values():
        claims = await _find(store, "presentation_claims", {"presentation_id": d["_id"], "stale": False}, sort="_id")
        about = [c for c in claims
                 if (text := c.get("drug") or c.get("statement") or "") and rx.search(text) and not (excl and excl.search(text))]
        if about:
            out.append({"date": d["date"], "kind": "presentation", "label": d.get("title") or "investor presentation",
                        "source": "investor presentation", "detail": f"{len(about)} statements about this drug",
                        "statements": len(about), "url": d.get("source_url"),
                        "ref": {"collection": "presentations", "id": d["_id"]}})
    return out


def merge(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One drug stored under two ids (Adis id + name) yields the same event twice: keep one. A deck is one event
    whatever name list found it - the record with more names (more statements) wins. Patents granted or expiring on
    the same day become ONE event naming every patent (a family often shares the date). Sorted by date."""
    seen: dict[tuple[str, ...], dict[str, Any]] = {}
    for e in events:
        if e["kind"] == "presentation":
            k = ("presentation", e["ref"]["id"])
            if k not in seen or e["statements"] > seen[k]["statements"]:
                seen[k] = e
            continue
        seen.setdefault((e["date"], e["kind"], e["label"], e["detail"] or ""), e)
    out: list[dict[str, Any]] = []
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    today = date.today().isoformat()
    for e in seen.values():
        if e["kind"] in PATENT_KINDS:
            grouped.setdefault((e["date"], e["kind"]), []).append(e)
        else:
            out.append(e)
    for (day, kind), es in grouped.items():
        es.sort(key=lambda e: e["label"])
        verb = "granted" if kind == "patent_granted" else "expire" if day >= today else "expired"
        out.append({"date": day, "kind": kind, "source": "Google Patents", "url": None,
                    "label": f"{len(es)} US patent{'s' if len(es) > 1 else ''} {verb}",
                    "detail": "; ".join(f"{e['label']} {e['detail']}".strip() for e in es)[:1500],
                    "ref": {"collection": "patents", "ids": [e["ref"]["id"] for e in es]}})
    return sorted(out, key=lambda e: (e["date"], e["kind"], e["label"]))
