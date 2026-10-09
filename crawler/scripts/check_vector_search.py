"""
Check that the configured MongoDB (self-hosted with mongot, or Atlas) supports Vector Search
(needed by Asset AI). Creates a throwaway collection + vector index, waits for
it to become queryable, runs one $vectorSearch, then drops everything.

    cd crawler && ../.venv/bin/python -m scripts.check_vector_search
"""

import os
import sys
import time

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.operations import SearchIndexModel

load_dotenv()

COLLECTION = "_vector_search_probe"
INDEX = "probe_vector_index"
DIMS = 4


def main() -> int:
    db = MongoClient(os.environ["MONGODB_URI"])[os.getenv("MONGODB_DB", "asset_journey")]
    coll = db[COLLECTION]
    coll.drop()
    try:
        coll.insert_many([
            {"label": "a", "embedding": [1.0, 0.0, 0.0, 0.0]},
            {"label": "b", "embedding": [0.0, 1.0, 0.0, 0.0]},
            {"label": "c", "embedding": [0.9, 0.1, 0.0, 0.0]},
        ])
        coll.create_search_index(SearchIndexModel(
            name=INDEX,
            type="vectorSearch",
            definition={"fields": [{"type": "vector", "path": "embedding",
                                    "numDimensions": DIMS, "similarity": "cosine"}]},
        ))
        deadline = time.time() + 180
        while time.time() < deadline:
            status = next(iter(coll.list_search_indexes(INDEX)), {})
            if status.get("queryable"):
                break
            time.sleep(3)
        else:
            print("FAIL: index created but never became queryable within 180s")
            return 1

        hits = list(coll.aggregate([
            {"$vectorSearch": {"index": INDEX, "path": "embedding", "queryVector": [1.0, 0.0, 0.0, 0.0],
                               "numCandidates": 10, "limit": 2}},
            {"$project": {"_id": 0, "label": 1, "score": {"$meta": "vectorSearchScore"}}},
        ]))
        labels = [h["label"] for h in hits]
        if labels[:2] != ["a", "c"]:
            print(f"FAIL: unexpected nearest neighbours {hits}")
            return 1
        print(f"OK: Vector Search works (nearest to 'a': {labels})")
        return 0
    except Exception as e:  # report the server's reason (tier limits, permissions, ...)
        print(f"FAIL: {type(e).__name__}: {e}")
        return 1
    finally:
        coll.drop()


if __name__ == "__main__":
    sys.exit(main())
