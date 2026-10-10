"""company -> latest decks -> per deck: download -> extract (worker) -> vision (selective) -> validate -> store.

Incremental: a known URL is revalidated (conditional GET) instead of re-downloaded; extraction is cached by (pdf sha,
extractor version, limits); vision by (page image sha, slide text, model, prompt + schema, output budget). A model
change re-runs only vision. Each deck fails closed on its own (status "failed" + reason); nothing here raises into the
caller except programming errors in setup.

Data integrity on re-runs: metric/claim ids come from what a fact IS (page + metric/arm/trial/... or the chart bar), never
from list positions, and model facts are only replaced or marked stale for pages whose vision result is authoritative
(ok/cached/not_needed). A failed, disabled or deferred vision stage keeps the previous run's facts for that page.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import re
import shutil
import tempfile
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from ..matching import normalize
from ..net import Cache, Http
from ..store import Store
from .artifacts import ArtifactStore, stage_key
from .config import PresentationSettings, presentation_settings
from .discovery import discover
from .downloader import DownloadError, Downloader
from .storage import PresentationStore
from .supervisor import WorkerFailed, run_worker
from .vision import PROMPT, PROMPT_VERSION, SCHEMA, SLIDE_TEXT_CHARS, VisionClient, VisionError

log = logging.getLogger("patent_intel.presentations")
EXTRACTOR_VERSION = "native-5"  # bump when worker.py output changes -> extraction cache invalidates
VISION_PRIORITY = ("no_text_layer", "chart", "table", "clinical_terms", "large_image")
AUTHORITATIVE = {"ok", "cached", "not_needed"}  # vision outcomes that may replace/retire a page's model facts
MODEL_PAGE_FIELDS = ("title", "slide_type", "model_charts", "model_tables")
# percentages that are shares of a whole (cannot exceed 100); growth/change percentages can
PROPORTION = re.compile(r"\b(?:rate|ORR|DCR|response|proportion|incidence|prevalence)\b", re.I)
CHANGE = re.compile(r"growth|change|increase|decrease|reduction|improvement|versus|\bvs\b", re.I)


def company_key(company: str | None, ticker: str | None) -> str:
    """One key per company whatever the caller adds: the (required) name wins over the optional ticker, so
    {UT, ticker UTHR} and {UT} share one lock, one work area and one company_id. Legal suffixes are dropped."""
    base = (company or ticker or "unknown").lower()
    return re.sub(r"[^a-z0-9]+", "-", normalize(base).lower() or base).strip("-")[:60] or "unknown"


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


# ---------------------------------------------------------------- validation (deterministic, no model calls)

def validate_metrics(metrics: list[dict[str, Any]], vector_chart: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Flag impossible values and cross-check model-read chart values against vector-geometry values."""
    bars = (vector_chart or {}).get("bars", [])
    geo = {normalize(b["label"] or ""): b["value"] for b in bars if b.get("label")}
    scale = _scale(bars)
    out = []
    for m in metrics:
        issues, status = [], "unverified"
        v, unit, name = m.get("value"), (m.get("unit") or "").strip(), m.get("metric") or ""
        if isinstance(v, (int, float)):
            if unit == "%" and PROPORTION.search(name) and not CHANGE.search(name) and not 0 <= v <= 100:
                issues.append("percent_out_of_range")  # a share of patients cannot be 140 %; revenue growth can
            if re.search(r"p[-\s]?value", name, re.I) and not 0 <= v <= 1:
                issues.append("p_value_out_of_range")
            if m.get("source_element") == "chart" and geo:
                ref = geo.get(normalize(m.get("arm") or ""))
                if ref is not None:
                    status = "validated" if _agrees(v, ref, scale) else "conflict"
                    m = {**m, "geometry_value": ref}
        if (m.get("confidence") or 0) < 0.5:
            issues.append("low_confidence")
        out.append({**m, "validation": {"status": "invalid" if issues and status != "validated" and any(
            i.endswith("out_of_range") for i in issues) else status, "issues": issues}})
    return out


def _scale(bars: list[dict[str, Any]]) -> float:
    return max((abs(b["value"]) for b in bars), default=0.0)


