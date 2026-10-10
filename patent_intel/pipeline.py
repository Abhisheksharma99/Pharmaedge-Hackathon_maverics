"""drug (AdisInsight id) -> companies + names -> PubChem patent links (relevance/seeds)
-> Google Patents /patent/ crawl (family + same-company citations) -> classify -> store + coverage."""

from __future__ import annotations

import hashlib
import logging
import json
import re
from collections import Counter
from datetime import datetime, UTC

from . import fdacal
from . import google_patents as gp
from .adis import fetch_drug
from .ctgov import other_product, other_products, resolve_by_name
from .crawler import classify, crawl
from .market.ingest import collect as market_collect
from .matching import normalize
from .net import Http, stats
from .pubchem import patent_ids
from .regulatory import collect
from .config import settings
from .store import Store

log = logging.getLogger("patent_intel")
MAX_TERMS = 40  # Adis lists alt names alphabetically; too low a cap silently drops brands (e.g. Tyvaso)
BIBLIO = ("publication_number", "country", "kind", "publication_description", "title", "abstract",
          "application_number", "filing_date", "priority_date", "publication_date", "assignee_original",
          "assignee_current", "inventors", "cpc", "priority_applications", "family_id", "family_members",
          "legal_status", "events", "legal_events")


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _clean(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r'["()\[\]{}:\\®™*?]', " ", t)).strip()


def search_terms(drug: dict) -> list[str]:
    """Drug name + usable alternative names (descriptions like 'X - Company' are skipped)."""
    out: dict[str, str] = {}
    for t in [drug["name"], *drug["alternative_names"]]:
        if " - " in t:
            continue
        if len(t := _clean(t)) >= 3:
            out.setdefault(t.lower(), t)
    return list(out.values())[:MAX_TERMS]


def drug_id_for(name: str) -> str:
    """Stable id for drugs given by name (no Adis profile): 'name:treprostinil'."""
    return "name:" + (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80] or "unknown")


async def resolve_drug(http: Http, adis_ref: str | None, drug_name: str | None, companies: list[str] | None) -> dict:
    """AdisInsight profile when an id/url is given; otherwise the drug name, with its company + other names from
    ClinicalTrials.gov (or openFDA) unless companies are given explicitly."""
    if adis_ref:
        adis = await fetch_drug(http, adis_ref)
        drug = {"_id": adis["adis_id"], **adis, "company_source": "AdisInsight", "input_companies": companies or [],
                "other_products": await other_products(http, adis["name"])}
    elif drug_name:
        found = await resolve_by_name(http, drug_name)
        if companies:  # explicit companies override the looked-up ones; names are still enriched
            found |= {"primary_companies": companies, "developers": companies, "company_source": "request"}
        drug = {"_id": drug_id_for(drug_name), "adis_id": None, "url": None, **found, "input_companies": companies or []}
    else:
        raise ValueError("give an AdisInsight id/url or a drug name")
    # a different substance that merely contains the name (e.g. 'TransCon treprostinil', 'treprostinil palmitil')
    # is never used as a name for this drug - even when a source lists it as an alternative name
    others = set(drug["other_products"]) | {o for a in drug["alternative_names"] if (o := other_product(a, drug["name"]))}
    drug["other_products"] = sorted(others)
    drug["alternative_names"] = [a for a in drug["alternative_names"] if not other_product(a, drug["name"])]
    return drug


