"""Crawl EMA's "Meeting highlights from the Committee for Medicinal Products for Human
Use (CHMP)" news items and store each meeting as one structured record.

Discovery walks every page of https://www.ema.europa.eu/en/news?page=N and keeps the
items whose title is a CHMP meeting highlights title (2006 onwards; older titles read
"Meeting highlights from the Committee for Medicinal Products for Human Use, ...").

EMA's listing is unreliable: for a page other than the first it often answers page 1
(the pager says "Page 1 of 390"), and CloudFront then caches that wrong page for five
minutes. Each listing page is therefore checked against its pager and retried, and the
pages that never come back right are covered by EMA's daily JSON export of all news
items, so a bad listing day cannot drop meetings. The manifest says how each meeting
was found.

Payload (all optional):
    {
        "since": "2020-01-01",   # only meetings published on/after this date (stops paging early)
        "until": "2026-12-31",   # only meetings published on/before this date
        "max_pages": 5,          # walk at most this many listing pages
        "page_attempts": 3,      # tries per listing page before falling back to the export
        "export_fallback": true, # use the JSON export for pages the listing never served
        "refresh": false,        # re-download meeting pages already in cache/pages/
        "workers": 2             # parallel meeting-page downloads
    }

Usage (from the hackathon root):
    ema/.venv/bin/python ema/chmp_highlights.py
    ema/.venv/bin/python ema/chmp_highlights.py '{"since": "2024-01-01"}'
    ema/.venv/bin/python ema/chmp_highlights.py --reparse     # rebuild output from cache/pages only

Output, in ema/output/:
    chmp_meeting_highlights.json  JSON array, one record per meeting (schema: ema/schema.json)
    manifest.json                 payload, listing pages served / failed, counts, problems
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from html import escape
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup, NavigableString, Tag
from curl_cffi import requests
from pypdf import PdfReader

BASE = "https://www.ema.europa.eu"
LISTING = f"{BASE}/en/news"
NEWS_EXPORT = f"{BASE}/en/documents/report/news-json-report_en.json"
HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "pages"
OUTPUT = HERE / "output"
RECORDS_FILE = "chmp_meeting_highlights.json"
PARSER_VERSION = 1

TIMEOUT = 60
MIN_INTERVAL = 1.0  # EMA answers bursts with HTTP 429
LISTING_INTERVAL = 3.0  # the listing walk is ~400 requests in a row: keep under EMA's rate limit
FAILURE_STREAK = 5  # after this many wrong pages in a row, try each page once ...
STREAK_COOLDOWN = 60  # ... and pause this long every 2 * FAILURE_STREAK wrong pages
MAX_ATTEMPTS = 5
RETRY_STATUSES = {429, 500, 502, 503, 504}

HIGHLIGHTS_TITLE = re.compile(r"\bhighlights\b", re.I)
CHMP_TITLE = re.compile(r"Committee for Medicinal Products for Human Use|\bCHMP\b", re.I)
MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], 1)}

log = logging.getLogger("ema.chmp")


class CrawlError(RuntimeError):
    """A request failed after all retries."""


# --- HTTP ------------------------------------------------------------------------------

class HttpClient:
    """curl_cffi session per thread, a shared request pace and retries on 429/5xx."""

    def __init__(self, min_interval: float = MIN_INTERVAL):
        self.min_interval = min_interval
        self._local = threading.local()
        self._lock = threading.Lock()
        self._next_slot = 0.0

    @property
    def session(self) -> requests.Session:
        if not hasattr(self._local, "session"):
            self._local.session = requests.Session(impersonate="chrome")
        return self._local.session

    def get(self, url: str, **kwargs) -> requests.Response:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._pace()
            try:
                response = self.session.get(url, timeout=TIMEOUT, **kwargs)
            except requests.RequestsError as e:
                if attempt == MAX_ATTEMPTS:
                    raise CrawlError(f"GET {url} failed: {e!r}") from e
                reason, delay = repr(e), 2 ** attempt
            else:
                if response.status_code < 400:
                    return response
                if response.status_code not in RETRY_STATUSES or attempt == MAX_ATTEMPTS:
                    raise CrawlError(f"GET {url} -> HTTP {response.status_code}")
                retry_after = response.headers.get("Retry-After", "")
                reason = f"HTTP {response.status_code}"
                delay = min(float(retry_after), 120) if retry_after.isdigit() else 5 * 2 ** attempt
            log.warning("GET %s failed (%s); retry %d/%d in %ss", url, reason, attempt,
                        MAX_ATTEMPTS - 1, delay)
            time.sleep(delay)
        raise AssertionError("unreachable")

    def _pace(self) -> None:
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next_slot)
            self._next_slot = slot + self.min_interval
        if slot > now:
            time.sleep(slot - now)


# --- payload ---------------------------------------------------------------------------

def parse_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")

    def day(name):
        value = payload.get(name)
        if value is None:
            return None
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            raise ValueError(f'"{name}" must be a date like "2024-01-31"') from None

    def positive_int(name, default, upper=None):
        value = payload.get(name, default)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int) or value < 1 \
                or (upper and value > upper):
            raise ValueError(f'"{name}" must be an integer from 1' + (f" to {upper}" if upper else ""))
        return value

    return {
        "since": day("since"),
        "until": day("until"),
        "max_pages": positive_int("max_pages", None),
        "page_attempts": positive_int("page_attempts", 3, 20),
        "export_fallback": bool(payload.get("export_fallback", True)),
        "refresh": bool(payload.get("refresh", False)),
        "workers": positive_int("workers", 2, 8),
    }


# --- discovery -------------------------------------------------------------------------

def is_chmp_highlights(title: str) -> bool:
    return bool(HIGHLIGHTS_TITLE.search(title) and CHMP_TITLE.search(title)
                and title.lower().lstrip().startswith("meeting highlights"))


def parse_listing(html: str) -> tuple[int | None, int | None, list[dict]]:
    """(page shown, page count, news items) of one /en/news listing page."""
    soup = BeautifulSoup(html, "lxml")
    shown = total = None
    pager = soup.select_one("nav.pager")
    if pager:
        m = re.search(r"Page (\d+) of (\d+)", pager.get_text(" "))
        if m:
            shown, total = int(m.group(1)), int(m.group(2))
    items = []
    for teaser in soup.select("article.ema-news--teaser"):
        link = teaser.select_one(".teaser-title a")
        if not link:
            continue
        items.append({
            "title": clean(link.get_text(" ")),
            "url": absolute(link.get("href")),
            "date": parse_day(text_of(teaser.select_one(".metadata-item"))),
            "summary": text_of(teaser.select_one(".card-text")),
        })
    return shown, total, items


def walk_listing(http: HttpClient, options: dict) -> tuple[dict[str, dict], dict]:
    """Every CHMP highlights item on the listing pages, keyed by URL, plus page stats."""
    found: dict[str, dict] = {}
    stats = {"pages_total": None, "pages_ok": [], "pages_failed": [], "stopped_early_at": None,
             "covers_since": None}  # oldest date the walk reached when it stopped before the end
    page = streak = 0
    while True:
        items = None
        # While EMA keeps serving page 1, retrying every page only earns HTTP 429s.
        attempts = options["page_attempts"] if streak < FAILURE_STREAK else 1
        for attempt in range(1, attempts + 1):
            # A wrong page is cached by CloudFront for 5 min under its URL: retry under a new one.
            params = {"page": page} if attempt == 1 else {"page": page, "_": random.randrange(10**9)}
            try:
                response = http.get(LISTING, params=params)
            except CrawlError as e:
                log.warning("listing page %d: %s", page + 1, e)
                continue
            shown, total, page_items = parse_listing(response.text)
            stats["pages_total"] = total or stats["pages_total"]
            if shown == page + 1 and page_items:
                items = page_items
                break
            log.info("listing page %d answered as page %s (attempt %d/%d)", page + 1, shown,
                     attempt, attempts)
            if attempt < attempts:
                time.sleep(min(3 * attempt, 15))
        if items is None:
            stats["pages_failed"].append(page + 1)
            streak += 1
            if streak % (2 * FAILURE_STREAK) == 0:
                log.info("%d listing pages in a row came back wrong; pausing %ds", streak, STREAK_COOLDOWN)
                time.sleep(STREAK_COOLDOWN)
        else:
            streak = 0
            stats["pages_ok"].append(page + 1)
            for item in items:
                if is_chmp_highlights(item["title"]) and in_range(item["date"], options):
                    found.setdefault(item["url"], {**item, "found_via": "listing"})
            oldest = min((i["date"] for i in items if i["date"]), default=None)
            stats["covers_since"] = oldest or stats["covers_since"]
            if options["since"] and oldest and oldest < options["since"]:
                stats["stopped_early_at"] = page + 1
                break
        log.info("listing page %d/%s: %s, %d CHMP highlights so far", page + 1,
                 stats["pages_total"] or "?", "ok" if items is not None else "FAILED", len(found))
        page += 1
        last = stats["pages_total"] or 1
        if page >= last:
            stats["covers_since"] = None  # walked to the oldest news item
            break
        if options["max_pages"] and page >= options["max_pages"]:
            break
    return found, stats


def from_export(http: HttpClient, options: dict) -> dict[str, dict]:
    """CHMP highlights from EMA's JSON export of all news items."""
    data = http.get(NEWS_EXPORT).json()["data"]
    found = {}
    for n in data:
        published = parse_day(n.get("first_published_date"), dmy=True)
        if is_chmp_highlights(n.get("title") or "") and in_range(published, options):
            url = n["news_url"]
            found[url] = {"title": clean(n["title"]), "url": url, "date": published,
                          "summary": clean(n.get("news_summary")), "found_via": "json_export"}
    return found


