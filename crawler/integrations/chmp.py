"""
EMA CHMP opinions for an asset, from the team's CHMP meeting highlights crawler
(ema/chmp_highlights.py): one page per monthly CHMP meeting (2006 onwards) with
the committee's opinions per medicine.

The meetings are shared by every asset, so they are kept as a corpus collection
(CHMP_CORPUS, default pharmaedge.ema_chmp_meetings), crawled in full and then
refreshed daily from the newest meetings by the corpus worker (corpus/), and
matched per asset: whole names, case-insensitive, against each opinion's medicine
name, INN and common name, and against the narrative paragraphs.

Records go to `ema_records`:
  ema_chmp_opinion    one per medicine opinion that names the asset (2010 onwards)
  ema_chmp_highlight  the asset's paragraphs from a meeting without a matching
                      opinion (2006-2009 pages are narrative only)
Both carry `content`, the asset's part of the page, for AI triage and event
extraction.
"""

import json
import os
import re
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from pymongo import ReplaceOne
from pymongo.errors import DuplicateKeyError

from . import TEAM_ROOT  # noqa: F401  (puts the team packages on sys.path)
from ema import chmp_highlights

CORPUS = os.getenv("CHMP_CORPUS", "pharmaedge.ema_chmp_meetings")
REFRESH_EVERY = timedelta(hours=24)  # CHMP meets monthly
OVERLAP = timedelta(days=60)  # re-read the newest meetings: EMA corrects pages after publishing

OPINION_TITLES = {
    ("positive", "new_medicine"): "CHMP recommends approval of {}",
    ("positive", "extension_of_indication"): "CHMP recommends extension of indication for {}",
    ("positive", None): "CHMP positive opinion on {}",
    ("negative", None): "CHMP negative opinion on {}",
    ("withdrawn", "new_medicine"): "EU marketing authorisation application withdrawn: {}",
    ("withdrawn", None): "EU application withdrawn: {}",
    ("re_examination", None): "CHMP re-examination: {}",
    ("referral_started", None): "EMA referral started: {}",
    ("referral_concluded", None): "EMA referral concluded: {}",
}


def _corpus(db):
    corpus_db, corpus_coll = CORPUS.split(".", 1)
    return db.client[corpus_db][corpus_coll]


def _claim_refresh(db) -> bool:
    """One refresh per day across jobs and workers: the first job to claim it crawls, the others match against
    the corpus as it is."""
    now = datetime.now(timezone.utc)
    marker = _corpus(db).database["corpus_refresh"]
    try:
        marker.find_one_and_update({"_id": CORPUS, "$or": [{"started_at": {"$lt": now - REFRESH_EVERY}},
                                                           {"started_at": {"$exists": False}}]},
                                   {"$set": {"started_at": now}}, upsert=True)
        return True
    except DuplicateKeyError:  # another job holds a fresh claim
        return False


def store_meetings(db, meetings: List[Dict[str, Any]]) -> int:
    if not meetings:
        return 0
    result = _corpus(db).bulk_write([ReplaceOne({"_id": m["id"]}, {**m, "_id": m["id"]}, upsert=True)
                                     for m in meetings], ordered=False)
    return result.upserted_count


def refresh_corpus(db, claim: bool = True) -> Dict[str, Any]:
    """Crawl meetings published since the newest one stored (minus an overlap); everything when the corpus is
    empty. `claim=False`: the caller already holds the source (the corpus worker, see corpus/)."""
    if claim and not _claim_refresh(db):
        return {"corpus_refreshed": False}
    newest = _corpus(db).find_one({}, {"published_at": 1}, sort=[("published_at", -1)])
    payload = {}
    if newest and newest.get("published_at"):
        payload["since"] = (date.fromisoformat(newest["published_at"][:10]) - OVERLAP).isoformat()
    try:
        with tempfile.TemporaryDirectory() as out:
            manifest = chmp_highlights.crawl(payload, Path(out))
            meetings = json.loads((Path(out) / chmp_highlights.RECORDS_FILE).read_text("utf-8"))
    except Exception:
        if claim:
            _corpus(db).database["corpus_refresh"].delete_one({"_id": CORPUS})  # let the next job retry
        raise
    return {"corpus_refreshed": True, "meetings_crawled": len(meetings), "meetings_new": store_meetings(db, meetings),
            "crawl_problems": len(manifest.get("problems") or [])}


def name_regex(names: List[str]) -> Optional[re.Pattern]:
    alts = sorted({re.escape(n.strip()) for n in names if len(n.strip()) >= 3}, key=len, reverse=True)
    return re.compile(rf"(?<![\w-])(?:{'|'.join(alts)})(?![\w-])", re.I) if alts else None


def _slug(text: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:80]


