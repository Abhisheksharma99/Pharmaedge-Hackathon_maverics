"""Drug name -> developer company + alternative names, when no AdisInsight id is given.

AdisInsight search requires a subscriber session (anonymous POST /search -> HTTP 500), so a bare name is resolved
through the ClinicalTrials.gov API v2 (official, free, no key): industry lead sponsors of trials whose intervention
is the drug (ranked by trial count) and the interventions' names/other names (brands, code names).
Fallback for approved drugs without industry trials: openFDA NDA/BLA sponsors.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any
from urllib.parse import urlencode

from .net import Http

API = "https://clinicaltrials.gov/api/v2/studies"
OPENFDA = "https://api.fda.gov/drug/drugsfda.json"
TTL = 7 * 86400
FIELDS = ("protocolSection.identificationModule.nctId,protocolSection.sponsorCollaboratorsModule.leadSponsor,"
          "protocolSection.armsInterventionsModule.interventions")
MAX_PAGES = 5  # 5 x 1000 studies is plenty to rank sponsors
GENERIC = re.compile(r"^(?:placebo|standard of care|saline|vehicle|matching placebo)$", re.I)
# words that do not change WHICH substance it is: dosage forms, routes, release types, devices, study wording
FORM_WORDS = {"inhalation", "inhalations", "inhaled", "inhaler", "powder", "solution", "suspension", "injection",
              "injectable", "infusion", "continuous", "oral", "tablet", "tablets", "capsule", "capsules", "extended",
              "release", "sustained", "modified", "controlled", "dry", "nebulized", "nebulised", "nebulizer", "ultrasonic",
              "subcutaneous", "intravenous", "parenteral", "transdermal", "cutaneous", "iontophoresis", "patch", "pump",
              "implanted", "implantable", "liposomal", "liposome", "premixed", "preservative", "free", "preservative-free",
              "iv", "sc", "dpi", "sr", "er", "xr", "for", "of", "the", "with", "via", "and", "or", "plus", "mg", "mcg", "ug",
              "ml", "dose", "doses", "dosing", "formulation", "system", "device", "drug", "product", "therapy", "treatment",
              "generic", "standard", "care", "group", "arm", "titration", "rapid", "slow", "fixed", "high", "low", "double",
              "blind", "open", "label", "maintenance", "escalation", "active", "study"}
SALT_WORDS = {"sodium", "potassium", "diolamine", "diethanolamine", "dienthanolmine", "olamine", "hydrochloride", "hcl",
              "sulfate", "sulphate", "acetate", "citrate", "mesylate", "phosphate", "maleate", "tartrate", "fumarate",
              "succinate"}


def _words(label: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", label.lower())


def other_product(label: str, name: str, own_names: set[str] | frozenset[str] = frozenset()) -> str | None:
    """A DIFFERENT substance that merely contains the drug name: exactly one extra alphabetic word (>= 4 letters)
    next to it, e.g. 'Treprostinil Palmitil Inhalation Powder' -> 'treprostinil palmitil', 'TransCon PEG Treprostinil'
    -> 'transcon treprostinil'. Same substance (None): forms/routes/salts/study wording ('parenteral treprostinil',
    'treprostinil diethanolamine', 'treprostinil therapy'), code names ('LIQ861 treprostinil') and the developer's own
    names ('Remodulin treprostinil')."""
    n = name.lower()
    words = list(dict.fromkeys(  # 'treprostinil treprostinil' -> 'treprostinil'
        w for w in _words(label)
        if w == n or (w not in FORM_WORDS and w not in SALT_WORDS and w not in own_names
                      and not re.search(r"\d", w) and len(w) >= 4)))
    if n not in words or len(words) != 2:
        return None
    return " ".join(words)


CODE = re.compile(r"[A-Za-z]{1,8}[- ]?\d[\w-]*")  # development codes: BMS-986278, UT-15C, INS1009


def rank(studies: list[dict[str, Any]], name: str) -> tuple[list[str], list[str], list[str]]:
    """(industry sponsors by trial count, candidate names from the DEVELOPER'S own trials of this substance,
    other substances containing the drug name, e.g. 'treprostinil palmitil'). Pure, unit-tested.
    Candidates are single-word brands (verified later against openFDA) and development codes; labels that merely
    contain the drug name add no recall and are not used as names ('Non-Treprostinil PAH Medications')."""
    n = name.lower()
    name_rx = re.compile(rf"(?<![A-Za-z0-9]){re.escape(name)}(?![A-Za-z0-9])", re.I)
    rows: list[tuple[str | None, list[list[str]]]] = []  # (industry sponsor, interventions naming the drug)
    for s in studies:
        ps = s.get("protocolSection", {})
        ivs = []
        for iv in ps.get("armsInterventionsModule", {}).get("interventions", []):
            labels = [re.sub(r"\s+", " ", x).strip() for x in [iv.get("name") or "", *iv.get("otherNames", [])]]
            if any(name_rx.search(x) for x in labels):
                ivs.append([x for x in labels if 3 <= len(x) <= 60 and not GENERIC.match(x)])
        lead = ps.get("sponsorCollaboratorsModule", {}).get("leadSponsor", {})
        rows.append((lead.get("name", "").strip() if lead.get("class") == "INDUSTRY" else None, ivs))

    def is_other(labels: list[str], own: set[str] | frozenset[str] = frozenset()) -> str | None:
        return next((d for x in labels if (d := other_product(x, name, own))), None)

    prelim = Counter(sp for sp, ivs in rows if sp and any(not is_other(lb) for lb in ivs))
    developer = prelim.most_common(1)[0][0] if prelim else None
    # the developer's vocabulary for THIS substance (never the drug name itself)
    own = {w for sp, ivs in rows if sp == developer for lb in ivs if not is_other(lb) for x in lb for w in _words(x)} - {n}
    sponsors: Counter[str] = Counter()
    others: set[str] = set()
    candidates: Counter[str] = Counter()
    for sp, ivs in rows:
        kept = []
        for lb in ivs:
            if diff := is_other(lb, own):
                others.add(diff)  # a different substance (prodrug/ester/conjugate), whoever sponsors it
            else:
                kept.append(lb)
        if sp and kept:
            sponsors[sp] += 1
        if sp == developer:
            candidates.update(x for lb in kept for x in lb
                              if not name_rx.search(x) and (re.fullmatch(r"[A-Za-z][A-Za-z-]{3,30}", x) or CODE.fullmatch(x)))
    seen: set[str] = set()
    alt = [c for c, _ in candidates.most_common(30) if not (c.lower() in seen or seen.add(c.lower()))]
    return [s for s, _ in sponsors.most_common()], alt, sorted(others)


def sponsor_counts(studies: list[dict[str, Any]], name: str, sponsors: list[str]) -> Counter[str]:
    """Trials per industry sponsor (only sponsors `rank` accepted) - one-off sponsors are not 'developers'."""
    name_rx = re.compile(rf"(?<![A-Za-z0-9]){re.escape(name)}(?![A-Za-z0-9])", re.I)
    c: Counter[str] = Counter()
    for s in studies:
        ps = s.get("protocolSection", {})
        sp = ps.get("sponsorCollaboratorsModule", {}).get("leadSponsor", {}).get("name", "").strip()
        ivs = ps.get("armsInterventionsModule", {}).get("interventions", [])
        if sp in sponsors and any(name_rx.search(x) for iv in ivs for x in [iv.get("name") or "", *iv.get("otherNames", [])]):
            c[sp] += 1
    return c


async def verify_brands(http: Http, name: str, candidates: list[str]) -> list[str]:
    """Keep development codes; keep a brand only if openFDA lists it with this active ingredient. Registry noise such
    as 'Flolan' (epoprostenol) recorded as an other name of a treprostinil intervention is dropped, and so are words
    openFDA does not know ('TreT')."""
    keep = []
    for c in candidates:
        if CODE.fullmatch(c):
            keep.append(c)
            continue
        q = urlencode({"search": f'products.brand_name:"{c}"', "limit": 10})
        status, text = await http.get_html(f"{OPENFDA}?{q}", TTL, ctype="json")
        if status != 200:
            continue  # unknown brand -> not trusted as a name of this drug
        ingredients = {i.get("name", "").lower() for r in json.loads(text).get("results", [])
                       for p in r.get("products", []) if p.get("brand_name", "").lower() == c.lower()
                       for i in p.get("active_ingredients", [])}
        if any(name.lower() in i for i in ingredients):
            keep.append(c)
    return keep


async def _studies(http: Http, name: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    token: str | None = None
    for _ in range(MAX_PAGES):
        params = {"query.intr": name, "pageSize": 1000, "fields": FIELDS} | ({"pageToken": token} if token else {})
        status, text = await http.get_html(f"{API}?{urlencode(params)}", TTL, ctype="json")
        if status != 200:
            raise RuntimeError(f"ClinicalTrials.gov -> HTTP {status}")
        data = json.loads(text)
        out += data.get("studies", [])
        if not (token := data.get("nextPageToken")):
            break
    return out


async def _openfda_sponsors(http: Http, name: str) -> list[str]:
    q = urlencode({"search": f'openfda.generic_name:"{name}" openfda.brand_name:"{name}"', "limit": 100})
    status, text = await http.get_html(f"{OPENFDA}?{q}", TTL, ctype="json")
    if status != 200:
        return []
    c = Counter(r.get("sponsor_name") for r in json.loads(text).get("results", [])
                if str(r.get("application_number", "")).startswith(("NDA", "BLA")) and r.get("sponsor_name"))
    return [s for s, _ in c.most_common()]


async def other_products(http: Http, name: str) -> list[str]:
    """Different substances that contain the drug name (for exclusion), best effort."""
    try:
        return rank(await _studies(http, name), name)[2]
    except (RuntimeError, ValueError):
        return []


async def resolve_by_name(http: Http, name: str) -> dict[str, Any]:
    name = re.sub(r"\s+", " ", name).strip()
    studies = await _studies(http, name)
    sponsors, alt, others = rank(studies, name)
    counts = sponsor_counts(studies, name, sponsors)
    alt = await verify_brands(http, name, alt)
    source = "ClinicalTrials.gov API v2 (industry lead sponsors by trial count)"
    if not sponsors:
        sponsors, source = await _openfda_sponsors(http, name), "openFDA drugsfda (NDA/BLA sponsors)"
    if not sponsors:
        raise ValueError(f"no developer company found for {name!r}; pass companies explicitly")
    return {"name": name, "primary_companies": sponsors[:1], "developers": sponsors[:10] if source.startswith("openFDA") else
            [sp for sp, c in counts.most_common(10) if c >= 2] or sponsors[:1],
            "alternative_names": alt, "other_products": others, "originators": [], "company_source": source}