def in_range(day: date | None, options: dict) -> bool:
    if day is None:
        return True
    return not ((options["since"] and day < options["since"])
                or (options["until"] and day > options["until"]))


# --- meeting page parsing --------------------------------------------------------------

def parse_meeting(html: str, url: str, pdf_text: str | None = None) -> dict:
    """Parse a meeting page. pdf_text is the text of the highlights PDF, for the 2007-2009
    pages that hold nothing but that PDF."""
    soup = BeautifulSoup(html, "lxml")
    for junk in soup.select("script, style, svg, button, .bcl-copyright, .visually-hidden"):
        junk.decompose()

    title = text_of(soup.select_one("h1.content-banner-title")) or meta(soup, "og:title")
    published = meta(soup, "article:published_time")
    banner = soup.select_one(".bcl-content-banner") or soup
    record = {
        "id": urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1],
        "source": "EMA",
        "committee": "CHMP",
        "url": url,
        "title": title,
        "summary": text_of(soup.select_one(".ema-news__summary")) or meta(soup, "description"),
        "published_at": iso_datetime(published),
        "meeting": parse_meeting_dates(title or "", published),
        "categories": [text_of(b) for b in banner.select(".ema-bg-category .label")],
        "topics": [text_of(b) for b in banner.select(".ema-bg-topic .label")],
        "highlights": [],
        "statistics": None,
        "outcomes": [],
        "sections": [],
        "documents": [],
        "related_content": [],
        "related_medicines": [],
        "medicine_names": [],
        "content_text": None,
        "content_source": "html",
        "crawled_at": None,
        "parser_version": PARSER_VERSION,
    }

    article = soup.select_one("article.ema-news--full") or soup
    wrapper = article.select_one(".ema-node-content-wrapper") or article
    record["content_text"] = clean_block_text(wrapper)

    section = None  # current h2 heading
    for item in wrapper.find_all("div", class_="item", recursive=False):
        related = item.select_one(".related-section-wrapper")
        if related:
            _parse_related(related, record)
            continue
        heading = item.select_one("h2")
        if heading:
            section = clean(heading.get_text(" "))
            heading.decompose()
            _section(record, section)

        for card in item.select(".description-list"):
            record["outcomes"].append(_outcome_from_card(card, section, url))
            card.decompose()
        for file in item.select(".bcl-file"):
            record["documents"].append(_document(file, section))
            file.decompose()
        accordion = item.select_one(".accordion")
        if accordion:
            record["statistics"] = _statistics(accordion)
            accordion.decompose()
        tables = item.select("table")
        # 2010-2020 pages put h3 headings and their tables in one rich-text item.
        # Before the first h2 (pre-2019 pages have none), a heading in an earlier item counts.
        scope = item if section else wrapper
        headings = [_heading_before(table, scope) or section for table in tables]
        for table, table_section in zip(tables, headings):
            outcomes = _outcomes_from_table(table, table_section, url)
            if outcomes:
                record["outcomes"].extend(outcomes)
                table.decompose()

        editor = item.select_one(".ecl-editor") or item
        # A heading left without text had only tables under it.
        blocks = [b for b in _rich_text_blocks(editor) if b["text"]]
        if section is None:
            record["highlights"].extend(blocks)
        elif blocks:
            target = _section(record, section)
            target["text"] = "\n".join(filter(None, [target["text"], *(
                "\n".join(filter(None, [b["heading"], b["text"]])) for b in blocks)]))
            target["links"].extend(link for b in blocks for link in b["links"])
            target["medicines"].extend(m for b in blocks for m in b["medicines"])

    # Old pages (pre-2023) keep their "Related content" etc. as h2 blocks outside .item.
    for heading in article.select("h2"):
        name = clean(heading.get_text(" "))
        if name == "Related medicine information" or (name in ("Related content", "Related press releases")
                                                        and not record["related_content"]):
            container = heading.find_next_sibling() or heading.parent
            links = [_link(a) for a in container.select("a[href]")] if container else []
            key = "related_medicines" if name == "Related medicine information" else "related_content"
            record[key] = [{"name" if key == "related_medicines" else "title": l["text"], "url": l["url"]}
                           for l in links if l["text"]]

    record["outcomes"].extend(_outcomes_from_documents(record))
    if pdf_text and not record["highlights"]:
        paragraphs = [clean(p) for p in re.split(r"\n\s*\n|(?<=[.:;])\s*\n", pdf_text) if clean(p)]
        fragment = BeautifulSoup("".join(f"<p>{escape(p)}</p>" for p in paragraphs), "lxml").body
        record["highlights"] = [{"heading": None, "text": "\n".join(paragraphs), "links": [],
                                 "medicines": mentioned_medicines([fragment])}]
        record["content_text"] = "\n".join(filter(None, [record["content_text"], *paragraphs]))
        record["content_source"] = "pdf"
    record["sections"] = [s for s in record["sections"] if s["text"] or s["links"] or s["medicines"]]
    names: dict[str, str] = {}  # spelling-insensitive key -> first spelling seen
    for name in [*(o["medicine_name"] for o in record["outcomes"]),
                 *(o for o in (p for o in record["outcomes"] for p in o["extra"].get("products", []))),
                 *(m["name"] for b in record["highlights"] + record["sections"] for m in b["medicines"]),
                 *(re.sub(r"\s+-\s+referral$", "", m["name"]) for m in record["related_medicines"])]:
        if name:
            names.setdefault(re.sub(r"\s*([/-])\s*", r"\1", name).casefold(), name)
    record["medicine_names"] = sorted(names.values(), key=str.casefold)
    return record