async def run_drug(*, http: Http, store: Store, adis_ref: str | None = None,
                   drug_name: str | None = None, companies: list[str] | None = None, all_developers: bool = False,
                   terms: list[str] | None = None, seeds: list[str] | None = None,
                   max_pages: int = 600, probe_budget: int = 150, regulatory: bool = True,
                   fda_calendar: bool = True, market: bool = True) -> dict:
    started, before = _now(), stats.copy()
    drug = await resolve_drug(http, adis_ref, drug_name, companies)
    did = drug["_id"]
    companies = companies or (drug["developers"] if all_developers else (drug["primary_companies"] or drug["developers"][:1]))
    if not companies:
        raise RuntimeError(f"no developer/company on AdisInsight profile {drug['url']}")
    terms = [t for t in map(_clean, terms) if t] if terms else search_terms(drug)

    relevant: set[str] = set()
    pubchem_error = None
    try:
        relevant = await patent_ids(http, drug["name"])
    except RuntimeError as e:  # crawl still works from --seed / citations; record the gap
        pubchem_error = str(e)
    log.info("run %s | companies=%s | %d terms | PubChem-linked publications: %d", drug["name"], companies, len(terms), len(relevant))

    c = await crawl(http, companies, terms, relevant, seeds or [], max_pages=max_pages, probe_budget=probe_budget)
    b = classify(c, companies, terms, relevant)
    log.info("run %s | pages %d (probes %d) -> include %d, uncertain %d, reject %d", drug["name"], len(c.pages),
             c.probes_used, len(b["include"]), len(b["uncertain"]), len(b["reject"]))

    patents, links = [], []
    for p, _ in b["include"]:
        bib = {k: p[k] for k in BIBLIO}
        patents.append({
            "_id": f"GP:{p['publication_number']}", **bib,
            "applicants_normalized": [normalize(a) for a in p["assignee_original"]],
            "content_hash": hashlib.sha256(json.dumps(bib, sort_keys=True).encode()).hexdigest(),
            "provenance": [{"source": "Google Patents page", "url": gp.page_url(p["publication_number"]),
                            "processed_at": _now(), "parser_version": gp.PARSER_VERSION, "family_type": "DOCDB_SIMPLE"}],
        })
    run_id = f"{did}:{started}"
    for d in ("include", "uncertain"):  # every link has the same fields -> an update never leaves stale ones behind
        links += [{"_id": f"{did}:{p['publication_number']}", "drug_id": did,
                   "patent_id": f"GP:{p['publication_number']}" if d == "include" else None, "decision": d, "match": m,
                   "row": None if d == "include" else {k: p[k] for k in ("publication_number", "title", "assignee_original", "family_id")},
                   "last_run": run_id, "stale": False, "stale_since": None}
                  for p, m in b[d]]

    delta = {k: v - before.get(k, 0) for k, v in stats.items() if v != before.get(k, 0)}
    run = {
        "_id": run_id, "drug_id": did, "drug_name": drug["name"],
        "started_at": started, "finished_at": _now(), "companies": companies, "search_terms": terms,
        "coverage": {
            "sources_used": ["AdisInsight", "PubChem PUG-REST", "Google Patents /patent/ pages"],
            "pubchem_linked_publications": len(relevant), "pubchem_error": pubchem_error,
            "pages_fetched": len(c.pages), "probes_used": c.probes_used, "not_found": len(c.not_found),
            "duplicate_aliases_skipped": c.duplicates,
            "included": len(patents), "uncertain": len(b["uncertain"]), "rejected": len(b["reject"]),
            "families": len({p["family_id"] for p in patents if p["family_id"]}),
            "family_members_not_fetched": sorted(c.unfetched_family),
            "budget_exhausted": c.budget_exhausted,
            "offices": dict(Counter(p["country"] or "unknown" for p in patents)),
            "legal_status": dict(Counter(p["legal_status"] or "unknown" for p in patents)),  # MongoDB keys must be strings
            "note": "Discovery = PubChem compound links + crawl of same-company citations and DOCDB families on "
                    "Google Patents pages. Not a claim of every patent owned by the companies.",
        },
        "rejected_sample": [{"publication_number": p["publication_number"], "assignee": p["assignee_original"]}
                            for p, _ in b["reject"][:200]],
        "errors": c.errors,
        "telemetry": delta,
    }
    # Order matters: patents before the links that point to them; the run report last (it describes what was written).
    await store.upsert("patents", patents)  # one doc per publication across all drugs/runs (unique index)
    await store.upsert("drug_patents", links)
    # links this run no longer confirms are flagged, not deleted (a smaller-budget run must not erase earlier findings)
    run["coverage"]["links_marked_stale"] = await store.mark_stale("drug_patents", {"drug_id": did}, {lk["_id"] for lk in links})
    cfg = settings()
    start, end = cfg.reg_window()  # computed now: end moves forward with the current date
    run["window"] = {"start": start, "end": end}
    if regulatory:  # PDUFA dates / CRLs (SEC EDGAR) + submissions/approvals (openFDA), one de-duplicated timeline
        events, rep = await collect(http, drug_id=did, terms=terms, companies=companies, sec_user_agent=cfg.sec_user_agent,
                                    start=start, end=end, max_docs=cfg.reg_max_filings, exclude=drug["other_products"])
        await store.upsert("regulatory_events", events)
        # events no longer confirmed (e.g. extraction rules tightened) are flagged, not silently kept as current
        rep["events_marked_stale"] = await store.mark_stale("regulatory_events", {"drug_id": did}, {e["_id"] for e in events})
        run["regulatory"] = rep
        log.info("run %s | regulatory events %d (%s)", drug["name"], len(events), rep.get("by_type"))
    if fda_calendar:  # FDA Tracker PDUFA/AdCom calendar, filtered to this drug by name (calendar text, link, document)
        web = Http(http.cache, public_web=True)  # SSRF-guarded client for arbitrary source links
        try:
            cal, rep = await fdacal.collect(http, web, drug_id=did, terms=fdacal.drug_terms(drug["name"], drug["alternative_names"]),
                                            companies=list(dict.fromkeys(companies + drug["developers"])),
                                            sec_user_agent=cfg.sec_user_agent, start=start, end=end,
                                            exclude=drug["other_products"])
        finally:
            await web.aclose()
        await store.upsert("fda_calendar_events", cal)
        rep["events_marked_stale"] = await store.mark_stale("fda_calendar_events", {"drug_id": did}, {e["_id"] for e in cal})
        run["fda_calendar"] = rep
        log.info("run %s | FDA calendar: %d matched, %d unresolved", drug["name"], rep["matched"], rep["unresolved"])
    if market:  # listed companies owning this drug's events + their daily prices (stock-impact charts)
        try:
            run["market"] = await market_collect(http, store, drug=drug, companies=companies)
        except Exception as e:  # optional step: never fails a run whose patents/events are already stored
            log.exception("run %s | market step failed", drug["name"])
            run["market"] = {"error": f"{type(e).__name__}: {e}"[:300]}
    await store.upsert("drugs", [{**drug, "updated_at": _now()}])
    await store.upsert("crawl_runs", [run])
    return run
