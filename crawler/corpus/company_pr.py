"""
company_pr corpus: every article of every company_pr spider (company newsrooms, news sites, agencies, wires),
keyed by URL. google_news is left out: it searches the asset's names, so it runs per asset (industry_news).

The first run crawls each spider's full history, one spider at a time; a spider is done once its full crawl
returns, so a restart resumes with the next one (and URLs already stored are skipped, within a spider too). Later
runs fetch the newest articles of every done spider, and the full history of spiders added since.
"""

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, Iterator, List

from pymongo import UpdateOne

from corpus import collection, progress_add, progress_set, state
from integrations import newsroom

log = logging.getLogger("corpus.company_pr")

SOURCE = "company_pr"
COLLECTION = os.getenv("COMPANY_PR_CORPUS", "pharmaedge.company_pr_news")
KEYWORD_SPIDERS = {"google_news"}
FULL_TIMEOUT_MIN = int(os.getenv("CORPUS_SPIDER_TIMEOUT_MIN", "720"))  # one spider's full history
NEW_LIMIT, NEW_TIMEOUT_MIN = 100, 60  # daily: newest articles per spider, all spiders in one run


def _coll(db):
    coll = collection(db, COLLECTION)
    coll.create_index("spider")
    coll.create_index("news_date")
    return coll


def corpus_spiders() -> List[Dict[str, Any]]:
    return [s for s in newsroom.catalog() if s["name"] not in KEYWORD_SPIDERS]


def store(db, items: Iterable[Dict[str, Any]], categories: Dict[str, str]) -> int:
    """Upsert items by URL; returns how many were new."""
    now = datetime.now(timezone.utc)
    ops = [UpdateOne({"_id": i["news_url"]},
                     {"$set": {**i, "category": categories.get(i["spider"]), "last_seen": now},
                      "$setOnInsert": {"first_seen": now}}, upsert=True)
           for i in items if i.get("news_url")]
    return _coll(db).bulk_write(ops, ordered=False).upserted_count if ops else 0


def _known(db, spiders: List[str]) -> List[str]:
    return [d["_id"] for d in _coll(db).find({"spider": {"$in": spiders}}, {"_id": 1})]


def crawl(db, *, full: bool, progress: Dict[str, Any], should_stop: Callable[[], bool]) -> Dict[str, Any]:
    spiders = corpus_spiders()
    categories = {s["name"]: s["category"] for s in spiders}
    done_before = set(progress.get("spiders_done") or [])
    done = set(done_before)
    counts = {"articles_new": 0, "spiders_crawled_full": 0, "spider_errors": 0}
    for name in [s["name"] for s in spiders if s["name"] not in done_before]:
        if should_stop():
            break
        try:
            items, _ = newsroom.run([name], known_urls=_known(db, [name]), limit=0, timeout_min=FULL_TIMEOUT_MIN,
                                    is_cancelled=should_stop)
        except Exception as e:  # noqa: BLE001 - one spider failing must not stop the others; retried next run
            log.warning("company_pr %s failed: %s", name, e)
            progress_set(db, SOURCE, f"errors.{name}", f"{type(e).__name__}: {e}"[:300])
            counts["spider_errors"] += 1
            continue
        counts["articles_new"] += store(db, items, categories)
        if should_stop():  # stopped mid-history: crawled again (minus what is stored) next run
            break
        progress_add(db, SOURCE, "spiders_done", name)
        done.add(name)
        counts["spiders_crawled_full"] += 1
        log.info("company_pr %s: full history stored (%d spiders of %d)", name, len(done), len(spiders))
    refresh = [s["name"] for s in spiders if s["name"] in done_before]
    if refresh and not should_stop():
        items, summary = newsroom.run(refresh, known_urls=_known(db, refresh), limit=NEW_LIMIT,
                                      timeout_min=NEW_TIMEOUT_MIN, is_cancelled=should_stop)
        counts["articles_new"] += store(db, items, categories)
        counts["spider_errors"] += sum(s["errors"] for s in summary)
    counts["complete"] = all(s["name"] in done for s in spiders)
    return counts


def stored_spiders(db) -> set:
    """Spiders whose full history is in the corpus."""
    return set((state(db, SOURCE).get("progress") or {}).get("spiders_done") or [])


def items(db, spiders: List[str], names: Iterable[str] = ()) -> Iterator[Dict[str, Any]]:
    """Stored articles of these spiders; with `names`, only those mentioning one of them (whole words)."""
    query: Dict[str, Any] = {"spider": {"$in": spiders}}
    names = [n for n in names if n.strip()]
    if names:  # cheap server-side narrowing on each name's first word; newsroom.mentions decides
        words = sorted({re.escape(n.split()[0]) for n in names})
        pattern = {"$regex": "|".join(words), "$options": "i"}
        query["$or"] = [{"title": pattern}, {"content": pattern}]
    for doc in _coll(db).find(query, {"_id": 0, "category": 0, "first_seen": 0, "last_seen": 0}):
        if not names or newsroom.mentions(doc, names):
            yield doc
