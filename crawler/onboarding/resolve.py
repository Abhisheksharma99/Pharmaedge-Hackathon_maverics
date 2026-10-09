"""
Resolve (spec §5.2): the drug name typed in the chat -> the identity card the user
confirms before anything is crawled.

Public sources are asked for facts in parallel (openFDA: sponsor, brands, class, label
indications; EMA: INN, holder, ATC, therapeutic area; ClinicalTrials.gov: sponsors,
conditions, code names). Each is best effort: a source that fails or is too slow
counts 0. The reasoning model merges the facts into a canonical identity, filling gaps
from its own knowledge but saying when it doesn't know the drug. The company website
and press-release page it proposes are then checked by fetching them, because a wrong
domain would send the company crawlers to the wrong site.
"""

import json
import logging
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from curl_cffi import requests

import integrations  # noqa: F401  (puts the team packages on sys.path)
from ai import llm
from clinicalTrialgov.clinicaltrials import ClinicalTrialsClient
from integrations import newsroom
from journey.store import asset_id
from regulatory import ema, fda
from storage.mongo_storage import get_db

log = logging.getLogger("onboarding.resolve")

FACTS_TIMEOUT = 20    # seconds for all sources together; EMA's report download is the slow one (once per process)
SITE_TIMEOUT = 10
IR_TIMEOUT = 6
IR_PATHS = ["/news", "/newsroom", "/media/press-releases", "/press-releases", "/news-releases", "/investors/news",
            "/media/news", "/news/press-releases", "/investors/press-releases"]
IR_SUBDOMAINS = [("ir", "/press-releases"), ("ir", "/news-releases"), ("investors", "/news-releases"),
                 ("investors", "/press-releases"), ("investor", "/news-releases")]
MODALITIES = ["Small molecule", "Biologic", "Antibody", "Antibody-drug conjugate", "Peptide", "Oligonucleotide",
              "Gene therapy", "Cell therapy", "Vaccine", "Other"]
# Words that don't identify a company on its own site ("Merck & Co." -> "merck")
GENERIC_WORDS = {"the", "and", "co", "company", "inc", "corp", "corporation", "ltd", "limited", "llc", "plc", "ag",
                 "sa", "se", "nv", "bv", "gmbh", "kk", "holdings", "group", "pharma", "pharmaceutical",
                 "pharmaceuticals", "therapeutics", "bio", "biosciences", "bioscience", "sciences", "laboratories",
                 "labs", "international", "global", "biotech", "biopharma", "biopharmaceuticals", "medical", "health"}
ACTIVE_TRIALS = {"RECRUITING", "ACTIVE_NOT_RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION"}
DATE = re.compile(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}"
                  r"|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}"
                  r"|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}/\d{4}\b")


# --- facts -------------------------------------------------------------------------------------------------

def _fda_facts(query: str) -> Tuple[int, Dict[str, Any]]:
    search = {"search": fda._name_query([query])}
    apps = fda._get("drugsfda", {**search, "limit": 10})["results"]
    labels = fda._get("label", {**search, "limit": 25})["results"]
    by_brand: Dict[str, Dict[str, Any]] = {}  # one label per brand: brands differ in indications (Tyvaso: PH-ILD)
    for label in labels:
        openfda = label.get("openfda", {})
        brand = ((openfda.get("brand_name") or openfda.get("generic_name") or [""])[0]).casefold()
        by_brand.setdefault(brand, {"brand_name": openfda.get("brand_name", []),
                                    "manufacturer_name": openfda.get("manufacturer_name", []),
                                    "pharm_class_epc": openfda.get("pharm_class_epc", []),
                                    "indications_and_usage": (label.get("indications_and_usage") or [""])[0][:800]})
    return len(apps) + len(labels), {
        "applications": [{"application_number": a.get("application_number"), "sponsor_name": a.get("sponsor_name"),
                          **{k: a.get("openfda", {}).get(k, []) for k in ("brand_name", "generic_name",
                                                                           "pharm_class_epc", "pharm_class_moa",
                                                                           "route")}} for a in apps],
        "labels": list(by_brand.values())[:6]}


