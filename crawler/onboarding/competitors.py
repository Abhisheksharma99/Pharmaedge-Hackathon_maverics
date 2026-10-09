"""
Competitors (spec §5.3 step 6): the drugs a primary asset competes with, ranked.

Candidates are what is being developed for the same diseases: drugs in phase 2-4
interventional trials on ClinicalTrials.gov for the asset's indications (and the
conditions its own trials study), counted per drug, plus drugs FDA labels put in the
asset's pharmacologic class. The reasoning model picks and ranks the top 5 distinct
molecules and says, for each of the asset's indications, whether the competitor is
approved, investigational or absent there.

Each competitor becomes an asset of kind "competitor" (an existing asset is linked,
never overwritten) and gets a light "competitor" crawl job. Competitor assets are not
scanned themselves, so there is no recursion.
"""

import json
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

import integrations  # noqa: F401  (puts the team packages on sys.path)
from ai import llm
from clinicalTrialgov.clinicaltrials import ClinicalTrialsClient
from journey.store import asset_id
from regulatory import fda
from service.jobs import JobAlreadyRunning, start_job

from .resolve import MODALITIES, _unique

TOP = 5
MAX_CANDIDATES = 40
PAGES_PER_CONDITION = 2
RESCAN_AFTER = timedelta(days=30)
RECRAWL_AFTER = timedelta(hours=24)
PHASE_RANK = {"EARLY_PHASE1": 0, "PHASE1": 1, "PHASE2": 2, "PHASE3": 3, "PHASE4": 4}
LATE_PHASE_TRIALS = "AREA[StudyType]INTERVENTIONAL AND AREA[Phase](PHASE2 OR PHASE3 OR PHASE4)"
TRIAL_FIELDS = "NCTId|Phase|LeadSponsorName|InterventionName|InterventionType|InterventionOtherName"
NOT_A_DRUG = re.compile(r"placebo|standard (of )?care|usual care|best supportive|background|vehicle|saline|sham|"
                        r"no intervention|control", re.I)
DOSE = re.compile(r"\s*\b\d+(\.\d+)?\s*(mg|mcg|µg|ug|g|ml|mg/kg|%|iu)\b.*$", re.I)
ENTRY_FIELDS = ("id", "name", "company", "reason", "basis", "stage", "coverage", "other_indications")


def reference_indications(asset: Dict[str, Any]) -> List[str]:
    tags = asset.get("tags", {})
    return list(dict.fromkeys([*tags.get("indications", []), *tags.get("investigational_indications", [])]))


def _names(asset: Dict[str, Any]) -> List[str]:
    return [asset["name"], *asset.get("aliases", [])]


def _own(asset: Dict[str, Any]) -> re.Pattern:
    return re.compile("|".join(rf"\b{re.escape(n)}\b" for n in _names(asset)), re.I)


def _utc(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)  # pymongo returns naive UTC datetimes


# --- candidates --------------------------------------------------------------------------------------------

def _conditions(db, asset: Dict[str, Any]) -> List[str]:
    """Reference indications without abbreviations, plus the 3 conditions the asset's own trials study most."""
    plain = [re.sub(r"\s*\(.*?\)", "", i).strip() for i in reference_indications(asset)]
    studied = Counter(c for r in db.trial_records.find({"assets": asset["_id"]}, {"conditions": 1})
                      for c in r.get("conditions") or [])
    unique: Dict[str, str] = {}
    for c in plain + [c for c, _ in studied.most_common(3)]:
        unique.setdefault(c.casefold(), c)
    return list(unique.values())


def _normalize(name: str) -> str:
    """"Seralutinib 90 mg BID" -> "Seralutinib"; "Sotatercept (MK-7962)" -> "Sotatercept"."""
    name = re.sub(r"\s*\(.*?\)|[®™]", " ", DOSE.sub("", name))
    return " ".join(name.split())


def count_interventions(studies: List[Dict[str, Any]], condition: str, own: re.Pattern,
                        found: Dict[str, Dict[str, Any]]) -> None:
    """Tally each drug / biological in the studies (one count per trial), skipping placebo-like arms and the
    asset itself."""
    for study in studies:
        p = study["protocolSection"]
        nct = p["identificationModule"]["nctId"]
        phase = max((PHASE_RANK.get(x, 0) for x in p.get("designModule", {}).get("phases", [])), default=0)
        sponsor = p.get("sponsorCollaboratorsModule", {}).get("leadSponsor", {}).get("name")
        for i in p.get("armsInterventionsModule", {}).get("interventions", []):
            aka = [i.get("name") or "", *(i.get("otherNames") or [])]
            name = _normalize(aka[0])
            if i.get("type") not in ("DRUG", "BIOLOGICAL") or not name or NOT_A_DRUG.search(name) \
                    or any(own.search(a) for a in aka):
                continue
            c = found.setdefault(name.casefold(), {"name": name, "trials": set(), "phase": 0,
                                                   "sponsors": Counter(), "conditions": set()})
            c["conditions"].add(condition)
            if nct not in c["trials"]:
                c["trials"].add(nct)
                c["phase"] = max(c["phase"], phase)
                c["sponsors"][sponsor] += 1


