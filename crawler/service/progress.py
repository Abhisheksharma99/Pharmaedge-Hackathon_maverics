"""
Live-build progress for the app (DATA_CONTRACTS §B.2): the asset's records per collection and per year, and the
size of its journey. Measured after every step and stored on the job.
"""

from typing import Any, Dict, List

from journey.store import COLLECTIONS_WITH_ASSETS

# "2021-03-31" -> "2021"; missing or non-string dates fall into an "" bucket (counted, not placed on a year).
YEAR = {"$substrBytes": [{"$ifNull": [{"$toString": "$date"}, ""]}, 0, 4]}


def measure(db, asset_id: str) -> Dict[str, Any]:
    by_coll: Dict[str, int] = {}
    years: List[Dict[str, Any]] = []
    for coll in COLLECTIONS_WITH_ASSETS:
        rows = list(db[coll].aggregate([{"$match": {"assets": asset_id}},
                                        {"$group": {"_id": YEAR, "n": {"$sum": 1}}}]))
        by_coll[coll] = sum(r["n"] for r in rows)
        years += [{"coll": coll, "year": int(r["_id"]), "n": r["n"]} for r in rows if str(r["_id"]).isdigit()]
    return {"records_by_coll": by_coll, "record_years": years,
            "events": db.journey_events.count_documents({"asset": asset_id})}
