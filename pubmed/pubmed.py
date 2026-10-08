"""Crawl PubMed articles matching a list of keywords through NCBI E-utilities.

Payload:
    {
        "keywords": ["trastuzumab deruxtecan", "Enhertu", "DS-8201"],
        "match": "any",                  # optional: "any" (OR, default) or "all" (AND)
        "field": "tiab",                 # optional: PubMed field tag, e.g. tiab, ti, mh, au
        "exact": false,                  # optional: search each keyword as an exact phrase
        "publication_types": ["Clinical Trial", "Review"],  # optional, OR-ed together
        "date_from": "2020-01-01",       # optional: YYYY, YYYY-MM or YYYY-MM-DD (publication date)
        "date_to": "2025-12-31",         # optional
        "max_results": 500,              # optional: default is every match
        "sort": "relevance"              # optional: "relevance" (default) or "pub_date"
    }

"keywords" is required and may be a single string. Each keyword is a PubMed search
term, so PubMed syntax such as "BRCA1[gene]" works. Without "field" or "exact",
keywords go through PubMed's automatic term mapping (MeSH and synonym expansion),
which gives the best recall. With "field", each keyword is quoted as a phrase and
searched only in that field.

ESearch returns at most 9,999 records per query, so larger result sets are split
into Entrez-date ranges (the day each record was added to PubMed) that each stay
under the limit.

Usage:
    python3 pubmed/pubmed.py '{"keywords": ["pembrolizumab", "Keytruda"], "max_results": 200}'
    python3 pubmed/pubmed.py payload.json --out /tmp/pubmed

    from pubmed.pubmed import crawl  # from the hackathon root
    manifest = crawl({"keywords": ["pembrolizumab"]})

Set NCBI_API_KEY to raise the rate limit from 3 to 10 requests/second, and
NCBI_EMAIL so NCBI can contact you about heavy usage instead of blocking you.

Output, in pubmed/output/<keywords-slug>/ by default:
    articles.jsonl  one parsed article per line (title, abstract, authors, journal,
                    dates, MeSH, keywords, publication types, DOI/PMC IDs, linked
                    ClinicalTrials.gov IDs, grants)
    manifest.json   payload, query, PubMed's query translation, counts and PMIDs
"""

from __future__ import annotations

import argparse
import calendar
import gzip
import http.client
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

API_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
ESEARCH_LIMIT = 9999  # ESearch refuses retstart >= 10,000 for PubMed
FETCH_BATCH = 200
MIN_REQUEST_INTERVAL = 0.34  # NCBI allows 3 requests/second without an API key
MIN_REQUEST_INTERVAL_WITH_KEY = 0.11  # and 10 with one
MAX_ATTEMPTS = 5
MAX_RETRY_DELAY = 120
TIMEOUT = 120
RETRY_STATUSES = {429, 500, 502, 503, 504}
TOOL_NAME = "pharmaedge-hackathon-pubmed-crawler"
USER_AGENT = TOOL_NAME + "/1.0"
EARLIEST_DATE = date(1900, 1, 1)  # before PubMed's first Entrez dates
SORTS = {"relevance": "relevance", "pub_date": "pub_date"}
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output"

log = logging.getLogger(__name__)


class PayloadError(ValueError):
    """The crawl payload is missing or malformed."""


class PubMedError(RuntimeError):
    """A PubMed request failed after all retries."""


