"""Crawl ERS conference abstracts from publications.ersnet.org.

https://publications.ersnet.org/conference-abstracts links each meeting year to a
journal supplement (ERS Congress 2025 -> ERJ 66 suppl 69). The supplement page names
its issue id, and the site search filtered to that issue and to conference abstracts
lists every abstract, 100 per page. With keywords, the search's own "query" narrows
the list first; each abstract page then gives the full text, authors with
affiliations, DOI, topic and the session it was presented in.

The site sits behind Cloudflare; requests go through curl_cffi impersonating Chrome.

Payload: see conference/common.py. "meeting" picks the series from the listing page
(default "ERS Congress"; also "Lung Science Conference", "Sleep and Breathing
Conference", "Respiratory Failure and Mechanical Ventilation Conference", ...).

Usage:
    python conference/ers/ers.py '{"keywords": ["treprostinil"], "years": "2023-2025"}'
    python conference/ers/ers.py '{"years": 2025, "workers": 6}'   # every 2025 abstract

Output, in conference/ers/output/<keywords-slug>/ (abstracts.jsonl, manifest.json).
Parsed abstracts are cached in conference/ers/cache/ so reruns skip pages already read.
"""

from __future__ import annotations

import re
import sys
import time
from pathlib import Path
from typing import Iterator
from urllib.parse import urljoin

from bs4 import BeautifulSoup

try:
    from .. import common
except ImportError:  # run as a script
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import common

BASE_URL = "https://publications.ersnet.org"
LISTING_URL = BASE_URL + "/conference-abstracts"
SEARCH_URL = BASE_URL + "/search"
DEFAULT_MEETING = "ERS Congress"
PAGE_SIZE = 100
SEARCH_WORKERS = 3  # the search backend answers 503 when pushed harder
HERE = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = HERE / "output"
CACHE_DIR = HERE / "cache"

log = common.log


def discover(http: common.HttpClient, options: dict) -> dict[int, dict]:
    """Years of the requested meeting series -> supplement URL, from the listing page."""
    wanted = options["meeting"] or DEFAULT_MEETING
    soup = BeautifulSoup(http.get(LISTING_URL).text, "lxml")
    meetings = {}
    for heading in soup.find_all("h3"):
        table = heading.find_next_sibling()
        if table is None or table.name != "table":
            continue
        meetings[common.clean(heading.get_text(" "))] = {
            int(a.get_text(strip=True)): urljoin(BASE_URL, a["href"])
            for a in table.find_all("a", href=True) if re.fullmatch(r"\d{4}", a.get_text(strip=True))}
    name = common.choose_meeting(wanted, meetings, "ERS")
    return {year: {"meeting": name, "url": url} for year, url in meetings[name].items()}


def crawl_year(http: common.HttpClient, year: int, source: dict, options: dict, stats: dict,
               failed: list) -> Iterator[dict]:
    issue_page = http.get(source["url"]).text
    issue_ids = set(re.findall(r"parent_issue%3A(\d+)", issue_page))
    if len(issue_ids) != 1:
        raise common.CrawlError(f"expected one issue id on {source['url']}, found {issue_ids}")
    issue_id = issue_ids.pop()

    urls: dict[str, None] = {}  # ordered set
    for query in options["keywords"] or [None]:
        found, total = search(http, issue_id, query, options["workers"])
        log.info("ERS %d: %d abstracts listed%s", year, total, f" for {query!r}" if query else "")
        urls.update(dict.fromkeys(found))
    stats["listed"] = len(urls)

    yield from common.iter_cached(
        list(urls), CACHE_DIR / f"{common.slug(source['meeting'])}-{year}.jsonl", options,
        lambda url: parse_abstract(fetch_page(http, url), url, year, source), failed, f"ERS {year}")


def fetch_page(http: common.HttpClient, url: str) -> str:
    """Some responses come without the citation_* meta tags (affiliations, topic);
    a second request usually has them."""
    html = http.get(url).text
    if 'name="citation_title"' not in html:
        time.sleep(2)
        retry = http.get(url).text
        if 'name="citation_title"' in retry:
            return retry
    return html


