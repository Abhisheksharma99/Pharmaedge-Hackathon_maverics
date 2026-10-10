"""CLI: python -m patent_intel 800010447 [800000002 ...]   |   python -m patent_intel --name treprostinil --company "United Therapeutics"
Storage comes from .env / environment (MONGO_URI set -> MongoDB, else JSON in DATA_DIR)."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging

from .config import settings
from .net import Cache, Http
from .pipeline import run_drug
from .store import open_store


async def main() -> None:
    ap = argparse.ArgumentParser(prog="patent_intel", description="Drug -> developer -> Google Patents biblio data (no credentials)")
    ap.add_argument("drugs", nargs="*", help="AdisInsight drug id or URL (developers are read from that profile)")
    ap.add_argument("--name", help="drug name, when there is no Adis id (company is looked up on ClinicalTrials.gov)")
    ap.add_argument("--company", action="append", help="company name(s); overrides Adis developers (repeatable)")
    ap.add_argument("--all-developers", action="store_true", help="use every Adis developer, not just the profile's primary company")
    ap.add_argument("--term", action="append", help="override drug terms (repeatable); default: drug + Adis alternative names")
    ap.add_argument("--seed", action="append", help="known publication number(s) to start from, e.g. US9604901B2")
    ap.add_argument("--max-pages", type=int, default=settings().max_pages, help="Google Patents page budget per drug (~1 page/s)")
    ap.add_argument("--probe", type=int, default=settings().probe_pages, help="max PubChem probe pages used to find seeds")
    ap.add_argument("--no-regulatory", action="store_true", help="skip the PDUFA/approval timeline (SEC EDGAR + openFDA)")
    ap.add_argument("--no-fda-calendar", action="store_true", help="skip the FDA Tracker PDUFA/AdCom calendar")
    ap.add_argument("--no-market", action="store_true", help="skip listed companies + daily prices (stock impact)")
    a = ap.parse_args()
    if not a.drugs and not a.name:
        ap.error("give AdisInsight id(s) or --name")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per request is noise; progress logs every 50 pages

    s = settings()
    store = await open_store(s.store_spec(), s.mongo_db, s.mongo_tls_ca_file)
    http = Http(Cache(s.data_dir / ".cache"))
    jobs = [{"adis_ref": r} for r in a.drugs] or [{"drug_name": a.name}]
    try:
        for job in jobs:
            try:
                run = await run_drug(http=http, store=store, companies=a.company, all_developers=a.all_developers,
                                     terms=a.term, seeds=a.seed, max_pages=a.max_pages, probe_budget=a.probe,
                                     regulatory=not a.no_regulatory, fda_calendar=not a.no_fda_calendar,
                                     market=not a.no_market, **job)
                cov = {**run["coverage"], "family_members_not_fetched": len(run["coverage"]["family_members_not_fetched"])}
                print(json.dumps({"drug": run["drug_name"], "drug_id": run["drug_id"], **cov,
                                  "regulatory": run.get("regulatory"), "fda_calendar": run.get("fda_calendar"),
                                  "market": run.get("market")},
                                 indent=1, default=str))
            except Exception as e:  # keep going with the next drug
                logging.error("%s: %s: %s", job, type(e).__name__, e)
    finally:
        await http.aclose()
        await store.close()


if __name__ == "__main__":
    asyncio.run(main())
