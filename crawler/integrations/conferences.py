"""
Conference abstracts (ERS, ATS, CHEST) for an asset, from the team's conference
crawler (conference/). A full crawl reads every abstract page of every year
(~10-12 h per conference), so its output is kept as a corpus collection
(CONFERENCE_CORPUS, default pharmaedge.conference_abstracts) and an asset's
abstracts are matched from it with the crawler's own keyword rules: whole words,
case- and accent-insensitive, in the title or abstract.
"""

import os
import re
from typing import Any, Dict, Iterator, List

from . import TEAM_ROOT  # noqa: F401  (puts the team packages on sys.path)
from conference.common import compile_keywords, matched_keywords

CORPUS = os.getenv("CONFERENCE_CORPUS", "pharmaedge.conference_abstracts")


def _date(doc: Dict[str, Any]) -> str:
    """Session date (ATS), else the supplement's publication date (ERS, CHEST), else the year."""
    start = ((doc.get("session") or {}).get("start") or "")[:10]
    return start or (doc.get("publication") or {}).get("date") or str(doc.get("year") or "")


def to_record(doc: Dict[str, Any], matched: List[str]) -> Dict[str, Any]:
    session = doc.get("session") or {}
    return {
        "record_key": f"conference:{doc['id']}",
        "record_type": "conference_abstract",
        "source": doc["conference"].lower(),
        "date": _date(doc),
        "conference": doc["conference"],
        "meeting": doc.get("meeting"),
        "year": doc.get("year"),
        "abstract_number": doc.get("abstract_number"),
        "title": doc.get("title"),
        "abstract": doc.get("abstract"),
        "authors": [a["name"] for a in (doc.get("authors") or [])[:12] if isinstance(a, dict) and a.get("name")],
        "category": doc.get("category"),
        "session_title": session.get("title"),
        "session_type": session.get("type"),
        "doi": doc.get("doi"),
        "url": doc.get("url"),
        "journal": (doc.get("publication") or {}).get("journal"),
        "mentions": matched,
    }


def _prefilter(names: List[str]) -> Dict[str, Any]:
    """Cheap server-side narrowing on each name's first word; matched_keywords decides."""
    words = sorted({re.escape(n.split()[0]) for n in names if n.split()})
    pattern = {"$regex": "|".join(words), "$options": "i"}
    return {"$or": [{"title": pattern}, {"abstract": pattern}]}


def fetch(db, names: List[str]) -> Iterator[Dict[str, Any]]:
    """Abstracts in the corpus that mention any of the names."""
    corpus_db, corpus_coll = CORPUS.split(".", 1)
    patterns = compile_keywords(names)
    fields = {"_id": 0, "id": 1, "conference": 1, "meeting": 1, "year": 1, "abstract_number": 1, "title": 1,
              "abstract": 1, "authors": 1, "category": 1, "session": 1, "doi": 1, "url": 1, "publication": 1}
    for doc in db.client[corpus_db][corpus_coll].find(_prefilter(names), fields):
        matched = matched_keywords(doc, patterns)
        if matched:
            yield to_record(doc, matched)
