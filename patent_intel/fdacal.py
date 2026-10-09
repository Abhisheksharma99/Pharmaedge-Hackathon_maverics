"""FDA Tracker calendar (https://www.fdatracker.com/fda-calendar/) -> events for OUR drug only.

The page embeds two public Google Calendars ("PDUFA", "Adcom"). Their standard public iCal exports return every
event (date, title, description with the source link) in one HTTP request each - no browser needed.

Per event (in the date window) the drug is identified from, in order:
  1. the calendar text itself (title + description),
  2. the source link's URL slug (press-release sites put the headline, incl. the drug name, in the URL),
  3. the linked document: the sentence(s) stating the event date, plus the sentence before (or a press release's
     lead paragraph),
  4. if the link is technically blocked: the same press release filed on SEC EDGAR (company CIK + date).
An event is kept only if one of our drug's names is found. Events whose evidence could not be obtained are
reported as `unresolved` (with the exact technical blocker), never guessed.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import quote, unquote, urlencode, urlsplit

from .matching import normalize
from .net import Http, HostDown
from .regulatory import EFTS, SENT_SPLIT, doc_text, exclusion_regex, is_company

SOURCE_PAGE = "https://www.fdatracker.com/fda-calendar/"
FEEDS = {"pdufa": "5dso8589486irtj53sdkr4h6ek@group.calendar.google.com",
         "adcom": "evgohovm2m3tuvqakdf4hfeq84@group.calendar.google.com"}
ICS_URL = "https://calendar.google.com/calendar/ical/{id}/public/basic.ics"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik}/{adsh}/{file}"
TTL_FEED, TTL_DOC, TTL_TICKERS = 6 * 3600, 30 * 86400, 7 * 86400
URL_RX = re.compile(r"https?://[^\s<>\"'\\]+")
EVENT_TYPES = {"PDUFA": "pdufa", "ADCOM": "adcom", "PANEL": "advisory_panel"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
LINK_CONCURRENCY = 8  # different hosts in parallel; each host is still paced/serialized by Http


# ---------------------------------------------------------------- iCal parsing (pure, tested)

def _unescape(v: str) -> str:
    return re.sub(r"\\([\\;,nN])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), v)


def parse_ics(text: str, calendar: str) -> list[dict[str, Any]]:
    """RFC 5545 subset: unfold lines, read VEVENT properties (params ignored), unescape text values."""
    raw = re.sub(r"\r?\n[ \t]", "", text.replace("\r\n", "\n"))
    out = []
    for block in re.findall(r"BEGIN:VEVENT\n(.*?)\nEND:VEVENT", raw, re.S):
        props: dict[str, str] = {}
        for line in block.split("\n"):
            key, _, val = line.partition(":")
            props.setdefault(key.split(";")[0].upper(), val)
        d = props.get("DTSTART", "")[:8]
        if not re.fullmatch(r"\d{8}", d) or not props.get("UID"):
            continue
        summary = _unescape(props.get("SUMMARY", "")).strip()
        description = _unescape(props.get("DESCRIPTION", "")).strip()
        links = list(dict.fromkeys(u.rstrip(".,);]") for u in URL_RX.findall(f"{description} {props.get('URL', '')}")))
        out.append({"uid": props["UID"], "calendar": calendar, "date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
                    "summary": summary, "description": description, "links": links,
                    "last_modified": props.get("LAST-MODIFIED"), **parse_summary(summary)})
    return out


def parse_summary(s: str) -> dict[str, str | None]:
    """'MRK Merck & Co., Inc. PDUFA' -> ticker MRK, company 'Merck & Co., Inc.', type pdufa."""
    toks = s.split()
    etype = EVENT_TYPES.get(toks[-1].upper()) if toks else None
    body = toks[:-1] if etype else toks
    ticker = body[0] if len(body) > 1 and re.fullmatch(r"[A-Z0-9.]{1,6}", body[0]) else None
    company = " ".join(body[1:] if ticker else body) or None
    return {"ticker": ticker, "company": company, "event_type": etype or "other"}


def slug_text(url: str) -> str:
    """URL path words: '/en/...-Application-for-Ralinepag-to-Treat-PAH' -> 'en ... Application for Ralinepag ...'."""
    return re.sub(r"[-_/+.]+", " ", unquote(urlsplit(url).path)).strip()


def long_date(iso: str) -> list[str]:
    y, m, d = (int(x) for x in iso.split("-"))
    return [f"{MONTHS[m - 1]} {d}, {y}", f"{MONTHS[m - 1][:3]}. {d}, {y}", iso]


def near_date(text: str, iso: str, lead_chars: int = 0) -> str:
    """Sentences that state the event date, each with the sentence before it (+ optional document lead)."""
    pats = re.compile("|".join(re.escape(p) for p in long_date(iso)), re.I)
    sents = SENT_SPLIT.split(text)
    parts = [" ".join(sents[max(0, i - 1): i + 1]) for i, s in enumerate(sents) if pats.search(s)]
    lead = text[:lead_chars] if lead_chars else ""
    return " … ".join(dict.fromkeys(p[-800:] for p in parts)) + (f" … {lead}" if lead else "")


SHORT_DOC = 8_000  # chars: an 8-K / press release about ONE announcement - the whole text is its context


def _doc_near_date(raw: str, iso: str, lead_chars: int) -> str:
    """CPU-bound; called via asyncio.to_thread. Short documents are one announcement, so all of it counts
    ("…resubmission for YUTREPIA (treprostinil)…" two sentences before "PDUFA goal date of May 24, 2025");
    long ones (10-K/10-Q) keep the strict date-sentence window so neighbouring products are not mixed up."""
    text = doc_text(raw)
    return near_date(text, iso, len(text) if len(text) <= SHORT_DOC else lead_chars)


def headline_from_link(url: str) -> str | None:
    """Press-release URLs carry the headline ('…Announces-FDA-Filing-Acceptance-of-New-Drug-Application-for-Ralinepag…');
    a descriptive slug identifies the announcement even when the page itself cannot be fetched."""
    words = [w for w in slug_text(url).split() if w.isalpha()]
    return " ".join(words) if len(words) >= 6 and re.search(r"FDA|NDA|BLA|PDUFA|Approv|Applicat|Review", " ".join(words), re.I) else None


APPLICATION_RX = re.compile(r"\b(?:applications?|NDA|BLA|sNDA|sBLA|supplemental|accepted|approval)\b", re.I)


def description_identifies(description: str) -> bool:
    """The calendar text itself says which application the date is for ('…sNDA for KRAZATI in combination with…'),
    as opposed to a bare 'The FDA set a PDUFA date of …' that needs the link to identify the product."""
    text = re.sub(r"^\d{4}-\d{2}-\d{2}\s*", "", URL_RX.sub(" ", description)).strip()
    return len(text.split()) >= 10 and bool(APPLICATION_RX.search(text))


def find_terms(text: str, rx: re.Pattern[str]) -> list[str]:
    return sorted({m.group(0).lower() for m in rx.finditer(text)})


def term_regex(terms: list[str]) -> re.Pattern[str]:
    alts = [re.escape(t) for t in terms if len(t.strip()) >= 3]
    if not alts:
        raise ValueError("no drug terms")
    return re.compile(r"(?<![A-Za-z0-9])(?:" + "|".join(alts) + r")(?![A-Za-z0-9])", re.I)


# ---------------------------------------------------------------- acquisition

async def load_events(http: Http, start: str, end: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    events, meta = [], {}
    for name, cal_id in FEEDS.items():
        url = ICS_URL.format(id=quote(cal_id))
        status, text = await http.get_html(url, TTL_FEED, ctype="text/calendar")
        if status != 200:
            raise RuntimeError(f"calendar feed {name} -> HTTP {status}")
        evs = await asyncio.to_thread(parse_ics, text, name)
        meta[name] = {"feed_url": url, "events_total": len(evs)}
        events += [e for e in evs if start <= e["date"] <= end]
    return events, meta


async def _tickers(http: Http, ua: dict[str, str]) -> dict[str, str]:
    status, text = await http.get_html(TICKERS_URL, TTL_TICKERS, ctype="json", headers=ua)
    if status != 200:
        return {}
    return {v["ticker"].upper(): str(v["cik_str"]) for v in json.loads(text).values()}


async def _sec_copy(http: Http, ua: dict[str, str], cik: str, iso: str) -> tuple[str | None, str | None]:
    """Same announcement filed on EDGAR by the company (8-K/6-K exhibit): search its filings for the event date."""
    y = int(iso[:4])
    q = f'"{long_date(iso)[0]}"'
    url = EFTS + "?" + urlencode({"q": q, "ciks": cik.zfill(10), "dateRange": "custom", "startdt": f"{y - 2}-01-01",
                                  "enddt": min(f"{y}-12-31", date.today().isoformat()), "forms": "8-K,6-K"})
    status, text = await http.get_html(url, 86400, ctype="json", headers=ua)
    if status != 200:
        return None, None
    for h in json.loads(text).get("hits", {}).get("hits", [])[:3]:
        adsh, _, fname = h["_id"].partition(":")
        if not (re.fullmatch(r"\d{10}-\d{2}-\d{6}", adsh) and re.fullmatch(r"[A-Za-z0-9][\w.-]{0,120}", fname)):
            continue
        doc_url = ARCHIVE.format(cik=int(cik), adsh=adsh.replace("-", ""), file=fname)
        st, raw = await http.get_html(doc_url, TTL_DOC, ctype=("html", "text/plain"), headers=ua)
        if st == 200:
            return doc_url, raw
    return None, None


async def collect(http: Http, web: Http, *, drug_id: str, terms: list[str], companies: list[str],
                  sec_user_agent: str | None, start: str, end: str,
                  exclude: list[str] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """`http`: allow-listed client (calendar feeds, SEC). `web`: SSRF-guarded client for arbitrary source links.
    `exclude`: other substances containing the drug name ('treprostinil palmitil') - evidence naming them is rejected."""
    rx = term_regex(terms)
    excl_rx = exclusion_regex(exclude or [])

    def terms_in(text: str) -> list[str]:
        return [] if excl_rx and excl_rx.search(text) else find_terms(text, rx)
    events, meta = await load_events(http, start, end)
    ua = {"User-Agent": sec_user_agent} if sec_user_agent else {}
    tickers = await _tickers(http, ua) if sec_user_agent else {}
    sem = asyncio.Semaphore(LINK_CONCURRENCY)
    blockers: dict[str, str] = {}
    now = datetime.now(UTC).isoformat(timespec="seconds")

    async def evidence_for(ev: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
        found: list[dict[str, Any]] = []
        problems: list[str] = []
        cal_text = URL_RX.sub(" ", f"{ev['summary']} {ev['description']}")  # names inside links count as link_url
        if t := terms_in(cal_text):
            found.append({"kind": "calendar_text", "terms": t, "text": ev["description"][:600], "url": SOURCE_PAGE})
        for url in ev["links"]:
            if t := terms_in(slug_text(url)):
                found.append({"kind": "link_url", "terms": t, "text": slug_text(url)[:300], "url": url})
        if found:
            return found, problems
        for url in ev["links"]:  # documents only when text/slug did not already decide
            host = urlsplit(url).hostname or ""
            if host in ("www.sec.gov", "efts.sec.gov") and url.startswith("http://"):
                url = "https://" + url[len("http://"):]  # old calendar links use http; SEC serves the same file on https
            client, hdr = (http, ua) if host in ("www.sec.gov", "efts.sec.gov") else (web, None)
            if host in ("www.sec.gov", "efts.sec.gov") and not sec_user_agent:
                problems.append(f"{url}: SEC_USER_AGENT not configured")
                continue
            try:
                async with sem:
                    status, raw = await client.get_html(url, TTL_DOC, ctype=("html", "text/plain"), headers=hdr, attempts=2)
            except HostDown:
                status, raw = -1, ""
            except Exception as e:  # unsupported type, SSRF block, oversize: record, never crash the run
                problems.append(f"{url}: {type(e).__name__}: {str(e)[:120]}")
                continue
            if status != 200:
                why = "connection reset by bot protection" if status in (0, -1) else f"HTTP {status}"
                blockers[host] = why if status in (0, -1) else blockers.get(host, why)
                problems.append(f"{url}: {why}")
                continue
            lead = 0 if host == "www.sec.gov" else 2500  # press release lead names the product
            text = await asyncio.to_thread(_doc_near_date, raw, ev["date"], lead)
            if t := terms_in(text):
                found.append({"kind": "link_document", "terms": t, "text": text[:800], "url": url})
        if not found and problems and ev["ticker"] and ev["ticker"].upper() in tickers:
            doc_url, raw = await _sec_copy(http, ua, tickers[ev["ticker"].upper()], ev["date"])
            if raw:
                text = await asyncio.to_thread(_doc_near_date, raw, ev["date"], 2500)
                if t := terms_in(text):
                    found.append({"kind": "sec_copy", "terms": t, "text": text[:800], "url": doc_url})
        return found, problems

    results = await asyncio.gather(*(evidence_for(ev) for ev in events))
    out, unresolved = [], 0
    for ev, (found, problems) in zip(events, results, strict=True):
        own = bool(ev["company"]) and is_company(companies, ev["company"])
        # the calendar text or the link headline already names the (other) product -> not "unresolved"
        identified_elsewhere = description_identifies(ev["description"]) or any(headline_from_link(u) for u in ev["links"])
        if found:
            status = "matched"
        elif problems and own and not identified_elsewhere:
            status, unresolved = "unresolved", unresolved + 1  # likely ours but evidence technically unavailable
        else:
            continue
        out.append({
            "_id": f"{drug_id}:{ev['uid']}", "drug_id": drug_id, "status": status,
            "date": ev["date"], "event_type": ev["event_type"], "calendar": ev["calendar"],
            "ticker": ev["ticker"], "company": ev["company"], "is_company": own,
            "title": ev["summary"], "description": ev["description"][:2000], "links": ev["links"],
            "matched_terms": sorted({t for f in found for t in f["terms"]}), "evidence": found[:5],
            "problems": problems[:5], "stale": False, "stale_since": None,
            "provenance": {"source": "FDA Tracker calendar", "page": SOURCE_PAGE,
                           "feed_url": meta[ev["calendar"]]["feed_url"], "uid": ev["uid"],
                           "source_last_modified": ev["last_modified"], "retrieved_at": now,
                           "retrieval_method": "HTTP GET public iCal export; links via HTTP GET"},
        })
    out.sort(key=lambda e: (e["date"], e["title"]))
    report = {"feeds": meta, "events_in_window": len(events), "matched": sum(e["status"] == "matched" for e in out),
              "unresolved": unresolved, "blocked_hosts": blockers,
              "matched_by": {k: sum(any(f["kind"] == k for f in e["evidence"]) for e in out)
                             for k in ("calendar_text", "link_url", "link_document", "sec_copy")}}
    return out, report


def drug_terms(name: str, alternative_names: list[str]) -> list[str]:
    """Drug name + alternative names usable for matching (descriptions like 'X - Company' skipped)."""
    out = [name] + [a for a in alternative_names if " - " not in a]
    return [t for t in dict.fromkeys(re.sub(r"[^\w .+-]", " ", t).strip() for t in out) if len(t) >= 3 and normalize(t)]
