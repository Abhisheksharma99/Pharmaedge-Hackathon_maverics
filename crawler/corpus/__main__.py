"""
Run corpus sources: python -m corpus [source or group ...] [--full]   (from crawler/; default: every source)

The corpus worker runs this in a child process per group. SIGTERM (the worker stopping, or the job's timeout)
asks the running source to stop after its current unit (spider, year, report); its progress is kept.
"""

import argparse
import json
import logging
import signal
import sys
import threading

from dotenv import load_dotenv

load_dotenv()

from corpus import GROUPS, run_source, sources  # noqa: E402
from storage.mongo_storage import get_db  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Crawl the shared corpora into MongoDB")
    parser.add_argument("names", nargs="*", help=f"sources or groups (groups: {', '.join(GROUPS)}); default: all")
    parser.add_argument("--full", action="store_true", help="crawl in full again, even if done before")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger("scrapy").setLevel(logging.WARNING)

    names = [s for n in args.names or GROUPS for s in GROUPS.get(n, [n])]
    unknown = [n for n in names if n not in sources()]
    if unknown:
        parser.error(f"unknown sources: {', '.join(unknown)}; known: {', '.join(sources())}")

    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    db, failed = get_db(), 0
    for name in names:
        if stopping.is_set():
            break
        try:
            result = run_source(db, name, force_full=args.full, should_stop=stopping.is_set)
        except Exception as e:  # noqa: BLE001 - recorded on the source's state; the group's other sources still run
            logging.exception("corpus %s failed", name)
            result, failed = {"error": f"{type(e).__name__}: {e}"}, failed + 1
        print(json.dumps({"source": name, **result}, default=str), flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