def _agrees(model: float, geo: float, scale: float) -> bool:
    """Model reading vs vector geometry: within 2 % of the value or 1 % of the chart's largest bar (models round to the
    printed label). Scale-relative, so a 0..0.5 chart is checked as strictly as a 0..40 one."""
    return abs(model - geo) <= max(0.02 * abs(geo), 0.01 * scale)


def _ident_id(prefix: str, parts: list[str], seen: Counter[str]) -> str:
    """Stable id from a fact's identity (not its list position); a repeat of the same identity on a page gets -2, -3."""
    h = hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:16]
    seen[h] += 1
    return f"{prefix}{h}" + (f"-{seen[h]}" if seen[h] > 1 else "")


def metric_id(pid: str, page: int, m: dict[str, Any], seen: Counter[str]) -> str:
    if m.get("method") == "vector_geometry":  # a bar is the same bar whatever the model calls it (or if vision is off)
        parts = ["geo", str(m["bar_index"])]
    else:
        parts = ["model"] + [normalize(str(m.get(k) or "")) for k in ("metric", "arm", "trial", "indication", "timepoint",
                                                                      "comparator", "unit")]
    return _ident_id(f"{pid}:{page}:m", parts, seen)


def claim_id(pid: str, page: int, c: dict[str, Any], seen: Counter[str]) -> str:
    return _ident_id(f"{pid}:{page}:c", [str(c.get("category")), normalize(c.get("statement") or "")], seen)


def reconcile_chart(vector_chart: dict[str, Any] | None, res: dict[str, Any]) -> list[dict[str, Any]]:
    """Pair geometry bars (left -> right) with the model's chart points in order when the counts match.
    Geometry gives the precise value; the model gives clean labels (rotated axis text is unreliable in PDFs).
    status: validated (agree within rounding) | conflict | geometry_only (model could not read the value)."""
    bars = (vector_chart or {}).get("bars") or []
    if not bars:
        return []
    series = next((s for c in res.get("charts", []) for s in c["series"] if len(s["points"]) == len(bars)), None)
    chart = next((c for c in res.get("charts", []) if series and series in c["series"]), None)
    scale = _scale(bars)
    out = []
    for i, b in enumerate(bars):
        pt = series["points"][i] if series else None
        mv = pt["y"] if pt else None
        st = "geometry_only" if mv is None else "validated" if _agrees(mv, b["value"], scale) else "conflict"
        out.append({"bar_index": i, "metric": (series or {}).get("name") or (chart or {}).get("title") or "chart value",
                    "value": round(b["value"], 4), "model_value": mv, "value_text": str(round(b["value"], 2)),
                    "unit": (chart or {}).get("y_axis"), "arm": (pt or {}).get("x") or b["label"], "trial": None,
                    "indication": None, "timepoint": (pt or {}).get("x"), "comparator": None, "p_value_text": None,
                    "source_element": "chart", "method": "vector_geometry", "bbox": b["bbox"],
                    "confidence": vector_chart["confidence"], "validation": {"status": st, "issues": []}})  # type: ignore[index]
    return out


# ---------------------------------------------------------------- one deck

