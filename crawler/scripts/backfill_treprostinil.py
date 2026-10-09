"""
One-off backfill for Treprostinil, crawled before the platform existed:
rename its record tags to the asset id, create its `assets` document, and build
its rule-based journey events. Safe to re-run.

    cd crawler && ../.venv/bin/python -m scripts.backfill_treprostinil

Later assets get their identity from the onboarding resolve step instead.
"""

from dotenv import load_dotenv

load_dotenv()

from journey.rules import build_rule_events  # noqa: E402
from journey.store import bump_asset_version, rename_asset_tag, replace_rule_events, upsert_asset  # noqa: E402
from storage.mongo_storage import get_db  # noqa: E402

ASSET = {
    "_id": "treprostinil",
    "name": "Treprostinil",
    "aliases": ["Tyvaso", "Tyvaso DPI", "Remodulin", "Orenitram", "Yutrepia", "Trepulmix"],
    "company": {
        "name": "United Therapeutics",
        "website": "https://www.unither.com",
        "ir_url": "https://ir.unither.com/press-releases",
    },
    # AdisInsight drug profile: the patent crawler reads developers and alternative names from it.
    "ids": {"adis": "800010447"},
    "tags": {
        "indications": ["Pulmonary arterial hypertension (PAH)", "PH-ILD"],
        "investigational_indications": ["Idiopathic pulmonary fibrosis", "Progressive pulmonary fibrosis"],
        "mechanism": "Prostacyclin analogue (IP receptor agonist)",
        "modality": "Small molecule",
        "routes": ["Subcutaneous / IV (Remodulin)", "Inhaled (Tyvaso, Tyvaso DPI)", "Oral (Orenitram)"],
    },
    "kind": "primary",
    "status": "ready",
    "competitors": [],
}


def main() -> None:
    db = get_db()
    print("renamed tags:", rename_asset_tag(db, "Treprostinil", ASSET["_id"]))
    upsert_asset(db, ASSET)
    events = build_rule_events(db, ASSET["_id"], ASSET["company"]["name"])
    print("journey events:", replace_rule_events(db, ASSET["_id"], events))
    print("cache invalidated:", bump_asset_version(ASSET["_id"]))


if __name__ == "__main__":
    main()