EMA_FIELDS = ("name_of_medicine", "active_substance", "international_non_proprietary_name_common_name",
              "marketing_authorisation_developer_applicant_holder", "therapeutic_area_mesh", "atc_code_human",
              "medicine_status", "therapeutic_indication")


def _ema_facts(query: str) -> Tuple[int, Dict[str, Any]]:
    rows = ema.fetch_report("medicines", [query])
    return len(rows), {"medicines": [{k: str(r.get(k) or "")[:600] for k in EMA_FIELDS} for r in rows[:5]]}


PLACEBO = re.compile(r"placebo|standard of care|vehicle", re.I)


def _trial_facts(query: str) -> Tuple[int, Dict[str, Any]]:
    client, phrase = ClinicalTrialsClient(timeout=15), f'"{query.replace(chr(34), " ")}"'
    params = {"pageSize": 50, "countTotal": "true",
              "fields": "NCTId|OverallStatus|LeadSponsorName|Condition|Phase|InterventionName|InterventionOtherName|"
                        "InterventionType"}
    page = client.get("/studies", {**params, "query.intr": phrase})
    # A new INN is often only in the trial text while the interventions still carry the code name (fipaxalparant
    # is "HZN-825"): search all fields, and take the trials' investigational drugs as candidate names.
    broad = not page.get("studies")
    if broad:
        page = client.get("/studies", {**params, "query.term": phrase})
    sponsors, conditions, active, phases, names = Counter(), Counter(), Counter(), Counter(), Counter()
    own = re.compile(rf"\b{re.escape(query)}\b", re.I)
    for study in page.get("studies", []):
        p = study["protocolSection"]
        sponsors[p.get("sponsorCollaboratorsModule", {}).get("leadSponsor", {}).get("name")] += 1
        conditions.update(p.get("conditionsModule", {}).get("conditions", []))
        if p.get("statusModule", {}).get("overallStatus") in ACTIVE_TRIALS:
            active.update(p.get("conditionsModule", {}).get("conditions", []))
        phases.update(p.get("designModule", {}).get("phases", []))
        for i in p.get("armsInterventionsModule", {}).get("interventions", []):
            aka = [i.get("name") or "", *(i.get("otherNames") or [])]
            investigational = i.get("type") in ("DRUG", "BIOLOGICAL") and not PLACEBO.search(aka[0])
            if any(own.search(n) for n in aka) or (broad and investigational):  # the asset's own intervention:
                names.update(aka)                                               # its other names are code names
    return page.get("totalCount", 0), {"lead_sponsors": [s for s, _ in sponsors.most_common(5) if s],
                                       "conditions": [c for c, _ in conditions.most_common(8)],
                                       "conditions_of_active_trials": [c for c, _ in active.most_common(8)],
                                       "phases": dict(phases),
                                       "intervention_names": [n for n, _ in names.most_common(12)]}


def gather_facts(query: str) -> Tuple[Dict[str, int], Dict[str, Any]]:
    """(records per source, facts per source). Sources run in parallel; failures and stragglers count 0."""
    sources = {"fda": _fda_facts, "ema": _ema_facts, "trials": _trial_facts}
    pool = ThreadPoolExecutor(max_workers=len(sources) + 1)
    pool.submit(newsroom.catalog)  # warm the newsroom spider list (a child process) for the plan notes
    futures = {key: pool.submit(fn, query) for key, fn in sources.items()}
    wait(futures.values(), timeout=FACTS_TIMEOUT)
    pool.shutdown(wait=False)  # a straggler finishes in the background (EMA's download is then cached)
    counts, facts = {}, {}
    for key, future in futures.items():
        try:
            counts[key], facts[key] = future.result(timeout=0)
        except Exception as e:
            log.warning("resolve: %s facts unavailable for %r: %r", key, query, e)
            counts[key], facts[key] = 0, {}
    return counts, facts