async def _extract(cand: dict[str, Any], src: dict[str, Any], doc_id: str, ps: PresentationSettings,
                   arts: ArtifactStore, tel: dict[str, Any]) -> list[dict[str, Any]]:
    limits = {"dpi": ps.render_dpi, "max_pixels": ps.max_page_pixels, "max_images": ps.max_images_per_page,
              "max_pages": ps.max_pages, "vision_side": ps.vision_image_max_side}
    key = stage_key(src["sha256"], EXTRACTOR_VERSION, limits)
    if (hit := await asyncio.to_thread(arts.cache_get, key)) is not None:
        tel["extract_cache_hit"] = True
        return hit
    await asyncio.to_thread((ps.data_dir / "work").mkdir, parents=True, exist_ok=True)
    # private per run: two jobs on the same content (other company key, CLI + API) never share or delete each other's files
    work = Path(await asyncio.to_thread(tempfile.mkdtemp, prefix=f"{doc_id}-", dir=ps.data_dir / "work"))
    job = {**limits, "out_dir": str(work)}
    job |= {"images": src["image_paths"]} if cand["kind"] == "html_slides" else {"pdf": src["path"]}
    pages: list[dict[str, Any]] = []
    wt: dict[str, Any] = {}
    try:
        async with contextlib.aclosing(run_worker(job, page_timeout=ps.page_timeout_s, job_timeout=ps.job_timeout_s,
                                                  memory_limit_mb=ps.memory_limit_mb, telemetry=wt)) as stream:
            async for msg in stream:
                if msg["type"] == "error":
                    raise WorkerFailed(msg.get("code", "error"), msg.get("message", ""))
                if msg["type"] == "inspect":
                    tel["page_count"] = msg["page_count"]
                elif msg["type"] == "page":  # move page artifacts into the content-addressed store, keep refs
                    msg = await asyncio.to_thread(_store_page_files, msg, arts)  # hashing/copying off the loop
                    pages.append(msg)
    finally:
        tel["worker"] = wt
        await asyncio.to_thread(shutil.rmtree, work, True)  # page files now live in the object store
    await asyncio.to_thread(arts.cache_put, key, pages)
    return pages


def _store_page_files(msg: dict[str, Any], arts: ArtifactStore) -> dict[str, Any]:
    """Move one page's files into the content-addressed store; replace paths with {sha256, path, size}."""
    msg["page_png"] = arts.put_file(Path(msg["page_png"]), ".png")
    msg["vision_png"] = arts.put_file(Path(msg["vision_png"]), ".png")
    images = []
    for i in msg["images"]:
        i = dict(i)
        if path := i.pop("path", None):
            i["artifact"] = arts.put_file(Path(path), ".png", move=True)
        images.append(i)
    msg["images"] = images
    return msg


async def _vision(pages: list[dict[str, Any]], vision: VisionClient | None, ps: PresentationSettings,
                  arts: ArtifactStore, tel: dict[str, Any]) -> dict[int, dict[str, Any]]:
    """{page: {"status": ok|cached|deferred|failed|disabled|not_needed, "result": ...}} within the page budget."""
    out: dict[int, dict[str, Any]] = {}
    wanted = sorted((p for p in pages if p["needs_vision"]),
                    key=lambda p: (min(VISION_PRIORITY.index(r) for r in p["vision_reasons"]), p["page"]))
    for p in pages:
        if not p["needs_vision"]:
            out[p["page"]] = {"status": "not_needed"}
    if vision is None:
        out |= {p["page"]: {"status": "disabled"} for p in wanted}
        return out
    budget = wanted[: ps.vision_max_pages]
    out |= {p["page"]: {"status": "deferred"} for p in wanted[ps.vision_max_pages:]}  # budget exhausted: kept, not lost

    def key(p: dict[str, Any]) -> str:  # every input that shapes the answer: image, the text sent, model, prompt, schema, budget
        text_sha = hashlib.sha256(p["text"][:SLIDE_TEXT_CHARS].encode()).hexdigest()
        return stage_key(p["vision_png"]["sha256"], text_sha, vision.model, PROMPT_VERSION, PROMPT, SCHEMA,
                         vision.max_output_tokens, vision.retry_max_output_tokens)

    async def one(k: str, p: dict[str, Any]) -> dict[str, Any]:
        """Never raises (except cancellation): one bad page must not orphan its siblings' paid requests."""
        try:
            if (hit := await asyncio.to_thread(arts.cache_get, k)) is not None:
                return {"status": "cached", "result": hit}
            res = await vision.analyse(Path(p["vision_png"]["path"]), p["text"], p["page"])
        except VisionError as e:
            return {"status": "failed", "error": str(e)[:200]}
        except Exception as e:  # missing image, corrupt cache entry, odd response: contained like VisionError
            log.warning("vision page=%d failed: %s", p["page"], type(e).__name__)
            return {"status": "failed", "error": type(e).__name__}
        try:
            await asyncio.to_thread(arts.cache_put, k, res)
        except OSError as e:  # result is still good; only the cache write failed
            log.warning("vision cache write failed: %s", type(e).__name__)
        return {"status": "ok", "result": res}

    groups: dict[str, list[dict[str, Any]]] = {}
    for p in budget:  # identical slides (same image + text) are asked once
        groups.setdefault(key(p), []).append(p)
    t0 = time.monotonic()
    results = await asyncio.gather(*(one(k, ps_[0]) for k, ps_ in groups.items()))  # bounded inside VisionClient
    for same, r in zip(groups.values(), results, strict=True):
        out |= {p["page"]: r for p in same}
    tel["vision_s"] = round(time.monotonic() - t0, 2)
    return out


