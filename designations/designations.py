"""Parse FDA's expedited-program approval lists (PDFs) into one record per approval.

designations/Designation_data/ holds FDA lists of drug and biologic approvals that used an
expedited program, one folder per program:

    AA approval/               CDER and CBER "Drug and Biologic Accelerated Approvals Based on a
                               Surrogate Endpoint", with conversion to full approval or withdrawal
    Breakthrough Designation/  CDER "Breakthrough Therapy Designation Approvals" (cumulative and
                               calendar-year lists)
    Fast Track designation/    CDER "Fast Track Designation Approvals" (cumulative and calendar-year)
    Priority Designation/      CDER "Calendar Year Priority Approvals", one PDF per year

Every table row becomes one record in one shared schema (designations/schema.json). The program
comes from the PDF's title and the columns are mapped by their header names, so a new year's
file can simply be added to its folder. Wrapped cells are re-joined, including words that Excel
split mid-word (DEUTETRABENAZI|NE), footnote marks are resolved to their text, and each file's
row count is checked against the total printed on it.

Payload (optional): {"asset_name": "...", "aliases": [...]} keeps only the records whose names
match, whole words and case-insensitive, like the CHMP integration's asset matching.

Usage (from the hackathon root):
    designations/.venv/bin/python designations/designations.py
    designations/.venv/bin/python designations/designations.py '{"asset_name": "pembrolizumab", "aliases": ["Keytruda"]}'
    designations/.venv/bin/python designations/designations.py --data /other/pdfs --out /tmp/designations

Output, in designations/output/ (output/<asset-slug>/ with an asset payload):
    designations.json   JSON array, one record per approval (schema: designations/schema.json)
    manifest.json       per PDF: title, as-of date, stated vs parsed rows, footnotes and notes
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "Designation_data"
OUTPUT_DIR = HERE / "output"
RECORDS_FILE = "designations.json"
MANIFEST_FILE = "manifest.json"
PARSER_VERSION = 1

log = logging.getLogger("designations")

# Keyword in the PDF title -> (program, display name)
PROGRAMS = [
    ("accelerated approval", "accelerated_approval", "Accelerated Approval"),
    ("breakthrough", "breakthrough_therapy", "Breakthrough Therapy"),
    ("fast track", "fast_track", "Fast Track"),
    ("priority", "priority_review", "Priority Review"),
]

# Column header (lower case, single spaces) -> field. Typos are FDA's ("Numner", "Propriety").
HEADER_FIELDS = [
    (re.compile(r"^(application|appl type|bla) (number|numner)$"), "application"),
    (re.compile(r"^submission type"), "submission"),
    (re.compile(r"^propriet(ar)?y name$"), "proprietary_name"),
    (re.compile(r"^(established|proper) name$"), "established_name"),
    (re.compile(r"^applicant$"), "applicant"),
    (re.compile(r"received date$"), "received_date"),
    (re.compile(r"^(accelerated )?approval date$"), "approval_date"),
    (re.compile(r"^total time"), "months_to_approval"),
    (re.compile(r"indication$|^use$"), "indication"),
    (re.compile(r"^review classification$"), "review_classification"),
    (re.compile(r"status$"), "conversion_status"),
    (re.compile(r"withdrawal date$"), "conversion_date"),
]
# Column order when a table has no header row, by column count.
DEFAULT_COLUMNS = {
    10: ["application", "proprietary_name", "established_name", "applicant", "received_date",
         "approval_date", "months_to_approval", "indication", "conversion_status", "conversion_date"],
    7: ["application", "submission", "proprietary_name", "established_name", "applicant",
        "approval_date", "indication"],
    6: ["application", "proprietary_name", "established_name", "applicant",
        "review_classification", "approval_date"],
}

APP_RE = re.compile(r"^(NDA|BLA)\s*-?\s*(\d{5,6})(?:/(\d+)(?:\.\d+)?)?", re.I)
SUBMISSION_RE = re.compile(r"\b(ORIGINAL|ORIG|SUPPLEMENT|SUPPL)\s*-?\s*(\d+)", re.I)
MARK_RE = re.compile(r"\((\d+)\)|(?<![\w.])(\d)(?![\w.])|(\*+)|(†+)")
MENTION_RE = re.compile(r"\b(NDA|BLA)\s*(\d{6})\s+(ORIGINAL|SUPPLEMENT)-(\d+)", re.I)
DATE_RE = re.compile(r"\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{4}|\d{1,2}-[A-Za-z]{3}-\d{2,4}|\d{4}-\d{2}-\d{2}"
                     r"|[A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}-\d{1,2}-\d{4}")
DATE_FORMATS = ("%m/%d/%Y", "%d-%b-%Y", "%d-%b-%y", "%Y-%m-%d", "%B %d, %Y", "%m-%d-%Y")
STATUSES = [
    ("application withdrawn", "application_withdrawn"),
    ("indication withdrawn", "indication_withdrawn"),
    ("not yet converted", "not_yet_converted"),
    ("converted", "converted"),
]
# Trailer lines (below the table on the last page): footnotes, legend, notes.
FOOTNOTE_RES = [re.compile(r"^\((\d+)\)\s*(.+)"), re.compile(r"^(\d+)\.\s+(.+)"), re.compile(r"^(†+)[\s\-–—]*(.+)")]
LEGEND_RE = re.compile(r"^([A-Z])\s+-\s+(.+)")
TRAILER_SKIP_RE = re.compile(r"^(notes?|review classification):?$", re.I)
# A single-word line that ends this close to the cell's right edge (in character widths) filled
# the cell: the word after it may be the rest of a word Excel had to split.
FULL_LINE_GAP = 0.75


class PayloadError(ValueError):
    """The payload is malformed."""


# ---- pass 1: read the PDFs -------------------------------------------------------------------

def read_pdf(path: Path, data_dir: Path) -> dict:
    """Title block, raw table rows (cells as lines plus line geometry) and the trailer text."""
    with pdfplumber.open(path) as pdf:
        head = [line.strip() for line in (pdf.pages[0].extract_text() or "").splitlines() if line.strip()]
        rows, trailer = [], ""
        for page_number, page in enumerate(pdf.pages, start=1):
            last_data_bottom = 0.0
            for table in page.find_tables():
                for row, texts in zip(table.rows, table.extract()):
                    cells = [read_cell(page, bbox, text) for bbox, text in zip(row.cells, texts)]
                    return_overflow(cells)
                    rows.append({"page": page_number, "cells": cells})
                    if texts and APP_RE.match((texts[0] or "").strip()):
                        last_data_bottom = max(last_data_bottom, row.bbox[3])
            if page_number == len(pdf.pages):
                # within_bbox, not crop: crop clips the last row's characters onto the edge,
                # where they merge with the first note line
                x0, top, x1, bottom = page.bbox
                trailer = page.within_bbox((x0, max(top, last_data_bottom), x1, bottom)).extract_text() or ""
        pages = len(pdf.pages)
    title = re.sub(r"\*+$", "", head[0]).strip() if head else path.stem
    return {
        "file": path.relative_to(data_dir).as_posix(),
        "title": title,
        "head": head[:8],
        "pages": pages,
        "rows": rows,
        "trailer": trailer,
    }


def read_cell(page, bbox, text: str | None) -> dict:
    """The cell's lines, and for each line break whether the line before it filled the cell."""
    lines = [line.strip() for line in (text or "").split("\n")]
    full = [False] * (len(lines) - 1)
    geometry = None
    for i, line in enumerate(lines[:-1]):
        if not line or " " in line or line.endswith("-") or bbox is None:
            continue
        if geometry is None:
            try:
                geometry = page.within_bbox(bbox).extract_text_lines(strip=True)
            except ValueError:  # cell outside the page box
                geometry = []
        found = next((g for g in geometry if g["text"].strip() == line), None)
        if found:
            char_width = (found["x1"] - found["x0"]) / len(line)
            full[i] = bbox[2] - found["x1"] < FULL_LINE_GAP * char_width
    return {"lines": lines, "full": full}