SUMMARY_OF_OPINION = re.compile(r"summary of (?P<kind>positive|negative) opinion for (?P<name>.+?)\s*$", re.I)


def _outcomes_from_documents(record: dict) -> list[dict]:
    """2009-2011 pages list medicines only as documents: "CHMP summary of positive opinion
    for Nimenrix", "CHMP post-authorisation summary of positive opinion for Herceptin"."""
    known = {(o["medicine_name"] or "").casefold() for o in record["outcomes"]}
    outcomes = []
    for doc in record["documents"]:
        m = SUMMARY_OF_OPINION.search(doc["title"] or "")
        if not m or m.group("name").casefold() in known:
            continue
        known.add(m.group("name").casefold())
        post = "post-authorisation" in doc["title"].lower()
        outcome = _outcome(m.group("name"), [], doc["section"], record["url"])
        outcome.update(opinion=m.group("kind").lower(),
                       procedure="extension_of_indication" if post else "new_medicine",
                       ema_url=doc["url"], ema_page_type="summary_of_opinion")
        outcomes.append(outcome)
    return outcomes


def _heading_before(node: Tag, scope: Tag) -> str | None:
    """The nearest heading (h2-h5 or an all-bold paragraph) above node inside scope."""
    for el in node.find_all_previous(["h2", "h3", "h4", "h5", "p"]):
        if scope not in el.parents:
            return None
        text = text_of(el)
        if not text or el.find_parent("table"):
            continue
        if el.name != "p":
            return text
        bold = el.find(["strong", "b"])
        if bold and text and text_of(bold) == text and len(text) < 160:
            return text.rstrip(":")
    return None