# --- merge -------------------------------------------------------------------------------------------------

SYSTEM = f"""You identify ONE drug asset for a pharma competitive-intelligence platform, from the name a user
typed and facts from openFDA, EMA and ClinicalTrials.gov (possibly empty). Return:
- found: false when the query is not a drug or development code you can identify with confidence. A brand,
  development code or misspelling of a known drug counts as found, and so does a name the facts show trials for
  (a new INN may be newer than your knowledge: then the trials' intervention names are its development codes).
  Never invent a drug.
- name: the canonical INN (generic name) in Title Case, e.g. "Sotatercept"; the code name when there is no INN.
  When the query is itself a generic name the registries match, use it (Title Case) and keep codes as aliases.
- aliases: brand names and development codes (at most 8) that refer only to this drug, not repeating name; no
  salts, strengths, forms or descriptive names.
- company: the company that develops / markets it now (for licensed drugs, the main global rights holder),
  name as commonly written (e.g. "Merck & Co."); websites: 1-3 candidate official corporate sites as https root
  URLs, most likely first (e.g. "https://www.merck.com"; include the short or abbreviated domain many companies
  use when you know it); ir_url: its press-release / news listing page, or "" if unsure.
- indications: approved indications as short labels with standard abbreviations and no population or severity
  qualifiers, e.g. "Pulmonary arterial hypertension (PAH)"; [] if not approved anywhere.
- investigational_indications: indications in active phase 2/3 development (see conditions_of_active_trials; not
  discontinued programs), same style, not repeating approved ones.
- mechanism: at most 6 words, e.g. "Activin signaling inhibitor"; "" when unknown. modality: one of {", ".join(MODALITIES)}.
Prefer the facts; use your own knowledge where they are thin."""

_STRINGS = {"type": "array", "items": {"type": "string"}}
SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean"}, "name": {"type": "string"}, "aliases": _STRINGS,
        "company": {"type": "object", "properties": {"name": {"type": "string"}, "websites": _STRINGS,
                                                     "ir_url": {"type": "string"}},
                    "required": ["name", "websites", "ir_url"], "additionalProperties": False},
        "indications": _STRINGS, "investigational_indications": _STRINGS,
        "mechanism": {"type": "string"}, "modality": {"type": "string", "enum": MODALITIES},
    },
    "required": ["found", "name", "aliases", "company", "indications", "investigational_indications",
                 "mechanism", "modality"],
    "additionalProperties": False,
}


