"""Isolated PDF worker: `python -m patent_intel.presentations.worker`, one document per process.

Protocol: one JSON job on stdin; JSON lines on stdout ({"type": "inspect"|"page"|"error"|"done"}). Only paths and
small JSON cross the pipe - page images are written to `out_dir` here. The parent (supervisor.py) enforces page/job
timeouts and the RSS limit and kills this process group; this module only enforces per-page input caps.

Safety: PDFs are untrusted. pdfium has no JavaScript engine in these builds and forms are never initialised;
attachments/embedded files are never opened; page pixel counts are capped before rendering (page-size bombs);
decompression bombs are bounded by the parent's per-page timeout.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Any

NUM = re.compile(r"^[-+(]?\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\)?$|^[-+]?\d+(?:\.\d+)?%?$")
CLINICAL = re.compile(r"\b(?:ORR|PFS|OS|DoR|HR|CI|p\s*[<=]|n\s*=|placebo|endpoint|primary|secondary|efficacy|"
                      r"safety|adverse|response rate|survival|Phase\s*[123])\b", re.I)
MAX_SEGMENTS, MAX_TABLE_ROWS, MAX_TABLE_COLS, MAX_CELL = 1000, 200, 50, 300
MAX_TEXT, MAX_TABLES = 100_000, 20  # per page; real slides are ~1-3 K chars and 0-3 tables


def _num(s: str) -> float | None:
    s = s.strip()
    if not NUM.match(s):
        return None
    neg = s.startswith("(") and s.endswith(")")
    v = float(re.sub(r"[^\d.\-+]", "", s) or "nan")
    return -v if neg else v


def bar_chart(rects: list[dict], words: list[dict], page_w: float, page_h: float) -> dict | None:
    """Vertical bar chart from vector geometry: filled bars on a shared baseline + numeric y-axis tick labels ->
    linear calibration -> bar values. Returns None unless the calibration is exact enough to trust (no guessing)."""
    bars = [r for r in rects if r.get("fill") and 1.5 <= r["width"] <= page_w * 0.25 and r["height"] >= 2
            and r["width"] * r["height"] < page_w * page_h * 0.25]
    groups: dict[int, list[dict]] = {}
    for r in bars:
        groups.setdefault(round(r["bottom"] / 1.5), []).append(r)  # shared baseline (pdfplumber: top-left origin)
    if not groups:
        return None
    group = max(groups.values(), key=len)
    if len(group) < 2:
        return None
    left = min(r["x0"] for r in group)
    ticks = [(((w["top"] + w["bottom"]) / 2), v) for w in words
             if w["x1"] <= left + 2 and (v := _num(w["text"])) is not None]
    ticks = list({v: (y, v) for y, v in ticks}.values())  # one tick per value
    if len(ticks) < 3:
        return None
    n = len(ticks)
    my, mv = sum(y for y, _ in ticks) / n, sum(v for _, v in ticks) / n
    sxx = sum((y - my) ** 2 for y, _ in ticks)
    if sxx == 0:
        return None
    a = sum((y - my) * (v - mv) for y, v in ticks) / sxx
    b = mv - a * my
    span = max(v for _, v in ticks) - min(v for _, v in ticks)
    resid = max(abs(a * y + b - v) for y, v in ticks)
    if a >= 0 or span <= 0 or resid > 0.02 * span:  # values must grow upwards; ticks must lie on one line
        return None
    baseline = sum(r["bottom"] for r in group) / len(group)
    out = []
    for r in sorted(group, key=lambda r: r["x0"]):
        cx = (r["x0"] + r["x1"]) / 2
        label = " ".join(w["text"] for w in words if baseline - 1 <= w["top"] <= baseline + 30
                         and abs((w["x0"] + w["x1"]) / 2 - cx) <= r["width"] / 2 + 2)  # this bar only, not neighbours
        out.append({"label": label or None, "value": round(a * r["top"] + b, 6),
                    "bbox": [round(r["x0"] / page_w, 4), round(r["top"] / page_h, 4),
                             round(r["x1"] / page_w, 4), round(r["bottom"] / page_h, 4)]})
    return {"chart_type": "bar", "method": "vector_geometry", "bars": out,
            "axis": {"ticks": n, "max_residual": round(resid, 6)},
            "confidence": 0.95 if resid <= 0.005 * span else 0.8}


def process_images(job: dict[str, Any], emit: Any) -> None:
    """Slide decks published as one image per slide (SEC HTML exhibits): each image is a page with no text layer."""
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = job["max_pixels"]  # decompression-bomb guard before decoding
    out = Path(job["out_dir"])
    imgs = job["images"][: job["max_pages"]]
    emit({"type": "inspect", "page_count": len(imgs), "metadata": {}})
    for no, src in enumerate(imgs, 1):
        with Image.open(src, formats=["PNG", "JPEG", "GIF"]) as im:  # only decoders the downloader admits (magic check)
            im.load()
            img = im.convert("RGB")
        page_png = out / f"page-{no:04d}.png"
        img.save(page_png, "PNG", optimize=True)  # lossless copy of the decoded original
        vision_png = page_png
        if max(img.size) > job["vision_side"]:
            img.thumbnail((job["vision_side"], job["vision_side"]))
            vision_png = out / f"vision-{no:04d}.png"
            img.save(vision_png, "PNG", optimize=True)
        emit({"type": "page", "page": no, "size_px": list(img.size), "page_png": str(page_png), "vision_png": str(vision_png),
              "text": "", "segments": [], "images": [], "image_area_fraction": 1.0, "tables": [], "vector_objects": 0,
              "vector_chart": None, "has_text_layer": False, "needs_vision": True, "vision_reasons": ["no_text_layer"]})


def process(job: dict[str, Any], emit: Any) -> None:
    if job.get("images"):
        process_images(job, emit)
        return
    import pdfplumber
    import pypdfium2 as pdfium
    from PIL import Image

    pdf_path, out = Path(job["pdf"]), Path(job["out_dir"])
    out.mkdir(parents=True, exist_ok=True)
    try:
        doc = pdfium.PdfDocument(str(pdf_path))
    except pdfium.PdfiumError as e:
        emit({"type": "error", "code": "encrypted_or_invalid", "message": str(e)[:200]})
        return
    try:
        n_pages = len(doc)
        meta = {k: v for k, v in (doc.get_metadata_dict() or {}).items() if k in ("Title", "Author", "CreationDate", "ModDate")}
        emit({"type": "inspect", "page_count": n_pages, "metadata": {k: str(v)[:300] for k, v in meta.items()}})
        if n_pages > job["max_pages"]:
            emit({"type": "error", "code": "too_many_pages", "message": f"{n_pages} > {job['max_pages']}"})
            return
        wanted = job.get("pages") or list(range(1, n_pages + 1))
        with pdfplumber.open(str(pdf_path)) as plumb:
            for no in wanted:
                emit({"type": "page", **_page(doc, plumb, no, out, job, pdfium, Image)})
    finally:
        doc.close()


def _page(doc: Any, plumb: Any, no: int, out: Path, job: dict[str, Any], pdfium: Any, Image: Any) -> dict[str, Any]:
    page = doc[no - 1]
    w, h = page.get_size()
    try:
        # render with a pixel cap (page-size bombs): scale = min(dpi/72, sqrt(max_px / area_pt))
        scale = min(job["dpi"] / 72, math.sqrt(job["max_pixels"] / max(w * h, 1)))
        bitmap = page.render(scale=scale)
        img = bitmap.to_pil()
        page_png = out / f"page-{no:04d}.png"
        img.save(page_png, "PNG", optimize=True)  # lossless evidence
        vision_png = page_png
        if max(img.size) > job["vision_side"]:
            img.thumbnail((job["vision_side"], job["vision_side"]))
            vision_png = out / f"vision-{no:04d}.png"
            img.save(vision_png, "PNG", optimize=True)
        bitmap.close()
        del img

        tp = page.get_textpage()
        text = (tp.get_text_range() or "")[:MAX_TEXT]
        segments = []
        for i in range(min(tp.count_rects(), MAX_SEGMENTS)):
            l, b, r, t = tp.get_rect(i)
            s = tp.get_text_bounded(l, b, r, t).strip()
            if s:  # bbox normalised 0..1, top-left origin
                segments.append({"text": s[:500], "bbox": [round(l / w, 4), round(1 - t / h, 4), round(r / w, 4), round(1 - b / h, 4)]})
        tp.close()

        images, img_area = [], 0.0
        for k, obj in enumerate(page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE], max_depth=3)):
            l, b, r, t = obj.get_bounds()  # pypdfium2 >= 5 (formerly get_pos)
            area = max(r - l, 0) * max(t - b, 0)
            background = area >= 0.85 * w * h  # slide-template backdrop: not content, must not trigger vision
            if not background:
                img_area += area
            if k >= job["max_images"]:
                continue
            entry: dict[str, Any] = {"bbox": [round(l / w, 4), round(1 - t / h, 4), round(r / w, 4), round(1 - b / h, 4)],
                                     "background": background}
            try:
                pw, ph = obj.get_px_size()
                if pw * ph <= job["max_pixels"]:
                    p = out / f"img-{no:04d}-{k:02d}.png"
                    obj.get_bitmap(render=False).to_pil().save(p, "PNG")  # original pixels, lossless
                    entry["path"] = str(p)
                else:
                    entry["skipped"] = "too_many_pixels"
            except Exception as e:  # unsupported filters etc.: keep the bbox, note why
                entry["skipped"] = type(e).__name__
            images.append(entry)
    finally:
        page.close()

    pp = plumb.pages[no - 1]
    try:
        tables = []
        for t in pp.find_tables()[:MAX_TABLES]:
            rows = [[(c or "")[:MAX_CELL] for c in row[:MAX_TABLE_COLS]] for row in (t.extract() or [])[:MAX_TABLE_ROWS]]
            x0, top, x1, bottom = t.bbox
            # layout boxes come back as 1-2 cell "tables"; only a real grid counts as a table (and triggers vision)
            real = len(rows) >= 2 and max((len(r) for r in rows), default=0) >= 2 and sum(bool(c.strip()) for r in rows for c in r) >= 4
            tables.append({"bbox": [round(x0 / w, 4), round(top / h, 4), round(x1 / w, 4), round(bottom / h, 4)],
                           "rows": rows, "real_table": real})
        rects = [{k: r[k] for k in ("x0", "x1", "top", "bottom", "width", "height")} | {"fill": bool(r.get("fill"))} for r in pp.rects]
        vectors = len(rects) + len(pp.lines) + len(pp.curves)
        chart = None
        if sum(r["fill"] for r in rects) >= 2:  # words only when a chart is plausible (CPU)
            words = [{k: x[k] for k in ("text", "x0", "x1", "top", "bottom")} for x in pp.extract_words()]
            chart = bar_chart(rects, words, w, h)
    finally:
        pp.close()

    img_frac = img_area / max(w * h, 1)
    has_text = len(text.strip()) >= 20
    reasons = [r for r, cond in (("no_text_layer", not has_text), ("chart", chart is not None or vectors >= 30),
                                 ("table", any(t["real_table"] for t in tables)), ("large_image", img_frac >= 0.25),
                                 ("clinical_terms", bool(CLINICAL.search(text)))) if cond]
    return {"page": no, "size_pt": [round(w, 2), round(h, 2)], "page_png": str(page_png), "vision_png": str(vision_png),
            "text": text, "segments": segments, "images": images, "image_area_fraction": round(min(img_frac, 1.0), 4),
            "tables": tables, "vector_objects": vectors, "vector_chart": chart, "has_text_layer": has_text,
            "needs_vision": bool(reasons), "vision_reasons": reasons}


def main() -> None:
    proto = os.fdopen(os.dup(1), "w", buffering=1)  # protocol channel = original stdout
    os.dup2(2, 1)  # anything libraries print goes to stderr, never into the protocol

    def emit(obj: dict[str, Any]) -> None:
        proto.write(json.dumps(obj, ensure_ascii=False) + "\n")
        proto.flush()

    try:
        process(json.loads(sys.stdin.readline()), emit)
    except Exception as e:  # report, never hang; details stay out of logs beyond type + short message
        emit({"type": "error", "code": type(e).__name__, "message": str(e)[:200]})
    emit({"type": "done"})


if __name__ == "__main__":
    main()
