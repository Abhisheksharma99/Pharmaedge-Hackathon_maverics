"""Regulatory timeline per drug from official, automation-permitted sources.

- SEC EDGAR full-text search (efts.sec.gov) + filing archive (www.sec.gov/Archives/edgar/data, robots-allowed):
  company filings that mention the drug together with PDUFA / target action date / complete response.
  The dated sentences are extracted verbatim (with the filing as the source), e.g.
  "The FDA has set a Prescription Drug User Fee Act (PDUFA) goal date of May 24, 2025."
- openFDA drugsfda (api.fda.gov): every application submission and approval for the drug.

Events are de-duplicated: the same (type, date, sponsor) reported by many filings becomes ONE event with all
its sources. SEC requires a declared User-Agent with contact details (SEC_USER_AGENT)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from datetime import date
from typing import Any
from urllib.parse import urlencode

from selectolax.parser import HTMLParser

from .matching import best_match, normalize
from .net import Http

EFTS = "https://efts.sec.gov/LATEST/search-index"
ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik}/{adsh}/{file}"
OPENFDA = "https://api.fda.gov/drug/drugsfda.json"
FORMS = "8-K,6-K,10-K,10-Q,20-F,40-F"  # where companies report PDUFA dates / FDA actions
KEYWORDS = ('"PDUFA"', '"target action date"', '"complete response letter"')
PAGE = 100  # EDGAR FTS page size
TTL_SEARCH, TTL_DOC = 86400, 30 * 86400  # searches change daily; a filed document never changes
ADSH, CIK, FILE = re.compile(r"\d{10}-\d{2}-\d{6}"), re.compile(r"\d{1,10}"), re.compile(r"[A-Za-z0-9][\w.-]{0,120}")

MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
DATE_RX = re.compile(rf"\b({MONTHS})\.?\s+(\d{{1,2}}),\s*(\d{{4}})\b|\b(\d{{4}})-(\d{{2}})-(\d{{2}})\b", re.I)
EVENT_RX = [  # first match wins
    # a CRL actually received/issued - not "asking the FDA to issue a complete response letter" (citizen petitions)
    ("complete_response_letter", re.compile(r"\b(?:received|receipt of|issued)\b[^.]{0,60}?complete response letter", re.I)),
    ("pdufa_date", re.compile(r"PDUFA|target action date|action date|goal date", re.I)),
]
NOT_AN_EVENT = re.compile(r"\b(?:ask\w*|request\w*|petition\w*|urg\w*|if|could|may|might)\b", re.I)
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(“\"])")


# ---------------------------------------------------------------- pure helpers (unit-tested)

def _iso(m: re.Match[str]) -> str | None:
    try:
        if m.group(1):
            mon = [x.lower() for x in MONTHS.split("|")].index(m.group(1).lower()) + 1
            return date(int(m.group(3)), mon, int(m.group(2))).isoformat()
        return date(int(m.group(4)), int(m.group(5)), int(m.group(6))).isoformat()
    except ValueError:  # e.g. "February 30, 2025" in OCR'd text
        return None


def doc_text(raw: str) -> str:
    """Filing (HTML or plain text) -> normalized text. Untrusted input: only text is kept, never markup."""
    body = HTMLParser(raw).body if "<" in raw[:2000] else None
    text = body.text(separator=" ") if body else raw
    return re.sub(r"\s+", " ", text.replace("\xa0", " ").replace("\u2011", "-")).strip()  # nbsp / non-breaking hyphen


def exclusion_regex(phrases: list[str]) -> re.Pattern[str] | None:
    """'treprostinil palmitil' -> regex tolerant of spacing/hyphens; None when there is nothing to exclude."""
    alts = [r"[\s-]+".join(map(re.escape, p.split())) for p in phrases if p.strip()]
    return re.compile(r"(?<![A-Za-z0-9])(?:" + "|".join(alts) + r")(?![A-Za-z0-9])", re.I) if alts else None


def extract_events(text: str, terms: list[str], window: int = 1, exclude: list[str] | None = None) -> list[dict[str, Any]]:
    """Sentences that state an FDA action date, attributed to the drug only if a drug term occurs in that sentence
    or the one right before it. Filings name the product, then state the date:
      "Welireg, in combination with ... Lenvima ... is under review by the FDA ..." -> "The FDA set a PDUFA date of
      October 4, 2026."  (Merck 10-K). A wider window would wrongly attach dates of neighbouring products."""
    term_rx = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(t) for t in terms if t.strip()) + r")(?!\w)", re.I)
    excl_rx = exclusion_regex(exclude or [])
    sents = SENT_SPLIT.split(text)
    out = []
    for i, s in enumerate(sents):
        if len(s) > 1500 or not term_rx.search(" ".join(sents[max(0, i - window): i + 1])):
            continue
        kind = next((k for k, rx in EVENT_RX if rx.search(s)), None)
        if kind == "complete_response_letter" and NOT_AN_EVENT.search(s):
            kind = None  # hypothetical ("may receive a CRL") or a request about someone else's application
        dates = [d for m in DATE_RX.finditer(s) if (d := _iso(m))]
        if kind and dates:
            context = " ".join(sents[max(0, i - window): i + 1])
            if excl_rx and excl_rx.search(context):
                continue  # the sentence is about a different substance (e.g. treprostinil palmitil)
            out.append({"type": kind, "dates": sorted(set(dates)), "sentence": s[:600],
                        "context": context[-1200:],  # evidence shows the drug name next to the date
                        "drug_terms": sorted({m.group(0).lower() for m in term_rx.finditer(context)})})
    return out


