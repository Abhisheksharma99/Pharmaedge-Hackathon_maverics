"""
FDA expedited-program approvals for an asset (Breakthrough Therapy, Priority Review, Accelerated Approval, Fast
Track), from the designations corpus the corpus worker loads from FDA's PDF lists (corpus/fda_designations.py).

Each list row is an FDA approval (application + submission + date) that used the program. They are stored as
`fda_records` (record_type `fda_expedited_approval`, key `fda_designation:{row id}`) so Asset AI can find and cite
them, and the journey rules attach the program to the matching Drugs@FDA approval event (same application,
submission type and number) instead of creating a second approval event.

A row belongs to the asset when one of its names (proprietary / established, as FDA prints them) is one of the
asset's names, compared case-insensitively. Read-only on the corpus.
"""

import os
from typing import Any, Dict, Iterator, List

from corpus import collection

COLLECTION = os.getenv("DESIGNATIONS_CORPUS", "pharmaedge.fda_designations")
MIN_NAME = 3  # shorter names ("ID", "XR") would match unrelated rows


def to_record(row: Dict[str, Any]) -> Dict[str, Any]:
    app = f"{row.get('application_type') or ''}{row.get('application_number') or ''}"
    original = (row.get("submission_type") or "").lower().startswith("orig")
    brand, generic = row.get("proprietary_name"), row.get("established_name")
    program = row.get("program_name") or (row.get("program") or "").replace("_", " ").title()
    return {
        "record_key": f"fda_designation:{row['_id']}",
        "record_type": "fda_expedited_approval",
        "source": "fda",
        "date": row.get("approval_date") or "",
        "title": f"{program}: {brand or generic or app}" + (f" ({row['indication'][:90]})" if row.get("indication") else ""),
        "program": row.get("program"),
        "program_name": program,
        "application_number": app,
        "submission_type": "ORIG" if original else "SUPPL",
        "submission_number": None if original else row.get("submission_number"),
        "brand_names": [brand] if brand else [],
        "generic_names": [generic] if generic else [],
        "sponsor_name": row.get("applicant"),
        "indication": row.get("indication"),
        "center": row.get("center"),
        "content": row.get("indication") or "",
        "source_document": row.get("source"),
    }


def for_asset(db, names: List[str]) -> Iterator[Dict[str, Any]]:
    upper = sorted({n.strip().upper() for n in names if len(n.strip()) >= MIN_NAME})
    if not upper:
        return
    for row in collection(db, COLLECTION).find({"names": {"$in": upper}}):
        if row.get("approval_date"):
            yield to_record(row)