def return_overflow(cells: list[dict]) -> None:
    """A hyphen ending a wrapped line can spill into the next column as a line of its own
    (POLATUZUMAB VEDOTIN | - | PIIQ): move it back to the end of the line it belongs to."""
    for left, cell in zip(cells, cells[1:]):
        lines = cell["lines"]
        for i, line in enumerate(lines):
            if line in ("-", "–") and len(lines) > 1 and i < len(left["lines"]) \
                    and left["lines"][i] and not left["lines"][i].endswith(("-", "–")):
                left["lines"][i] += "-"
                lines[i] = ""


def build_vocabulary(sources: list[dict]) -> set[str]:
    """Every word in every cell, except words that might be the tail of a split word."""
    vocabulary = set()
    for source in sources:
        for row in source["rows"]:
            for cell in row["cells"]:
                for i, line in enumerate(cell["lines"]):
                    words = _words(line)
                    if i and cell["full"][i - 1]:
                        words = words[1:]
                    vocabulary.update(w for w in words if len(w) > 1)
    return vocabulary


def _words(line: str) -> list[str]:
    return [w for w in re.split(r"[\s/\-–(),;]+", line.upper()) if w]


def join_lines(cell: dict, vocabulary: set[str]) -> str:
    """Re-join a wrapped cell: no space after a hyphen, or inside a word Excel split because it
    did not fit the cell (DALFOPRISTIN/QUINUPR|ISTIN); a space everywhere else."""
    lines, full = cell["lines"], cell["full"]
    text = lines[0]
    for i, line in enumerate(lines[1:], start=1):
        if not line:
            continue
        words = _words(line)
        if text.endswith("-") or (full[i - 1] and (not words or words[0] not in vocabulary)):
            text += line
        else:
            text += " " + line
    return text


