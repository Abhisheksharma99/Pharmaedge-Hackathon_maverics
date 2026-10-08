"""Run the ERS, ATS and CHEST crawlers with one payload and merge their records.

Each crawler still writes its own output (conference/<name>/output/...); this also
writes every record, in the shared schema, to one file. A conference that fails (for
example a requested year it does not have) is reported and the others still run.

Usage:
    python conference/run.py '{"keywords": ["treprostinil", "Tyvaso"], "years": 2025}'
    python conference/run.py payload.json --only ers,ats

Output, in conference/output/<keywords-slug>/:
    abstracts.jsonl  records from every conference that ran
    manifest.json    payload, and per conference its manifest summary or error
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from . import common
    from .ats import ats
    from .chest import chest
    from .ers import ers
except ImportError:  # run as a script
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import common
    from ats import ats
    from chest import chest
    from ers import ers

CRAWLERS = {"ers": ers.crawl, "ats": ats.crawl, "chest": chest.crawl}
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output"

log = common.log


def crawl_all(payload: dict, output_dir: str | Path = DEFAULT_OUTPUT_DIR,
              only: list[str] | None = None) -> dict:
    options = common.parse_payload(payload)  # fail fast on a bad payload
    target = Path(output_dir) / common.slugify(options)
    target.mkdir(parents=True, exist_ok=True)
    abstracts_path = target / "abstracts.jsonl"
    partial_path = target / "abstracts.jsonl.part"

    results, count = {}, 0
    with partial_path.open("w", encoding="utf-8") as out:
        for name in only or CRAWLERS:
            try:
                manifest = CRAWLERS[name](payload)
            except (common.PayloadError, common.CrawlError) as e:
                log.error("%s: %s", name.upper(), e)
                results[name] = {"error": str(e)}
                continue
            with open(manifest["abstracts_file"], encoding="utf-8") as f:
                for line in f:
                    out.write(line)
                    count += 1
            results[name] = {k: manifest[k] for k in ("years", "abstract_count", "abstracts_file", "failed")}
    os.replace(partial_path, abstracts_path)

    manifest = {
        "source": "conference",
        "conferences": results,
        "keywords": options["keywords"],
        "crawled_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "abstract_count": count,
        "abstracts_file": str(abstracts_path),
        "payload": payload,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False),
                                          encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crawl ERS, ATS and CHEST abstracts with one payload.")
    parser.add_argument("payload", nargs="?", default="{}", help="JSON payload or path to a JSON file")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT_DIR,
                        help="output root for the merged file (default: %(default)s)")
    parser.add_argument("--only", help=f"comma-separated subset of {','.join(CRAWLERS)}")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        payload = json.loads(args.payload)
    except json.JSONDecodeError:
        try:
            payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            parser.error(f"payload is neither JSON nor a readable JSON file: {e}")
    only = [n.strip().lower() for n in args.only.split(",")] if args.only else None
    if only and set(only) - set(CRAWLERS):
        parser.error(f"--only takes {', '.join(CRAWLERS)}")

    try:
        manifest = crawl_all(payload, args.out, only)
    except common.PayloadError as e:
        parser.error(str(e))
    for name, result in manifest["conferences"].items():
        print(f"{name.upper()}: {result.get('abstract_count', 'failed: ' + result.get('error', ''))}")
    print(f"{manifest['abstract_count']} abstracts -> {manifest['abstracts_file']}")
    return 0 if all("error" not in r for r in manifest["conferences"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