def trial_candidates(db, asset: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The drugs in the most recent phase 2-4 trials for the asset's conditions, most trials first."""
    client, own, found = ClinicalTrialsClient(timeout=30), _own(asset), {}
    for condition in _conditions(db, asset):
        params = {"query.cond": condition, "filter.advanced": LATE_PHASE_TRIALS, "sort": "StartDate:desc",
                  "pageSize": 100, "fields": TRIAL_FIELDS}
        for _ in range(PAGES_PER_CONDITION):
            try:
                page = client.get("/studies", params)
            except Exception:  # best effort: the other conditions still count
                break
            count_interventions(page.get("studies", []), condition, own, found)
            if not page.get("nextPageToken"):
                break
            params["pageToken"] = page["nextPageToken"]
    ranked = sorted(found.values(), key=lambda c: (-len(c["trials"]), -c["phase"]))[:MAX_CANDIDATES]
    phase_name = {v: k for k, v in PHASE_RANK.items()}
    return [{"name": c["name"], "trials": len(c["trials"]), "max_phase": phase_name[c["phase"]],
             "top_sponsor": c["sponsors"].most_common(1)[0][0], "conditions": sorted(c["conditions"])}
            for c in ranked]


def same_class(asset: Dict[str, Any]) -> List[str]:
    """Generic names of drugs FDA labels put in the asset's pharmacologic class (EPC). Best effort."""
    try:
        labels = fda._get("label", {"search": fda._name_query(_names(asset)), "limit": 1})["results"]
        classes = labels[0].get("openfda", {}).get("pharm_class_epc", []) if labels else []
        counts = [fda._get("label", {"search": f'openfda.pharm_class_epc:"{cls}"',
                                     "count": "openfda.generic_name.exact"})["results"] for cls in classes[:2]]
        drugs = [r["term"].title() for rows in counts for r in rows[:15]]
    except Exception:
        return []
    own = _own(asset)
    return [d for d in dict.fromkeys(drugs) if not own.search(d)]


# --- ranking -----------------------------------------------------------------------------------------------

SYSTEM = f"""You pick the main competitors of ONE drug asset, for pharma competitive-intelligence analysts. You get
the asset, its reference indications, candidate drugs counted from recent phase 2-4 trials in the same conditions
on ClinicalTrials.gov (trial count, highest phase, top sponsor), and drugs FDA labels put in the same
pharmacologic class. Return the top {TOP} competitors, strongest first. Rules:
- Distinct molecules only: never another formulation, generic, brand or salt of the asset's own molecule.
- Rank by how directly a drug competes in the asset's approved indications (its current market) first, then in
  its investigational ones. Within that, approved and phase 3 drugs first, and recent launches and heavy recent
  trial activity (high trial counts) count as much as long-established use.
- Drop candidates that are not drugs (procedures, supplements, background therapy). You may add well-known
  competitors missing from the candidates.
- name: INN in Title Case. aliases: brand names and development codes used for the reference indications (at
  most 6; no brands sold for unrelated diseases). company: one company name as commonly written (e.g.
  "Johnson & Johnson"). modality: one of {", ".join(MODALITIES)}.
- indications / investigational_indications: its approved / phase 2-3 indications, short labels with standard
  abbreviations, e.g. "Pulmonary arterial hypertension (PAH)".
- basis: "indication" (same diseases), "mechanism" (same target or class) or "both".
- stage: its most advanced status for the reference indications: approved, phase3, phase2 or other.
- coverage: one entry per reference indication, the indication copied exactly: approved, investigational or none.
- other_indications: its approved or late-stage indications outside the reference ones.
- reason: one sentence on why it competes with the asset."""

_STRINGS = {"type": "array", "items": {"type": "string"}}
_COMPETITOR = {
    "type": "object",
    "properties": {
        "name": {"type": "string"}, "aliases": _STRINGS, "company": {"type": "string"},
        "mechanism": {"type": "string"}, "modality": {"type": "string", "enum": MODALITIES},
        "indications": _STRINGS, "investigational_indications": _STRINGS,
        "basis": {"type": "string", "enum": ["indication", "mechanism", "both"]},
        "stage": {"type": "string", "enum": ["approved", "phase3", "phase2", "other"]},
        "reason": {"type": "string"},
        "coverage": {"type": "array", "items": {
            "type": "object",
            "properties": {"indication": {"type": "string"},
                           "status": {"type": "string", "enum": ["approved", "investigational", "none"]}},
            "required": ["indication", "status"], "additionalProperties": False}},
        "other_indications": _STRINGS,
    },
    "required": ["name", "aliases", "company", "mechanism", "modality", "indications", "investigational_indications",
                 "basis", "stage", "reason", "coverage", "other_indications"],
    "additionalProperties": False,
}
SCHEMA = {"type": "object", "properties": {"competitors": {"type": "array", "items": _COMPETITOR}},
          "required": ["competitors"], "additionalProperties": False}


def _clean(ranked: List[Dict[str, Any]], asset: Dict[str, Any], references: List[str]) -> List[Dict[str, Any]]:
    """Ids, no duplicates or the asset itself, aliases without the name, coverage keyed by every reference
    indication; top 5."""
    own_ids, out = {asset_id(n) for n in _names(asset)}, []
    for c in ranked:
        cid = asset_id(c["name"])
        if not cid or cid in own_ids or cid in {o["id"] for o in out}:
            continue
        given = {x["indication"].casefold(): x["status"] for x in c["coverage"]}
        out.append({**c, "id": cid, "aliases": _unique(c["aliases"], c["name"], 6),
                    "coverage": {r: given.get(r.casefold(), "none") for r in references}})
    return out[:TOP]


def _link_existing(db, ranked: List[Dict[str, Any]], primary_id: str) -> List[Dict[str, Any]]:
    """A competitor already tracked under another of its names (its code name, its INN) keeps that asset's id, so
    "BMS-986278" links to the tracked "admilparant" instead of becoming a second asset; the primary itself drops."""
    known: Dict[str, str] = {}
    for a in db.assets.find({}, {"name": 1, "aliases": 1}):
        for n in [a["name"], *(a.get("aliases") or [])]:
            known.setdefault(n.casefold(), a["_id"])
    out: List[Dict[str, Any]] = []
    for c in ranked:
        cid = next((known[n.casefold()] for n in [c["name"], *c["aliases"]] if n.casefold() in known), c["id"])
        if cid != primary_id and cid not in {o["id"] for o in out}:
            out.append({**c, "id": cid})
    return out


def identify(db, asset: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], int]:
    """(ranked competitors with full identities, number of candidates the model considered). Reads only."""
    candidates, related = trial_candidates(db, asset), same_class(asset)
    references = reference_indications(asset)
    tags = asset.get("tags", {})
    payload = {"asset": {"name": asset["name"], "aliases": asset.get("aliases", []),
                         "company": asset.get("company", {}).get("name"), "mechanism": tags.get("mechanism"),
                         "modality": tags.get("modality")},
               "reference_indications": references, "trial_candidates": candidates, "same_class": related}
    ranked = llm.structured(llm.REASONING_MODEL, SYSTEM, json.dumps(payload), "competitors", SCHEMA)["competitors"]
    return _link_existing(db, _clean(ranked, asset, references), asset["_id"]), len(candidates) + len(related)