# ---- pass 2: rows -> records -----------------------------------------------------------------

def parse_source(raw: dict, vocabulary: set[str]) -> tuple[list[dict], dict]:
    """Records and the source summary (title, as-of date, totals, footnotes, notes) for one PDF."""
    head_text = " ".join(raw["head"])
    program, program_name = _program(raw["title"], raw["file"])
    center = "CBER" if raw["title"].upper().startswith("CBER") else "CDER" if "CDER" in raw["title"].upper() else None
    as_of_match = re.search(r"(?:as of|data as of)\s+(.+?)(?:\s+total\b|$)", head_text, re.I)
    total_match = re.search(r"\bTotal(?: of)?(?: Approvals)?\s+(\d+)", head_text, re.I)
    footnotes, legend, notes = parse_trailer(raw["trailer"])
    source = {
        "file": raw["file"],
        "program": program,
        "center": center,
        "title": raw["title"],
        "as_of": parse_date(as_of_match.group(1))[0] if as_of_match else None,
        "pages": raw["pages"],
        "stated_total": int(total_match.group(1)) if total_match else None,
        "footnotes": footnotes,
        "legend": legend,
        "notes": notes,
    }
    row_notes = defaultdict(list)  # (application, submission) -> notes naming that row
    for note in notes:
        for m in MENTION_RE.finditer(note):
            kind = "ORIG" if m.group(3).upper() == "ORIGINAL" else "SUPPL"
            row_notes[(f"{m.group(1).upper()} {m.group(2)}", f"{kind}-{int(m.group(4))}")].append(note)

    records, columns, warnings = [], None, []
    for row in raw["rows"]:
        texts = [join_lines(cell, vocabulary) for cell in row["cells"]]
        header = [_header_field(t) for t in texts]
        if sum(1 for f in header if f) >= 4:
            columns = header
            continue
        if not texts or not APP_RE.match(_clean(texts[0]) or ""):
            continue
        fields = columns if columns and len(columns) == len(texts) else DEFAULT_COLUMNS.get(len(texts))
        if not fields:
            warnings.append(f"p{row['page']}: no column mapping for a {len(texts)}-column row: {texts[0]!r}")
            continue
        values = {f: t for f, t in zip(fields, texts) if f}
        record = make_record(values, source, program_name, row["page"], row_notes, warnings)
        if not record["approval_date"]:
            warnings.append(f"p{row['page']}: {record['application']} has no readable approval date")
        records.append(record)

    source["rows_parsed"] = len(records)
    source["check"] = ("no_total" if source["stated_total"] is None
                       else "ok" if source["stated_total"] == len(records) else "mismatch")
    source["warnings"] = warnings
    return records, source


