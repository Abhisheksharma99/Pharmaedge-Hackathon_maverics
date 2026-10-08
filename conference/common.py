"""Shared pieces of the conference-abstract crawlers in ers/, ats/ and chest/.

Every crawler takes the same payload and writes records with the same schema, so
the three outputs can be concatenated or compared directly.

Payload:
    {
        "keywords": ["treprostinil", "Tyvaso"],  # optional: omit to collect every abstract
        "match": "any",                          # optional: "any" (default) or "all"
        "years": [2024, 2025],                   # optional: a year, a list, "2020-2025",
                                                 #   "latest" or "all" (default)
        "meeting": "ERS Congress",               # optional: which meeting series (see each crawler)
        "max_results": 100,                      # optional: stop after this many abstracts
        "refresh": false,                        # optional: re-download abstracts already cached
        "workers": 4                             # optional: parallel page downloads
    }

"asset_name" plus optional "aliases" works in place of "keywords", matching the
clinicalTrialgov payload. Keywords are matched case-insensitively as whole words in
each abstract's title and text; "-" and spaces are interchangeable, so
"ralinepag" also matches "Ralinepag-treated" but not "ralinepagx".

Record schema (one JSON object per line in abstracts.jsonl):
    id                 "<conference>-<year>-<abstract number or page id>"
    conference         "ERS" | "ATS" | "CHEST"
    meeting            e.g. "ERS Congress", "ATS International Conference", "CHEST Annual Meeting"
    year               int
    abstract_number    the conference's own number (ERS "PA4194", ATS "P6421"); null for CHEST
    title              str
    abstract           plain text, labelled sections joined as "LABEL: text" with blank lines
    abstract_sections  [{"label": "METHODS", "text": "..."}]  (label is null for unlabelled text)
    authors            [{"name", "affiliations": [str], "presenting": bool | null}]
    category           topic / track the abstract was filed under
    session            {"title", "type", "start", "end", "location"}  (ISO datetimes when known)
    doi                str | null
    url                page the record was parsed from
    publication        {"journal", "volume", "issue", "pages", "date"} | null
    matched_keywords   payload keywords found in the title or abstract
    extra              source-specific fields (poster board, disclosures, ...)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Iterator

from bs4 import BeautifulSoup, NavigableString, Tag
from curl_cffi import requests

MAX_ATTEMPTS = 5
MAX_RETRY_DELAY = 120
TIMEOUT = 90
RETRY_STATUSES = {403, 429, 500, 502, 503, 504}  # 403 is Cloudflare's challenge page
IMPERSONATE = "chrome"  # Cloudflare lets curl_cffi's Chrome TLS fingerprint through
DEFAULT_WORKERS = 4
RECORD_FIELDS = ("id", "conference", "meeting", "year", "abstract_number", "title", "abstract",
                 "abstract_sections", "authors", "category", "session", "doi", "url",
                 "publication", "matched_keywords", "extra")
SESSION_FIELDS = ("title", "type", "start", "end", "location")
PUBLICATION_FIELDS = ("journal", "volume", "issue", "pages", "date")

log = logging.getLogger("conference")


class PayloadError(ValueError):
    """The crawl payload is missing or malformed."""


class CrawlError(RuntimeError):
    """A request failed after all retries."""


# --- HTTP ------------------------------------------------------------------------------

class HttpClient:
    """curl_cffi client that looks like Chrome to Cloudflare, with a shared request
    pace across threads and retries on challenges, rate limits and server errors."""

    def __init__(self, min_interval: float = 0.5, timeout: float = TIMEOUT):
        self.min_interval = min_interval
        self.timeout = timeout
        self._local = threading.local()
        self._lock = threading.Lock()
        self._next_slot = 0.0

    @property
    def session(self) -> requests.Session:
        # One session per thread: curl handles are not thread-safe.
        if not hasattr(self._local, "session"):
            self._local.session = requests.Session(impersonate=IMPERSONATE)
        return self._local.session

    def get(self, url: str, **kwargs) -> requests.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> requests.Response:
        return self.request("POST", url, **kwargs)

    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        attempt = 0
        while True:
            attempt += 1
            self._pace()
            try:
                response = self.session.request(method, url, timeout=self.timeout, **kwargs)
            except requests.RequestsError as e:
                if attempt == MAX_ATTEMPTS:
                    raise CrawlError(f"{method} {url} failed: {e!r}") from e
                delay, reason = 2 ** attempt, repr(e)
            else:
                if response.status_code < 400 and not _is_challenge(response):
                    return response
                if response.status_code not in RETRY_STATUSES or attempt == MAX_ATTEMPTS:
                    raise CrawlError(f"{method} {url} -> HTTP {response.status_code}"
                                     + (" (Cloudflare challenge)" if _is_challenge(response) else ""))
                delay = _retry_after(response) or 5 * 2 ** attempt
                reason = f"HTTP {response.status_code}"
                if _is_challenge(response):
                    reason += " Cloudflare challenge"
                    self._local.session = requests.Session(impersonate=IMPERSONATE)
            log.warning("%s %s failed (%s); retry %d/%d in %ss",
                        method, url, reason, attempt, MAX_ATTEMPTS - 1, delay)
            time.sleep(delay)

    def _pace(self) -> None:
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next_slot)
            self._next_slot = slot + self.min_interval
        if slot > now:
            time.sleep(slot - now)


def _is_challenge(response: requests.Response) -> bool:
    return (response.status_code in (403, 503)
            and "<title>Just a moment...</title>" in response.text[:3000])


def _retry_after(response: requests.Response) -> float | None:
    value = response.headers.get("Retry-After", "")
    return min(float(value), MAX_RETRY_DELAY) if value.isdigit() else None


def fetch_all(items: list, fetch: Callable, workers: int) -> Iterable[tuple[object, object]]:
    """Yield (item, fetch(item)) in input order, or (item, error) when it fails, so one
    unreachable or oddly formatted page does not abort a long crawl."""
    def run(item):
        try:
            return item, fetch(item)
        except CrawlError as e:
            return item, e
        except Exception as e:  # a parser surprise on one page
            log.exception("could not parse %s", item)
            return item, CrawlError(f"parse error: {e!r}")
    if workers <= 1:
        yield from map(run, items)
        return
    pool = ThreadPoolExecutor(workers)
    try:
        yield from pool.map(run, items)
    finally:
        # Reached max_results or interrupted: drop the downloads not started yet.
        pool.shutdown(wait=True, cancel_futures=True)


# --- payload ---------------------------------------------------------------------------

def parse_payload(payload: dict) -> dict:
    """Validate the payload and return normalized options."""
    if not isinstance(payload, dict):
        raise PayloadError("payload must be a JSON object")

    if "keywords" in payload:
        keywords = payload["keywords"]
    elif "asset_name" in payload:
        aliases = payload.get("aliases") or []
        keywords = [payload["asset_name"], *([aliases] if isinstance(aliases, str) else aliases)]
    else:
        keywords = []
    if isinstance(keywords, str):
        keywords = [keywords]
    if not isinstance(keywords, list) or not all(isinstance(k, str) for k in keywords):
        raise PayloadError('"keywords" must be a string or a list of strings')
    cleaned, seen = [], set()
    for keyword in (" ".join(k.split()) for k in keywords):
        if keyword and keyword.casefold() not in seen:
            seen.add(keyword.casefold())
            cleaned.append(keyword)

    match = payload.get("match", "any")
    if match not in ("any", "all"):
        raise PayloadError('"match" must be "any" or "all"')

    max_results = payload.get("max_results")
    if max_results is not None and (isinstance(max_results, bool) or not isinstance(max_results, int)
                                    or max_results < 1):
        raise PayloadError('"max_results" must be a positive integer')

    workers = payload.get("workers", DEFAULT_WORKERS)
    if isinstance(workers, bool) or not isinstance(workers, int) or not 1 <= workers <= 16:
        raise PayloadError('"workers" must be an integer from 1 to 16')

    meeting = payload.get("meeting")
    if meeting is not None and (not isinstance(meeting, str) or not meeting.strip()):
        raise PayloadError('"meeting" must be a non-empty string')

    return {
        "keywords": cleaned,
        "match": match,
        "years": _parse_years(payload.get("years", payload.get("year", "all"))),
        "meeting": meeting.strip() if meeting else None,
        "max_results": max_results,
        "refresh": bool(payload.get("refresh", False)),
        "workers": workers,
    }


def _parse_years(value) -> list[int] | str:
    if value in ("all", "latest"):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return [value]
    if isinstance(value, str):
        match = re.fullmatch(r"\s*(\d{4})\s*(?:-\s*(\d{4})\s*)?", value)
        if match:
            start, end = int(match.group(1)), int(match.group(2) or match.group(1))
            if start <= end:
                return list(range(start, end + 1))
    if isinstance(value, list) and value and all(isinstance(y, int) and not isinstance(y, bool)
                                                 for y in value):
        return sorted(set(value))
    raise PayloadError('"years" must be a year, a list of years, "YYYY-YYYY", "all" or "latest"')


def resolve_years(requested: list[int] | str, available: Iterable[int], conference: str) -> list[int]:
    """Turn the payload's years into the years this conference has, newest first."""
    available = sorted(set(available), reverse=True)
    if not available:
        raise CrawlError(f"found no {conference} years to crawl")
    if requested == "latest":
        return available[:1]
    if requested == "all":
        return available
    missing = [y for y in requested if y not in available]
    if missing:
        raise PayloadError(f"{conference} has no abstracts for {missing}; "
                           f"available years: {sorted(available)}")
    return sorted(requested, reverse=True)