def search(http: common.HttpClient, issue_id: str, query: str | None,
           workers: int) -> tuple[list[str], int]:
    """Every conference-abstract URL in an issue, optionally narrowed by a search query.
    Each results page takes the site ~20 s, so pages after the first load a few at a time."""
    params = [("f[0]", f"parent_issue:{issue_id}"),
              ("f[1]", "content_type_facet:periodical-meeting-report"),
              ("items_per_page", PAGE_SIZE), ("sort_by", "title_plain"), ("sort_order", "ASC")]
    if query:
        params.append(("query", query))

    def results_page(page: int) -> BeautifulSoup:
        return BeautifulSoup(http.get(SEARCH_URL, params=params + [("page", page)]).text, "lxml")

    def links(soup: BeautifulSoup) -> list[str]:
        return [urljoin(BASE_URL, a["href"]) for a in soup.select("div.results-item h3 a[href]")]

    first = results_page(0)
    count = first.select_one('[data-drupal-facet-item-id="content_types_reset"] .facet-item__count')
    total = int(count.get_text(strip=True).replace(",", "")) if count else 0
    urls = links(first)
    for page, result in common.fetch_all(range(1, -(-total // PAGE_SIZE)),
                                         lambda p: links(results_page(p)), min(workers, SEARCH_WORKERS)):
        if isinstance(result, Exception):
            raise common.CrawlError(f"ERS search page {page} for issue {issue_id} failed: {result}")
        urls.extend(result)
    urls = list(dict.fromkeys(urls))
    if len(urls) != total:
        log.warning("ERS search for issue %s%s listed %d abstracts but returned %d",
                    issue_id, f" and {query!r}" if query else "", total, len(urls))
    return urls, total


def crawl(payload: dict, output_dir: str | Path = DEFAULT_OUTPUT_DIR,
          http: common.HttpClient | None = None) -> dict:
    """Collect ERS abstracts for the payload and write abstracts.jsonl and manifest.json
    under output_dir/<keywords-slug>/. Returns the manifest."""
    http = http or common.HttpClient(min_interval=0.5)
    return common.crawl_conference(
        "ERS", payload, Path(output_dir),
        discover=lambda options: discover(http, options),
        crawl_year=lambda *args: crawl_year(http, *args))


# --- parsing ---------------------------------------------------------------------------

SESSION = re.compile(r"presented at the \d{4} .+?, in session\s*[“\"](.+?)[”\"]\s*\.", re.S)
# "European Respiratory Journal 2024 64(suppl 68): OA1870; DOI:"
CITATION = re.compile(r"^(?P<journal>.+?)\s+\d{4}\s+(?P<volume>\d+)\((?P<issue>[^)]*)\):\s*(?P<number>[\w-]+)")


def parse_abstract(html: str, url: str, year: int, source: dict) -> dict:
    """Parse an abstract page. The visible page is read first; the citation_* meta tags,
    which a few pages lack, add affiliations, topic and publication date."""
    soup = BeautifulSoup(html, "lxml")
    meta = _meta(soup)
    title_node = soup.select_one(".article__title .field--highwire-content-title")
    title = common.clean(title_node.get_text(" ")) if title_node else _one(meta, "citation_title")
    if not title:
        raise common.CrawlError(f"no abstract title on {url}")

    doi_link = soup.select_one(".journal-doi-info a[href*='doi.org/']")
    doi = _one(meta, "citation_doi") or (doi_link and doi_link.get("title"))
    label = soup.select_one(".journal-doi-info .doi-label")
    citation = CITATION.match(common.clean(label.get_text(" ")) or "") if label else None
    number = (citation and citation["number"]) or url.rstrip("/").rsplit("/", 1)[-1]
    number = number.upper()

    abstract = soup.select_one("div.abstract")
    if abstract is not None:
        for heading in abstract.select("h2.main-title"):
            heading.decompose()
    sections = common.sections_from_html(abstract if abstract is not None
                                         else _one(meta, "citation_abstract") or "")

    authors = []
    for name, content in meta["_ordered"]:
        if name == "citation_author":
            authors.append({"name": common.clean(content), "affiliations": []})
        elif name == "citation_author_institution" and authors:
            # "1Intensive care Department, ..." -> drop the affiliation's footnote number
            authors[-1]["affiliations"].append(common.clean(re.sub(r"^\d{1,3}(?=\D)", "", content)))
    if not authors:
        authors = [{"name": common.clean(a.get_text(" "))}
                   for a in soup.select(".article__authorname ul.author-orchid li")]

    session = SESSION.search(" ".join(soup.get_text(" ").split()))  # from the footnotes

    return common.make_record(
        id=record_id(source["meeting"], year, number),
        conference="ERS",
        meeting=source["meeting"],
        year=year,
        abstract_number=number,
        title=title,
        abstract_sections=sections,
        authors=authors,
        category=common.strip_numbering(_one(meta, "citation_section")),
        session={"title": common.clean(session.group(1)) if session else None},
        doi=doi,
        url=url,
        publication={
            "journal": _one(meta, "citation_journal_title") or (citation and citation["journal"]),
            "volume": _one(meta, "citation_volume") or (citation and citation["volume"]),
            "issue": _one(meta, "citation_issue") or (citation and citation["issue"]),
            "pages": number,
            "date": _one(meta, "citation_publication_date"),
        },
        extra={"article_type": _one(meta, "citation_article_type")},
    )


def record_id(meeting: str, year: int, number: str) -> str:
    """"ers-2025-PA4194" for the Congress; other ERS meetings reuse small numbers, so
    their ids name the meeting: "ers-sleep-and-breathing-conference-2025-32"."""
    if meeting == DEFAULT_MEETING:
        return f"ers-{year}-{number}"
    return f"ers-{common.slug(meeting.replace('ERS/ESRS', '').replace('ERS', ''))}-{year}-{number}"


def _meta(soup: BeautifulSoup) -> dict:
    meta: dict = {"_ordered": []}
    for tag in soup.find_all("meta", attrs={"name": True, "content": True}):
        meta.setdefault(tag["name"], []).append(tag["content"])
        meta["_ordered"].append((tag["name"], tag["content"]))
    return meta


def _one(meta: dict, name: str) -> str | None:
    values = meta.get(name)
    return common.clean(values[0]) if values else None


if __name__ == "__main__":
    sys.exit(common.main(crawl, "Crawl ERS conference abstracts.", DEFAULT_OUTPUT_DIR))
