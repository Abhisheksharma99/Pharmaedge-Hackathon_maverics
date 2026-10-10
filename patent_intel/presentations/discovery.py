"""Find a company's latest investor presentations.

Sources (verified 2026-10-09):
  1. Company IR "events & presentations" page (given as ir_url): static <a href="*.pdf"> links with dates in the
     surrounding event card or the filename (e.g. ir.unither.com lists 26 dated PDFs). Factsheets/press releases out.
  2. Fallback, SEC EDGAR: 8-K (Item 7.01/8.01) exhibits that are slide decks. SEC exhibits are HTML with one image
     per slide (no PDFs found across ~20 biotechs), so they are returned as kind="html_slides".
"Latest N" = N distinct decks by date (same deck under two names/sources counted once; PDF preferred over HTML).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Any
from urllib.parse import urljoin, urlsplit

from selectolax.parser import HTMLParser

from ..matching import normalize
from ..net import HostDown, Http

INCLUDE = re.compile(r"present|corporate[\s_-]*(?:overview|deck)|investor[\s_-]*(?:deck|day)|\bjpm\b|j\.?\s?p\.?\s?morgan|"
                     r"earnings|conference|r\s?&\s?d[\s_-]*day|slides?\b|webcast[\s_-]*deck|eps", re.I)
EXCLUDE = re.compile(r"fact[\s_-]*sheet|press[\s_-]*release(?!s/\d{4}/.*present)|transcript|\b10-?[kq]\b|proxy|"
                     r"annual[\s_-]*report|sustainab|\besg\b|code[\s_-]*of[\s_-]*conduct|charter|bylaws|policy", re.I)
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/"
TTL_PAGE, TTL_SEC = 6 * 3600, 86400
log = logging.getLogger("patent_intel.presentations")


def _date(text: str) -> str | None:
    """'23 Sep 2026' | 'September 23, 2026' | '2026-03-02' | '12-01-2026' | '08242026' | 'q2-2026' -> ISO date."""
    t = text.lower()
    for rx, order in ((r"\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})\b", "dmy"), (r"\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b", "mdy"),
                      (r"\b(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})\b", "ymd"), (r"\b(\d{1,2})[-_/](\d{1,2})[-_/](20\d{2})\b", "mdy_n"),
                      (r"(?<!\d)(\d{2})(\d{2})(20\d{2})(?!\d)", "mdy_n")):
        for m in re.finditer(rx, t):
            try:
                a, b, c = m.groups()
                if order == "dmy":
                    return date(int(c), MONTHS[b[:3]], int(a)).isoformat()
                if order == "mdy":
                    return date(int(c), MONTHS[a[:3]], int(b)).isoformat()
                if order == "ymd":
                    return date(int(a), int(b), int(c)).isoformat()
                return date(int(c), int(a), int(b)).isoformat()
            except (KeyError, ValueError):
                continue
    if m := re.search(r"\bq([1-4])[\s_-]*(20\d{2})\b|\b([1-4])q[\s_-]*(20)?(\d{2})\b", t):  # quarter -> quarter-end + 1 month
        q, y = (int(m[1]), int(m[2])) if m[1] else (int(m[3]), 2000 + int(m[5]))
        return date(y + (q == 4), (q * 3) % 12 + 1, 1).isoformat()
    return None


def _title_from(url: str) -> str:
    stem = urlsplit(url).path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return re.sub(r"[-_]+", " ", stem).strip()


def _dedupe_key(title: str, day: str | None) -> str:
    """Same deck under different file names: drop dates, versions, punctuation."""
    t = re.sub(r"\b(?:v\d+|version\s*\d+|final|updated|\d{1,4})\b", " ", title.lower())
    return f"{normalize(t)}|{day}"


def parse_ir_page(html: str, page_url: str) -> list[dict[str, Any]]:
    """Pure: IR page HTML -> presentation PDF candidates (title, url, date)."""
    t = HTMLParser(html)
    out: dict[str, dict[str, Any]] = {}
    for a in t.css("a[href]"):
        href = a.attributes.get("href") or ""
        if not re.search(r"\.pdf(?:$|[?#])", href, re.I):
            continue
        url = urljoin(page_url, href)
        if urlsplit(url).scheme not in ("http", "https"):
            continue
        anchor = re.sub(r"\s+", " ", a.text()).strip()
        title = anchor if len(anchor) > 12 and not re.fullmatch(r"(?i)(download|view|pdf|presentation)[\w\s()]*", anchor) else _title_from(url)
        ctx, node = "", a
        for _ in range(5):  # nearest container that carries a date (event card)
            node = node.parent
            if node is None:
                break
            ctx = re.sub(r"\s+", " ", node.text(separator=" "))
            if _date(ctx):
                break
        blob = f"{title} {url}"
        if not INCLUDE.search(blob) or EXCLUDE.search(blob):
            continue
        day = _date(ctx[:300]) or _date(urlsplit(url).path)
        out.setdefault(url, {"title": title[:200], "url": url, "date": day, "kind": "pdf", "source": "ir", "source_page": page_url})
    return list(out.values())


def latest(candidates: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
    """Newest n distinct decks; PDF/IR preferred over SEC HTML for the same deck."""
    best: dict[str, dict[str, Any]] = {}
    for c in sorted(candidates, key=lambda c: (c["kind"] != "pdf", c["source"] != "ir")):
        best.setdefault(_dedupe_key(c["title"], c["date"]), c)
    return sorted(best.values(), key=lambda c: c["date"] or "", reverse=True)[:n]


async def resolve_cik(http: Http, ua: dict[str, str], company: str | None, ticker: str | None) -> str | None:
    status, text = await http.get_html(TICKERS_URL, TTL_SEC, ctype="json", headers=ua)
    if status != 200:
        return None
    rows = json.loads(text).values()
    if ticker:
        return next((str(r["cik_str"]) for r in rows if r["ticker"].upper() == ticker.upper()), None)
    want = normalize(company or "")
    return next((str(r["cik_str"]) for r in rows if want and normalize(r["title"]) == want), None)


async def from_sec(http: Http, ua: dict[str, str], cik: str, max_filings: int = 40) -> list[dict[str, Any]]:
    """8-K Item 7.01/8.01 exhibits that are slide decks (>= 5 images, or a deck title in the first 3 KB)."""
    status, text = await http.get_html(SUBMISSIONS.format(cik=int(cik)), TTL_SEC, ctype="json", headers=ua)
    if status != 200:
        return []
    r = json.loads(text)["filings"]["recent"]
    out: list[dict[str, Any]] = []
    rows = [i for i, f in enumerate(r["form"]) if f in ("8-K", "6-K") and re.search(r"7\.01|8\.01", r["items"][i] or "")]
    for i in rows[:max_filings]:
        try:  # one odd filing (bad index JSON, unexpected content type) must not cost the others
            out += await _filing_decks(http, ua, cik, r, i)
        except Exception as e:
            if isinstance(e, HostDown):
                raise  # SEC unreachable: stop asking (circuit breaker)
            log.warning("SEC filing %s skipped: %s", r["accessionNumber"][i], type(e).__name__)
    return out


async def _filing_decks(http: Http, ua: dict[str, str], cik: str, r: dict[str, Any], i: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    base = ARCHIVE.format(cik=int(cik), acc=r["accessionNumber"][i].replace("-", ""))
    st, idx = await http.get_html(base + "index.json", TTL_SEC, ctype="json", headers=ua)
    if st != 200:
        return out
    for item in json.loads(idx).get("directory", {}).get("item", []):
        name = item.get("name", "")
        if not re.fullmatch(r"[\w.-]+ex-?99[\w.-]*\.htm", name, re.I) and not name.lower().endswith(".pdf"):
            continue
        url = base + name
        if name.lower().endswith(".pdf"):
            out.append({"title": _title_from(url), "url": url, "date": r["filingDate"][i], "kind": "pdf", "source": "sec"})
            continue
        st, html = await http.get_html(url, TTL_SEC, headers=ua)
        if st != 200:
            continue
        doc = HTMLParser(html)
        imgs = [urljoin(url, x.attributes.get("src") or "") for x in doc.css("img[src]")]
        head = re.sub(r"\s+", " ", doc.body.text(separator=" ") if doc.body else "")[:3000]
        if len(imgs) >= 5 or re.search(r"(corporate|investor)\s+presentation|forward[-\s]looking statements", head, re.I):
            if not imgs:
                continue  # text-only exhibit (press release), not a deck
            out.append({"title": (head[:120] or _title_from(url)).strip(), "url": url, "date": r["filingDate"][i],
                        "kind": "html_slides", "source": "sec", "slide_images": imgs[:200], "html_text": head})
    return out


async def discover(http: Http, *, company: str | None, ticker: str | None, ir_url: str | None, n: int,
                   sec_user_agent: str | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Each source fails on its own: an unreachable/blocked/odd IR page or SEC answer is reported in `errors` and the
    other source (and whatever was already found) is still used."""
    report: dict[str, Any] = {"ir": None, "sec": None, "errors": []}
    cands: list[dict[str, Any]] = []
    if ir_url:
        try:
            status, html = await http.get_html(ir_url, TTL_PAGE)
            if status == 200:
                found = parse_ir_page(html, ir_url)
                report["ir"] = {"url": ir_url, "candidates": len(found)}
                cands += found
            else:
                report["errors"].append(f"IR page {ir_url}: HTTP {status}")
        except Exception as e:  # blocked by the SSRF guard, wrong content type, host down, ...
            report["errors"].append(f"IR page {ir_url}: {type(e).__name__}")
    if len(latest(cands, n)) < n:
        if not sec_user_agent:
            report["errors"].append("SEC fallback skipped: SEC_USER_AGENT not configured")
        else:
            ua = {"User-Agent": sec_user_agent}
            try:
                cik = await resolve_cik(http, ua, company, ticker)
                if cik:
                    found = await from_sec(http, ua, cik)
                    report["sec"] = {"cik": cik, "candidates": len(found)}
                    cands += found
                else:
                    report["errors"].append("SEC fallback: company/ticker not found in SEC ticker list")
            except Exception as e:
                report["errors"].append(f"SEC fallback: {type(e).__name__}")
    chosen = latest(cands, n)
    report["selected"] = len(chosen)
    return chosen, report