def _paragraphs(meeting: Dict[str, Any], rx: re.Pattern) -> List[str]:
    """Narrative paragraphs (highlights, other sections) that name the asset."""
    out = []
    for block in (meeting.get("highlights") or []) + (meeting.get("sections") or []):
        for para in (block.get("text") or "").split("\n"):
            if rx.search(para):
                out.append(para.strip())
    return list(dict.fromkeys(out))


def _outcome_text(o: Dict[str, Any]) -> str:
    fields = [("Section", o.get("section")), ("Medicine", o.get("medicine_name")),
              ("Active substance", o.get("inn") or o.get("common_name")), ("Company", o.get("company")),
              ("Therapeutic indication", o.get("therapeutic_indication")), ("Status", o.get("status")),
              ("Orphan medicine", "yes" if o.get("orphan") else None)]
    return "\n".join(f"{label}: {value}" for label, value in fields if value)


def _meeting_fields(meeting: Dict[str, Any]) -> Dict[str, Any]:
    m = meeting.get("meeting") or {}
    when = m.get("end_date") or m.get("start_date") or (meeting.get("published_at") or "")[:10]
    return {"source": "ema", "date": when, "meeting": m.get("label"), "meeting_start_date": m.get("start_date"),
            "meeting_end_date": m.get("end_date"), "published_at": meeting.get("published_at"),
            "url": meeting["url"], "meeting_title": meeting.get("title")}


def opinion_title(o: Dict[str, Any]) -> str:
    name = o.get("medicine_name") or "medicine"
    substance = o.get("inn") or o.get("common_name")
    if substance and substance.lower() != name.lower():
        name = f"{name} ({substance})"
    template = (OPINION_TITLES.get((o.get("opinion"), o.get("procedure")))
                or OPINION_TITLES.get((o.get("opinion"), None)) or "CHMP: {}")
    return template.format(name)


def to_records(meeting: Dict[str, Any], rx: re.Pattern) -> List[Dict[str, Any]]:
    """The asset's opinions in one meeting, or its paragraphs when no opinion names it."""
    common = _meeting_fields(meeting)
    paragraphs = _paragraphs(meeting, rx)
    title, when = meeting.get("title") or "CHMP meeting highlights", common["meeting"] or common["date"]
    header = title if when and when in title else f"{title} ({when})"
    records = []
    for o in meeting.get("outcomes") or []:
        fields = (o.get("medicine_name"), o.get("inn"), o.get("common_name"))
        found = sorted({m.group(0) for f in fields for m in rx.finditer(f or "")}, key=str.lower)
        if not found:
            continue
        # The paragraphs about this medicine: the narrative names medicines by trade name or INN.
        own = name_regex([o.get("medicine_name") or "", o.get("inn") or "", o.get("common_name") or ""])
        context = [p for p in paragraphs if own and own.search(p)]
        records.append({
            **common,
            "record_key": f"ema:chmp:{meeting['id']}:{_slug(o.get('section'))}:{_slug(o.get('medicine_name'))}",
            "record_type": "ema_chmp_opinion",
            "title": opinion_title(o),
            "name_of_medicine": o.get("medicine_name"),
            "active_substance": o.get("inn") or o.get("common_name"),
            **{k: o.get(k) for k in ("section", "opinion", "procedure", "medicine_type", "re_examination", "company",
                                     "company_role", "therapeutic_indication", "orphan", "status")},
            "medicine_url": o.get("ema_url"),
            "related_news": o.get("related_news") or [],
            "mentions": found,
            "content": "\n\n".join([header, _outcome_text(o), *context]),
        })
    if not records and paragraphs:
        records.append({
            **common,
            "record_key": f"ema:chmp:{meeting['id']}:highlights",
            "record_type": "ema_chmp_highlight",
            "title": f"CHMP meeting highlights ({common['meeting'] or common['date']})",
            "mentions": sorted({m.group(0) for p in paragraphs for m in rx.finditer(p)}, key=str.lower),
            "content": "\n\n".join([header, *paragraphs]),
        })
    return records


def fetch(db, names: List[str]) -> Iterator[Dict[str, Any]]:
    """CHMP records naming any of the asset's names, from the corpus."""
    rx = name_regex(names)
    if not rx:
        return
    pattern = {"$regex": rx.pattern, "$options": "i"}
    query = {"$or": [{"medicine_names": pattern}, {"outcomes.medicine_name": pattern}, {"outcomes.inn": pattern},
                     {"outcomes.common_name": pattern}, {"highlights.text": pattern}, {"sections.text": pattern}]}
    fields = {"id": 1, "url": 1, "title": 1, "published_at": 1, "meeting": 1, "outcomes": 1, "highlights": 1,
              "sections": 1}
    for meeting in _corpus(db).find(query, fields):
        yield from to_records(meeting, rx)