def _https(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    return "https://" + re.sub(r"^\w+://", "", url)


# Dosing regimens trial registries append to intervention names ("HZN-825 BID", "X 10 mg").
DOSING = re.compile(r"\s+(?:QD|BID|TID|QID|QW|Q\d+W|\d+(?:\.\d+)?\s*(?:mg|µg|mcg|g|ml)\b.*)$", re.I)


def _unique(names: List[str], exclude: str, limit: int) -> List[str]:
    seen, out = {exclude.casefold()}, []
    for n in (DOSING.sub("", n.strip()) for n in names):
        if n and n.casefold() not in seen:
            seen.add(n.casefold())
            out.append(n)
    return out[:limit]


def merge(query: str, facts: Dict[str, Any], sources: Dict[str, int]) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    """(the model's identity, cleaned, with its most likely website; all candidate websites). The identity is None
    when the model doesn't know the drug and no registry has it."""
    payload = {"query": query, "registry_records": sources, "facts": facts}
    if any(sources.values()):  # the registries know it, even if the model doesn't (a new INN): it is a real drug
        payload["note"] = "The registries have records for this query, so found must be true; identify it from the facts."
    raw = llm.structured(llm.REASONING_MODEL, SYSTEM, json.dumps(payload),
                         "asset_identity", SCHEMA, reasoning_effort="low")  # the user is waiting
    if not raw["found"] or not raw["name"].strip():
        return None, []
    name, aliases = raw["name"].strip(), _unique(raw["aliases"], raw["name"].strip(), 8)
    typed = query.strip()
    # A new INN can be newer than the model, which then names the drug by its code: the typed generic name wins.
    if re.fullmatch(r"[A-Za-z]{6,}", typed) and re.search(r"\d", name) and typed.casefold() in map(str.casefold, aliases):
        name, aliases = typed.title(), _unique([name, *aliases], typed, 8)
    websites = _unique([_https(u) for u in raw["company"]["websites"]], "", 3)
    return {"name": name, "aliases": aliases,
            "company": {"name": raw["company"]["name"].strip(), "website": websites[0] if websites else "",
                        "ir_url": _https(raw["company"]["ir_url"])},
            "tags": {"indications": _unique(raw["indications"], "", 12),
                     "investigational_indications": _unique(raw["investigational_indications"], "", 12),
                     "mechanism": raw["mechanism"].strip(), "modality": raw["modality"]}}, websites


# --- verification ------------------------------------------------------------------------------------------

def _fetch(url: str, timeout: int) -> Optional[Tuple[str, str]]:
    """(final URL, HTML) when the page answers, else None. Not just 200: some sites answer a redirect without a
    Location and the page as its body (unither.com)."""
    try:
        resp = requests.get(url, impersonate="chrome", timeout=timeout, allow_redirects=True)
    except Exception:
        return None
    return (str(resp.url), resp.text) if resp.status_code < 400 else None


def _domain(url: str) -> str:
    host = urlparse(url or "").netloc.lower()
    return host[4:] if host.startswith("www.") else host


def _distinctive_word(company: str) -> str:
    words = re.findall(r"[a-z0-9]+", company.lower())
    return next((w for w in words if len(w) >= 3 and w not in GENERIC_WORDS), words[0] if words else "")


def _is_news_listing(html: str) -> bool:
    """A press-release listing shows several dated items."""
    return len(set(DATE.findall(html))) >= 3 and bool(re.search(r"press|news|media", html, re.I))


def _ir_candidates(website: str, ir_url: str) -> List[str]:
    domain = _domain(website)
    urls = [ir_url] if ir_url else []
    if domain:
        root = f"https://{urlparse(website).netloc}"
        urls += [root + p for p in IR_PATHS] + [f"https://{sub}.{domain}{p}" for sub, p in IR_SUBDOMAINS]
    return list(dict.fromkeys(urls))


def verify_company(company: Dict[str, str], websites: List[str]) -> Tuple[str, bool, str, bool]:
    """(website, verified, press-release page, verified). The website is the first candidate that answers and names
    the company (as the root it redirects to), else the model's first. The release page is the model's when it
    verifies, else the first common pattern on that website that does, else the model's, unverified."""
    word = _distinctive_word(company["name"])
    website, website_ok = company["website"], False
    with ThreadPoolExecutor(max_workers=len(websites) or 1) as pool:
        homes = list(pool.map(lambda url: _fetch(url, SITE_TIMEOUT), websites))
    for home in homes:
        if home and word and re.search(rf"\b{re.escape(word)}\b", home[1], re.I):
            final = urlparse(home[0])
            website, website_ok = f"{final.scheme}://{final.netloc}", True
            break
    candidates = _ir_candidates(website, company["ir_url"])
    with ThreadPoolExecutor(max_workers=len(candidates) or 1) as pool:
        pages = list(pool.map(lambda url: _fetch(url, IR_TIMEOUT), candidates))
    for page in pages:
        if page and _is_news_listing(page[1]):
            return website, website_ok, page[0], True
    return website, website_ok, company["ir_url"], False


# --- plan --------------------------------------------------------------------------------------------------

def plan(identity: Dict[str, Any], sources: Dict[str, int], spiders: List[str]) -> Tuple[List[Dict[str, str]], str]:
    """The onboard steps with a short note on what each will do for this asset, and a one-line summary."""
    from service.steps import PLANS

    company = identity["company"]
    domain = _domain(company["website"])
    generic_releases = not spiders and bool(company["ir_url"]) and domain != "unither.com"
    if domain == "unither.com":
        site = "unither adapter"
    elif domain:
        site = f"generic crawler: product pages and PDFs from {domain}" + \
               (", press releases from the IR page" if generic_releases else "")
    else:
        site = "no website: skipped"
    notes = {
        "regulatory": f"{sources.get('fda', 0)} FDA and {sources.get('ema', 0)} EMA records found",
        "clinical": f"{sources.get('trials', 0)} trials found",
        "publications": f"PubMed, {1 + len(identity['aliases'])} names",
        "company_site": site,
        "company_news": f"newsroom spider {', '.join(spiders)}" if spiders
        else "no newsroom crawler: press releases come from newswires",
        "news": f"{1 + len(identity['aliases'])} names",
        "competitors": "top 5 by indication and mechanism; each gets a light crawl",
        "patents": "by name and company (no AdisInsight id)",
    }
    steps = [{**s, "note": notes.get(s["name"], "")} for s in PLANS["onboard"]]
    regulators = " + ".join(k.upper() for k in ("fda", "ema") if sources.get(k)) or "FDA/EMA (nothing yet)"
    parts = [regulators, f"{sources.get('trials', 0)} trials", "PubMed",
             f"{domain} site" if domain else "",
             f"{company['name']} newsroom ({', '.join(spiders)} spider)" if spiders else "",
             "newswires", "competitors", "patents"]
    return steps, ", ".join(p for p in parts if p)


def _notes(identity: Dict[str, Any], sources: Dict[str, int], spiders: List[str], website_ok: bool,
           ir_ok: bool, existing: Optional[Dict[str, str]]) -> List[str]:
    company, notes = identity["company"], []
    if existing:
        notes.append(f"{identity['name']} is already tracked" if existing["kind"] == "primary"
                     else f"{identity['name']} is tracked as a competitor; adding it makes it a primary asset")
    if not any(sources.values()):
        notes.append("No FDA, EMA or ClinicalTrials.gov records matched: the identity comes from the model's knowledge")
    if not company["website"]:
        notes.append("No company website: the company site step will be skipped")
    elif not website_ok:
        notes.append(f"Could not verify {company['website']} as the website of {company['name']}: "
                     "check it before starting")
    if not spiders and not ir_ok:
        notes.append("Press-release page not verified: company releases come from newswires")
    notes.append("No AdisInsight id: patents are searched by name and company")
    return notes


def resolve(query: str) -> Optional[Dict[str, Any]]:
    """The identity card for a typed drug name (contract: Identity), or None when it can't be resolved."""
    sources, facts = gather_facts(query)
    identity, websites = merge(query, facts, sources)
    if identity is None:
        return None
    company = identity["company"]
    company["website"], website_ok, company["ir_url"], ir_ok = verify_company(company, websites)
    try:
        spiders = newsroom.spiders_for_domain(_domain(identity["company"]["website"]))
    except Exception as e:  # the spider list is a child process; the plan note is all that depends on it
        log.warning("resolve: newsroom spider list unavailable: %r", e)
        spiders = []
    aid = asset_id(identity["name"])
    doc = get_db().assets.find_one({"_id": aid}, {"kind": 1, "status": 1})
    existing = {"id": aid, "kind": doc.get("kind", "primary"), "status": doc.get("status", "ready")} if doc else None
    steps, summary = plan(identity, sources, spiders)
    return {"id": aid, **identity, "website_verified": website_ok, "ir_verified": ir_ok, "sources": sources,
            "exists": existing is not None, "existing": existing, "plan": steps, "plan_summary": summary,
            "notes": _notes(identity, sources, spiders, website_ok, ir_ok, existing)}
