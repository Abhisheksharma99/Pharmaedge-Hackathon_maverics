"""
Rebuild every asset's rule-based journey events from the records already stored (no crawling, no network),
e.g. after the rule-event identity change (ids now carry the asset). Idempotent; dry run unless --apply.

    cd crawler && python -m scripts.rebuild_journeys            # report what would change
    cd crawler && python -m scripts.rebuild_journeys --apply    # write

Per asset: events built, documents the rebuild would add and remove, AI-merged evidence carried over.
AI events (origin "ai") are never touched.
"""

import argparse
import sys

from journey.rules import build_rule_events
from journey.store import replace_rule_events
from storage.mongo_storage import get_db


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="write the rebuilt events (default: report only)")
    ap.add_argument("--asset", help="only this asset id")
    args = ap.parse_args()
    db = get_db()
    query = {"_id": args.asset} if args.asset else {}
    for asset in db.assets.find(query, {"company": 1}):
        events = build_rule_events(db, asset["_id"], (asset.get("company") or {}).get("name"))
        ids = {e["_id"] for e in events}
        have = {e["_id"] for e in db.journey_events.find({"asset": asset["_id"], "origin": "rule"}, {"_id": 1})}
        line = f"{asset['_id']:24} events {len(events):5}  add {len(ids - have):5}  remove {len(have - ids):5}"
        if args.apply:
            counts = replace_rule_events(db, asset["_id"], events)
            line += f"  written: new {counts['new']}, removed {counts['removed']}, evidence carried {counts['evidence_carried']}"
        print(line)
    if not args.apply:
        print("dry run: nothing written (use --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