def make_record(values: dict, source: dict, program_name: str, page: int, row_notes: dict,
                warnings: list[str]) -> dict:
    app_type, app_number, sub_type, sub_number, app_marks = parse_application(_clean(values["application"]))
    if not sub_type and values.get("submission"):
        found = SUBMISSION_RE.search(values["submission"])
        if found:
            sub_type = "original" if found.group(1).upper().startswith("ORIG") else "supplement"
            sub_number = int(found.group(2))
    if not sub_type and source["program"] in ("priority_review", "accelerated_approval"):
        sub_type = "original"  # these lists only annotate supplements; priority lists are original applications
    submission = None
    if sub_type:
        submission = f"{'ORIG' if sub_type == 'original' else 'SUPPL'}" + (f"-{sub_number}" if sub_number else "")

    approval_date, approval_marks = parse_date(values.get("approval_date"))
    received_date, received_marks = parse_date(values.get("received_date"))
    conversion_date, conversion_marks = parse_date(values.get("conversion_date"))
    months, months_marks = _number(values.get("months_to_approval"))
    status_text = _clean(re.sub(r"^\s*-\s*", "", values.get("conversion_status") or ""))
    codes = re.findall(r"[A-Z]", (values.get("review_classification") or "").upper())

    notes = []
    for field, marks in (("application", app_marks), ("approval_date", _marks(approval_marks)),
                         ("received_date", _marks(received_marks)), ("months_to_approval", months_marks),
                         ("conversion_date", _marks(conversion_marks))):
        for mark in marks:
            notes.append({"ref": mark, "field": field, "text": source["footnotes"].get(mark)})
    application = f"{app_type} {app_number}"
    for text in row_notes.get((application, submission), []):
        notes.append({"ref": None, "field": None, "text": text})
    note_text = " ".join(n["text"] or "" for n in notes)

    proprietary = _clean(values.get("proprietary_name"))
    established = _clean_name(values.get("established_name"))
    applicant = _clean(values.get("applicant"))
    if established and applicant and established.casefold() == applicant.rstrip(".").casefold():
        # FDA put the applicant in the name column: take the name from 'BRAND (NAME)' if given
        split = re.fullmatch(r"(.+?)\s*\(([^()]+)\)", proprietary or "")
        established = _clean_name(split.group(2)) if split else None
        warnings.append(f"p{page}: {application} lists the applicant as its established name; "
                        f"using {established!r}")
    record = {
        "id": None,
        "program": source["program"],
        "program_name": program_name,
        "center": source["center"],
        "application": application,
        "application_type": app_type,
        "application_number": app_number,
        "submission": submission,
        "submission_type": sub_type,
        "submission_number": sub_number,
        "proprietary_name": proprietary,
        "established_name": established,
        "applicant": applicant,
        "approval_date": approval_date,
        "indication": _clean(values.get("indication")),
        "review_classification": codes or None,
        "orphan": ("O" in codes) if codes else None,
        "approval_qualifier": ("tentative_or_pepfar" if "PEPFAR" in note_text
                               else "tentative" if "tentatively approved" in note_text else None),
        "received_date": received_date,
        "months_to_approval": months,
        "conversion_status": _status(status_text),
        "conversion_status_text": status_text,
        "conversion_date": conversion_date,
        "notes": notes,
        "names": lookup_names(proprietary, established),
        "source": {"file": source["file"], "title": source["title"], "as_of": source["as_of"], "page": page},
        "parser_version": PARSER_VERSION,
    }
    record["id"] = record_id(record)
    return record


