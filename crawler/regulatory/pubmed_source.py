"""
PubMed publications for an asset, via the team's PubMed crawler (pubmed/pubmed.py,
NCBI E-utilities). Maps its articles onto the shared record contract
(`publication_records`). Newest first; stops early once it reaches articles
already stored, so refreshes only fetch what's new.
"""

import os
import sys
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List

# pubmed/ lives at the repo root (outside crawler/); in Docker it's copied next to the crawler code.
for root in (Path(__file__).resolve().parents[2], Path(__file__).resolve().parents[1]):
    if (root / "pubmed" / "pubmed.py").exists() and str(root) not in sys.path:
        sys.path.append(str(root))

from pubmed.pubmed import ESEARCH_LIMIT, PubMedClient, build_query, iter_articles, parse_payload  # noqa: E402

MAX_RESULTS = int(os.getenv("PUBMED_MAX_RESULTS", "1000"))
STOP_AFTER_KNOWN = 50


def _iso(value: Any) -> str:
    """'2021-03-31' / '2021-03' / '2021' -> ISO-ish; free text ('2019 Nov-Dec') -> its year."""
    s = str(value or "")
    if len(s) >= 4 and s[:4].isdigit():
        parts = s.split("-")
        return "-".join([parts[0], *(p.zfill(2) for p in parts[1:3] if p.isdigit())]) if "-" in s else s[:4]
    return ""


def to_record(a: Dict[str, Any]) -> Dict[str, Any]:
    journal = a.get("journal") or {}
    return {
        "record_key": f"pubmed:{a['pmid']}",
        "record_type": "publication",
        "source": "pubmed",
        "date": _iso(a.get("electronic_date") or a.get("pub_date")),
        "pmid": a["pmid"],
        "url": a.get("url"),
        "title": a.get("title"),
        "abstract": a.get("abstract"),
        "journal": journal.get("title") or journal.get("iso_abbreviation"),
        "authors": [" ".join(filter(None, [au.get("fore_name") or au.get("initials"), au.get("last_name")]))
                    for au in (a.get("authors") or [])[:12] if isinstance(au, dict)],
        "doi": a.get("doi"),
        "publication_types": a.get("publication_types") or [],
        "mesh_terms": [m.get("descriptor") for m in a.get("mesh_terms") or [] if isinstance(m, dict) and m.get("descriptor")],
        "trial_ids": (a.get("databanks") or {}).get("ClinicalTrials.gov", []),
    }


def fetch(names: List[str], known: Callable[[str], bool] = lambda key: False,
          max_results: int = MAX_RESULTS) -> Iterator[Dict[str, Any]]:
    """Articles mentioning any of the names in title/abstract, newest first (at most max_results)."""
    opts = parse_payload({"keywords": names, "match": "any", "field": "tiab", "exact": True,
                          "sort": "pub_date", "max_results": max_results})
    known_streak = 0
    for article in iter_articles(PubMedClient(), build_query(opts), opts["sort"],
                                 min(opts["max_results"] or ESEARCH_LIMIT, ESEARCH_LIMIT), None):
        record = to_record(article)
        if known(record["record_key"]):
            known_streak += 1
            if known_streak >= STOP_AFTER_KNOWN:
                return
            continue
        known_streak = 0
        yield record
