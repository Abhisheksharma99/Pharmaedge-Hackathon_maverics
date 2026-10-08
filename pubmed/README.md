# PubMed crawler

Fetches every PubMed article matching a list of keywords through NCBI's official
E-utilities API. It uses only the Python standard library: no packages, no
database, no secrets.

## Setup (once)

```bash
cd pubmed
uv venv --python 3.12 .venv      # or: python3 -m venv .venv
```

There is nothing to install.

## Run

Pass a JSON payload, either inline or as a path to a JSON file:

```bash
.venv/bin/python pubmed.py '{"keywords": ["Treprostinil"]}'
.venv/bin/python pubmed.py '{"keywords": ["pembrolizumab", "Keytruda"], "max_results": 500}'
.venv/bin/python pubmed.py payload.json --out /some/other/dir
```

From Python (run from the hackathon root):

```python
from pubmed.pubmed import crawl

manifest = crawl({"keywords": ["Treprostinil"]})
print(manifest["article_count"], manifest["articles_file"])
```

## Payload

Only `keywords` is required.

| field | default | meaning |
|---|---|---|
| `keywords` | required | a string or a list of strings. PubMed syntax such as `BRCA1[gene]` also works |
| `match` | `"any"` | `"any"` joins keywords with OR, `"all"` with AND |
| `field` | all fields | limits the search to one PubMed field: `tiab` (title/abstract), `ti` (title), `mh` (MeSH), `au` (author) |
| `exact` | `false` | search each keyword as an exact phrase |
| `publication_types` | all types | e.g. `["Clinical Trial", "Review"]` |
| `date_from` / `date_to` | no limit | publication date as `YYYY`, `YYYY-MM` or `YYYY-MM-DD` |
| `max_results` | every match | stop after this many articles |
| `sort` | `"relevance"` | `"relevance"` or `"pub_date"` (newest first) |

Full example:

```json
{
  "keywords": ["trastuzumab deruxtecan", "Enhertu", "DS-8201"],
  "match": "any",
  "field": "tiab",
  "publication_types": ["Clinical Trial"],
  "date_from": "2020",
  "date_to": "2025-06",
  "max_results": 1000,
  "sort": "pub_date"
}
```

## Output

Each run writes to `output/<keywords>/`, replacing that folder's previous results:

| file | contents |
|---|---|
| `articles.jsonl` | one article per line |
| `manifest.json` | the payload, the query sent, how PubMed interpreted it, counts and all PMIDs |

Article fields: `pmid`, `url`, `title`, `abstract`, `abstract_sections`, `authors`
(name, ORCID, affiliations), `journal`, `pub_date`, `electronic_date`, `pubmed_date`,
`publication_status`, `language`, `publication_types`, `doi`, `pmc_id`,
`article_ids`, `mesh_terms`, `keywords`, `chemicals`, `databanks` (e.g. linked
ClinicalTrials.gov NCT IDs), `grants`, `conflict_of_interest`.

## Tips

- **0 results? Check the spelling first.** PubMed does not fix misspelled drug
  names: `Tresprostinol` finds nothing, `Treprostinil` finds over 1,000 articles.
  `manifest.json` shows how PubMed read your query (`query_translation`).
- **Add brand names and code names as extra keywords**, e.g.
  `["Treprostinil", "Remodulin", "Tyvaso"]`. Results from all of them are combined.
- **Too many unrelated results?** By default PubMed expands keywords with synonyms
  and MeSH terms, which can pull in other drugs (`Enhertu` also matches plain
  `trastuzumab`). Use `"exact": true` or `"field": "tiab"` for tighter results.
- **Large searches work.** PubMed returns at most 9,999 results per search, so the
  crawler splits bigger ones into date ranges automatically. 15,000 articles take
  about 8 minutes.
- **Going faster:** NCBI allows 3 requests per second by default. Set an
  [NCBI API key](https://www.ncbi.nlm.nih.gov/account/settings/) to allow 10, and
  your email so NCBI can contact you instead of blocking heavy use:

  ```bash
  export NCBI_API_KEY=your_key
  export NCBI_EMAIL=you@example.com
  ```