def parse_application(text: str) -> tuple:
    """'BLA 125514 Supplement 92 4' -> ('BLA', '125514', 'supplement', 92, ['4'])."""
    m = APP_RE.match(text)
    app_type, number, slash = m.group(1).upper(), m.group(2), m.group(3)
    rest = text[m.end():]
    sub_type = sub_number = None
    found = SUBMISSION_RE.search(rest)
    if found:
        sub_type = "original" if found.group(1).upper().startswith("ORIG") else "supplement"
        sub_number = int(found.group(2))
        rest = rest[:found.start()] + " " + rest[found.end():]
    elif slash is not None:  # CBER and older lists: BLA 125127/0 is the original, /1010 a supplement
        sub_type, sub_number = ("original", None) if int(slash) == 0 else ("supplement", int(slash))
    return app_type, number, sub_type, sub_number, _marks(rest)


def parse_date(text: str | None) -> tuple[str | None, str]:
    """ISO date in the text, and what is left of the text (footnote marks)."""
    m = DATE_RE.search(text or "")
    if not m:
        return None, text or ""
    raw = re.sub(r"\s+", "", m.group(0)) if "/" in m.group(0) else m.group(0)
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date().isoformat(), text[:m.start()] + " " + text[m.end():]
        except ValueError:
            continue
    return None, text


def parse_trailer(text: str) -> tuple[dict, dict, list]:
    """Footnotes ('1', '(2)', '†' -> text), the review-classification legend and other notes."""
    footnotes, legend, notes = {}, {}, []
    last = None  # (dict or list, key) of the item a lower-case line continues
    for line in (l.strip() for l in text.splitlines()):
        if not line or TRAILER_SKIP_RE.match(line):
            continue
        line = re.sub(r"^NOTES?:\s*", "", line, flags=re.I)
        footnote = next((m for m in (rx.match(line) for rx in FOOTNOTE_RES) if m), None)
        legend_line = LEGEND_RE.match(line)
        if footnote:
            footnotes[footnote.group(1)] = footnote.group(2).strip()
            last = (footnotes, footnote.group(1))
        elif legend_line:
            legend[legend_line.group(1)] = legend_line.group(2).strip()
            last = (legend, legend_line.group(1))
        elif last and line[0].islower():
            last[0][last[1]] += " " + line
        else:
            notes.append(line)
            last = (notes, len(notes) - 1)
    return footnotes, legend, notes


def lookup_names(proprietary: str | None, established: str | None) -> list[str]:
    """Names to match an asset against: both names, both parts of a 'BRAND (NAME)' proprietary
    name (PYRUKYND (MITAPIVAT)), the established name without a trailing parenthetical
    ('Concentrate (Human)'), and without FDA's ado-/fam- prefix and four-letter biologic suffix
    (FAM-TRASTUZUMAB DERUXTECAN-NXKI -> TRASTUZUMAB DERUXTECAN)."""
    names = []

    def add(name):
        name = _clean(name)
        if name and name.casefold() not in {n.casefold() for n in names}:
            names.append(name)

    if proprietary:
        add(proprietary)
        split = re.fullmatch(r"(.+?)\s*\(([^()]+)\)", proprietary)
        if split:
            add(split.group(1))
            add(split.group(2))
            add(_base_name(split.group(2)))
    if established:
        add(established)
        outer = re.sub(r"\s*\([^()]*\)$", "", established)
        add(outer)
        add(_base_name(outer))
    return names


