# FDA expedited-program approvals (designations)

`designations.py` reads FDA's PDF lists of drug and biologic approvals that used an expedited
program and writes one JSON record per approval, in one schema for all four programs:
[schema.json](schema.json). It needs no network access; all 17 PDFs take about 6 seconds.

| folder in `Designation_data/` | FDA list | rows |
|---|---|---|
| `AA approval/` | CDER (as of 30 Jun 2026) and CBER (as of 30 Jun 2025) Accelerated Approvals Based on a Surrogate Endpoint | 350 + 36 |
| `Breakthrough Designation/` | CDER Breakthrough Therapy approvals: cumulative to end of 2025, and 2026 to 30 Jun | 337 + 15 |
| `Fast Track designation/` | CDER Fast Track approvals: cumulative to end of 2025, and 2026 to 30 Jun | 335 + 10 |
| `Priority Designation/` | CDER Calendar Year Priority Approvals, one PDF per year 2015–2025 (original applications) | 481 |

## Setup (once)

```bash
uv venv --python 3.12 designations/.venv
uv pip install --python designations/.venv/bin/python -r designations/requirements.txt
```

## Run (from the hackathon root)

```bash
designations/.venv/bin/python designations/designations.py                  # every PDF -> designations/output/
designations/.venv/bin/python designations/designations.py '{"asset_name": "pembrolizumab", "aliases": ["Keytruda"]}'
designations/.venv/bin/python designations/designations.py --data /other/pdfs --out /tmp/designations
```

With an asset payload, only records whose `names` match are kept (whole words,
case-insensitive), in `output/<asset-name>/`. From Python, like `ema.chmp_highlights`:

```python
from designations import designations

manifest = designations.crawl({}, out_dir)       # records: out_dir / designations.RECORDS_FILE
```

## Output

`output/designations.json` is a JSON array, newest approval first. `output/manifest.json` has,
per PDF, its title, as-of date, the total printed on it against the rows parsed (`check`:
`ok`, `mismatch` or `no_total`), its footnotes, legend, notes and warnings.

| field | content |
|---|---|
| `id` | primary key: `program:application:submission:date:hash` |
| `program`, `program_name`, `center` | `accelerated_approval`, `breakthrough_therapy`, `fast_track` or `priority_review`; `CDER` or `CBER` |
| `application`, `application_type`, `application_number` | `BLA 125514`, `BLA`, `125514`: the key to join programs, Drugs@FDA and openFDA |
| `submission`, `submission_type`, `submission_number` | `SUPPL-92`, `supplement`, `92` (or `ORIG-1`, `original`, `1`) |
| `proprietary_name`, `established_name`, `applicant` | as printed, with wrapped lines re-joined |
| `approval_date` | ISO date; for Accelerated Approval, the accelerated approval date |
| `indication` | the list's "Use" or "Accelerated Approval Indication" (Priority lists have none) |
| `review_classification`, `orphan`, `approval_qualifier` | Priority lists: `["P", "O"]`, the orphan flag, and `tentative` / `tentative_or_pepfar` approvals |
| `received_date`, `months_to_approval`, `conversion_status`, `conversion_status_text`, `conversion_date` | Accelerated Approval only: conversion to traditional approval or withdrawal |
| `notes[]` | footnotes on the row resolved to their text (`ref`, `field`, `text`), and notes under the table that name the row |
| `names` | every name to match an asset against; index this |
| `source` | `file`, `title`, `as_of`, `page` |

```json
{
  "id": "accelerated_approval:BLA125514:SUPPL-92:2020-06-24:bec722f0fb",
  "program": "accelerated_approval",
  "application": "BLA 125514",
  "submission": "SUPPL-92",
  "proprietary_name": "KEYTRUDA",
  "established_name": "PEMBROLIZUMAB",
  "approval_date": "2020-06-24",
  "received_date": "2020-06-12",
  "months_to_approval": 0.4,
  "conversion_status": "converted",
  "conversion_date": "2022-12-16",
  "notes": [{"ref": "4", "field": "application", "text": "This accelerated approval is for a new dosing regimen that is applicable across multiple indications. ..."}],
  "names": ["KEYTRUDA", "PEMBROLIZUMAB"]
}
```

## How the PDFs are read

The PDFs are Excel sheets exported to PDF, and pdfplumber reads their ruled tables.

- The program comes from each PDF's title, and columns are matched by header name, FDA's typos
  included ("Numner", "Propriety"). A new year's PDF can simply be added to its folder.
- Wrapped cells are re-joined. There is no space after a line-ending hyphen, or inside a word
  Excel split because it did not fit the cell (`DEUTETRABENAZI|NE`,
  `ELEXACAFTOR/TEZA|CAFTOR/IVACAFTOR`). A split word is recognised when its first line fills the
  cell to the edge and the next line does not start with a word found anywhere else in the PDFs.
- A hyphen that spilled into the next column is put back (`POLATUZUMAB VEDOTIN|-|PIIQ`).
- Footnote marks are split off the values and resolved: Accelerated Approval `1`–`5` and `†`,
  Priority `(1)` and `(2)`. Fast Track's `*` and `**` have no legend in the PDF, so their `text`
  is null.
- Every list that prints a total matches it. Priority lists print none.

Kept as FDA printed them:

- One Keytruda Accelerated Approval row (SUPPL-14) gives 5.4 months, though its dates are 8.4
  months apart.
- The same substance is written differently across lists (`LUSPATERCEPT-AAMT`,
  `LUSPATERCEPT AAMT`), so match assets against `names` as whole words.
- The 2023 Priority list puts the applicant in Loqtorzi's proper-name column. The parser takes
  the name from `LOQTORZI (TORIPALIMAB-TPZI)` instead and logs a warning in the manifest.

## Moving to a database

Each record is self-contained and keyed by `id`, so it maps directly to a MongoDB collection
(`_id = id`). Index `names`, `application`, `program` and `approval_date`. For a relational
database, use one table with the scalar fields, plus child tables for `notes`
(`record_id, ref, field, text`) and `names` (`record_id, name`).

A run rebuilds every record from the PDFs. Load it by upserting on `id` and deleting the ids a
run no longer produces: an id changes when FDA edits a row's text. Identical rows in two PDFs,
such as a 2026 calendar-year list and a later cumulative list, are merged and the newer list is
kept. Rows that changed between the two are listed in `manifest.json` → `possible_duplicates`;
remove the older PDF.

Grouping by `application` shows every program an application used. For example, Enhertu
(BLA 761139) has 9 Breakthrough Therapy, 3 Accelerated Approval, 1 Fast Track and 1 Priority
Review record.