def _section(record: dict, heading: str) -> dict:
    for s in record["sections"]:
        if s["heading"] == heading:
            return s
    s = {"heading": heading, "text": None, "links": [], "medicines": []}
    record["sections"].append(s)
    return s


def _parse_related(related: Tag, record: dict) -> None:
    heading = clean(text_of(related.select_one("h2")))
    # 2007-2009 pages: the highlights PDF and Q&A documents, without a heading.
    for file in related.select(".bcl-file"):
        record["documents"].append(_document(file, heading))
    if heading == "Related content":
        record["related_content"] = [{"title": l["text"], "url": l["url"]}
                                     for l in map(_link, related.select("a[href]")) if l["text"]]


def _outcome_from_card(card: Tag, section: str | None, page_url: str) -> dict:
    name = text_of(card.select_one("h3"))
    fields = []
    for dt in card.select("dt"):
        dd = dt.find_next_sibling("dd")
        if dd is not None:
            fields.append((text_of(dt), dd))
    return _outcome(name, fields, section, page_url)


NAME_LABEL = re.compile(r"^\s*name of (the )?medicine", re.I)
FIELD_LABEL = re.compile(r"\bINN\b|non-proprietary|common name|applicant|holder|indication|"
                         r"more information|orphan", re.I)


def _outcomes_from_table(table: Tag, section: str | None, page_url: str) -> list[dict]:
    """Medicine tables. 2018-2023: one two-column table per medicine, rows "Name of
    medicine" / "INN" / ... . 2010-2017: one table per section with a header row
    "Name of medicine | INN | Marketing authorisation applicant" and a row per medicine."""
    rows = [cells for cells in (tr.find_all(["td", "th"], recursive=False) for tr in table.select("tr"))
            if cells]
    if not rows or not NAME_LABEL.match(text_of(rows[0][0]) or ""):
        return []
    header = [text_of(c) or "" for c in rows[0]]
    if len(header) != 2 or FIELD_LABEL.search(header[1]):
        return [_outcome_from_row(header, row, section, page_url) for row in rows[1:]
                if any(text_of(c) for c in row)]

    outcomes, current = [], None
    for cells in rows:
        if len(cells) != 2:
            continue
        label, cell = text_of(cells[0]), cells[1]
        if NAME_LABEL.match(label or ""):
            if current:
                outcomes.append(_outcome(*current, section, page_url))
            current = (text_of(cell), [])
        elif current:
            current[1].append((label, cell))
    if current:
        outcomes.append(_outcome(*current, section, page_url))
    return outcomes


def _outcome_from_row(header: list[str], row: list[Tag], section: str | None, page_url: str) -> dict:
    """A row of a 2010-2017 header table. The name cell holds a link to the summary of
    opinion ("CHMP summary of positive opinion for Nimenrix") or to a news item, and
    sometimes the medicines a review covered on the following line."""
    name_cell = row[0]
    lines = [clean(l) for l in name_cell.get_text("\n").split("\n") if clean(l)]
    name = None
    for line in lines:
        m = re.search(r"opinion for (.+)$", line, re.I)
        if m:
            name = m.group(1)
            break
    if name is None and lines and not re.match(r"(press release|questions and answers)\b", lines[0], re.I):
        name = lines[0]
    outcome = _outcome(name, list(zip(header[1:], row[1:])), section, page_url)
    link = name_cell.select_one("a[href]")
    if link and not outcome["ema_url"]:
        outcome["ema_url"] = _link(link, page_url)["url"]
        outcome["ema_page_type"] = ema_page_type(outcome["ema_url"])
    products = [p for line in lines[1:] for p in re.split(r",\s*", line)
                if p and not re.search(r"opinion for|press release|questions and answers", p, re.I)]
    if products:
        outcome["extra"]["products"] = products
    if name is None and lines:
        outcome["extra"]["name_cell"] = " | ".join(lines)
    return outcome


