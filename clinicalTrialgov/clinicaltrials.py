"""Crawl every ClinicalTrials.gov study for a drug asset through the public API v2.

Payload:
    {"asset_name": "trastuzumab deruxtecan", "aliases": ["Enhertu", "DS-8201", "T-DXd"]}

"asset_name" is required and "aliases" is optional. Each name is searched as an exact
phrase in the intervention fields (intervention names and other names, arm groups,
titles, keywords, intervention MeSH terms) and the names are OR-ed together.
ClinicalTrials.gov resolves some synonyms itself (Keytruda and MK-3475 find the same
trials as pembrolizumab) but not all (Enhertu, DS-8201 and T-DXd each find different
trials), so pass brand, generic and code names as aliases.

Add "search_in": "all_fields" to search every text field (query.term) instead. That
also returns trials of other drugs that only mention the asset, e.g. as a prior
therapy in their summary or eligibility criteria.

ClinicalTrials.gov does not correct spelling, so a misspelled name matches nothing
in any field. When nothing matches, the manifest lists spellings suggested by NLM
RxNorm (Tresprostinol -> treprostinil).

Every matching study is saved in full, exactly as the API returns it: protocol,
results, documents, annotations and derived MeSH data.

Usage:
    python3 clinicalTrialgov/clinicaltrials.py '{"asset_name": "Keytruda"}'
    python3 clinicalTrialgov/clinicaltrials.py payload.json --out /tmp/ct

    from clinicalTrialgov.clinicaltrials import crawl  # from the hackathon root
    manifest = crawl({"asset_name": "Keytruda"})

Output, in clinicalTrialgov/output/<asset-slug>/ by default:
    studies.jsonl   one full study record per line
    manifest.json   payload, query, API data timestamp, counts, NCT IDs and spelling suggestions
"""

from __future__ import annotations

import argparse
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
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

API_BASE_URL = "https://clinicaltrials.gov/api/v2"
PAGE_SIZE = 200  # the API allows 1000, but full records average ~50 KB each
MIN_REQUEST_INTERVAL = 1.2  # seconds; stays under the ~50 requests/minute per IP commonly cited for the API
MAX_ATTEMPTS = 5
MAX_RETRY_DELAY = 120
TIMEOUT = 120
RETRY_STATUSES = {429, 500, 502, 503, 504}
USER_AGENT = "pharmaedge-hackathon-ct-crawler/1.0"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output"
SEARCH_PARAMS = {"interventions": "query.intr", "all_fields": "query.term"}
RXNAV_SPELLING_URL = "https://rxnav.nlm.nih.gov/REST/spellingsuggestions.json"

log = logging.getLogger(__name__)


class PayloadError(ValueError):
    """The crawl payload is missing or malformed."""


class ClinicalTrialsError(RuntimeError):
    """A ClinicalTrials.gov request failed after all retries."""


class ClinicalTrialsClient:
    """Small ClinicalTrials.gov API v2 client with gzip, request pacing and retries."""

    def __init__(self, base_url: str = API_BASE_URL, timeout: float = TIMEOUT):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._last_request = 0.0

    def get(self, path: str, params: dict | None = None) -> dict:
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "User-Agent": USER_AGENT,
        })
        attempt = 0
        while True:
            attempt += 1
            self._pace()
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(_read_body(response))
            except urllib.error.HTTPError as e:
                if e.code not in RETRY_STATUSES or attempt == MAX_ATTEMPTS:
                    detail = _read_body(e).decode("utf-8", "replace")[:500]
                    raise ClinicalTrialsError(f"GET {url} -> HTTP {e.code}: {detail}") from e
                delay = _retry_after(e) or 2 ** attempt
                reason = f"HTTP {e.code}"
            except (OSError, http.client.HTTPException, EOFError, zlib.error, json.JSONDecodeError) as e:
                # Dropped connections, timeouts and truncated bodies are worth another try.
                if attempt == MAX_ATTEMPTS:
                    raise ClinicalTrialsError(f"GET {url} failed: {e!r}") from e
                delay = 2 ** attempt
                reason = repr(e)
            log.warning("GET %s failed (%s); retry %d/%d in %ss",
                        url, reason, attempt, MAX_ATTEMPTS - 1, delay)
            time.sleep(delay)

    def _pace(self) -> None:
        wait = self._last_request + MIN_REQUEST_INTERVAL - time.monotonic()
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


def parse_payload(payload: dict) -> tuple[list[str], str]:
    """Return the names to search (asset_name first, then aliases, cleaned and
    de-duplicated) and the search_in scope."""
    if not isinstance(payload, dict):
        raise PayloadError("payload must be a JSON object")
    asset_name = payload.get("asset_name")
    aliases = payload.get("aliases") or []
    search_in = payload.get("search_in") or "interventions"
    if not isinstance(asset_name, str) or not _clean_name(asset_name):
        raise PayloadError('payload needs a non-empty "asset_name" string')
    if not isinstance(aliases, list) or not all(isinstance(a, str) for a in aliases):
        raise PayloadError('"aliases" must be a list of strings')
    if not isinstance(search_in, str) or search_in not in SEARCH_PARAMS:
        raise PayloadError(f'"search_in" must be one of: {", ".join(SEARCH_PARAMS)}')

    names, seen = [], set()
    for name in map(_clean_name, [asset_name, *aliases]):
        if name and name.casefold() not in seen:
            seen.add(name.casefold())
            names.append(name)
    return names, search_in


