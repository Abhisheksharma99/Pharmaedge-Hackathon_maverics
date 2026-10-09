"""
One-off v3 backfill (spec §4): rebuild every asset's rule events (so they gain details / product / indications /
links), then derive indication branches, key events and enrichment, and bump the API cache. Safe to re-run: LLM
calls are cached by content hash and enrichment only touches events not enriched yet.

    docker compose exec crawler-worker python -m scripts.v3_backfill [--reset-colors] [asset_id ...]

--reset-colors clears the stored AI-branch colours first, so they are reassigned by the current palette rule
(active branches first).
"""

import sys

from dotenv import load_dotenv

load_dotenv()

from journey.derive import derive_journey  # noqa: E402
from journey.rules import build_rule_events  # noqa: E402
from journey.store import bump_asset_version, replace_rule_events  # noqa: E402
from storage.mongo_storage import get_db  # noqa: E402


def main(ids, reset_colors=False):
    db = get_db()
    query = {"_id": {"$in": ids}} if ids else {}
    assets = sorted(db.assets.find(query), key=lambda a: (a.get("kind") != "primary", a["_id"]))
    for a in assets:
        if reset_colors:
            db.asset_branches.update_many({"asset": a["_id"], "origin": {"$ne": "user"}}, {"$unset": {"color": ""}})
        rules = replace_rule_events(db, a["_id"], build_rule_events(db, a["_id"], (a.get("company") or {}).get("name")))
        derived = derive_journey(db, a, log=lambda kind, text, **_: print(f"  [{kind}] {text}", flush=True))
        bump_asset_version(a["_id"])
        print(f"{a['_id']}: rules={rules} derived={derived}", flush=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    main([a for a in args if a != "--reset-colors"], "--reset-colors" in args)
