"""
Investor-presentation slides for an asset, from the team's presentation intelligence (patent_intel/presentations),
which stores decks in its own database (PRESENTATIONS_DB, default "Cluster0", same cluster). Read-only: decks are
neither crawled nor copied wholesale here; each slide that concerns the asset is mapped into the record contract.

One record per slide in `company_records` (record_type `presentation_slide`), keyed
`presentation:{presentation_id}:{page}`: the slide's text, its extracted claims and metrics (value, unit, arm, trial,
validation status) with page and bounding-box provenance, the deck title, date and source URL. The index step makes
it searchable for Asset AI and the citation opens it in the app; the deck PDF stays the original source.

A slide belongs to the asset when the deck is from the asset's company (same company key as the presentation
pipeline: normalized legal name) and the slide - text, title, claims or metrics - names the asset (any of its
names). Superseded deck versions and stale facts are left out.
"""

import os
import re
from typing import Any, Dict, Iterator, List

from . import TEAM_ROOT  # noqa: F401  (puts the team packages on sys.path)
from conference.common import compile_keywords, matched_keywords
from patent_intel.matching import normalize

from .chmp import name_regex

PRESENTATIONS_DB = os.getenv("PRESENTATIONS_DB", "Cluster0")
MAX_TEXT, MAX_FACTS = 4000, 40


def company_key(company: str) -> str:
    """patent_intel.presentations.pipeline.company_key for a company name (kept in sync; that module's imports
    need the presentation subsystem's dependencies, which the crawler doesn't install)."""
    base = (company or "unknown").lower()
    return re.sub(r"[^a-z0-9]+", "-", normalize(base).lower() or base).strip("-")[:60] or "unknown"


# File-name style deck titles ("2026 02 25 4q eps presentation") -> readable ("4Q EPS Presentation"); the date is
# shown from the deck's own date field.
_LEADING_DATE = re.compile(r"^\s*(?:\d{4}[ ._-]\d{1,2}[ ._-]\d{1,2}|\d{1,2}[ ._-]\d{1,2}[ ._-]\d{4})\s+")
_ACRONYMS = {"eps", "jpm", "ir", "fda", "ema", "ats", "ers", "asco", "esc", "aha", "acc", "r&d", "ipf", "pah", "ph-ild",
             "ppf", "copd", "dpi", "lng", "ceo", "cfo", "sec", "ex-us", "us", "eu"}


def deck_title(raw: str | None) -> str:
    words = _LEADING_DATE.sub("", raw or "").split()
    out = []
    for w in words:
        lw = w.lower()
        if lw in _ACRONYMS or re.fullmatch(r"q[1-4]|[1-4]q|fy\d{2,4}|h[12]", lw):
            out.append(lw.upper())
        else:
            out.append(w if any(c.isupper() for c in w) else w.capitalize())
    return " ".join(out) or "Investor presentation"


def _metric_line(m: Dict[str, Any]) -> str:
    value = m.get("value_text") or m.get("value")
    where = ", ".join(str(x) for x in (m.get("arm"), m.get("trial"), m.get("timepoint")) if x)
    status = (m.get("validation") or {}).get("status")
    return f"{m.get('metric')}: {value}{' ' + m['unit'] if m.get('unit') else ''}{f' ({where})' if where else ''}" \
           f"{f' [{status}]' if status and status != 'unverified' else ''}"


def to_record(deck: Dict[str, Any], page: Dict[str, Any], claims: List[Dict[str, Any]],
              metrics: List[Dict[str, Any]], company: str | None = None) -> Dict[str, Any]:
    text = re.sub(r"[ \t]*\r?\n[ \t]*", "\n", page.get("text") or "").strip()[:MAX_TEXT]
    parts = [text]
    if claims:
        parts.append("Claims:\n" + "\n".join(f"- {c['statement']}" for c in claims[:MAX_FACTS]))
    if metrics:
        parts.append("Metrics:\n" + "\n".join(f"- {_metric_line(m)}" for m in metrics[:MAX_FACTS]))
    slide_title = re.sub(r"\s+", " ", page.get("title") or "").strip() or f"Slide {page['page']}"
    deck = {**deck, "title": deck_title(deck.get("title"))}
    return {
        "record_key": f"presentation:{deck['_id']}:{page['page']}",
        "record_type": "presentation_slide",
        "source": "company_presentation",
        "date": deck.get("date") or "",
        "title": f"{deck['title']}, slide {page['page']}: {slide_title}",
        "deck_title": deck["title"],
        "slide_title": slide_title,
        "url": deck.get("source_url"),
        "company": company or deck.get("company_id"),  # display name; company_id is the pipeline's key
        "company_id": deck.get("company_id"),
        "presentation_id": deck["_id"],
        "page": page["page"],
        "slide_type": page.get("slide_type"),
        "slide_text": text,  # the slide as printed (the panel shows it); `content` adds the facts for search
        "content": "\n\n".join(p for p in parts if p),
        "claims": [{k: c.get(k) for k in ("statement", "category", "drug", "trial", "confidence")} for c in claims[:MAX_FACTS]],
        "metrics": [{k: m.get(k) for k in ("metric", "value", "value_text", "unit", "arm", "trial", "timepoint", "comparator",
                                          "p_value_text", "bbox", "validation")} for m in metrics[:MAX_FACTS]],
        "evidence": {"presentation_id": deck["_id"], "page": page["page"], "page_png_sha256": (page.get("page_png") or {}).get("sha256")},
    }


def fetch(db, asset: Dict[str, Any], names: List[str]) -> Iterator[Dict[str, Any]]:
    """Slides of the asset company's decks that name the asset."""
    company = (asset.get("company") or {}).get("name")
    rx = name_regex(names)
    if not company or not rx:
        return
    src = db.client[PRESENTATIONS_DB]
    keywords = compile_keywords(names)
    decks = list(src.presentations.find({"company_id": company_key(company), "status": "done",
                                         "superseded_by": {"$in": [None, ""]}},
                                        {"title": 1, "date": 1, "source_url": 1, "company_id": 1}))
    for deck in decks:
        pid = deck["_id"]
        claims: Dict[int, List[Dict[str, Any]]] = {}
        for c in src.presentation_claims.find({"presentation_id": pid, "stale": {"$ne": True}}):
            claims.setdefault(c["page"], []).append(c)
        metrics: Dict[int, List[Dict[str, Any]]] = {}
        for m in src.presentation_metrics.find({"presentation_id": pid, "stale": {"$ne": True}}):
            metrics.setdefault(m["page"], []).append(m)
        for page in src.presentation_pages.find({"presentation_id": pid}, {"page": 1, "text": 1, "title": 1, "slide_type": 1, "page_png": 1}):
            n = page["page"]
            facts = " ".join([c.get("statement") or "" for c in claims.get(n, [])] + [c.get("drug") or "" for c in claims.get(n, [])]
                             + [_metric_line(m) for m in metrics.get(n, [])])
            if rx.search(f"{page.get('title') or ''} {page.get('text') or ''} {facts}"):
                record = to_record(deck, page, claims.get(n, []), metrics.get(n, []), company)
                # Same whole-word matching as press releases, so "Mentioning <asset>" lists slides too.
                record["mentions"] = matched_keywords({"title": page.get("title"), "abstract": f"{page.get('text') or ''} {facts}"},
                                                      keywords) or names[:1]
                yield record
