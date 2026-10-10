"""
Quality of the AI-extracted journey events, per asset, measured against the regulators' own records.

    python -m scripts.extraction_report            (inside the crawler container, or with MONGO_URI set)

Read-only. Columns:
  ai            AI events on the journey
  stated/pub    how their dates were set: stated in the text / the document's date (events extracted before
                date_basis existed count as "legacy")
  checked       AI approval / label-expansion claims a regulator record could check (US or EU, past)
  confirmed     ... that a regulator record within 45 days confirms
  unconfirmed   ... that no regulator record confirms (possible misdates or misreads). Confirmed duplicates of a
                regulator approval are folded into it by finalize, so they leave the AI count.
  conflicts     decision dates that differ for the same subject (any origin)
  lit_bg        approvals / deals dated by a paper or abstract (background the extractor now drops)
  other_sponsor regulator events of another company's product of the same molecule
"""

from collections import Counter

from storage.mongo_storage import get_db

LITERATURE = {"publication_records", "conference_records"}
OWN_IN_LITERATURE = {"publication", "trial_readout"}


def report(db) -> list:
    rows = []
    for a in db.assets.find({}, {"_id": 1}).sort("_id", 1):
        aid = a["_id"]
        ai = list(db.journey_events.find({"asset": aid, "origin": "ai"},
                                         {"date_basis": 1, "verification": 1, "type": 1, "sources": 1}))
        basis = Counter(e.get("date_basis") or "legacy" for e in ai)
        status = Counter((e.get("verification") or {}).get("status") for e in ai)
        checked = status["confirmed"] + status["unconfirmed"]
        lit_bg = sum(1 for e in ai if e["type"] not in OWN_IN_LITERATURE
                     and ((e.get("sources") or [{}])[0]).get("collection") in LITERATURE
                     and e["type"] in {"approval", "label_expansion", "deal", "launch", "regulatory_submission"})
        rows.append({
            "asset": aid, "ai": len(ai), "stated": basis["stated"], "pub": basis["publication"], "legacy": basis["legacy"],
            "checked": checked, "confirmed": status["confirmed"], "unconfirmed": status["unconfirmed"],
            "conflicts": db.journey_events.count_documents({"asset": aid, "verification.status": "conflict"}),
            "lit_bg": lit_bg,
            "other_sponsor": db.journey_events.count_documents({"asset": aid, "origin": "rule", "sponsor_is_company": False}),
        })
    return rows


if __name__ == "__main__":
    rows = report(get_db())
    cols = list(rows[0]) if rows else []
    print("  ".join(f"{c:>13}" if i else f"{c:<13}" for i, c in enumerate(cols)))
    for r in rows:
        print("  ".join(f"{r[c]!s:>13}" if i else f"{r[c]!s:<13}" for i, c in enumerate(cols)))