def _outcome(name: str | None, fields: list[tuple[str | None, Tag]], section: str | None,
             page_url: str) -> dict:
    procedure_number = re.search(r"\s*\(((?:II|IB|IA|X|WS)[-/][\w/-]+)\)\s*$", name or "")
    if procedure_number:
        name = name[:procedure_number.start()]
    outcome = {
        "medicine_name": strip_marks(name),
        "section": section,
        **classify_section(section),
        "inn": None,
        "common_name": None,
        "company": None,
        "company_role": None,
        "therapeutic_indication": None,
        "orphan": None,
        "status": None,
        "ema_url": None,
        "ema_page_type": None,
        "related_news": [],
        "extra": {"procedure_number": procedure_number.group(1)} if procedure_number else {},
    }
    for label, cell in fields:
        key = (label or "").lower()
        value = text_of(cell)
        if "non-proprietary" in key or key == "inn":
            outcome["inn"] = value
        elif key.startswith("common name"):
            outcome["common_name"] = value
        elif "applicant" in key or "holder" in key:
            outcome["company"] = value
            outcome["company_role"] = "applicant" if "applicant" in key else "holder"
        elif "indication" in key:
            outcome["therapeutic_indication"] = value
        elif "orphan" in key:
            outcome["orphan"] = True
            outcome["extra"]["orphan_note"] = value
        elif key.startswith("more information"):
            link = cell.select_one("a[href]")
            if link:
                info = _link(link, page_url)
                outcome["ema_url"] = info["url"]
                outcome["ema_page_type"] = ema_page_type(info["url"])
                # "Evlarco : pending EC decision"; referral links have no status.
                if ":" in (info["text"] or "") and outcome["ema_page_type"] in ("epar", "variation"):
                    outcome["status"] = clean(info["text"].rsplit(":", 1)[1])
            elif value:
                outcome["extra"]["more_information"] = value
        elif key == "news" or key.startswith("related news") or key.startswith("press release"):
            outcome["related_news"].extend(
                {"title": l["text"], "url": l["url"]} for l in
                (_link(a, page_url) for a in cell.select("a[href]")))
        elif label:
            outcome["extra"][label] = value
    return outcome


def classify_section(heading: str | None) -> dict:
    """Normalize an h2 heading such as "Positive recommendations on new generic medicines"."""
    h = (heading or "").lower()
    re_examination = "re-examination" in h or "reexamination" in h
    referral = bool(re.search(r"referral|review|arbitration|harmonisation", h))
    if "withdraw" in h:
        opinion = "withdrawn"
    elif "negative" in h:
        opinion = "negative"
    elif "positive" in h:
        opinion = "positive"
    elif re_examination:
        opinion = "re_examination"  # "Start of re-examination of ..."
    elif re.search(r"\bstarts? of\b", h) and referral:
        opinion = "referral_started"
    elif re.search(r"conclusion|outcome|final opinion|opinions? on", h) and referral:
        opinion = "referral_concluded"
    elif "article 5(3)" in h or "scientific matter" in h:
        opinion = "scientific_opinion"
    else:
        opinion = "other" if h else None

    if "extension" in h or "indication" in h:
        procedure = "extension_of_indication"
    elif referral:
        procedure = "referral"
    elif "change the marketing authorisation" in h or "post-authorisation" in h:
        procedure = "variation"
    elif re.search(r"\bnew\b|initial|generic|biosimilar|hybrid|informed.consent", h):
        procedure = "new_medicine"
    else:
        procedure = "other" if h else None

    medicine_type = next((t for t, words in (
        ("biosimilar", ("biosimilar",)), ("generic", ("generic",)), ("hybrid", ("hybrid",)),
        ("informed_consent", ("informed consent", "informed-consent")),
        ("advanced_therapy", ("advanced therap",)),
    ) if any(w in h for w in words)), None)
    return {"opinion": opinion, "procedure": procedure, "medicine_type": medicine_type,
            "re_examination": re_examination}


def ema_page_type(url: str | None) -> str | None:
    path = urlsplit(url or "").path
    for part, kind in (("/EPAR/", "epar"), ("/variation/", "variation"), ("/referrals/", "referral"),
                       ("/withdrawn-applications/", "withdrawn_application"),
                       ("/summaries-opinion/", "summary_of_opinion"), ("/documents/", "document")):
        if part in path:
            return kind
    return "other" if path else None


def _document(file: Tag, section: str | None) -> dict:
    meta_texts = [text_of(s) for s in file.select(".file-metadata-row")]
    reference = next((re.sub(r"^Reference Number:\s*", "", t) for t in meta_texts
                      if t and t.startswith("Reference Number")), None)
    status = next((t for t in meta_texts if t and not t.startswith("Reference Number")), None)
    lang = file.select_one(".file-language-links")
    lang_text = text_of(lang.find("p")) if lang and lang.find("p") else None
    size = re.search(r"\(([\d.,]+\s*[KMG]?B)\s*-\s*([A-Za-z0-9]+)\)", lang_text or "")
    dates = {}
    for small in (lang.select("small") if lang else []):
        label = text_of(small.find("strong")) or ""
        when = small.find("time")
        if when:
            dates["first_published" if "First" in label else "last_updated"] = \
                parse_day(text_of(when), dmy=True)
    link = (lang or file).select_one("a[href]")
    return {
        "title": text_of(file.select_one(".file-title")),
        "section": section,
        "reference_number": reference,
        "status": status,
        "language": re.sub(r"\s*\(.*", "", lang_text) if lang_text else None,
        "file_type": size.group(2).upper() if size else None,
        "file_size": size.group(1) if size else None,
        "first_published": iso_day(dates.get("first_published")),
        "last_updated": iso_day(dates.get("last_updated")),
        "url": absolute(link.get("href")) if link else None,
    }


