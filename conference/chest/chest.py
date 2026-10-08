"""Crawl CHEST meeting abstracts from journal.chestnet.org.

https://journal.chestnet.org/meetings links each meeting to a CHEST journal supplement
issue ("Browse the CHEST 2025 Annual Meeting Abstracts" -> /issue/S0012-3692(25)X0002-7).
The issue's table of contents lists every abstract, 50 per page, under topic headings
("Frontmatter" > "Allergy and Airway", "Cardiovascular Disease", ...). Each abstract's
full-text page has the session, presentation time, labelled abstract sections,
authors with affiliations, funding and disclosures.

The site sits behind Cloudflare; requests go through curl_cffi impersonating Chrome.
Its search and citation export do not expose abstract text, so keywords are matched
locally after every abstract page of a year is read (~4,000 pages for 2025, roughly
30 minutes with 6 workers). Parsed abstracts are cached in conference/chest/cache/, so
later runs for that year, with any keywords, take seconds.

Payload: see conference/common.py. "meeting" picks the series (default
"CHEST Annual Meeting"; also "CHEST Congress", "CHEST Regional Congress", ...).

Usage:
    python conference/chest/chest.py '{"keywords": ["treprostinil"], "years": 2025, "workers": 6}'

Output, in conference/chest/output/<keywords-slug>/ (abstracts.jsonl, manifest.json).
"""

from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterator
from urllib.parse import urljoin

from bs4 import BeautifulSoup

try:
    from .. import common
except ImportError:  # run as a script
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import common

BASE_URL = "https://journal.chestnet.org"
MEETINGS_URL = BASE_URL + "/meetings"
DEFAULT_MEETING = "CHEST Annual Meeting"
SKIP_SECTIONS = {"errata", "erratum", "corrigendum", "retraction", "retractions", "disclaimer"}
HERE = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = HERE / "output"
CACHE_DIR = HERE / "cache"

log = common.log


def discover(http: common.HttpClient, options: dict) -> dict[int, dict]:
    """Years of the requested meeting series -> supplement issue, from /meetings."""
    soup = BeautifulSoup(http.get(MEETINGS_URL).text, "lxml")
    series: dict[str, dict[int, dict]] = {}
    for link in soup.select("a[href*='/issue/']"):
        label = common.clean(link.get_text(" ")) or ""
        year = re.search(r"\b(?:19|20)\d{2}\b", label)
        if not label.lower().startswith("browse") or not year:
            continue
        congress = re.search(r"CHEST(?: \w+)? Congress", label)
        name = congress.group(0) if congress else DEFAULT_MEETING
        series.setdefault(name, {})[int(year.group(0))] = {
            "meeting": name, "url": urljoin(BASE_URL, link["href"]), "label": label}
    name = common.choose_meeting(options["meeting"] or DEFAULT_MEETING, series, "CHEST")
    return series[name]


def crawl_year(http: common.HttpClient, year: int, source: dict, options: dict, stats: dict,
               failed: list) -> Iterator[dict]:
    items = list_issue(http, source["url"])
    stats["listed"] = len(items)
    by_url = {item["url"]: item for item in items}
    yield from common.iter_cached(
        list(by_url), CACHE_DIR / f"{common.slug(source['meeting'])}-{year}.jsonl", options,
        lambda url: parse_abstract(http.get(url).text, by_url[url], year, source),
        failed, f"CHEST {year}")


def list_issue(http: common.HttpClient, issue_url: str) -> list[dict]:
    """Walk the issue's table of contents and return its abstracts with their topic."""
    items: dict[str, dict] = {}
    top = sub = None
    skipped = withdrawn = page = 0
    while True:
        soup = BeautifulSoup(http.get(issue_url, params={"pageStart": page}).text, "lxml")
        for node in soup.select("h2.toc__heading__header, h3.heading1, div.toc__item[data-pii]"):
            text = common.clean(node.get_text(" ")) if node.name != "div" else None
            if node.name == "h2":
                if text != top:  # each page repeats the heading it continues
                    top, sub = text, None
            elif node.name == "h3":
                sub = text
            else:
                link = node.select_one("h3.toc__item__title a[href]")
                pii = node["data-pii"]
                if link is None or pii in items:
                    continue
                title = common.clean(link.get_text(" "))
                if {(top or "").lower(), (sub or "").lower()} & SKIP_SECTIONS:
                    skipped += 1
                    continue
                if (title or "").upper() == "WITHDRAWN":
                    withdrawn += 1
                    continue
                items[pii] = {
                    "pii": pii,
                    "url": urljoin(BASE_URL, link["href"]),
                    "title": title,
                    "category": sub or (top if top and top.lower() != "frontmatter" else None),
                    "pages": common.clean(_text(node.select_one(".toc__item__pages"))),
                }
        page += 1
        if soup.select_one(".toc__pagination--next a[href]") is None:
            break
        if page % 20 == 0:
            log.info("CHEST: %d table-of-contents pages read, %d abstracts", page, len(items))
    log.info("CHEST: %d abstracts in %d table-of-contents pages (%d withdrawn and %d errata or "
             "front matter skipped)", len(items), page, withdrawn, skipped)
    return list(items.values())


