"""Crawl ATS International Conference abstracts from the ATS d365 event portals.

The portals linked from https://site.thoracic.org/conference/program/past-program-itinerary
(ats2024.d365.events, ats2025..., ats2026...) are a Vue app over a public GraphQL API.
A guest token from /guest/token?domain=<portal> is enough to read every abstract: each
one is a "session" with activityType "Abstract", carrying its text, authors and the
parent session it is presented in. A whole year (~7,000 abstracts) takes ~15 requests,
so keywords are matched locally rather than through the portal's search.

Payload: see conference/common.py. "meeting" is not used (one meeting per year).

Usage:
    python conference/ats/ats.py '{"keywords": ["treprostinil"], "years": "all"}'
    python conference/ats/ats.py '{"years": 2025}' --out /tmp/ats

Output, in conference/ats/output/<keywords-slug>/:
    abstracts.jsonl  one record per abstract, schema in conference/common.py
    manifest.json    payload, per-year counts and record ids
"""

from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path
from typing import Iterator

from bs4 import BeautifulSoup

try:
    from .. import common
except ImportError:  # run as a script
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import common

GRAPHQL_URL = "https://aggregator.d365.events/graphqlb"
TOKEN_URL = "https://aggregator.d365.events/guest/token"
PORTAL = "ats{year}.d365.events"
FIRST_PORTAL_YEAR = 2024  # earlier meetings are not on d365
MEETING = "ATS International Conference"
PAGE_SIZE = 500
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output"

ABSTRACTS_QUERY = """
query Abstracts($first: Int, $offset: Int) {
  session(activityType: "Abstract", first: $first, offset: $offset, orderBy: [id_asc]) {
    uid id foreignId name descriptionHtml speakers startTime endTime customRef5
    categories { name domain }
    parentSession { uid name startTime endTime customRef5 categories { name domain } }
  }
}"""
COUNT_QUERY = '{ session(activityType: "Abstract", totalCount: true) { _count } }'

log = common.log


class AtsClient:
    def __init__(self, http: common.HttpClient | None = None):
        self.http = http or common.HttpClient(min_interval=0.3)
        self.tokens: dict[int, str | None] = {}

    def token(self, year: int) -> str | None:
        """Guest token for a year's portal, or None when that portal does not exist."""
        if year not in self.tokens:
            response = self.http.post(TOKEN_URL, params={"domain": PORTAL.format(year=year)})
            self.tokens[year] = response.json().get("token")
        return self.tokens[year]

    def query(self, year: int, query: str, variables: dict | None = None) -> dict:
        response = self.http.post(GRAPHQL_URL, json={"query": query, "variables": variables or {}},
                                  headers={"jwt-token": self.token(year)})
        body = response.json()
        if body.get("errors"):
            raise common.CrawlError(f"ATS GraphQL error for {year}: {body['errors'][0].get('message')}")
        return body["data"]


def discover(client: AtsClient) -> dict[int, dict]:
    sources = {}
    for year in range(FIRST_PORTAL_YEAR, date.today().year + 2):
        # Next year's portal can exist before any abstract is published.
        if client.token(year) and (count := client.query(year, COUNT_QUERY)["session"][0]["_count"]):
            sources[year] = {"meeting": MEETING, "url": f"https://{PORTAL.format(year=year)}/",
                             "count": count}
    return sources


def crawl_year(client: AtsClient, year: int, source: dict, options: dict, stats: dict,
               failed: list) -> Iterator[dict]:
    stats["listed"] = source["count"]
    offset = 0
    while True:
        page = client.query(year, ABSTRACTS_QUERY, {"first": PAGE_SIZE, "offset": offset})["session"]
        for session in page:
            yield parse_abstract(session, year)
        offset += len(page)
        if len(page) < PAGE_SIZE:
            break
    if offset != stats["listed"]:
        log.warning("ATS %d lists %d abstracts but %d were returned", year, stats["listed"], offset)


def crawl(payload: dict, output_dir: str | Path = DEFAULT_OUTPUT_DIR,
          client: AtsClient | None = None) -> dict:
    """Collect ATS abstracts for the payload and write abstracts.jsonl and manifest.json
    under output_dir/<keywords-slug>/. Returns the manifest."""
    client = client or AtsClient()
    return common.crawl_conference(
        "ATS", payload, Path(output_dir),
        discover=lambda options: discover(client),
        crawl_year=lambda *args: crawl_year(client, *args))