async def process_deck(cand: dict[str, Any], *, ck: str, http_dl: Downloader, vision: VisionClient | None,
                       pstore: PresentationStore, arts: ArtifactStore, ps: PresentationSettings,
                       worker_slots: asyncio.Semaphore) -> dict[str, Any]:
    tel: dict[str, Any] = {}
    t0 = time.monotonic()
    report: dict[str, Any] = {"url": cand["url"], "title": cand["title"], "date": cand["date"], "kind": cand["kind"]}
    try:
        # ---- download. SEC archive URLs are immutable -> a known one is reused. Any other known URL is revalidated with a
        # conditional GET (publishers replace files in place); unreachable -> keep using the copy we have.
        known = await pstore.known_url(cand["url"])
        prev = known or {}
        have = bool(prev) and await asyncio.to_thread(Path(prev["artifact"]["path"]).exists)
        validators, d = prev.get("http_validators"), None
        if cand["kind"] == "pdf" and not (have and cand["source"] == "sec"):
            try:
                d = await http_dl.fetch(cand["url"], "pdf", validators if have else None)  # None = 304 Not Modified
            except DownloadError:
                if not have:
                    raise
                tel["revalidation"] = "failed_used_known"
        slide_arts: list[dict[str, Any]] = []
        if d is not None:
            src = await asyncio.to_thread(arts.put_file, d["tmp_path"], ".pdf", d["sha256"], True)
            validators = d["validators"]
            tel["download"] = "deduplicated" if src["deduplicated"] else "downloaded"
        elif have:
            src = prev["artifact"] | {"image_paths": [a["path"] for a in prev.get("slide_artifacts", [])]}
            tel["download"] = "skipped_known"
            slide_arts = prev.get("slide_artifacts", [])
        else:  # SEC HTML deck: slide images, capped
            for u in cand["slide_images"][: ps.max_pages]:
                img = await http_dl.fetch(u, "image")
                if img is None:  # only possible with validators, which are never sent here
                    raise DownloadError("protocol", "unexpected 304")
                ext = re.sub(r"[^a-z0-9.]", "", Path(urlsplit(u).path).suffix.lower())[:5] or ".img"  # never a path part
                slide_arts.append(await asyncio.to_thread(arts.put_file, img["tmp_path"], ext, img["sha256"], True) | {"url": u})
            combined = hashlib.sha256("".join(a["sha256"] for a in slide_arts).encode()).hexdigest()
            src = {"sha256": combined, "path": slide_arts[0]["path"] if slide_arts else "", "size": sum(a["size"] for a in slide_arts),
                   "image_paths": [a["path"] for a in slide_arts]}
            tel["download"] = "downloaded"
        pid = f"pres_{src['sha256'][:24]}"
        report["presentation_id"] = pid

        # ---- extract (worker process) / vision / validate
        async with worker_slots:  # local CPU/RAM work only; released before the (remote) vision stage
            pages = await _extract(cand, src, pid, ps, arts, tel)
        vis = await _vision(pages, vision, ps, arts, tel)
        doc_dir = await asyncio.to_thread(arts.doc_dir, ck, pid)
        # pages whose vision result is not authoritative this run (failed/disabled/deferred) keep the facts of the last
        # authoritative run, if there was one; their new (geometry-only) facts are not written over them
        held = {n for n, v in vis.items() if v["status"] not in AUTHORITATIVE}
        prev_pages = await pstore.get_many("presentation_pages", [f"{pid}:{n}" for n in held]) if held else {}
        carried = {n: pp for n in held if (pp := prev_pages.get(f"{pid}:{n}"))
                   and pp.get("facts_vision_status", pp.get("vision_status")) in AUTHORITATIVE}
        metrics, claims, page_docs = [], [], []
        for p in pages:
            n = p["page"]
            v = vis.get(n, {})
            res = v.get("result") or {}
            if n not in carried:
                seen: Counter[str] = Counter()
                for m in validate_metrics(res.get("metrics", []), p["vector_chart"]) + reconcile_chart(p["vector_chart"], res):
                    metrics.append({"_id": metric_id(pid, n, m, seen), "presentation_id": pid, "company_id": ck, "page": n,
                                    **m, "evidence": {"presentation_id": pid, "page": n, "bbox": m.get("bbox"),
                                                      "artifact_sha256": p["page_png"]["sha256"]},
                                    "model": vision.model if vision else None, "prompt_version": PROMPT_VERSION,
                                    "stale": False, "stale_since": None})
                seen = Counter()
                for c in res.get("claims", []):
                    claims.append({"_id": claim_id(pid, n, c, seen), "presentation_id": pid, "company_id": ck, "page": n,
                                   **c, "evidence": {"presentation_id": pid, "page": n, "artifact_sha256": p["page_png"]["sha256"]},
                                   "stale": False, "stale_since": None})
            page_doc = {
                "_id": f"{pid}:{n}", "presentation_id": pid, "company_id": ck, "page": n,
                "title": res.get("slide_title"), "slide_type": res.get("slide_type"), "text": p["text"][:20000],
                "has_text_layer": p["has_text_layer"], "vision_reasons": p["vision_reasons"],
                "vision_status": v.get("status"), "facts_vision_status": v.get("status"),
                "tables": [{"bbox": t["bbox"], "rows": t["rows"][:50]} for t in p["tables"]],
                "vector_chart": p["vector_chart"], "model_charts": res.get("charts", []), "model_tables": res.get("tables", []),
                "page_png": p["page_png"], "images": [i.get("artifact", {}).get("sha256") for i in p["images"]]}
            if pp := carried.get(n):
                page_doc |= {k: pp.get(k) for k in MODEL_PAGE_FIELDS}
                page_doc["facts_vision_status"] = pp.get("facts_vision_status", pp.get("vision_status"))
            page_docs.append(page_doc)
        kept = {coll: [r["_id"] for r in await pstore.current(coll, pid) if r["page"] in carried] if carried else []
                for coll in ("presentation_metrics", "presentation_claims")}

        extraction = await asyncio.to_thread(arts.write_json_zst, doc_dir / "extraction" / "pages.json.zst", pages)
        vis_art = await asyncio.to_thread(arts.write_json_zst, doc_dir / "extraction" / "vision.json.zst", vis)
        statuses = [v["status"] for v in vis.values()]
        doc = {"_id": pid, "presentation_id": pid, "company_id": ck, "title": cand["title"], "date": cand["date"],
               "source": cand["source"], "source_url": cand["url"], "kind": cand["kind"], "artifact": src | {"image_paths": None},
               "slide_artifacts": slide_arts, "page_count": len(pages), "extractor_version": EXTRACTOR_VERSION,
               "vision_model": vision.model if vision else None,
               "vision_summary": {s: statuses.count(s) for s in set(statuses)},
               "http_validators": validators,
               "counts": {"metrics": len(metrics) + len(kept["presentation_metrics"]),
                          "claims": len(claims) + len(kept["presentation_claims"]),
                          "tables": sum(t["real_table"] for p in pages for t in p["tables"]),
                          "vector_charts": sum(1 for p in pages if p["vector_chart"]), "images": sum(len(p["images"]) for p in pages)},
               "extraction_artifacts": [extraction, vis_art], "status": "done", "error": None}
        t_db = time.monotonic()
        await pstore.upsert("presentation_pages", page_docs)
        await pstore.upsert("presentation_metrics", metrics)
        await pstore.upsert("presentation_claims", claims)
        await pstore.mark_stale("presentation_metrics", pid, {m["_id"] for m in metrics} | set(kept["presentation_metrics"]))
        await pstore.mark_stale("presentation_claims", pid, {c["_id"] for c in claims} | set(kept["presentation_claims"]))
        tel["mongo_s"] = round(time.monotonic() - t_db, 2)
        tel["total_s"] = round(time.monotonic() - t0, 2)
        doc["telemetry"] = tel
        await pstore.upsert("presentations", [doc])
        if known and known["_id"] != pid:  # same URL, new content: the old version stays queryable, marked as replaced
            await pstore.upsert("presentations", [known | {"superseded_by": pid}])
        await asyncio.to_thread(arts.write_manifest, doc_dir, {
            "presentation_id": pid, "source_url": cand["url"], "pdf_sha256": src["sha256"], "extractor_version": EXTRACTOR_VERSION,
            "artifacts": [{"type": "original", "sha256": src["sha256"], "path": src["path"], "size": src["size"]}]
            + [{"type": "slide_image", **a} for a in slide_arts]
            + [{"type": "page", "page": p["page"], **p["page_png"]} for p in pages]
            + [{"type": "embedded_image", "page": p["page"], **i["artifact"]} for p in pages for i in p["images"] if i.get("artifact")]
            + [{"type": "extraction", **extraction}, {"type": "vision", **vis_art}]})
        return report | {"status": "done", "pages": len(pages), "metrics": doc["counts"]["metrics"], "claims": doc["counts"]["claims"],
                         "vision": doc["vision_summary"], "telemetry": tel}
    except (DownloadError, WorkerFailed) as e:  # expected per-document failures: contained
        return report | {"status": "failed", "error": getattr(e, "code", type(e).__name__), "telemetry": tel}
    except Exception as e:  # anything else: still contained, logged without document content
        log.exception("presentation failed url_host=%s", cand["url"].split("/")[2])
        return report | {"status": "failed", "error": type(e).__name__, "telemetry": tel}