def choose_meeting(wanted: str, names: Iterable[str], conference: str) -> str:
    """The one meeting series named exactly by "meeting", or else the one containing it."""
    names = sorted(set(names))
    chosen = ([n for n in names if _fold(n) == _fold(wanted)]
              or [n for n in names if _fold(wanted) in _fold(n)])
    if len(chosen) != 1:
        raise PayloadError(f'"meeting" {wanted!r} matches {chosen or "nothing"}; '
                           f"{conference} meetings: {names}")
    return chosen[0]


# --- keyword matching ------------------------------------------------------------------

def _fold(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


def compile_keywords(keywords: list[str]) -> list[tuple[str, re.Pattern]]:
    patterns = []
    for keyword in keywords:
        parts = [re.escape(p) for p in re.split(r"[\s\-‐-―]+", _fold(keyword)) if p]
        body = r"[\s\-‐-―]+".join(parts)
        patterns.append((keyword, re.compile(rf"(?<!\w){body}(?!\w)")))
    return patterns


def matched_keywords(record: dict, patterns: list[tuple[str, re.Pattern]]) -> list[str]:
    text = _fold(" ".join(filter(None, (record.get("title"), record.get("abstract")))))
    return [keyword for keyword, pattern in patterns if pattern.search(text)]


def is_match(found: list[str], options: dict) -> bool:
    if not options["keywords"]:
        return True
    if options["match"] == "all":
        return len(found) == len(options["keywords"])
    return bool(found)


# --- records ---------------------------------------------------------------------------

def make_record(**fields) -> dict:
    """Build a record with every schema field present, in schema order."""
    unknown = set(fields) - set(RECORD_FIELDS)
    if unknown:
        raise ValueError(f"unknown record fields: {sorted(unknown)}")
    record = {name: fields.get(name) for name in RECORD_FIELDS}
    record["abstract_sections"] = [s for s in record["abstract_sections"] or [] if s.get("text")]
    if record["abstract"] is None:
        record["abstract"] = join_sections(record["abstract_sections"])
    record["authors"] = [{"name": a["name"], "affiliations": a.get("affiliations") or [],
                          "presenting": a.get("presenting")}
                         for a in record["authors"] or [] if a.get("name")]
    session = record["session"] or {}
    record["session"] = {name: session.get(name) or None for name in SESSION_FIELDS}
    if record["publication"] is not None:
        record["publication"] = {name: record["publication"].get(name) or None
                                 for name in PUBLICATION_FIELDS}
    record["matched_keywords"] = record["matched_keywords"] or []
    record["extra"] = record["extra"] or {}
    return record


def clean(text: str | None) -> str | None:
    """Collapse whitespace; None for empty strings."""
    if text is None:
        return None
    return " ".join(text.split()) or None


def strip_numbering(text: str | None) -> str | None:
    """'12. Diffuse Lung Disease' or '5.2 Monitoring' -> the name alone."""
    return clean(re.sub(r"^\s*\d+(?:\.\d+)*\.?\s+", "", text)) if text else None


BOLD_TAGS = {"b", "strong", "bold"}
BLOCK_TAGS = {"p", "div", "br", "li", "section"}
LABEL_LIKE = re.compile(r"[A-Z][A-Za-z0-9 ,/&()'\-]{0,60}")
# Headings that also count when typed as plain text ("Rationale: ...", "RESULTS The ...").
KNOWN_LABELS = (
    r"rationale|background|introduction|intro|hypothesis|objectives?|aims?(?: and objectives)?|"
    r"purpose|(?:materials? and )?methods?|study design|design|setting|patients|participants|"
    r"measurements(?: and main results)?|main results|results?|findings|conclusions?|"
    r"discussion|case(?: presentation| description| report| summary)?|history|summary|"
    r"significance|clinical implications|funding|disclosures?")
TEXT_LABEL = re.compile(
    rf"(?:^[ \t]*|(?<=[.!?)\]] ))(?P<open>\[)?(?P<label>{KNOWN_LABELS})"
    r"(?(open)\]\s*|(?:(?P<colon>\s*:\s*)|(?P<space>[ \t]+|[ \t]*$)))", re.I | re.M)
KNOWN_LABEL = re.compile(KNOWN_LABELS, re.I)
MARK = "\x00"  # wraps a section label inside the flattened text


def sections_from_html(html: str | Tag) -> list[dict]:
    """Split abstract HTML into labelled sections.

    A label is a bold run ending in a colon (or followed by one), e.g. ATS
    "<b>RATIONALE:</b>", ERS "<bold>Background:</bold>", CHEST "<b>PURPOSE:</b>"; a bold
    standard heading ("<b>Rationale </b>"); or a standard heading typed as text at the
    start of a paragraph or sentence: "Introduction:", "[Rationale]", "Results<br>", or
    "RESULTS " in capitals. Labels are upper-cased.
    """
    root = BeautifulSoup(html, "lxml") if isinstance(html, str) else html
    parts: list[str] = []

    def walk(node):
        for child in node.children:
            if isinstance(child, NavigableString):
                if type(child) is NavigableString:  # skip comments, CDATA
                    parts.append(str(child))
            elif isinstance(child, Tag) and child.name not in ("script", "style"):
                bold = clean(child.get_text(" ")) or "" if child.name in BOLD_TAGS else ""
                name = bold[:-1].strip() if bold.endswith(":") else bold
                if name and LABEL_LIKE.fullmatch(name):
                    if bold.endswith(":") or KNOWN_LABEL.fullmatch(name):
                        parts.append(f"\n{MARK}{name}{MARK}")
                    else:
                        parts.append(f"\n{MARK}?{name}{MARK}")  # a label only if a colon follows
                    continue
                if child.name in BLOCK_TAGS:
                    parts.append("\n")
                walk(child)
                if child.name in BLOCK_TAGS:
                    parts.append("\n")

    walk(root)
    text = "".join(parts)
    text = re.sub(rf"{MARK}\?([^{MARK}]*){MARK}(\s*:)?",
                  lambda m: f"{MARK}{m.group(1)}{MARK}" if m.group(2) else m.group(1), text)
    text = TEXT_LABEL.sub(_mark_text_label, text)

    chunks = re.split(rf"{MARK}([^{MARK}]*){MARK}", text)
    sections = [(None, chunks[0])] + list(zip(chunks[1::2], chunks[2::2]))
    result = []
    for label, body in sections:
        body = re.sub(r"^[\s:]+", "", " ".join(body.split()))
        label = clean(label.strip(" :[]").upper()) if label else None
        if body or label:
            result.append({"label": label, "text": body or None})
    return result


def _mark_text_label(match: re.Match) -> str:
    label, end = match.group("label"), match.string[match.end():match.end() + 1]
    if match.group("space") is not None:
        # Without a colon or brackets, a heading is alone on its line, "RESULTS The ...",
        # or a paragraph opening with "Results The ..."; "... trial. Results were" is not.
        at_line_start = match.string[match.start() - 1:match.start()] in ("", "\n")
        alone = at_line_start and end in ("", "\n")
        capital_next = end.isupper() or end.isdigit()
        if not alone and not (capital_next and (label.isupper() or at_line_start)):
            return match.group(0)
    return f"\n{MARK}{label}{MARK}"


def join_sections(sections: list[dict]) -> str | None:
    return "\n\n".join(f"{s['label']}: {s['text']}" if s["label"] else s["text"]
                       for s in sections if s.get("text")) or None


# --- cache -----------------------------------------------------------------------------

class AbstractCache:
    """Parsed abstracts for one conference year, appended to cache/<name>.jsonl as they
    are fetched. A rerun, a different keyword list or an interrupted crawl reuses them
    instead of downloading every page again."""

    def __init__(self, path: Path, refresh: bool = False):
        self.path = path
        self.records: dict[str, dict] = {}
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        if refresh:
            path.unlink(missing_ok=True)
        elif path.exists():
            with path.open(encoding="utf-8") as f:
                for line in f:
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:  # a line cut short by a killed crawl
                        continue
                    self.records[record["url"]] = record
        self._file = path.open("a", encoding="utf-8")

    def get(self, url: str) -> dict | None:
        return self.records.get(url)

    def add(self, record: dict) -> None:
        with self._lock:
            self.records[record["url"]] = record
            self._file.write(json.dumps(record, ensure_ascii=False) + "\n")
            self._file.flush()

    def close(self) -> None:
        self._file.close()


def iter_cached(urls: list[str], cache_path: Path, options: dict, fetch: Callable[[str], dict],
                failed: list, label: str) -> Iterator[dict]:
    """Yield the record for each URL in order, from the cache or by fetch(url) in
    parallel; each fetched record is cached at once, so an interrupted crawl resumes."""
    cache = AbstractCache(cache_path, options["refresh"])
    todo = [url for url in urls if cache.get(url) is None]
    if todo:
        log.info("%s: fetching %d abstract pages (%d cached)", label, len(todo), len(urls) - len(todo))
    fetched = fetch_all(todo, fetch, options["workers"])
    done = 0
    try:
        for url in urls:
            record = cache.get(url)
            if record is None:
                _, result = next(fetched)
                done += 1
                if done % 250 == 0:
                    log.info("%s: %d/%d pages fetched", label, done, len(todo))
                if isinstance(result, Exception):
                    failed.append({"url": url, "error": str(result)})
                    continue
                cache.add(result)
                record = result
            yield record
    finally:
        fetched.close()
        cache.close()


# --- output ----------------------------------------------------------------------------

def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-")[:80].rstrip("-")


def slugify(options: dict) -> str:
    return slug("-".join(options["keywords"])) or "all-abstracts"


def write_output(conference: str, output_dir: Path, options: dict, payload: dict,
                 years: dict, records: list[dict], failed: list[dict], crawled_at: str) -> dict:
    """Write abstracts.jsonl and manifest.json under output_dir/<keywords-slug>/."""
    target = Path(output_dir) / slugify(options)
    target.mkdir(parents=True, exist_ok=True)
    abstracts_path = target / "abstracts.jsonl"
    partial_path = target / "abstracts.jsonl.part"
    try:
        with partial_path.open("w", encoding="utf-8") as out:
            for record in records:
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
        os.replace(partial_path, abstracts_path)
    except BaseException:
        partial_path.unlink(missing_ok=True)
        raise

    manifest = {
        "source": "conference",
        "conference": conference,
        "keywords": options["keywords"],
        "options": options,
        "crawled_at": crawled_at,
        "years": years,
        "abstract_count": len(records),
        "abstracts_file": str(abstracts_path),
        "failed": failed,
        "ids": [r["id"] for r in records],
        "payload": payload,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False),
                                          encoding="utf-8")
    return manifest