# --- parsing ---------------------------------------------------------------------------

POSTER_BOARD = re.compile(r"^\s*\(Poster Board\s*#\s*([^)]*)\)\s*", re.I)


def parse_abstract(session: dict, year: int) -> dict:
    title = session["name"] or ""
    board = POSTER_BOARD.match(title)
    if board:
        title = title[board.end():]
    categories = _categories(session)
    parent = session.get("parentSession") or {}
    parent_categories = _categories(parent)
    portal = PORTAL.format(year=year)
    return common.make_record(
        id=f"ats-{year}-{session['foreignId'] or session['uid']}",
        conference="ATS",
        meeting=MEETING,
        year=year,
        abstract_number=session.get("foreignId"),
        title=common.clean(title),
        abstract_sections=common.sections_from_html(session.get("descriptionHtml") or ""),
        authors=parse_speakers(session.get("speakers") or ""),
        category=common.strip_numbering(_first(categories, "TOPIC_THEME")),
        session={
            "title": common.clean(parent.get("name")),
            "type": _first(parent_categories, "SESSION_TYPE") or _first(categories, "SESSION_TYPE"),
            "start": session.get("startTime") or parent.get("startTime"),
            "end": session.get("endTime") or parent.get("endTime"),
            "location": common.clean(session.get("customRef5")) or common.clean(parent.get("customRef5")),
        },
        url=f"https://{portal}/directory/sessions/{session['uid']}",
        extra={
            "uid": session["uid"],
            "poster_board": common.clean(board.group(1)) if board else None,
            "abstract_type": _first(categories, "ABSTRACT_ACTIVITY"),
            "assemblies": parent_categories.get("ASSEMBLIES", []),
            "tracks": parent_categories.get("SESSION_TRACK", []),
            "session_uid": parent.get("uid"),
        },
    )


def _categories(session: dict) -> dict[str, list[str]]:
    by_domain: dict[str, list[str]] = {}
    for category in session.get("categories") or []:
        by_domain.setdefault(category.get("domain"), []).append(category.get("name"))
    return by_domain


def _first(categories: dict[str, list[str]], domain: str) -> str | None:
    values = categories.get(domain)
    return values[0] if values else None


def parse_speakers(html: str) -> list[dict]:
    """Parse '<b>C. A. Owen</b><sup>1</sup>, X. Zhou<sup>2</sup>; <br/><sup>1</sup>Dept, ...'
    into authors with their numbered affiliations. The bold author presents."""
    authors_html, _, affiliations_html = re.sub(r"<br\s*/?>", "<br>", html).partition("<br>")

    parts = re.split(r"<sup>\s*([^<]*?)\s*</sup>", affiliations_html)
    affiliations = {number: _text(text).rstrip(" ,.;")
                    for number, text in zip(parts[1::2], parts[2::2])}
    unnumbered = _text(parts[0]).rstrip(" ,.;") or None  # one shared affiliation, no numbers

    # Commas inside <sup>1,2</sup> are reference lists, not author separators.
    authors_html = re.sub(r"<sup>(.*?)</sup>", lambda m: "<sup>" + m.group(1).replace(",", "|") + "</sup>",
                          authors_html.strip().rstrip(";"))
    authors = []
    for chunk in authors_html.split(","):
        refs = [r.strip() for sup in re.findall(r"<sup>(.*?)</sup>", chunk) for r in sup.split("|")]
        name = _text(re.sub(r"<sup>.*?</sup>", "", chunk))
        if not name:
            continue
        names = [affiliations[r] for r in refs if r in affiliations]
        if not names and unnumbered:
            names = [unnumbered]
        authors.append({"name": name, "affiliations": names,
                        "presenting": bool(re.search(r"<(b|strong)\b", chunk))})
    return authors


def _text(html: str) -> str:
    return common.clean(BeautifulSoup(html, "html.parser").get_text(" ")) or ""


if __name__ == "__main__":
    sys.exit(common.main(crawl, "Crawl ATS International Conference abstracts.", DEFAULT_OUTPUT_DIR))
