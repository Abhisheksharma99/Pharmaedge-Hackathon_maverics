# EMA – CHMP meeting highlights

`chmp_highlights.py` collects every "Meeting highlights from the Committee for Medicinal
Products for Human Use (CHMP)" news item on ema.europa.eu (monthly, 2006 onwards) and
stores each meeting as one structured record.

```
ema/.venv/bin/python ema/chmp_highlights.py                            # all pages, all years
ema/.venv/bin/python ema/chmp_highlights.py '{"since": "2024-01-01"}'  # stop paging at 2024
ema/.venv/bin/python ema/chmp_highlights.py '{"max_pages": 5}'
ema/.venv/bin/python ema/chmp_highlights.py --reparse                  # rebuild output from cache, no network
```

Setup: `uv venv --python 3.12 ema/.venv && uv pip install --python ema/.venv/bin/python -r ema/requirements.txt`

Payload keys (all optional): `since`, `until` (publication dates), `max_pages`,
`page_attempts` (default 3), `export_fallback` (default true), `refresh` (re-download
cached meeting pages), `workers` (default 2).

## How it crawls

1. Walks `https://www.ema.europa.eu/en/news?page=0..N` (≈390 pages, 10 items each) and keeps
   items whose title starts with "Meeting highlights" and names the CHMP.
2. **EMA's listing is unreliable.** For any page but the first it often returns page 1
   (its pager says "Page 1 of 390"), and CloudFront then caches the wrong page for 5 minutes.
   Each page's pager is checked against the page requested, and the page is retried under a
   new URL. Pages that never come back right are listed in `manifest.json` →
   `listing.pages_failed`, and their meetings are taken from EMA's JSON export of all news
   (`/en/documents/report/news-json-report_en.json`). `found_via_listing` and
   `found_via_json_export` in the manifest say which source found each meeting.
3. Downloads each meeting page once into `cache/pages/<slug>.html` (pass `"refresh": true` to
   re-download) and parses it.

## Output

`output/chmp_meeting_highlights.json` holds a JSON array with one record per meeting,
newest first. `output/manifest.json` holds the run's stats and any problem pages.
The full schema, with field descriptions, is in [schema.json](schema.json).

| field | content |
|---|---|
| `id` | page slug (primary key) |
| `title`, `summary`, `url`, `published_at` | as on the page |
| `meeting` | `label` ("20-23 July 2026"), `start_date`, `end_date`, `year`, `month` |
| `categories`, `topics` | EMA badges |
| `highlights[]` | narrative split at its headings: `heading`, `text`, `links`, `medicines[{name, inn}]` |
| `statistics` | 2024+ "text version" figures: `count`, `year_total`, `breakdown` |
| `outcomes[]` | one per medicine card/table row (see below) |
| `documents[]` | document cards: title, reference number, type, size, dates, url |
| `sections[]`, `related_content[]`, `related_medicines[]` | remaining page sections and links |
| `medicine_names` | every medicine named on the page, de-duplicated (index this for asset lookups) |
| `content_text` | whole body as plain text |

`outcomes[]` entries: `medicine_name`, `section` (heading verbatim), `opinion`
(positive / negative / withdrawn / re_examination / referral_started / referral_concluded /
scientific_opinion / other), `procedure` (new_medicine / extension_of_indication / variation /
referral / other), `medicine_type` (generic / biosimilar / hybrid / informed_consent /
advanced_therapy), `re_examination`, `inn`, `common_name`, `company`, `company_role`
(applicant / holder), `therapeutic_indication`, `orphan`, `status` ("pending EC decision"),
`ema_url`, `ema_page_type`, `related_news[]`, `extra{}`.

### Page formats over the years

| years | medicine data on the page | parsed into |
|---|---|---|
| 2024 → | one card (`<dl>`) per medicine under h2 sections | `outcomes` with indication, orphan, status |
| 2018 – 2023 | one two-column table per medicine | `outcomes` |
| 2010 – 2017 | one table per section, a row per medicine, links to summaries of opinion | `outcomes` (name, INN, company; no indication) |
| 2006 – 2009 | narrative only | `highlights[].medicines` (heuristic: bold names / "Name (inn)") |

## Moving to a database

Each record is self-contained and keyed by `id`, so it maps directly to a MongoDB
collection (`_id = id`). Index `medicine_names`, `outcomes.medicine_name`, `outcomes.inn`,
`meeting.start_date`. For a relational DB, split it into `chmp_meetings` (top-level
fields) and `chmp_outcomes` (one row per `outcomes[]` entry plus `meeting_id`). The
nested lists (documents, highlights) become child tables the same way.