STAT_LINE = re.compile(r"^(?P<count>\d+)\s+(?P<label>[^:.]+?)(?:\s*:\s*(?P<breakdown>.*?))?\.?"
                       r"\s*(?:Total in (?P<year>\d{4})\s*:\s*(?P<total>\d+))?\.?$", re.I)


def _statistics(accordion: Tag) -> dict:
    """The "CHMP statistics: Text version" accordion of 2024+ pages."""
    body = accordion.select_one(".accordion-body") or accordion
    figures = []
    for li in body.select("li"):
        line = text_of(li)
        m = STAT_LINE.match(line or "")
        figures.append({
            "label": clean(m.group("label")) if m else None,
            "count": int(m.group("count")) if m else None,
            "breakdown": clean(m.group("breakdown")) if m else None,
            "year": int(m.group("year")) if m and m.group("year") else None,
            "year_total": int(m.group("total")) if m and m.group("total") else None,
            "text": line,
        })
    return {"text": clean_block_text(body), "figures": figures}


HEADING_TAGS = {"h2", "h3", "h4", "h5", "h6"}


def _rich_text_blocks(editor: Tag) -> list[dict]:
    """Split rich text into {"heading", "text", "links", "medicines"} blocks. A heading is
    an h3/h4 or a paragraph that is all bold ("<p><strong>Start of referral</strong></p>"),
    or a bold run before a <br> (2006-2008: "<p><strong>Extension of indication</strong><br>...")."""
    blocks: list[dict] = []
    current = {"heading": None, "parts": [], "nodes": []}

    def flush():
        text = "\n".join(p for p in current["parts"] if p)
        if text or current["heading"]:
            links = [l for n in current["nodes"] for l in map(_link, n.select("a[href]"))
                     if l["url"] and not l["url"].startswith("mailto:")]
            medicines = mentioned_medicines(current["nodes"])
            blocks.append({"heading": current["heading"], "text": text or None,
                           "links": links, "medicines": medicines})

    for node in editor.children:
        if isinstance(node, NavigableString):
            if clean(str(node)):
                current["parts"].append(clean(str(node)))
            continue
        if not isinstance(node, Tag):
            continue
        heading, rest = None, False
        if node.name in HEADING_TAGS:
            heading = text_of(node)
        elif node.name == "p":
            bold = node.find(["strong", "b"], recursive=False)
            text = text_of(node)
            if bold and text and text_of(bold) == text and len(text) < 160:
                heading = text
            elif bold and bold is _first_content(node) and isinstance(bold.next_sibling, Tag) \
                    and bold.next_sibling.name == "br":
                heading, rest = text_of(bold), True
                bold.next_sibling.decompose()
                bold.decompose()
        if heading:
            flush()
            current = {"heading": heading.rstrip(":"), "parts": [], "nodes": []}
            if not rest:
                continue
        text = clean_block_text(node)
        if text:
            current["parts"].append(text)
            current["nodes"].append(node)
    flush()
    return blocks


def _first_content(node: Tag):
    for child in node.children:
        if isinstance(child, NavigableString) and not child.strip():
            continue
        return child
    return None


NOT_A_MEDICINE = re.compile(
    r"^(article|directive|regulation|committee|commission|agency|annex|section|the |a |an |"
    r"eu\b|ec\b|ema\b|emea\b|chmp\b|prac\b|cat\b|comp\b|pdco\b|who\b|ich\b|note|update|"
    r"negative|positive|withdrawal|start|conclusion|outcome|agenda|minutes|recommend|"
    r"\d)", re.I)
NAME_THEN_INN = re.compile(
    r"(?<![\w-])(?P<name>[A-Z][\w-]*(?:[ /][A-Z0-9][\w-]*){0,3})\*?\s*\((?P<inn>[a-z][^()]{1,120}?)\)")
INN_STOP = re.compile(r"^(as |see |the |a |an |in |for |from |which|also|e\.g|i\.e|including|"
                      r"previously|formerly|known|now|and |or )", re.I)