def crawl(payload: dict, output_dir: str | Path = DEFAULT_OUTPUT_DIR,
          http: common.HttpClient | None = None) -> dict:
    """Collect CHEST abstracts for the payload and write abstracts.jsonl and manifest.json
    under output_dir/<keywords-slug>/. Returns the manifest."""
    http = http or common.HttpClient(min_interval=0.25)
    return common.crawl_conference(
        "CHEST", payload, Path(output_dir),
        discover=lambda options: discover(http, options),
        crawl_year=lambda *args: crawl_year(http, *args))


# --- parsing ---------------------------------------------------------------------------

SESSION_LABELS = {"SESSION TITLE": "title", "SESSION TYPE": "type"}
EXTRA_LABELS = {"FUNDING": "funding", "DISCLOSURE": "disclosures", "DISCLOSURES": "disclosures",
                "DISCLOSURE INFORMATION": "disclosures", "PRESENTED ON": "presented_on"}


def parse_abstract(html: str, item: dict, year: int, source: dict) -> dict:
    soup = BeautifulSoup(html, "lxml")
    meta = {}
    for tag in soup.find_all("meta", attrs={"name": True, "content": True}):
        meta.setdefault(tag["name"], []).append(common.clean(tag["content"]))
    title = (meta.get("citation_title") or [item["title"]])[0]
    body = soup.select_one("section#bodymatter")
    if body is None or not title:
        raise common.CrawlError(f"no abstract body on {item['url']}")
    for heading in body.find_all(["h2", "h3"]):
        if (common.clean(heading.get_text(" ")) or "").lower() == "abstract":
            heading.decompose()

    session, extra, sections = {}, {"pii": item["pii"]}, []
    for section in common.sections_from_html(body):
        label = section["label"]
        if label in SESSION_LABELS:
            session[SESSION_LABELS[label]] = section["text"]
        elif label in EXTRA_LABELS:
            extra[EXTRA_LABELS[label]] = section["text"]
        else:
            sections.append(section)
    session["start"], session["end"] = parse_presented_on(extra.get("presented_on"))
    if extra.get("disclosures"):
        extra["disclosures"] = disclosure_lines(body) or [extra["disclosures"]]

    authors = []
    for node in soup.select("div[property='author'][id]"):
        given = _text(node.select_one(".heading [property='givenName']"))
        family = _text(node.select_one(".heading [property='familyName']"))
        name = common.clean(f"{given or ''} {family or ''}")
        affiliations = [common.clean(a.get_text(" "))
                        for a in node.select("[property='affiliation'] [property='name']")]
        authors.append({"name": name, "affiliations": [a for a in affiliations if a]})
    if not authors:
        authors = [{"name": name} for name in meta.get("citation_author", [])]

    first, last = (meta.get("citation_firstpage") or [None])[0], (meta.get("citation_lastpage") or [None])[0]
    pages = "-".join(p for p in (first, last) if p) if first else item["pages"]
    pub_date = (meta.get("citation_date") or meta.get("citation_publication_date") or [None])[0]

    return common.make_record(
        id=f"chest-{year}-{item['pii']}",
        conference="CHEST",
        meeting=source["meeting"],
        year=year,
        title=title,
        abstract_sections=sections,
        authors=authors,
        category=item["category"],
        session=session,
        doi=(meta.get("citation_doi") or [None])[0],
        url=item["url"],
        publication={
            "journal": (meta.get("citation_journal_title") or ["CHEST"])[0],
            "volume": (meta.get("citation_volume") or [None])[0],
            "issue": (meta.get("citation_issue") or [None])[0],
            "pages": pages,
            "date": pub_date.replace("/", "-") if pub_date else None,
        },
        extra=extra,
    )


PRESENTED_FORMATS = [
    # "10/21/2025 01:45 pm - 02:30 pm"
    (re.compile(r"(\d{1,2}/\d{1,2}/\d{4})\s+(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)", re.I),
     "%m/%d/%Y %I:%M%p"),
    # "Tuesday, October 29, 2013 at 01:30 PM - 02:30 PM"
    (re.compile(r"([A-Z][a-z]+ \d{1,2}, \d{4}) at (\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)", re.I),
     "%B %d, %Y %I:%M%p"),
]


def parse_presented_on(text: str | None) -> tuple[str | None, str | None]:
    """ISO start and end from CHEST's "PRESENTED ON" line, when it has times."""
    for pattern, fmt in PRESENTED_FORMATS:
        match = pattern.search(text or "")
        if match:
            day, times = match.group(1), [t.replace(" ", "") for t in match.groups()[1:]]
            try:
                return tuple(datetime.strptime(f"{day} {t}", fmt).isoformat() for t in times)
            except ValueError:
                break
    return None, None


def disclosure_lines(body) -> list[str]:
    """The paragraphs under DISCLOSURES:, one relationship each."""
    lines, inside = [], False
    for paragraph in body.select("[role='paragraph']"):
        text = common.clean(paragraph.get_text(" ")) or ""
        label = re.match(r"([A-Z][A-Z /]+):\s*", text)
        if label and paragraph.find(["b", "strong"]):
            inside = label.group(1).startswith("DISCLOSURE")
            text = text[label.end():]
        if inside and text:
            lines.append(text)
    return lines


def _text(node) -> str | None:
    return common.clean(node.get_text(" ")) if node is not None else None


if __name__ == "__main__":
    sys.exit(common.main(crawl, "Crawl CHEST meeting abstracts.", DEFAULT_OUTPUT_DIR))
