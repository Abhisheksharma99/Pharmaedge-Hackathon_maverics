# ClinicalTrials.gov crawler

Fetches every ClinicalTrials.gov study for a drug asset through the official API v2
and saves each study in full: protocol, results, documents and MeSH data. It uses
only the Python standard library: no packages, no database, no secrets.

## Setup (once)

```bash
cd clinicalTrialgov
uv venv --python 3.12 .venv      # or: python3 -m venv .venv
```

There is nothing to install. Any Python 3.9+ also works, e.g. plain `python3`.

## Run

Pass a JSON payload, either inline or as a path to a JSON file:

```bash
.venv/bin/python clinicaltrials.py '{"asset_name": "treprostinil"}'
.venv/bin/python clinicaltrials.py '{"asset_name": "trastuzumab deruxtecan", "aliases": ["Enhertu", "DS-8201", "T-DXd"]}'
.venv/bin/python clinicaltrials.py payload.json --out /some/other/dir
```

From Python (run from the hackathon root):

```python
from clinicalTrialgov.clinicaltrials import crawl

manifest = crawl({"asset_name": "treprostinil"})
print(manifest["study_count"], manifest["studies_file"])
```

## Payload

Only `asset_name` is required. Any other keys are copied into `manifest.json` unchanged.

| field | default | meaning |
|---|---|---|
| `asset_name` | required | the drug to search for, e.g. `"treprostinil"` |
| `aliases` | none | other names for the same drug: brand, generic and code names. Results from all names are combined |
| `search_in` | `"interventions"` | `"interventions"` searches intervention names, arms, titles and keywords; `"all_fields"` searches all text |

Full example:

```json
{
  "asset_name": "trastuzumab deruxtecan",
  "aliases": ["Enhertu", "DS-8201", "T-DXd"],
  "search_in": "interventions"
}
```

## Output

Each run writes to `output/<asset-name>/`, replacing that folder's previous results:

| file | contents |
|---|---|
| `studies.jsonl` | one study per line, exactly as the API returns it |
| `manifest.json` | the payload, the query sent, the API's data date, counts, all NCT IDs and spelling suggestions |

Every study has `protocolSection` (identification, status, sponsors, design, arms and
interventions, outcomes, eligibility, locations, references), `derivedSection` (MeSH
terms) and `hasResults`. When available it also has `resultsSection` (participant
flow, baseline, outcome results, adverse events), `documentSection` (protocol, SAP and
consent form files) and `annotationSection`.

Reading the studies:

```python
import json

with open("output/treprostinil/studies.jsonl") as f:
    studies = [json.loads(line) for line in f]
print(studies[0]["protocolSection"]["identificationModule"]["nctId"])
```

Exit codes: `0` success (also when nothing matched), `1` the API failed after retries,
`2` invalid payload.

## Tips

- **0 results? Check the spelling first.** ClinicalTrials.gov does not fix misspelled
  names: `Tresprostinol` finds nothing, `treprostinil` finds 157 trials. When nothing
  matches, the log and `spelling_suggestions` in `manifest.json` suggest corrected
  spellings from NLM RxNorm. Company code names get no suggestions.
- **Add brand names and code names as aliases.** ClinicalTrials.gov links some names
  (`Keytruda` and `MK-3475` find the same trials as `pembrolizumab`) but not others:
  `trastuzumab deruxtecan` alone finds 229 trials, and 255 with `Enhertu`, `DS-8201`
  and `T-DXd` added.
- **Give each name separately.** Every name is searched as an exact phrase, so
  `"Tecentriq (atezolizumab)"` as one name finds a single trial. Use
  `"asset_name": "atezolizumab", "aliases": ["Tecentriq"]` instead.
- **`"all_fields"` finds more, but mostly other drugs' trials.** It also returns trials
  that only mention the asset, e.g. as a prior therapy in their eligibility criteria
  (treprostinil: 165 instead of 157).
- **Large assets work.** Keytruda is about 3,000 trials and 160 MB, and takes about
  40 seconds. Requests are paced to about 50 per minute and retried automatically when
  the API is busy.