def mentioned_medicines(nodes: list[Tag]) -> list[dict]:
    """Medicines named in narrative text: bold names ("<strong>Lyrokaul</strong>
    (lerodalcibep)") and, on old pages without bold, "Byetta (exenatide)". Heuristic."""
    found: dict[str, dict] = {}

    def add(name, inn):
        name = strip_marks(name)
        if not name or len(name) < 3 or len(name.split()) > 6 or NOT_A_MEDICINE.match(name) \
                or not name[0].isupper():
            return
        entry = found.setdefault(name.casefold(), {"name": name, "inn": None})
        if inn and not entry["inn"] and not INN_STOP.match(inn):
            entry["inn"] = clean(inn)

    for node in nodes:
        for bold in node.find_all(["strong", "b"]):
            text = text_of(bold)
            if not text or text.endswith(":"):
                continue
            after = bold.next_sibling
            inn_match = re.match(r"\s*\*?\s*\(([^()]+)\)", str(after)) if isinstance(after, NavigableString) else None
            names = [p for p in re.split(r",\s*|\s+and\s+", text) if p.strip()]
            for i, name in enumerate(names):
                add(name, inn_match.group(1) if inn_match and i == len(names) - 1 else None)
        bold_names = [key for key in found]
        for m in NAME_THEN_INN.finditer(node.get_text(" ")):
            name = m.group("name").casefold()
            # "Sun" out of a bold "Sitagliptin/Metformin hydrochloride Sun (sitagliptin ...)"
            if INN_STOP.match(m.group("inn")) or any(name in key and name != key for key in bold_names):
                continue
            add(m.group("name"), m.group("inn"))
    return list(found.values())


def parse_meeting_dates(title: str, published: str | None) -> dict:
    """"... (CHMP) 20-23 July 2026" / "28 September - 1 October 2026" / "29 June-2 July 2026"."""
    year_hint = int(published[:4]) if published and published[:4].isdigit() else None
    m = re.search(r"(\d{1,2})\s*([A-Za-z]+)?\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]+)(?:,?\s+(\d{4}))?", title)
    single = None if m else re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", title)
    label = start = end = None
    try:
        if m and m.group(4).lower() in MONTHS:
            d1, mon1, d2, mon2, year = m.groups()
            end_month = MONTHS[mon2.lower()]
            start_month = MONTHS.get((mon1 or "").lower(), end_month)
            year = int(year) if year else year_hint
            if year:
                end = date(year, end_month, int(d2))
                start = date(year - (start_month > end_month), start_month, int(d1))
            label = clean(m.group(0))
        elif single and single.group(2).lower() in MONTHS:
            start = end = date(int(single.group(3)), MONTHS[single.group(2).lower()], int(single.group(1)))
            label = clean(single.group(0))
    except ValueError:
        start = end = None
    return {"label": label, "start_date": iso_day(start), "end_date": iso_day(end),
            "year": (start or end).year if (start or end) else year_hint,
            "month": end.month if end else None}


# --- helpers ---------------------------------------------------------------------------

def clean(text: str | None) -> str | None:
    if text is None:
        return None
    return " ".join(text.replace("\xa0", " ").split()) or None


def text_of(node) -> str | None:
    return clean(node.get_text(" ")) if node is not None else None


def clean_block_text(node: Tag) -> str | None:
    """Text with one line per paragraph / list item instead of one long run."""
    parts = []
    for el in node.find_all(["p", "li", "h2", "h3", "h4", "h5", "td", "dt", "dd"]):
        if el.find(["p", "li", "td", "dd"]):
            continue
        text = text_of(el)
        if text:
            parts.append(text)
    if not parts:
        return text_of(node)
    return "\n".join(parts)


def strip_marks(name: str | None) -> str | None:
    return clean(re.sub(r"[*†‡¹²³⁴⁵⁶⁷⁸⁹⁰\d]+$|^[\s,;:]+|[\s,;:.]+$", "", name or "")) if name else None


def absolute(href: str | None) -> str | None:
    return urljoin(BASE, href) if href else None


def _link(a: Tag, base: str = BASE) -> dict:
    return {"text": text_of(a), "url": urljoin(base, a.get("href"))}


def meta(soup: BeautifulSoup, name: str) -> str | None:
    tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
    return clean(tag.get("content")) if tag else None


def parse_day(text: str | None, dmy: bool = False) -> date | None:
    if not text:
        return None
    text = clean(text)
    try:
        if dmy:
            d, m, y = text.split("/")
            return date(int(y), int(m), int(d))
        return datetime.strptime(text, "%d %B %Y").date()
    except ValueError:
        return None


def iso_day(day: date | None) -> str | None:
    return day.isoformat() if day else None


def iso_datetime(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S%z").isoformat()
    except ValueError:
        return value


# --- crawl -----------------------------------------------------------------------------

def cache_path(url: str) -> Path:
    return CACHE / f"{urlsplit(url).path.rstrip('/').rsplit('/', 1)[-1]}.html"


def highlights_pdf_text(record: dict, http: HttpClient | None, refresh: bool) -> str | None:
    """Text of the page's "Meeting highlights ..." PDF, downloaded once into the cache
    (with http None, only a cached copy is used)."""
    doc = next((d for d in record["documents"] if d["url"] and ".pdf" in d["url"]
                and (d["title"] or "").lower().startswith("meeting highlights")), None)
    if doc is None:
        return None
    path = CACHE / f"{record['id']}.pdf"
    if http and (refresh or not path.exists()):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(http.get(doc["url"]).content)
    if not path.exists():
        return None
    try:
        reader = PdfReader(str(path))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages).strip() or None
    except Exception as e:  # a damaged PDF must not lose the rest of the record
        log.warning("could not read %s: %r", path, e)
        return None