def _base_name(name: str) -> str:
    return re.sub(r"-[A-Z]{4}$", "", re.sub(r"^(?:ADO|FAM)-", "", name, flags=re.I), flags=re.I)


def record_id(record: dict) -> str:
    """Readable and stable: program, application, submission and date, plus a hash of the
    row's names and indication (one application can have several indications on one date)."""
    key = "|".join(str(record[k] or "") for k in ("program", "application", "submission", "approval_date",
                                                   "proprietary_name", "established_name", "indication"))
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
    return (f"{record['program']}:{record['application_type']}{record['application_number']}:"
            f"{record['submission'] or 'NA'}:{record['approval_date'] or 'NA'}:{digest}")


# ---- run -------------------------------------------------------------------------------------

def crawl(payload: dict | None = None, output_dir: str | Path = OUTPUT_DIR,
          data_dir: str | Path = DATA_DIR) -> dict:
    """Parse every PDF under data_dir, write RECORDS_FILE and MANIFEST_FILE to output_dir and
    return the manifest."""
    payload = payload or {}
    names = parse_payload(payload)
    data_dir, output_dir = Path(data_dir), Path(output_dir)
    pdfs = sorted(data_dir.rglob("*.pdf"))
    if not pdfs:
        raise FileNotFoundError(f"no PDFs under {data_dir}")

    raw_sources = []
    for path in pdfs:
        log.info("Reading %s", path.relative_to(data_dir))
        raw_sources.append(read_pdf(path, data_dir))
    vocabulary = build_vocabulary(raw_sources)

    records, sources = [], []
    for raw in raw_sources:
        file_records, source = parse_source(raw, vocabulary)
        records += file_records
        sources.append(source)
        level = logging.INFO if source["check"] != "mismatch" else logging.WARNING
        log.log(level, "%s: %d rows (stated total: %s)", source["file"], source["rows_parsed"], source["stated_total"])

    records, merged = _dedupe(records)
    possible_duplicates = _possible_duplicates(records)
    if names:
        rx = name_regex(names)
        records = [r for r in records if any(rx.search(n) for n in r["names"])]
    records.sort(key=lambda r: (r["approval_date"] or "", r["program"], r["application"]), reverse=True)

    counts = defaultdict(int)
    for r in records:
        counts[r["program"]] += 1
    manifest = {
        "parsed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "parser_version": PARSER_VERSION,
        "payload": payload,
        "data_dir": str(data_dir),
        "record_count": len(records),
        "records_by_program": dict(sorted(counts.items())),
        "sources": sources,
        "duplicates_merged": merged,
        "possible_duplicates": possible_duplicates,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / RECORDS_FILE).write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    (output_dir / MANIFEST_FILE).write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def parse_payload(payload: dict) -> list[str]:
    if not isinstance(payload, dict):
        raise PayloadError("payload must be a JSON object")
    asset_name, aliases = payload.get("asset_name"), payload.get("aliases") or []
    if asset_name is not None and not isinstance(asset_name, str):
        raise PayloadError('"asset_name" must be a string')
    if not isinstance(aliases, list) or not all(isinstance(a, str) for a in aliases):
        raise PayloadError('"aliases" must be a list of strings')
    if aliases and not asset_name:
        raise PayloadError('"aliases" needs an "asset_name"')
    return [n.strip() for n in [asset_name or "", *aliases] if n.strip()]


def name_regex(names: list[str]) -> re.Pattern:
    """Whole names, case-insensitive; the same rule as crawler/integrations/chmp.py."""
    alts = sorted({re.escape(n) for n in names}, key=len, reverse=True)
    return re.compile(rf"(?<![\w-])(?:{'|'.join(alts)})(?![\w-])", re.I)


def _dedupe(records: list[dict]) -> tuple[list[dict], list[str]]:
    """The same row in two PDFs (a calendar-year list and a later cumulative one): keep the newer."""
    by_id, merged = {}, []
    for record in records:
        kept = by_id.get(record["id"])
        if kept:
            merged.append(record["id"])
            if (record["source"]["as_of"] or "") <= (kept["source"]["as_of"] or ""):
                continue
        by_id[record["id"]] = record
    return list(by_id.values()), merged