# --- storage and jobs --------------------------------------------------------------------------------------

def is_fresh(asset: Dict[str, Any]) -> bool:
    """Competitors identified less than 30 days ago are reused."""
    at = (asset.get("competitor_scan") or {}).get("at")
    return bool(asset.get("competitors") and at and _utc(at) > datetime.now(timezone.utc) - RESCAN_AFTER)


def save(db, primary: Dict[str, Any], ranked: List[Dict[str, Any]], candidates: int) -> int:
    """Store the ranking on the primary and upsert each competitor as an asset; returns how many are new."""
    now, new = datetime.now(timezone.utc), 0
    for c in ranked:
        result = db.assets.update_one({"_id": c["id"]}, {
            # An existing asset (primary or competitor) keeps its identity: it is only linked.
            "$setOnInsert": {"name": c["name"], "aliases": c["aliases"], "company": {"name": c["company"]},
                             "tags": {"indications": c["indications"],
                                      "investigational_indications": c["investigational_indications"],
                                      "mechanism": c["mechanism"], "modality": c["modality"]},
                             "kind": "competitor", "status": "onboarding", "created_at": now},
            "$addToSet": {"competitor_of": primary["_id"]},
            "$set": {"updated_at": now}}, upsert=True)
        new += result.upserted_id is not None
    # Assets that dropped out of the ranking no longer compete with this primary.
    db.assets.update_many({"competitor_of": primary["_id"], "_id": {"$nin": [c["id"] for c in ranked]}},
                          {"$pull": {"competitor_of": primary["_id"]}})
    db.assets.update_one({"_id": primary["_id"]}, {"$set": {
        "competitors": [{k: c[k] for k in ENTRY_FIELDS} for c in ranked],
        "competitor_scan": {"at": now, "candidates": candidates}, "updated_at": now}})
    return new


async def start_jobs(db, queue, primary: Dict[str, Any], ids: List[str], plan: List[Dict[str, str]]) -> int:
    """A competitor crawl for each competitor asset not crawled in the last 24 h and not already running.
    Competitors that are primary assets themselves have their own jobs."""
    started, now = 0, datetime.now(timezone.utc)
    for cid in ids:
        doc = db.assets.find_one({"_id": cid}, {"kind": 1, "last_crawled_at": 1})
        if not doc or doc.get("kind") != "competitor":
            continue
        if doc.get("last_crawled_at") and _utc(doc["last_crawled_at"]) > now - RECRAWL_AFTER:
            continue
        try:
            await start_job(db, queue, cid, "competitor", plan,
                            {"id": "crawler", "name": f"Competitors of {primary['name']}"})
            started += 1
        except JobAlreadyRunning:
            pass
    return started