def fetch_meeting(http: HttpClient, item: dict, refresh: bool) -> dict:
    path = cache_path(item["url"])
    if refresh or not path.exists():
        html = http.get(item["url"]).text
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(html, encoding="utf-8")
        fetched = datetime.now(timezone.utc)
    else:
        html = path.read_text(encoding="utf-8")
        fetched = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
    record = parse_meeting(html, item["url"])
    if not record["highlights"] and not record["outcomes"]:
        pdf_text = highlights_pdf_text(record, http, refresh)
        if pdf_text:
            record = parse_meeting(html, item["url"], pdf_text)
    record["crawled_at"] = fetched.isoformat(timespec="seconds")
    record["summary"] = record["summary"] or item.get("summary")
    return record


def crawl(payload: dict | None = None, out_dir: Path = OUTPUT) -> dict:
    options = parse_payload(payload or {})
    http = HttpClient()
    started = datetime.now(timezone.utc)

    found, stats = walk_listing(HttpClient(LISTING_INTERVAL), options)
    export_added = []
    if options["export_fallback"] and stats["pages_failed"]:
        log.info("%d listing pages never served correctly; filling in from the JSON export",
                 len(stats["pages_failed"]))
        for url, item in from_export(http, options).items():
            # Only the stretch of news the listing walk covered (max_pages / since stop early).
            covered = stats["covers_since"] is None or (item["date"] and item["date"] >= stats["covers_since"])
            if url not in found and covered:
                found[url] = item
                export_added.append(url)

    items = sorted(found.values(), key=lambda i: i["date"] or date.min, reverse=True)
    log.info("downloading %d CHMP meeting highlights pages", len(items))
    records, problems = [], []

    def run(item):
        try:
            return item, fetch_meeting(http, item, options["refresh"])
        except Exception as e:  # one bad page must not abort the crawl
            log.exception("could not crawl %s", item["url"])
            return item, e

    with ThreadPoolExecutor(options["workers"]) as pool:
        for item, result in pool.map(run, items):
            if isinstance(result, Exception):
                problems.append({"url": item["url"], "error": repr(result)})
            else:
                records.append(result)
                if not result["outcomes"] and not result["highlights"]:
                    problems.append({"url": item["url"], "warning": "no highlights or outcomes parsed"})

    manifest = write_output(records, out_dir, {
        "payload": {k: (v.isoformat() if isinstance(v, date) else v) for k, v in options.items()},
        "started_at": started.isoformat(timespec="seconds"),
        "listing": {**stats, "pages_ok": len(stats["pages_ok"]), "pages_failed": stats["pages_failed"],
                    "covers_since": iso_day(stats["covers_since"])},
        "found_via_listing": sum(i["found_via"] == "listing" for i in items),
        "found_via_json_export": len(export_added),
        "problems": problems,
    })
    return manifest


def reparse(out_dir: Path = OUTPUT) -> dict:
    """Rebuild the output from cache/pages without any network access."""
    records, problems = [], []
    for path in sorted(CACHE.glob("*.html")):
        url = f"{BASE}/en/news/{path.stem}"
        try:
            html = path.read_text(encoding="utf-8")
            record = parse_meeting(html, url)
            if not record["highlights"] and not record["outcomes"]:
                pdf_text = highlights_pdf_text(record, None, False)
                if pdf_text:
                    record = parse_meeting(html, url, pdf_text)
            record["crawled_at"] = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) \
                .isoformat(timespec="seconds")
            records.append(record)
        except Exception as e:
            log.exception("could not parse %s", path)
            problems.append({"url": url, "error": repr(e)})
    return write_output(records, out_dir, {"payload": "reparse of cache/pages", "problems": problems})


def write_output(records: list[dict], out_dir: Path, info: dict) -> dict:
    records.sort(key=lambda r: (r["meeting"]["start_date"] or r["published_at"] or ""), reverse=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / RECORDS_FILE).write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        **info,
        "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "meetings": len(records),
        "outcomes": sum(len(r["outcomes"]) for r in records),
        "documents": sum(len(r["documents"]) for r in records),
        "meetings_without_structured_outcomes": sum(not r["outcomes"] for r in records),
        "date_range": [records[-1]["meeting"]["start_date"], records[0]["meeting"]["start_date"]]
        if records else None,
        "output": str((out_dir / RECORDS_FILE).relative_to(HERE.parent)
                      if (out_dir / RECORDS_FILE).is_relative_to(HERE.parent) else out_dir / RECORDS_FILE),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("payload", nargs="?", help="JSON payload or path to a JSON file")
    parser.add_argument("--out", type=Path, default=OUTPUT, help="output folder (default: ema/output)")
    parser.add_argument("--reparse", action="store_true", help="rebuild output from cache/pages only")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("curl_cffi").setLevel(logging.WARNING)

    if args.reparse:
        manifest = reparse(args.out)
    else:
        payload = {}
        if args.payload:
            path = Path(args.payload)
            payload = json.loads(path.read_text() if path.is_file() else args.payload)
        try:
            manifest = crawl(payload, args.out)
        except ValueError as e:
            parser.error(str(e))
    print(json.dumps({k: v for k, v in manifest.items() if k != "problems"}, indent=2))
    if manifest.get("problems"):
        print(f"{len(manifest['problems'])} problems, see manifest.json", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
