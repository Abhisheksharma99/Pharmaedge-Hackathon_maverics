# Conference abstracts: ERS, ATS, CHEST

Crawls every abstract from three respiratory conferences into one shared JSON format.

| Crawler | Source | Years |
|---------|--------|-------|
| `ers/ers.py` | publications.ersnet.org (ERS Congress) | 2011 – 2025 |
| `ats/ats.py` | ats{year}.d365.events (ATS International Conference) | 2024 – 2026 |
| `chest/chest.py` | journal.chestnet.org (CHEST Annual Meeting) | 2003 – 2025 |

## 1. Setup (once)

```sh
cd conference
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

## 2. Crawl all the data

Run from the `conference/` folder.

**All three conferences, every year, every abstract (one command):**

```sh
.venv/bin/python run.py
```

This runs ERS, then ATS, then CHEST, and also writes everything into one merged file.

**Faster: the three in parallel** (each one in the background, logs in `*.log`):

```sh
nohup .venv/bin/python ers/ers.py     '{"workers": 6}' > ers.log   2>&1 &
nohup .venv/bin/python ats/ats.py                      > ats.log   2>&1 &
nohup .venv/bin/python chest/chest.py '{"workers": 6}' > chest.log 2>&1 &
tail -f ers.log chest.log      # watch progress
```

How long it takes: ATS ~2 minutes. ERS and CHEST read one web page per abstract (~4,000–5,000 a year), so a full run of every year is roughly 10–12 hours each.

**Interrupted?** Just run the same command again. Every abstract is saved to `<conference>/cache/` as soon as it is read, so the crawl resumes where it stopped. Keep the Mac awake while it runs.

## 3. Search for a drug / asset

Once the data is cached, keyword runs are fast:

```sh
.venv/bin/python run.py '{"keywords": ["treprostinil", "Tyvaso"]}'
.venv/bin/python run.py '{"asset_name": "treprostinil", "aliases": ["Tyvaso", "Remodulin"]}'
```

Keywords match whole words, case-insensitive, in the title or abstract.

Other payload options (all optional):

| Option | Example | Default |
|--------|---------|---------|
| `years` | `2025`, `[2024, 2025]`, `"2020-2025"`, `"latest"` | `"all"` |
| `match` | `"all"` (every keyword must appear) | `"any"` |
| `meeting` | ERS `"Lung Science Conference"`, CHEST `"CHEST Congress"` | main congress |
| `max_results` | `100` | no limit |
| `workers` | `6` (parallel page downloads) | `4` |
| `refresh` | `true` (ignore the cache, download again) | `false` |

Run one conference only: `.venv/bin/python run.py '{...}' --only ers,chest`

## 4. Where the data goes

| Run | Output |
|-----|--------|
| `run.py` | `conference/output/<keywords or all-abstracts>/abstracts.jsonl` (all conferences merged) |
| a single crawler | `conference/<ers\|ats\|chest>/output/<keywords or all-abstracts>/abstracts.jsonl` |

Each folder also has a `manifest.json` with the payload, counts per year and any pages that failed.

## 5. Record format (same for all three)

One JSON object per line:

```json
{
  "id": "ers-2025-PA4194",
  "conference": "ERS",
  "meeting": "ERS Congress",
  "year": 2025,
  "abstract_number": "PA4194",
  "title": "...",
  "abstract": "BACKGROUND: ...\n\nMETHODS: ...",
  "abstract_sections": [{"label": "BACKGROUND", "text": "..."}],
  "authors": [{"name": "Ana Cysneiros", "affiliations": ["..."], "presenting": null}],
  "category": "Acute critical care",
  "session": {"title": "Mechanical ventilation", "type": null, "start": null, "end": null, "location": null},
  "doi": "10.1183/13993003.congress-2025.PA4194",
  "url": "https://publications.ersnet.org/content/erj/66/suppl69/pa4194",
  "publication": {"journal": "European Respiratory Journal", "volume": "66", "issue": "suppl 69", "pages": "PA4194", "date": "2025-11-18"},
  "matched_keywords": [],
  "extra": {}
}
```

Fields a source does not have are `null`: ATS has no DOI or journal publication; CHEST has no abstract number. Source-specific details (ATS poster board, CHEST funding and disclosures) are in `extra`.