def _clean_name(name: str) -> str:
    # A double quote would end the search phrase early.
    return " ".join(name.replace('"', " ").split())


def build_query(names: list[str]) -> str:
    """OR the names together, each quoted as a phrase so brackets, parentheses or
    AND/OR/NOT inside a name are not parsed as search syntax ([177Lu]Lu-PSMA-617
    is an HTTP 400 unquoted). Quoting keeps the API's synonym expansion."""
    return " OR ".join(f'"{name}"' for name in names)


def spelling_suggestions(names: list[str]) -> list[str]:
    """Drug-name spellings NLM RxNorm suggests for the names (Tresprostinol ->
    treprostinil). Best effort: stops quietly if RxNav is unreachable."""
    seen = {name.casefold() for name in names}
    suggestions = []
    for name in names:
        url = RXNAV_SPELLING_URL + "?" + urllib.parse.urlencode({"name": name})
        request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.load(response)
        except (OSError, http.client.HTTPException, json.JSONDecodeError) as e:
            log.warning("RxNorm spelling suggestions unavailable: %r", e)
            break
        suggestion_list = (data.get("suggestionGroup") or {}).get("suggestionList") or {}
        for suggestion in suggestion_list.get("suggestion") or []:
            if suggestion.casefold() not in seen:
                seen.add(suggestion.casefold())
                suggestions.append(suggestion)
    return suggestions


def iter_pages(client: ClinicalTrialsClient, query: str, search_param: str = "query.intr",
               page_size: int = PAGE_SIZE) -> Iterator[dict]:
    """Yield raw /studies pages for a search, following nextPageToken."""
    params = {search_param: query, "pageSize": page_size, "countTotal": "true"}
    while True:
        page = client.get("/studies", params)
        yield page
        token = page.get("nextPageToken")
        if not token:
            return
        params["pageToken"] = token


def crawl(payload: dict, output_dir: str | Path = DEFAULT_OUTPUT_DIR,
          client: ClinicalTrialsClient | None = None) -> dict:
    """Fetch every study for the payload's asset, write studies.jsonl and
    manifest.json under output_dir/<asset-slug>/, and return the manifest."""
    names, search_in = parse_payload(payload)
    search_param = SEARCH_PARAMS[search_in]
    query = build_query(names)
    client = client or ClinicalTrialsClient()
    target = Path(output_dir) / _slugify(names[0])
    target.mkdir(parents=True, exist_ok=True)
    studies_path = target / "studies.jsonl"
    partial_path = target / "studies.jsonl.part"

    crawled_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    version = client.get("/version")
    log.info("Searching ClinicalTrials.gov (data as of %s): %s=%s",
             version.get("dataTimestamp"), search_param, query)

    total_count, nct_ids, seen = 0, [], set()
    try:
        with partial_path.open("w", encoding="utf-8") as out:
            for page_number, page in enumerate(iter_pages(client, query, search_param), start=1):
                if page_number == 1:
                    total_count = page.get("totalCount", 0)
                for study in page.get("studies", []):
                    nct_id = study["protocolSection"]["identificationModule"]["nctId"]
                    if nct_id in seen:  # results shifted because the data refreshed mid-crawl
                        continue
                    seen.add(nct_id)
                    nct_ids.append(nct_id)
                    out.write(json.dumps(study, ensure_ascii=False) + "\n")
                log.info("Page %d: %d/%d studies", page_number, len(nct_ids), total_count)
        os.replace(partial_path, studies_path)
    except BaseException:
        partial_path.unlink(missing_ok=True)  # leave the previous crawl's output intact
        raise

    suggestions = []
    if not nct_ids:
        suggestions = spelling_suggestions(names)
        hint = f"did you mean {' / '.join(suggestions)}?" if suggestions else "check the spelling or add aliases"
        log.warning("No studies matched %s; %s", query, hint)
    elif len(nct_ids) != total_count:
        log.warning("API reported %d studies but %d were fetched", total_count, len(nct_ids))

    manifest = {
        "source": "clinicaltrials.gov",
        "asset_name": names[0],
        "search_names": names,
        "search_in": search_in,
        "query": {search_param: query},
        "api_version": version.get("apiVersion"),
        "data_timestamp": version.get("dataTimestamp"),
        "crawled_at": crawled_at,
        "total_count": total_count,
        "study_count": len(nct_ids),
        "spelling_suggestions": suggestions,
        "studies_file": str(studies_path),
        "nct_ids": nct_ids,
        "payload": payload,
    }
    (target / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-") or "asset"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crawl every ClinicalTrials.gov study for a drug asset.")
    parser.add_argument("payload", help='JSON payload such as \'{"asset_name": "Keytruda"}\', '
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
    except ClinicalTrialsError as e:
        log.error("%s", e)
        return 1
    print(f"{manifest['study_count']} studies for {manifest['asset_name']!r} -> {manifest['studies_file']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