def crawl_conference(conference: str, payload: dict, output_dir: Path,
                     discover: Callable[[dict], dict[int, dict]],
                     crawl_year: Callable[..., Iterator[dict]]) -> dict:
    """Run one conference crawl: resolve years, pull each year's records from
    crawl_year, keep the ones matching the keywords, then write the output.

    discover(options) returns {year: {"meeting": ..., "url": ..., ...}}.
    crawl_year(year, source, options, stats, failed) yields parsed records; it sets
    stats["listed"] and appends {"url", "error"} to failed for pages it could not get.
    """
    options = parse_payload(payload)
    crawled_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    sources = discover(options)
    years = resolve_years(options["years"], sources, conference)
    patterns = compile_keywords(options["keywords"])
    log.info("%s: crawling %s for %s", conference, years, options["keywords"] or "every abstract")

    records, failed, year_stats, seen = [], [], {}, set()
    limit = options["max_results"]
    for year in years:
        source = sources[year]
        stats = year_stats[year] = {"meeting": source["meeting"], "source_url": source["url"],
                                    "listed": None, "scanned": 0, "matched": 0, "failed": 0}
        failed_before = len(failed)
        year_records = crawl_year(year, source, options, stats, failed)
        try:
            for record in year_records:
                stats["scanned"] += 1
                record["matched_keywords"] = matched_keywords(record, patterns)
                if record["id"] in seen or not is_match(record["matched_keywords"], options):
                    continue
                seen.add(record["id"])
                records.append(record)
                stats["matched"] += 1
                if limit and len(records) >= limit:
                    break
        finally:
            year_records.close()
        stats["failed"] = len(failed) - failed_before
        log.info("%s %d: %s listed, %d scanned, %d kept, %d failed", conference, year,
                 stats["listed"], stats["scanned"], stats["matched"], stats["failed"])
        if limit and len(records) >= limit:
            break

    if failed:
        log.warning("%d pages could not be fetched; they are listed under 'failed' in the manifest",
                    len(failed))
    return write_output(conference, output_dir, options, payload, year_stats, records, failed,
                        crawled_at)


def main(crawl: Callable[[dict, Path], dict], description: str, default_output: Path,
         argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("payload", nargs="?", default="{}",
                        help='JSON payload such as \'{"keywords": ["treprostinil"], "years": 2025}\', '
                             "or a path to a JSON file (default: every abstract of every year)")
    parser.add_argument("--out", type=Path, default=default_output,
                        help="output root (default: %(default)s)")
    parser.add_argument("-v", "--verbose", action="store_true", help="log every request retry and page")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("curl_cffi").setLevel(logging.WARNING)

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
    except CrawlError as e:
        log.error("%s", e)
        return 1
    print(f"{manifest['abstract_count']} {manifest['conference']} abstracts "
          f"({', '.join(map(str, manifest['years']))}) -> {manifest['abstracts_file']}")
    if manifest["failed"]:
        print(f"{len(manifest['failed'])} pages failed; see 'failed' in the manifest", file=sys.stderr)
    return 0