class PubMedClient:
    """Small E-utilities client with gzip, NCBI rate limiting and retries."""

    def __init__(self, base_url: str = API_BASE_URL, timeout: float = TIMEOUT,
                 api_key: str | None = None, email: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.api_key = api_key if api_key is not None else os.environ.get("NCBI_API_KEY")
        self.email = email if email is not None else os.environ.get("NCBI_EMAIL")
        self.interval = MIN_REQUEST_INTERVAL_WITH_KEY if self.api_key else MIN_REQUEST_INTERVAL
        self._last_request = 0.0

    def post(self, endpoint: str, params: dict) -> bytes:
        """POST form parameters to an E-utility, so long queries never hit URL limits."""
        url = f"{self.base_url}/{endpoint}"
        params = {**params, "tool": TOOL_NAME}
        if self.api_key:
            params["api_key"] = self.api_key
        if self.email:
            params["email"] = self.email
        data = urllib.parse.urlencode(params).encode()
        request = urllib.request.Request(url, data=data, headers={
            "Accept-Encoding": "gzip",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
        })
        attempt = 0
        while True:
            attempt += 1
            self._pace()
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return _read_body(response)
            except urllib.error.HTTPError as e:
                if e.code not in RETRY_STATUSES or attempt == MAX_ATTEMPTS:
                    detail = _read_body(e).decode("utf-8", "replace")[:500]
                    raise PubMedError(f"POST {url} -> HTTP {e.code}: {detail}") from e
                delay = _retry_after(e) or 2 ** attempt
                reason = f"HTTP {e.code}"
            except (OSError, http.client.HTTPException, EOFError, zlib.error) as e:
                # Dropped connections, timeouts and truncated bodies are worth another try.
                if attempt == MAX_ATTEMPTS:
                    raise PubMedError(f"POST {url} failed: {e!r}") from e
                delay = 2 ** attempt
                reason = repr(e)
            log.warning("POST %s failed (%s); retry %d/%d in %ss",
                        url, reason, attempt, MAX_ATTEMPTS - 1, delay)
            time.sleep(delay)

    def esearch(self, query: str, *, retmax: int = 0, sort: str = "relevance",
                history: bool = False, entrez_range: tuple[date, date] | None = None) -> dict:
        params = {"db": "pubmed", "term": query, "retmode": "json",
                  "retmax": retmax, "sort": sort}
        if history:
            params["usehistory"] = "y"
        if entrez_range:
            params.update(datetype="edat", mindate=_ncbi_date(entrez_range[0]),
                          maxdate=_ncbi_date(entrez_range[1]))
        for attempt in range(1, MAX_ATTEMPTS + 1):
            body = self.post("esearch.fcgi", params)
            try:
                result = json.loads(body)["esearchresult"]
            except (json.JSONDecodeError, KeyError, TypeError):
                # NCBI occasionally answers 200 with an HTML or truncated error page.
                result = {"ERROR": body[:300].decode("utf-8", "replace")}
            if "ERROR" not in result:
                for kind in ("errorlist", "warninglist"):
                    notes = {k: v for k, v in (result.get(kind) or {}).items()
                             if v and v != ["No items found."]}
                    if notes:
                        log.warning("PubMed %s for %s: %s", kind, query, notes)
                return result
            if attempt < MAX_ATTEMPTS:
                log.warning("ESearch error (%s); retry %d/%d", result["ERROR"], attempt, MAX_ATTEMPTS - 1)
                time.sleep(2 ** attempt)
        raise PubMedError(f"ESearch failed for {query!r}: {result['ERROR']}")

    def efetch(self, webenv: str, query_key: str, retstart: int, retmax: int) -> ET.Element:
        params = {"db": "pubmed", "query_key": query_key, "WebEnv": webenv,
                  "retstart": retstart, "retmax": retmax, "retmode": "xml"}
        for attempt in range(1, MAX_ATTEMPTS + 1):
            body = self.post("efetch.fcgi", params)
            try:
                root = ET.fromstring(body)
                if root.tag == "PubmedArticleSet":
                    return root
                error = _text(root.find(".//ERROR")) or root.tag
            except ET.ParseError as e:
                error = repr(e)
            if attempt < MAX_ATTEMPTS:
                log.warning("EFetch error (%s); retry %d/%d", error, attempt, MAX_ATTEMPTS - 1)
                time.sleep(2 ** attempt)
        raise PubMedError(f"EFetch failed at retstart={retstart}: {error}")

    def _pace(self) -> None:
        wait = self._last_request + self.interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.monotonic()


def _read_body(response) -> bytes:
    body = response.read()
    if response.headers.get("Content-Encoding", "").lower() == "gzip":
        body = gzip.decompress(body)
    return body


def _retry_after(error: urllib.error.HTTPError) -> float | None:
    value = (error.headers or {}).get("Retry-After", "")
    return min(float(value), MAX_RETRY_DELAY) if value.isdigit() else None


# --- payload and query ---------------------------------------------------------------

def parse_payload(payload: dict) -> dict:
    """Validate the payload and return normalized search options."""
    if not isinstance(payload, dict):
        raise PayloadError("payload must be a JSON object")

    keywords = payload.get("keywords")
    if isinstance(keywords, str):
        keywords = [keywords]
    if not isinstance(keywords, list) or not all(isinstance(k, str) for k in keywords):
        raise PayloadError('payload needs "keywords": a string or a list of strings')
    cleaned, seen = [], set()
    for keyword in (" ".join(k.split()) for k in keywords):
        if keyword and keyword.casefold() not in seen:
            seen.add(keyword.casefold())
            cleaned.append(keyword)
    if not cleaned:
        raise PayloadError('"keywords" must contain at least one non-empty keyword')

    match = payload.get("match", "any")
    if match not in ("any", "all"):
        raise PayloadError('"match" must be "any" or "all"')

    field = payload.get("field")
    if field is not None and (not isinstance(field, str) or not re.fullmatch(r"[A-Za-z ]+", field)):
        raise PayloadError('"field" must be a PubMed field tag such as "tiab", "ti" or "mh"')

    types = payload.get("publication_types") or []
    if isinstance(types, str):
        types = [types]
    if not isinstance(types, list) or not all(isinstance(t, str) and t.strip() for t in types):
        raise PayloadError('"publication_types" must be a list of strings')

    max_results = payload.get("max_results")
    if max_results is not None and (isinstance(max_results, bool) or not isinstance(max_results, int)
                                    or max_results < 1):
        raise PayloadError('"max_results" must be a positive integer')

    sort = payload.get("sort", "relevance")
    if sort not in SORTS:
        raise PayloadError(f'"sort" must be one of {sorted(SORTS)}')

    date_from = _parse_date(payload.get("date_from"), "date_from", end=False)
    date_to = _parse_date(payload.get("date_to"), "date_to", end=True)
    if date_from and date_to and date_from > date_to:
        raise PayloadError('"date_from" is after "date_to"')

    return {
        "keywords": cleaned,
        "match": match,
        "field": field.strip() if field else None,
        "exact": bool(payload.get("exact", False)),
        "publication_types": [" ".join(t.replace('"', " ").split()) for t in types],
        "date_from": date_from,
        "date_to": date_to,
        "max_results": max_results,
        "sort": SORTS[sort],
    }


def _parse_date(value, name: str, end: bool) -> date | None:
    """Parse YYYY, YYYY-MM or YYYY-MM-DD ("/" also works); a partial date_to
    means the end of that year or month."""
    if value is None or value == "":
        return None
    match = re.fullmatch(r"(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?", str(value).strip())
    if not match:
        raise PayloadError(f'"{name}" must look like YYYY, YYYY-MM or YYYY-MM-DD')
    year, month, day = (int(g) if g else None for g in match.groups())
    try:
        if month is None:
            return date(year, 12, 31) if end else date(year, 1, 1)
        if day is None:
            return date(year, month, calendar.monthrange(year, month)[1] if end else 1)
        return date(year, month, day)
    except ValueError as e:
        raise PayloadError(f'"{name}" is not a valid date: {e}') from None


def build_query(options: dict) -> str:
    """Combine the keywords with OR/AND, then AND the publication-type and
    publication-date filters."""
    terms = []
    for keyword in options["keywords"]:
        if options["field"] or options["exact"]:
            # Quote the phrase: an unquoted "lung cancer[tiab]" would only tag "cancer".
            term = '"{}"'.format(keyword.replace('"', " ").strip())
            if options["field"]:
                term += f"[{options['field']}]"
        else:
            term = f"({keyword})"
        terms.append(term)
    query = f" {'OR' if options['match'] == 'any' else 'AND'} ".join(terms)
    if options["publication_types"]:
        types = " OR ".join(f'"{t}"[pt]' for t in options["publication_types"])
        query = f"({query}) AND ({types})"
    if options["date_from"] or options["date_to"]:
        start = _ncbi_date(options["date_from"]) if options["date_from"] else "1000/01/01"
        end = _ncbi_date(options["date_to"]) if options["date_to"] else "3000/12/31"
        query = f'({query}) AND ("{start}"[dp] : "{end}"[dp])'
    return query


# --- searching -----------------------------------------------------------------------

def plan_ranges(client: PubMedClient, query: str, start: date, end: date,
                sort: str) -> list[tuple[date, date, int]]:
    """Split [start, end] into Entrez-date ranges of at most ESEARCH_LIMIT matches
    each, newest range first. Entrez dates are exact days, unlike publication
    dates, where every year-only date falls on January 1."""
    count = int(client.esearch(query, sort=sort, entrez_range=(start, end))["count"])
    if count == 0:
        return []
    if count <= ESEARCH_LIMIT or start == end:
        if count > ESEARCH_LIMIT:
            log.warning("%d articles added to PubMed on %s; only the first %d can be fetched",
                        count, start, ESEARCH_LIMIT)
        return [(start, end, count)]
    middle = start + (end - start) // 2
    return (plan_ranges(client, query, middle + timedelta(days=1), end, sort)
            + plan_ranges(client, query, start, middle, sort))


def iter_articles(client: PubMedClient, query: str, sort: str, limit: int,
                  entrez_range: tuple[date, date] | None) -> Iterator[dict]:
    """Yield up to `limit` parsed articles for one ESearch, via the history server."""
    search = client.esearch(query, sort=sort, history=True, entrez_range=entrez_range)
    total = min(int(search["count"]), limit, ESEARCH_LIMIT)
    for retstart in range(0, total, FETCH_BATCH):
        root = client.efetch(search["webenv"], search["querykey"], retstart,
                             min(FETCH_BATCH, total - retstart))
        for element in root:
            if element.tag in ("PubmedArticle", "PubmedBookArticle"):
                yield parse_article(element)


def crawl(payload: dict, output_dir: str | Path = DEFAULT_OUTPUT_DIR,
          client: PubMedClient | None = None) -> dict:
    """Fetch every PubMed article for the payload's keywords, write articles.jsonl
    and manifest.json under output_dir/<keywords-slug>/, and return the manifest."""
    options = parse_payload(payload)
    query = build_query(options)
    client = client or PubMedClient()
    target = Path(output_dir) / _slugify(options["keywords"])
    target.mkdir(parents=True, exist_ok=True)
    articles_path = target / "articles.jsonl"
    partial_path = target / "articles.jsonl.part"

    crawled_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    probe = client.esearch(query, sort=options["sort"])
    total_count = int(probe["count"])
    wanted = min(total_count, options["max_results"] or total_count)
    log.info("PubMed has %d articles for %s (translated: %s); fetching %d",
             total_count, query, probe.get("querytranslation"), wanted)

    if wanted <= ESEARCH_LIMIT:
        ranges = [None]
    else:
        # A day of slack for NCBI's US time zone.
        planned = plan_ranges(client, query, EARLIEST_DATE, date.today() + timedelta(days=1),
                              options["sort"])
        log.info("Over %d results; split into %d Entrez-date ranges", ESEARCH_LIMIT, len(planned))
        ranges = [(s, e) for s, e, _ in planned]

    pmids, seen = [], set()
    try:
        with partial_path.open("w", encoding="utf-8") as out:
            for entrez_range in ranges:
                remaining = wanted - len(pmids)
                if remaining <= 0:
                    break
                for article in iter_articles(client, query, options["sort"], remaining, entrez_range):
                    if article["pmid"] in seen:  # a record moved between ranges mid-crawl
                        continue
                    seen.add(article["pmid"])
                    pmids.append(article["pmid"])
                    out.write(json.dumps(article, ensure_ascii=False) + "\n")
                    if len(pmids) % 1000 == 0:
                        log.info("%d/%d articles", len(pmids), wanted)
        os.replace(partial_path, articles_path)
    except BaseException:
        partial_path.unlink(missing_ok=True)  # leave the previous crawl's output intact
        raise

    if not pmids:
        log.warning("No articles matched %s; check the spelling or broaden the keywords", query)
    elif len(pmids) != wanted:
        log.warning("Expected %d articles but %d were fetched", wanted, len(pmids))

    manifest = {
        "source": "pubmed",
        "keywords": options["keywords"],
        "query": query,
        "query_translation": probe.get("querytranslation"),
        "options": {**options,
                    "date_from": options["date_from"] and options["date_from"].isoformat(),
                    "date_to": options["date_to"] and options["date_to"].isoformat()},
        "crawled_at": crawled_at,
        "total_count": total_count,
        "article_count": len(pmids),
        "articles_file": str(articles_path),
        "pmids": pmids,
        "payload": payload,
    }
    (target / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


# --- parsing PubMed XML --------------------------------------------------------------

def parse_article(element: ET.Element) -> dict:
    """Turn a <PubmedArticle> or <PubmedBookArticle> into a flat dict."""
    if element.tag == "PubmedBookArticle":
        citation = element.find("BookDocument")
        article = citation
        pubmed_data = element.find("PubmedBookData")
        book = citation.find("Book")
        title = _text(citation.find("ArticleTitle")) or _text(book.find("BookTitle"))
        journal = {"title": _text(book.find("BookTitle")),
                   "publisher": _text(book.find("Publisher/PublisherName"))}
        pub_date = _date(book.find("PubDate"))
        types = citation.findall("PublicationType")
    else:
        citation = element.find("MedlineCitation")
        article = citation.find("Article")
        pubmed_data = element.find("PubmedData")
        issue = article.find("Journal/JournalIssue")
        title = _text(article.find("ArticleTitle")) or _text(article.find("VernacularTitle"))
        journal = {
            "title": _text(article.find("Journal/Title")),
            "iso_abbreviation": _text(article.find("Journal/ISOAbbreviation")),
            "issn": _text(article.find("Journal/ISSN")),
            "volume": _text(issue.find("Volume")) if issue is not None else None,
            "issue": _text(issue.find("Issue")) if issue is not None else None,
            "pages": _text(article.find("Pagination/MedlinePgn")),
        }
        pub_date = _date(issue.find("PubDate")) if issue is not None else None
        types = article.findall("PublicationTypeList/PublicationType")

    pmid = _text(citation.find("PMID"))
    ids = {}
    if pubmed_data is not None:
        for article_id in pubmed_data.findall("ArticleIdList/ArticleId"):
            ids.setdefault(article_id.get("IdType", "unknown"), _text(article_id))
    for location in article.findall("ELocationID"):
        ids.setdefault(location.get("EIdType", "unknown"), _text(location))

    sections = [{"label": node.get("Label"), "category": node.get("NlmCategory"), "text": _text(node)}
                for node in article.findall("Abstract/AbstractText")]
    abstract = "\n\n".join(f"{s['label']}: {s['text']}" if s["label"] else s["text"]
                           for s in sections if s["text"]) or None

    databanks = {}
    for bank in article.findall("DataBankList/DataBank"):
        accessions = [_text(a) for a in bank.findall("AccessionNumberList/AccessionNumber")]
        databanks.setdefault(_text(bank.find("DataBankName")), []).extend(accessions)

    return {
        "pmid": pmid,
        "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        "title": title,
        "abstract": abstract,
        "abstract_sections": sections if len(sections) > 1 else [],
        "authors": [_author(a) for a in article.findall("AuthorList/Author")],
        "journal": journal,
        "pub_date": pub_date,
        "electronic_date": _date(article.find("ArticleDate[@DateType='Electronic']")),
        "pubmed_date": _date(pubmed_data.find("History/PubMedPubDate[@PubStatus='pubmed']"))
        if pubmed_data is not None else None,
        "publication_status": _text(pubmed_data.find("PublicationStatus")) if pubmed_data is not None else None,
        "language": [_text(lang) for lang in article.findall("Language")],
        "publication_types": [_text(t) for t in types],
        "doi": ids.get("doi"),
        "pmc_id": ids.get("pmc"),
        "article_ids": ids,
        "mesh_terms": [_mesh(m) for m in citation.findall("MeshHeadingList/MeshHeading")],
        "keywords": [_text(k) for k in citation.findall("KeywordList/Keyword") if _text(k)],
        "chemicals": [_text(c.find("NameOfSubstance")) for c in citation.findall("ChemicalList/Chemical")],
        "databanks": databanks,  # e.g. {"ClinicalTrials.gov": ["NCT01234567"]}
        "grants": [{"id": _text(g.find("GrantID")), "agency": _text(g.find("Agency")),
                    "country": _text(g.find("Country"))} for g in article.findall("GrantList/Grant")],
        "conflict_of_interest": _text(citation.find("CoiStatement")),
    }


def _author(node: ET.Element) -> dict:
    collective = _text(node.find("CollectiveName"))
    last, fore = _text(node.find("LastName")), _text(node.find("ForeName"))
    orcid = next((_text(i) for i in node.findall("Identifier") if i.get("Source") == "ORCID"), None)
    return {
        "name": collective or " ".join(p for p in (fore, last) if p),
        "last_name": last,
        "fore_name": fore,
        "initials": _text(node.find("Initials")),
        "collective": bool(collective),
        "orcid": orcid,
        "affiliations": [_text(a) for a in node.findall("AffiliationInfo/Affiliation")],
    }


def _mesh(node: ET.Element) -> dict:
    descriptor = node.find("DescriptorName")
    return {
        "descriptor": _text(descriptor),
        "ui": descriptor.get("UI") if descriptor is not None else None,
        "major": descriptor is not None and descriptor.get("MajorTopicYN") == "Y",
        "qualifiers": [_text(q) for q in node.findall("QualifierName")],
    }


MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}


def _date(node: ET.Element | None) -> str | None:
    """Return YYYY-MM-DD, YYYY-MM or YYYY, or PubMed's free-text MedlineDate
    (e.g. "2019 Nov-Dec") when the date has no structured parts."""
    if node is None:
        return None
    year = _text(node.find("Year"))
    if not year:
        return _text(node.find("MedlineDate"))
    month = _text(node.find("Month"))
    if month:
        month = MONTHS.get(month[:3].lower()) or (int(month) if month.isdigit() else None)
    day = _text(node.find("Day"))
    if not month:
        return year
    if not day or not day.isdigit():
        return f"{year}-{month:02d}"
    return f"{year}-{month:02d}-{int(day):02d}"


def _text(node: ET.Element | None) -> str | None:
    """All text inside an element, including inline markup like <i> and <sup>."""
    if node is None:
        return None
    return " ".join("".join(node.itertext()).split()) or None


def _ncbi_date(value: date) -> str:
    return value.strftime("%Y/%m/%d")


def _slugify(keywords: list[str]) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", "-".join(keywords).casefold()).strip("-")
    return slug[:80].rstrip("-") or "query"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crawl PubMed articles matching a list of keywords.")
    parser.add_argument("payload", help='JSON payload such as \'{"keywords": ["pembrolizumab"]}\', '
                                        "or a path to a JSON file")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT_DIR,
                        help="output root (default: %(default)s)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        payload = json.loads(args.payload)
    except json.JSONDecodeError:
        try:
            payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            parser.error(f"payload is neither JSON nor a readable JSON file: {e}")

    try:
        manifest = crawl(payload, args.out)
    except PayloadError as e:
        parser.error(str(e))
    except PubMedError as e:
        log.error("%s", e)
        return 1
    print(f"{manifest['article_count']} articles for {manifest['keywords']} -> {manifest['articles_file']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
