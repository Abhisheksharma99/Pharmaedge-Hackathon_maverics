"""
Conference corpus: every abstract of ERS, ATS and CHEST (team crawlers in conference/), in the collection the
conferences step matches assets against (CONFERENCE_CORPUS), upserted on the abstract `id`.

A full crawl takes ~10-12 h for ERS and for CHEST, so each conference is crawled one year at a time and a year
is marked done once its abstracts are stored: a restart resumes with the next year. Daily runs crawl the newest
year again (abstracts are added up to the meeting) and any year not done yet (a new meeting).
"""

import json
import logging
import os
import tempfile
from typing import Any, Callable, Dict, Iterable, List

from pymongo import UpdateOne

from corpus import collection, progress_add, progress_set
from integrations import conferences as conference_records  # noqa: F401  (puts the team packages on sys.path)
from conference import common
from conference.ats import ats
from conference.chest import chest
from conference.ers import ers

log = logging.getLogger("corpus.conferences")

WORKERS = int(os.getenv("CONFERENCE_WORKERS", "6"))  # parallel abstract-page downloads (ERS, CHEST)
BATCH = 500

# name -> (crawl(payload, output_dir), available years)
CONFERENCES: Dict[str, tuple] = {
    "ers": (ers.crawl, lambda: ers.discover(common.HttpClient(min_interval=0.5), common.parse_payload({}))),
    "ats": (ats.crawl, lambda: ats.discover(ats.AtsClient())),
    "chest": (chest.crawl, lambda: chest.discover(common.HttpClient(min_interval=0.25), common.parse_payload({}))),
}


def _coll(db):
    coll = collection(db, conference_records.CORPUS)
    coll.create_index("id")
    return coll


def store(db, abstracts: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    """Upsert abstracts on `id` (the corpus may hold documents copied from elsewhere, with other _ids)."""
    coll, ops, counts = _coll(db), [], {"abstracts": 0, "abstracts_new": 0}

    def flush() -> None:
        if ops:
            counts["abstracts_new"] += coll.bulk_write(ops, ordered=False).upserted_count
            ops.clear()

    for a in abstracts:
        a.pop("matched_keywords", None)  # a keyword-run field: empty for a full crawl
        ops.append(UpdateOne({"id": a["id"]}, {"$set": a}, upsert=True))
        counts["abstracts"] += 1
        if len(ops) >= BATCH:
            flush()
    flush()
    return counts


def _lines(path: str) -> Iterable[Dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def crawler(name: str) -> Callable[..., Dict[str, Any]]:
    run, discover = CONFERENCES[name]
    source = f"conference_{name}"

    def crawl(db, *, full: bool, progress: Dict[str, Any], should_stop: Callable[[], bool]) -> Dict[str, Any]:
        years: List[int] = sorted(discover(), reverse=True)
        done = set(progress.get("years_done") or [])
        todo = [y for y in years if y not in done]
        if not full and years and years[0] not in todo:
            todo.insert(0, years[0])
        counts = {"years_crawled": 0, "abstracts": 0, "abstracts_new": 0, "year_errors": 0}
        for year in todo:
            if should_stop():
                break
            try:
                with tempfile.TemporaryDirectory(prefix=f"{name}-{year}-") as out:
                    manifest = run({"years": year, "workers": WORKERS}, out)
                    stored = store(db, _lines(manifest["abstracts_file"]))
            except (common.CrawlError, common.PayloadError) as e:
                log.warning("%s %d failed: %s", name, year, e)
                progress_set(db, source, f"errors.{year}", str(e)[:300])
                counts["year_errors"] += 1
                continue
            counts["years_crawled"] += 1
            counts["abstracts"] += stored["abstracts"]
            counts["abstracts_new"] += stored["abstracts_new"]
            if stored["abstracts"]:  # an empty year (next year's portal, no abstracts yet) is tried again
                progress_add(db, source, "years_done", year)
                done.add(year)
            log.info("%s %d: %d abstracts stored (%d new)", name, year, stored["abstracts"], stored["abstracts_new"])
        counts["complete"] = not counts["year_errors"] and all(y in done for y in years[1:])
        return counts

    return crawl