def _possible_duplicates(records: list[dict]) -> list[dict]:
    """Same program, application, submission and date in different PDFs but different text:
    usually a superseded calendar-year list next to a newer cumulative one."""
    groups = defaultdict(list)
    for r in records:
        groups[(r["program"], r["application"], r["submission"], r["approval_date"])].append(r)
    return [{"ids": [r["id"] for r in group], "files": sorted({r["source"]["file"] for r in group})}
            for group in groups.values() if len({r["source"]["file"] for r in group}) > 1]


def _program(title: str, file: str) -> tuple[str, str]:
    for text in (title, file):
        for keyword, program, name in PROGRAMS:
            if keyword in text.lower():
                return program, name
    raise ValueError(f"cannot tell the program of {file!r} from its title {title!r}")


def _header_field(text: str) -> str | None:
    key = re.sub(r"\s*-\s*", "-", re.sub(r"\s+", " ", text or "").strip().lower())
    return next((field for rx, field in HEADER_FIELDS if rx.search(key)), None)


def _clean(text: str | None) -> str | None:
    text = re.sub(r"\s+", " ", re.sub(r"[™®]", "", text or "")).strip()
    return None if text.upper() in ("", "N/A", "NA", "-") else text


def _clean_name(text: str | None) -> str | None:
    """Established names: no spaces around hyphens or dashes (LUSPATERCEPT – AAMT), no trailing
    period, and a parenthesis the PDF cut off closed again ('Concentrate (Human')."""
    text = _clean(text)
    if not text:
        return None
    text = re.sub(r"\s*[-–—]\s*", "-", text).rstrip(".").strip()
    if text.count("(") == text.count(")") + 1 and text.rfind("(") > text.rfind(")"):
        text += ")"
    return text or None


def _marks(text: str | None) -> list[str]:
    return [next(g for g in m.groups() if g) for m in MARK_RE.finditer(text or "")]


def _number(text: str | None) -> tuple[float | None, list[str]]:
    m = re.search(r"\d+(?:\.\d+)?", text or "")
    if not m:
        return None, []
    return float(m.group(0)), _marks(text[:m.start()] + " " + text[m.end():])


def _status(text: str | None) -> str | None:
    if not text:
        return None
    return next((status for phrase, status in STATUSES if phrase in text.lower()), "other")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-") or "asset"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Parse FDA expedited-program approval PDFs into records.")
    parser.add_argument("payload", nargs="?", default="{}",
                        help='optional JSON payload such as \'{"asset_name": "Keytruda"}\', or a path to a JSON file')
    parser.add_argument("--data", type=Path, default=DATA_DIR, help="folder with the PDFs (default: %(default)s)")
    parser.add_argument("--out", type=Path,
                        help="output folder (default: designations/output, or output/<asset-slug> with an asset)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("pdfminer").setLevel(logging.ERROR)  # "CropBox missing" on every page

    try:
        payload = json.loads(args.payload)
    except json.JSONDecodeError:
        try:
            payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            parser.error(f"payload is neither JSON nor a readable JSON file: {e}")
    try:
        names = parse_payload(payload)
    except PayloadError as e:
        parser.error(str(e))
    out = args.out or (OUTPUT_DIR / _slug(names[0]) if names else OUTPUT_DIR)

    manifest = crawl(payload, out, args.data)
    for source in manifest["sources"]:
        if source["check"] == "mismatch":
            log.warning("%s: parsed %d rows, but the PDF says %d", source["file"], source["rows_parsed"],
                        source["stated_total"])
        for warning in source["warnings"]:
            log.warning("%s: %s", source["file"], warning)
    print(f"{manifest['record_count']} records {manifest['records_by_program']} -> {out / RECORDS_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
