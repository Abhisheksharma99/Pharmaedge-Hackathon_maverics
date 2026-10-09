"""
Designations corpus: FDA expedited-program approvals (Accelerated Approval, Breakthrough Therapy, Fast Track,
Priority Review) parsed by the team's designations/ crawler from the FDA PDFs in designations/Designation_data/,
keyed by record id. A once-only source: the PDFs are a fixed set (add a new year's PDF and run
`python -m corpus designations --full` to load it).
"""

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List

from pymongo import UpdateOne

from corpus import collection
from integrations import TEAM_ROOT  # noqa: F401  (puts the team packages on sys.path)
from designations import designations as parser

COLLECTION = os.getenv("DESIGNATIONS_CORPUS", "pharmaedge.fda_designations")


def store(db, records: List[Dict[str, Any]]) -> int:
    coll = collection(db, COLLECTION)
    for field in ("names", "program", "application"):
        coll.create_index(field)
    now = datetime.now(timezone.utc)
    ops = [UpdateOne({"_id": r["id"]}, {"$set": {**r, "last_seen": now}, "$setOnInsert": {"first_seen": now}},
                     upsert=True) for r in records]
    return coll.bulk_write(ops, ordered=False).upserted_count if ops else 0


def crawl(db, *, full: bool, progress: Dict[str, Any], should_stop: Callable[[], bool]) -> Dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="designations-") as out:
        manifest = parser.crawl({}, out)
        records = json.loads((Path(out) / parser.RECORDS_FILE).read_text("utf-8"))
    return {"records": len(records), "records_new": store(db, records), **manifest["records_by_program"],
            "pdfs": len(manifest["sources"]),
            "pdf_row_mismatches": sum(s["check"] == "mismatch" for s in manifest["sources"])}