def _extract_doc(raw: str, terms: list[str], exclude: list[str] | None) -> list[dict[str, Any]]:
    return extract_events(doc_text(raw), terms, exclude=exclude)  # CPU-bound; called via asyncio.to_thread


def event_id(drug_id: str, kind: str, day: str, sponsor: str) -> str:
    return hashlib.sha1(f"{drug_id}|{kind}|{day}|{sponsor}".encode()).hexdigest()


def _clean_term(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w .-]", " ", t)).strip()  # no quotes/operators reach either search syntax


def rank_terms(terms: list[str], limit: int = 10) -> list[str]:
    """Drug name first, then brand-like names (one word, no digits: what filings use), then codes/long names."""
    clean = [t for t in dict.fromkeys(map(_clean_term, terms)) if len(t) >= 3]
    head, rest = clean[:1], clean[1:]
    rest.sort(key=lambda t: (bool(re.search(r"\d", t)), " " in t, len(t)))
    return (head + rest)[:limit]


# ---------------------------------------------------------------- SEC EDGAR

async def _efts(http: Http, ua: dict[str, str], q: str, start: str, end: str, offset: int) -> dict[str, Any]:
    url = EFTS + "?" + urlencode({"q": q, "dateRange": "custom", "startdt": start, "enddt": end,
                                  "forms": FORMS, "from": offset})
    status, text = await http.get_html(url, TTL_SEARCH, ctype="json", headers=ua)
    if status != 200:
        raise RuntimeError(f"EDGAR search -> HTTP {status}")
    return json.loads(text)


