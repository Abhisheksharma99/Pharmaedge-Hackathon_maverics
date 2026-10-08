"""
Load reviewed JSON output (main.py --output json) into MongoDB.

    python load_json.py ../data/treprostinil

Safe to re-run: articles upsert on url, records on record_key, runs on id, and
an existing document only gains any new `assets` - its other fields are kept.
logs.jsonl is not loaded (crawl debugging only).
"""

import json
import os
import sys

from pymongo import UpdateOne

from storage.mongo_storage import _retry, get_db

COLLECTIONS = {
    "articles": "url",
    "fda_records": "record_key",
    "ema_records": "record_key",
    "trial_records": "record_key",
    "company_records": "record_key",
    "runs": "id",
}
BATCH = 200


@_retry
def _write(collection, ops) -> int:
    # Upserts are idempotent, so a retried batch can't duplicate anything
    return collection.bulk_write(ops, ordered=False).upserted_count


def load(data_dir: str) -> None:
    db = get_db()
    for name, key in COLLECTIONS.items():
        path = os.path.join(data_dir, f"{name}.json")
        if not os.path.exists(path):
            continue
        with open(path) as f:
            rows = json.load(f)
        inserted = 0
        for i in range(0, len(rows), BATCH):
            ops = []
            for row in rows[i:i + BATCH]:
                assets = row.pop("assets", [])
                update = {"$setOnInsert": row}
                if assets:
                    update["$addToSet"] = {"assets": {"$each": assets}}
                ops.append(UpdateOne({key: row[key]}, update, upsert=True))
            inserted += _write(db[name], ops)
        print(f"{name:16} {len(rows):5} in file, {inserted:5} new, {db[name].count_documents({}):5} in Mongo")


if __name__ == "__main__":
    load(sys.argv[1])