# ---------------------------------------------------------------- one company

async def process_company(*, store: Store, company: str | None, ticker: str | None = None, ir_url: str | None = None,
                          sec_user_agent: str | None = None, ps: PresentationSettings | None = None) -> dict[str, Any]:
    ps = ps or presentation_settings()
    ck = company_key(company, ticker)
    arts = await asyncio.to_thread(ArtifactStore, ps.data_dir)
    pstore = PresentationStore(store)
    http = Http(Cache(ps.data_dir / "http-cache"), public_web=True)  # own pool, SSRF-guarded
    dl = Downloader(ps.data_dir / "tmp", ps.max_pdf_mb * 2**20, sec_user_agent)
    vision = (VisionClient(ps.openai_api_key.get_secret_value(), ps.vision_model, timeout_s=ps.vision_timeout_s,  # type: ignore[union-attr]
                           max_output_tokens=ps.vision_max_output_tokens, concurrency=ps.vision_concurrency,
                           max_attempts=ps.vision_max_attempts, retry_max_output_tokens=ps.vision_retry_max_output_tokens)
              if ps.vision_enabled else None)
    started = _now()
    try:
        await pstore.ensure_indexes()
        decks, disc = await discover(http, company=company, ticker=ticker, ir_url=ir_url, n=ps.latest_n,
                                     sec_user_agent=sec_user_agent)
        worker_slots = asyncio.Semaphore(ps.max_concurrent)  # = concurrent worker processes (local resources)

        async def one(c: dict[str, Any]) -> dict[str, Any]:
            # decks overlap: while one deck is in the worker, others download or wait on vision (bounded in VisionClient).
            # Parent memory stays bounded without serialising decks (measured 3x slower): queued vision pages hold no
            # image (read inside the slot) and each deck's pages are capped by supervisor.MAX_OUTPUT_BYTES.
            return await process_deck(c, ck=ck, http_dl=dl, vision=vision, pstore=pstore, arts=arts, ps=ps,
                                      worker_slots=worker_slots)

        results = await asyncio.gather(*(one(c) for c in decks))
    finally:
        await http.aclose()
        await dl.aclose()
        if vision:
            await vision.aclose()
    return {"company_id": ck, "started_at": started, "finished_at": _now(), "discovery": disc, "presentations": results,
            "vision": {"enabled": vision is not None, "model": ps.vision_model if vision else None,
                       "calls": vision.calls if vision else 0, "input_tokens": vision.input_tokens if vision else 0,
                       "output_tokens": vision.output_tokens if vision else 0}}
