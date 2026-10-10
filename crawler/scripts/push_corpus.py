"""
Copy the corpora (company PR, EMA reports, CHMP meetings, designations) and their crawl progress from one
MongoDB to another, e.g. from a local Docker MongoDB to the team server, so the corpus worker there resumes
where the local one stopped. Upserts by _id: safe to re-run. Conference abstracts are left out (the team uploads
them separately; the corpus worker merges its own by abstract id).

    cd crawler && ../.venv/bin/python -m scripts.push_corpus --source '<mongodb uri>' --target '<mongodb uri>'
"""

import argparse
import time

from pymongo import MongoClient, ReplaceOne

COLLECTIONS = ("company_pr_news", "ema_reports", "ema_chmp_meetings", "fda_designations")
BATCH = 500


def copy(source, target, name: str) -> int:
    new, ops = 0, []
    for doc in source[name].find():
        ops.append(ReplaceOne({"_id": doc["_id"]}, doc, upsert=True))
        if len(ops) == BATCH:
            new += target[name].bulk_write(ops, ordered=False).upserted_count
            ops = []
    if ops:
        new += target[name].bulk_write(ops, ordered=False).upserted_count
    return new


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--db", default="pharmaedge", help="corpus database (CORPUS_DB)")
    args = parser.parse_args()
    source = MongoClient(args.source, serverSelectionTimeoutMS=10000)[args.db]
    target = MongoClient(args.target, serverSelectionTimeoutMS=10000)[args.db]
    for name in COLLECTIONS:
        started = time.time()
        new = copy(source, target, name)
        print(f"{name}: {target[name].estimated_document_count()} in target ({new} new, "
              f"{time.time() - started:.0f}s)", flush=True)
    for state in source.corpus_sources.find():
        if state.get("status") == "running":  # interrupted where it was copied from: resumable from its progress
            state["status"] = "partial"
        state.pop("heartbeat_at", None)
        target.corpus_sources.replace_one({"_id": state["_id"]}, state, upsert=True)
    print("corpus_sources:", [(s["_id"], s["status"]) for s in target.corpus_sources.find({}, {"status": 1})])


if __name__ == "__main__":
    main()
