"""
Load the drug master spreadsheet into the lookup corpus (corpus/drug_master.py), then - optionally - link the
tracked assets to it. Idempotent: re-running updates the same documents.

    cd crawler && python -m scripts.load_drug_master <drug_master.xlsx>             # load + report asset links
    cd crawler && python -m scripts.load_drug_master <drug_master.xlsx> --link      # also write assets.master
    cd crawler && python -m scripts.load_drug_master --link --set-adis              # (no file: link only) + ids.adis

--link writes `master` on each asset the master resolves unambiguously: {adis_id, name, names, keys, moa, targets,
modality, therapy_areas} - used to resolve what a user means, never as crawl aliases. --set-adis also fills a
missing ids.adis, which makes the patents step read the drug's AdisInsight profile (a behaviour change: opt-in).
"""

import argparse
import sys

from corpus import drug_master
from storage.mongo_storage import get_db


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("xlsx", nargs="?", help="the drug master spreadsheet (omit to only link assets)")
    ap.add_argument("--link", action="store_true", help="write assets.master for unambiguous matches")
    ap.add_argument("--set-adis", action="store_true", help="with --link: also fill a missing ids.adis")
    args = ap.parse_args()
    db = get_db()
    if args.xlsx:
        docs = (d for d in map(drug_master.to_doc, drug_master.rows(args.xlsx)) if d)
        print("loaded", drug_master.store(db, docs))
    for asset in db.assets.find({}, {"name": 1, "aliases": 1, "company": 1, "ids": 1}):
        m = drug_master.resolve(db, [asset["name"], *asset.get("aliases", [])], (asset.get("company") or {}).get("name"))
        if not m:
            print(f"{asset['_id']:22} no unambiguous master entry")
            continue
        master = {k: m.get(k) for k in ("adis_id", "name", "names", "keys", "moa", "targets", "modality", "therapy_areas")}
        update = {"master": master}
        if args.set_adis and m.get("adis_id") and not (asset.get("ids") or {}).get("adis"):
            update["ids.adis"] = m["adis_id"]
        print(f"{asset['_id']:22} -> {m['adis_id']} {m['name']} ({len(m['names'])} names; {', '.join(m.get('moa') or []) or 'no MoA'})"
              f"{' [sets ids.adis]' if 'ids.adis' in update else ''}")
        if args.link:
            db.assets.update_one({"_id": asset["_id"]}, {"$set": update})
    if not args.link:
        print("report only: assets not changed (use --link)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
