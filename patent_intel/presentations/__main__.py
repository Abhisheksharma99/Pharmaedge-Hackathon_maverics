"""CLI.

  python -m patent_intel.presentations crawl --company "United Therapeutics" --ticker UTHR \\
         --ir-url https://ir.unither.com/events-and-presentations
  python -m patent_intel.presentations benchmark --company-key uthr --models gpt-5.6-luna gpt-6-luna --pages 20
  python -m patent_intel.presentations gc [--delete] [--grace-hours 48] [--cache-days 90]   (dry run without --delete)

Storage follows the main .env (MONGO_URI -> MongoDB, else JSON in DATA_DIR). Vision needs OPENAI_API_KEY.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..config import settings
from ..matching import normalize
from ..store import open_store
from .artifacts import ArtifactStore
from .config import presentation_settings
from .pipeline import VISION_PRIORITY, process_company, validate_metrics
from .vision import VisionClient, VisionError

# $/1M tokens (input, output), OpenAI pricing page as checked 2026-10-09 - update when prices change
PRICES = {"gpt-5.6-luna": (0.20, 1.20), "gpt-6-luna": (0.10, 0.50), "gpt-5.6-terra": (2.00, 12.00), "gpt-6-astra": (10.00, 50.00)}


async def crawl(a: argparse.Namespace) -> None:
    s = settings()
    store = await open_store(s.store_spec(), s.mongo_db, s.mongo_tls_ca_file)
    try:
        rep = await process_company(store=store, company=a.company, ticker=a.ticker, ir_url=a.ir_url, sec_user_agent=s.sec_user_agent)
    finally:
        await store.close()
    print(json.dumps(rep, indent=1, default=str))


async def benchmark(a: argparse.Namespace) -> None:
    ps = presentation_settings()
    if not ps.vision_enabled:
        raise SystemExit("OPENAI_API_KEY is not set")
    pages: list[dict[str, Any]] = []
    for f in sorted((ps.data_dir / a.company_key).glob("*/extraction/pages.json.zst")):
        pages += [p | {"deck": f.parts[-3]} for p in await asyncio.to_thread(ArtifactStore.read_json_zst, f) if p["needs_vision"]]
    pages.sort(key=lambda p: (min(VISION_PRIORITY.index(r) for r in p["vision_reasons"]), p["deck"], p["page"]))
    pages = pages[: a.pages]
    if not pages:
        raise SystemExit(f"no extracted pages for '{a.company_key}' - run crawl first")
    results: dict[str, Any] = {}
    for model in a.models:
        vc = VisionClient(ps.openai_api_key.get_secret_value(), model, timeout_s=ps.vision_timeout_s,  # type: ignore[union-attr]
                          max_output_tokens=ps.vision_max_output_tokens, concurrency=ps.vision_concurrency,
                           max_attempts=ps.vision_max_attempts, retry_max_output_tokens=ps.vision_retry_max_output_tokens)
        per_page, errors, checks = [], 0, Counter()
        try:
            for p in pages:
                try:
                    res = await vc.analyse(Path(p["vision_png"]["path"]), p["text"], p["page"])
                except VisionError as e:
                    errors += 1
                    per_page.append({"deck": p["deck"], "page": p["page"], "error": str(e)})
                    continue
                checks.update(m["validation"]["status"] for m in validate_metrics(res.get("metrics", []), p["vector_chart"]))
                per_page.append({"deck": p["deck"], "page": p["page"], "result": res})
        finally:
            await vc.aclose()
        pin, pout = PRICES.get(model, (None, None))
        cost = None if pin is None else round(vc.input_tokens / 1e6 * pin + vc.output_tokens / 1e6 * pout, 4)
        results[model] = {"pages": len(pages), "calls": vc.calls, "errors": errors, "input_tokens": vc.input_tokens,
                          "output_tokens": vc.output_tokens, "cost_usd": cost,
                          "cost_per_page_usd": round(cost / max(vc.calls, 1), 5) if cost is not None else None,
                          "metrics": sum(len(x.get("result", {}).get("metrics", [])) for x in per_page),
                          "geometry_checks": dict(checks), "per_page": per_page}

    def facts(model: str) -> set[tuple[str, str, Any]]:
        return {(normalize(m["metric"]), normalize(m.get("arm") or ""), m.get("value"))
                for x in results[model]["per_page"] for m in x.get("result", {}).get("metrics", [])}
    if len(a.models) == 2:
        f1, f2 = facts(a.models[0]), facts(a.models[1])
        results["agreement"] = {"same_metric_arm_value": len(f1 & f2), f"only_{a.models[0]}": len(f1 - f2),
                                f"only_{a.models[1]}": len(f2 - f1)}
    out = ps.data_dir / "benchmarks" / f"{a.company_key}-{datetime.now(UTC):%Y%m%dT%H%M%S}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=1, default=str))
    summary = {m: {k: v for k, v in r.items() if k != "per_page"} for m, r in results.items() if m != "agreement"}
    print(json.dumps({"summary": summary, "agreement": results.get("agreement"), "details_file": str(out)}, indent=1))


def main() -> None:
    ap = argparse.ArgumentParser(prog="patent_intel.presentations")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crawl", help="discover + process the latest presentations of a company")
    c.add_argument("--company", required=True)
    c.add_argument("--ticker")
    c.add_argument("--ir-url", help="IR 'events & presentations' page (https)")
    b = sub.add_parser("benchmark", help="compare vision models on already-extracted slides")
    b.add_argument("--company-key", required=True, help="e.g. uthr (directory under PRESENTATION_DATA_DIR)")
    b.add_argument("--models", nargs="+", default=["gpt-5.6-luna", "gpt-6-luna"])
    b.add_argument("--pages", type=int, default=20)
    g = sub.add_parser("gc", help="reclaim disk: unreferenced objects + stale temp/work files (dry run without --delete)")
    g.add_argument("--delete", action="store_true")
    g.add_argument("--grace-hours", type=float, default=48, help="never touch files newer than this (running jobs)")
    g.add_argument("--cache-days", type=float, help="also drop stage-cache entries older than this (re-pays vision)")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if a.cmd == "gc":
        arts = ArtifactStore(presentation_settings().data_dir)
        print(json.dumps(arts.gc(grace_s=a.grace_hours * 3600, delete=a.delete,
                                 cache_max_age_s=None if a.cache_days is None else a.cache_days * 86400)))
        return
    asyncio.run(crawl(a) if a.cmd == "crawl" else benchmark(a))


if __name__ == "__main__":
    main()