async def edgar_events(http: Http, sec_user_agent: str, terms: list[str], start: str, end: str,
                       max_docs: int = 300, companies: list[str] | None = None,
                       exclude: list[str] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    ua = {"User-Agent": sec_user_agent}
    hits: dict[str, dict[str, Any]] = {}
    failed: list[str] = []
    for term in terms:
        for kw in KEYWORDS:
            offset, total = 0, 1
            while offset < total and offset < 1000:  # hard pagination cap per query
                try:
                    data = await _efts(http, ua, f'"{term}" {kw}', start, end, offset)
                except (RuntimeError, ValueError) as e:  # one failing query/page must not lose all the others
                    failed.append(f'"{term}" {kw} @{offset}: {e}')
                    break
                total = data["hits"]["total"]["value"]
                page = data["hits"]["hits"]
                for h in page:
                    hits.setdefault(h["_id"], h)
                if not page:
                    break
                offset += PAGE
    filers = [re.sub(r"\s*\(.*$", "", (h["_source"].get("display_names") or [""])[0]) for h in hits.values()]
    others = company_tokens(filers, companies or [])
    other_rx = re.compile(r"\b(?:" + "|".join(sorted(others)) + r")\b", re.I) if others else None
    # newest first; the budget bounds work and bytes for very common drugs
    docs = sorted(hits.values(), key=lambda h: h["_source"].get("file_date", ""), reverse=True)[:max_docs]

    async def one(h: dict[str, Any]) -> list[dict[str, Any]]:
        adsh, _, fname = h["_id"].partition(":")
        src = h["_source"]
        cik = (src.get("ciks") or [""])[0].lstrip("0")
        if not (ADSH.fullmatch(adsh) and CIK.fullmatch(cik) and FILE.fullmatch(fname)):
            return []  # never build a URL from unexpected values
        url = ARCHIVE.format(cik=cik, adsh=adsh.replace("-", ""), file=fname)
        status, raw = await http.get_html(url, TTL_DOC, ctype=("html", "text/plain", "xml"), headers=ua)
        if status != 200:
            return []
        found = await asyncio.to_thread(_extract_doc, raw, terms, exclude)
        company = re.sub(r"\s*\((?:CIK \d+|[A-Z0-9.\-, ]{1,20})\)", "", (src.get("display_names") or [""])[0]).strip()
        # "Liquidia announced ... PDUFA ..." inside United Therapeutics' 10-K is Liquidia's event, not UT's
        return [{**e, "about_other_company": bool(other_rx and other_rx.search(e["context"])),
                 "source": {"type": "SEC EDGAR", "url": url, "form": src.get("form"), "filed": src.get("file_date"),
                            "company": company, "cik": cik}} for e in found]

    nested = await asyncio.gather(*(one(h) for h in docs))  # Http enforces per-host pacing; gather just overlaps parsing
    return [e for group in nested for e in group], {"filings_matched": len(hits), "filings_read": len(docs),
                                                    "failed_queries": failed}


# ---------------------------------------------------------------- openFDA

async def openfda_events(http: Http, terms: list[str]) -> list[dict[str, Any]]:
    clauses = " ".join(f'openfda.{f}:"{t}"' for t in terms[:10] for f in ("generic_name", "brand_name"))
    url = OPENFDA + "?" + urlencode({"search": clauses, "limit": 100})
    status, text = await http.get_html(url, TTL_SEARCH, ctype="json")
    if status == 404:  # openFDA answers 404 for "no matches"
        return []
    if status != 200:
        raise RuntimeError(f"openFDA -> HTTP {status}")
    out = []
    for app in json.loads(text).get("results", []):
        brands = (app.get("openfda") or {}).get("brand_name") or [p.get("brand_name") for p in app.get("products", [])]
        for sub in app.get("submissions", []):
            d = sub.get("submission_status_date") or ""
            if not re.fullmatch(r"\d{8}", d):
                continue
            status_code = sub.get("submission_status")
            cls = (sub.get("submission_class_code_description") or "").lower()
            category = ("original" if sub.get("submission_type") == "ORIG" else "efficacy" if "efficacy" in cls
                        else "labeling" if "labeling" in cls else "manufacturing" if "manufacturing" in cls else "other")
            out.append({
                "category": category,  # original/efficacy = major regulatory milestones; labeling/manufacturing = minor
                "type": {"AP": "approval", "TA": "tentative_approval"}.get(status_code, f"submission_{status_code}".lower()),
                "dates": [f"{d[:4]}-{d[4:6]}-{d[6:]}"],
                "sentence": f"{app.get('application_number')} {sub.get('submission_type')} {sub.get('submission_number')}"
                            f" ({sub.get('submission_class_code_description') or 'n/a'}, {sub.get('review_priority') or 'n/a'})"
                            f" - status {status_code}",
                "source": {"type": "openFDA drugsfda", "url": url, "company": app.get("sponsor_name"),
                           "application_number": app.get("application_number"), "brands": sorted(set(filter(None, brands)))},
            })
    return out


# ---------------------------------------------------------------- merge -> one timeline

def company_tokens(names: list[str], exclude: list[str]) -> set[str]:
    """Distinctive first words of other filers' names ('LIQUIDIA', 'INSMED'), excluding our own companies' words."""
    ours = {w for c in exclude for w in normalize(c).split()}
    out = set()
    for n in names:
        words = normalize(n).split()
        if words and len(words[0]) >= 5 and words[0] not in ours and words[0] not in GENERIC_WORDS:
            out.add(words[0])
    return out


GENERIC_WORDS = {"UNITED", "GLOBAL", "INTERNATIONAL", "AMERICAN", "GENERAL", "NATIONAL", "PHARMA", "PHARMACEUTICALS",
                 "THERAPEUTICS", "BIOSCIENCES", "HOLDINGS", "MEDICAL", "HEALTH", "LABORATORIES", "SCIENCES", "BIOTECH"}


def is_company(companies: list[str], sponsor: str) -> bool:
    """Exact normalized match, or a source-truncated sponsor name (openFDA cuts names: 'UNITED THERAP')."""
    if best_match(companies, [sponsor])["decision"] == "include":
        return True
    s = normalize(sponsor)
    return len(s) >= 8 and any(normalize(c).startswith(s) for c in companies)


def build_timeline(drug_id: str, raw: list[dict[str, Any]], companies: list[str], start: str,
                   end: str) -> tuple[list[dict[str, Any]], int]:
    """Only the given drug's company: other sponsors of the same molecule (generics, competitors' formulations)
    are excluded and counted. One event per (type, date, sponsor); repeated reports merge, keeping every source."""
    events: dict[str, dict[str, Any]] = {}
    excluded = 0
    for r in raw:
        sponsor = r["source"].get("company") or "unknown"
        if not is_company(companies, sponsor) or r.get("about_other_company"):
            excluded += 1
            continue
        filed = r["source"].get("filed")
        # a PDUFA sentence often also contains the announcement date; the target date is the latest one
        day = max(r["dates"]) if r["type"] == "pdufa_date" else min(r["dates"])
        if not (start <= day <= end):
            continue
        eid = event_id(drug_id, r["type"], day, sponsor)
        ev = events.setdefault(eid, {
            "_id": eid, "drug_id": drug_id, "type": r["type"], "date": day, "sponsor": sponsor,
            "category": r.get("category", "major" if r["type"] in ("pdufa_date", "complete_response_letter") else "other"),
            "status": "upcoming" if day >= date.today().isoformat() else "past",
            "first_reported": filed, "last_reported": filed, "sources": [], "stale": False, "stale_since": None,
        })
        if filed:
            ev["first_reported"] = min(filter(None, [ev["first_reported"], filed]))
            ev["last_reported"] = max(filter(None, [ev["last_reported"], filed]))
        if not any(s["source"]["url"] == r["source"]["url"] and s["sentence"] == r["sentence"] for s in ev["sources"]):
            ev["sources"].append({"sentence": r["sentence"], "context": r.get("context", r["sentence"]),
                                  "drug_terms": r.get("drug_terms", []), "source": r["source"]})
    for ev in events.values():
        ev["sources"] = ev["sources"][:25]  # bounded document size (MongoDB 16 MB limit, API payloads)
        ev["evidence_count"] = len(ev["sources"])
    return sorted(events.values(), key=lambda e: (e["date"], e["type"])), excluded


async def collect(http: Http, *, drug_id: str, terms: list[str], companies: list[str], sec_user_agent: str | None,
                  start: str, end: str, max_docs: int = 300,
                  exclude: list[str] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    terms = rank_terms(terms)
    report: dict[str, Any] = {"sources_used": [], "errors": []}
    raw: list[dict[str, Any]] = []
    if sec_user_agent:
        try:
            # filings announce dates months ahead -> search filings from 2 years before the event window
            filed_from = f"{int(start[:4]) - 2}{start[4:]}"
            ev, st = await edgar_events(http, sec_user_agent, terms, filed_from, min(end, date.today().isoformat()),
                                        max_docs, companies, exclude)
            raw += ev
            report |= st
            report["sources_used"].append("SEC EDGAR")
        except (RuntimeError, ValueError, KeyError) as e:
            report["errors"].append(f"SEC EDGAR: {e}")
    else:
        report["errors"].append("SEC EDGAR skipped: SEC_USER_AGENT not configured")
    try:
        raw += await openfda_events(http, terms)
        report["sources_used"].append("openFDA")
    except (RuntimeError, ValueError, KeyError) as e:
        report["errors"].append(f"openFDA: {e}")
    timeline, excluded = build_timeline(drug_id, raw, companies, start, end)
    report |= {"events": len(timeline), "raw_mentions": len(raw), "other_sponsor_mentions_excluded": excluded,
               "by_type": {k: sum(e["type"] == k for e in timeline) for k in {e["type"] for e in timeline}}}
    return timeline, report
