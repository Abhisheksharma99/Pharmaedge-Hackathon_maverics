"""
Indication branches (spec §4.2, DATA_CONTRACTS §E.5): the asset's development drawn as a trunk (the indication of
its first approval) with branches that fork off the programme that led to them.

An LLM groups the asset's company-sponsored Phase 2+ trials and regulatory events into indication programmes and
names each one's parent and rationale. Everything else is rule-based, so it stays stable across refreshes: which
branches qualify, the trunk, ended, status, lane side and colour. Team-created branches (origin "user") are kept
as they are.
"""

import json
import re
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from pymongo import UpdateOne

from ai import llm

PALETTE = ["#2347d9", "#0b7a6f", "#6941c6", "#e0620f", "#0e7490", "#b54708"]
# Beyond the design palette (assets with many programmes): muted tones, handed out after the active branches.
EXTRA_COLORS = ["#7a5af8", "#c11574", "#4e5ba6", "#667085", "#93370d", "#3e4784", "#099250", "#a15c07"]
APPROVAL_TYPES = {"approval", "label_expansion", "new_formulation"}
FILED_TYPES = {"regulatory_submission", "regulatory_decision_expected", "regulatory_opinion"}
REGULATORY_TYPES = sorted(APPROVAL_TYPES | FILED_TYPES | {"application_withdrawn", "orphan_designation"})
STOPPED = {"TERMINATED", "WITHDRAWN", "SUSPENDED"}
ACTIVE_WORDS = {"RECRUITING": "recruiting", "ACTIVE_NOT_RECRUITING": "active", "NOT_YET_RECRUITING": "starting",
                "ENROLLING_BY_INVITATION": "enrolling"}
REGIONS = {"us": "US", "usa": "US", "united states": "US", "eu": "EU", "europe": "EU", "european union": "EU"}

SYSTEM = """You map ONE drug asset's development into indication branches for a journey chart.
A branch is a strategic programme in a distinct indication (disease or patient population), e.g. PAH, PH-ILD, IPF.
Rules:
- Group the given company trials and regulatory events into branches; member ids must come from the input.
- A different underlying disease, or a different clinical classification group, is a different branch even when
  the conditions share a term: e.g. pulmonary hypertension due to COPD, due to interstitial lung disease, and
  chronic thromboembolic PH are three branches, separate from pulmonary arterial hypertension; idiopathic and
  progressive pulmonary fibrosis are two. Merge only naming variants of the same disease (e.g. "PAH" and
  "pulmonary arterial hypertension"; unqualified "pulmonary hypertension" studies of the first indication).
- Closed programmes (terminated trials) and programmes run by partners or licensees are branches too.
- Formulations, devices or products are never branches. Prefer narrower branches over broad ones.
- id: the standard short abbreviation (e.g. PAH, PH-ILD, IPF, PPF, CTEPH, PH-COPD); full: the full name.
- parent: the id of the branch whose programme most directly led to this one (it must have started earlier);
  "" for the first branch. why: one line (max 15 words) on why the programme moved into this indication.
- partner: the company running this programme if it is a partner or licensee rather than the asset's company,
  else "".
- aliases: 3-8 lowercase phrases that identify this indication in free text, abbreviations included."""

SCHEMA = {
    "type": "object",
    "properties": {"branches": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "full": {"type": "string"},
                       "members": {"type": "array", "items": {"type": "string"}},
                       "parent": {"type": "string"}, "why": {"type": "string"}, "partner": {"type": "string"},
                       "aliases": {"type": "array", "items": {"type": "string"}}},
        "required": ["id", "full", "members", "parent", "why", "partner", "aliases"], "additionalProperties": False}}},
    "required": ["branches"], "additionalProperties": False,
}


def _phase_rank(phases: List[str]) -> int:
    return max((int(p[-1]) for p in phases or [] if re.fullmatch(r"(EARLY_)?PHASE\d", p or "")), default=0)


def candidate_trials(db, asset: Dict[str, Any], today: str) -> List[Dict[str, Any]]:
    """Company-sponsored Phase 2+ trials that actually started (withdrawn trials never did)."""
    company = ((asset.get("company") or {}).get("name") or "").lower()
    out = []
    for r in db.trial_records.find({"assets": asset["_id"]}, {"study": 0}):
        rank = _phase_rank(r.get("phases"))
        start = r.get("start_date") or ""
        if (not company or company not in (r.get("lead_sponsor") or "").lower() or rank < 2
                or r.get("overall_status") == "WITHDRAWN" or not start or start > today):
            continue
        out.append({"id": r["nct_id"], "acronym": r.get("acronym") or "", "phase": f"Phase {rank}", "phase_rank": rank,
                    "status": r.get("overall_status") or "", "start": start,
                    "end": r.get("primary_completion_date") or r.get("completion_date") or "",
                    "conditions": r.get("conditions") or [], "title": r.get("title") or ""})
    return sorted(out, key=lambda t: t["start"])


def candidate_events(db, asset_id: str, cap: int = 80) -> List[Dict[str, Any]]:
    """Regulatory milestones that show where the asset was filed and approved (AI ones only when High)."""
    out = []
    for e in db.journey_events.find({"asset": asset_id, "category": "regulatory", "type": {"$in": REGULATORY_TYPES}}):
        if e.get("origin") == "ai" and e.get("significance") != "High":
            continue
        out.append({"id": e["_id"], "date": e.get("date") or "", "type": e["type"], "region": e.get("region") or "",
                    "title": e.get("title") or "", "summary": (e.get("summary") or "")[:200],
                    "indication": e.get("indication") or ", ".join(e.get("indications") or []),
                    "origin": e.get("origin") or "", "holder": (e.get("details") or {}).get("Holder") or ""})
    return sorted(out, key=lambda e: e["date"])[:cap]


def propose(asset: Dict[str, Any], trials: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tags = asset.get("tags") or {}
    payload = {"asset": asset["name"], "company": (asset.get("company") or {}).get("name"),
               "indications": tags.get("indications", []), "investigational": tags.get("investigational_indications", []),
               "trials": [{k: t[k] for k in ("id", "acronym", "phase", "status", "start", "conditions")} for t in trials],
               "regulatory_events": [{k: e[k] for k in ("id", "date", "type", "region", "title", "indication")}
                                     for e in events]}
    return llm.structured(llm.REASONING_MODEL, SYSTEM, json.dumps(payload), "branches", SCHEMA)["branches"]


def _region(text: str) -> str:
    t = (text or "").strip()
    return REGIONS.get(t.lower(), t if len(t) <= 3 and t.isupper() else "")


def _status(d: Dict[str, Any], ended: Optional[str], partner: str) -> str:
    if d["approvals"]:
        regions = sorted({_region(a["region"]) for a in d["approvals"]} - {""})
        return "Approved" + (f" · {', '.join(regions)}" if regions else "") + (f" ({partner})" if partner else "")
    if ended:
        first = d["trials"][0]
        return f"Closed · {first['acronym'] or first['id']} {first['status'].lower()}"
    if any(e["type"] in FILED_TYPES for e in d["events"]):
        return "Filed · under review"
    active = [t for t in d["trials"] if t["status"] in ACTIVE_WORDS]
    if active:
        t = max(active, key=lambda t: t["phase_rank"])
        return f"Phase {t['phase_rank']} {ACTIVE_WORDS[t['status']]}"
    if d["trials"]:
        last = max((t["end"] or t["start"]) for t in d["trials"])
        return f"No active trials since {last[:4]}"
    return "In development"


def _is_closed(d: Dict[str, Any]) -> Optional[str]:
    return ("Terminated" if not d["approvals"] and d["trials"] and all(t["status"] in STOPPED for t in d["trials"])
            else None)


def _partner_of(d: Dict[str, Any], company: Optional[str]) -> str:
    """The LLM's partner, else the single other company holding every approval (e.g. an EU licensee)."""
    partner = (d["p"].get("partner") or "").strip()
    holders = {a.get("holder") for a in d["approvals"]}
    if not partner and len(holders) == 1 and next(iter(holders)):
        partner = next(iter(holders))
    company_l = (company or "").lower()
    if partner and company_l and (partner.lower() in company_l or company_l in partner.lower()):
        return ""
    return partner


def build(proposed: List[Dict[str, Any]], trials: List[Dict[str, Any]], events: List[Dict[str, Any]],
          company: Optional[str], existing: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Rule-based branch docs from the LLM's grouping (pure). Trunk first, then by fork date; user branches last."""
    trial_by = {t["id"]: t for t in trials}
    event_by = {e["id"]: e for e in events}
    user = [b for b in existing if b.get("origin") == "user"]
    taken, claimed = {b["id"] for b in user}, set()
    drafts: List[Dict[str, Any]] = []
    for p in proposed:
        bid = re.sub(r"\s+", " ", p.get("id") or "").strip()[:24]
        if not bid or bid in taken or any(d["id"] == bid for d in drafts):
            continue
        ts = sorted((trial_by[m] for m in p["members"] if m in trial_by and m not in claimed), key=lambda t: t["start"])
        es = sorted((event_by[m] for m in p["members"] if m in event_by and m not in claimed), key=lambda e: e["date"])
        approvals = [e for e in es if e["type"] in APPROVAL_TYPES and e["date"]]
        if not approvals and not ts:
            continue
        claimed.update(t["id"] for t in ts)
        claimed.update(e["id"] for e in es)
        dates = [t["start"] for t in ts] + [e["date"] for e in es if e["date"]]
        drafts.append({"p": p, "id": bid, "trials": ts, "events": es, "approvals": approvals, "start": min(dates)})
    if not drafts:
        return user

    def trunk_key(d):
        first_p3 = min((t["start"] for t in d["trials"] if t["phase_rank"] >= 3), default="9999")
        return (min((a["date"] for a in d["approvals"]), default="9999"), first_p3, d["start"])

    trunk = min(drafts, key=trunk_key)
    ordered = [trunk] + sorted((d for d in drafts if d is not trunk), key=lambda d: d["start"])
    # Colours: a branch keeps its colour across refreshes (unless another branch already has it); active branches
    # get the design palette first, closed and partner ones after.
    used = {b.get("color") for b in user}
    kept_colors: Dict[str, str] = {}
    for b in existing:
        if b.get("color") and b.get("origin") != "user" and b["color"] not in used and b["id"] in {d["id"] for d in drafts}:
            kept_colors[b["id"]] = b["color"]
            used.add(b["color"])
    by_priority = sorted(ordered, key=lambda d: (d is not trunk, bool(_is_closed(d)) or bool(_partner_of(d, company)), d["start"]))
    pool = [c for c in PALETTE + EXTRA_COLORS if c not in used]
    for d in by_priority:
        if d["id"] not in kept_colors:
            kept_colors[d["id"]] = pool.pop(0) if pool else EXTRA_COLORS[len(kept_colors) % len(EXTRA_COLORS)]
    out, right, left = [], 0, 0
    for d in ordered:
        p, is_trunk = d["p"], d is trunk
        ended = _is_closed(d)
        partner = _partner_of(d, company)
        parent = None
        if not is_trunk:
            wanted = (p.get("parent") or "").strip()
            ok = next((x for x in drafts if x["id"] == wanted and x is not d and x["start"] <= d["start"]), None)
            parent = ok["id"] if ok else trunk["id"]
        if is_trunk:
            off = 0
        elif ended or partner:
            left -= 1
            off = left
        else:
            right += 1
            off = right
        color = kept_colors[d["id"]]
        aliases = [a.strip().lower() for a in [*p.get("aliases", []), d["id"], p.get("full", "")] if len(a.strip()) >= 3]
        out.append({"id": d["id"], "label": d["id"], "full": (p.get("full") or d["id"]).strip(), "color": color,
                    "off": off, "trunk": is_trunk, "from": parent, "why": "" if is_trunk else (p.get("why") or "").strip(),
                    "status": _status(d, ended, partner), "ended": ended, "origin": "ai", "partner": partner or None,
                    "aliases": list(dict.fromkeys(aliases)), "start": d["start"],
                    "members": [t["id"] for t in d["trials"]] + [e["id"] for e in d["events"]]})
    return out + user


def save(db, asset_id: str, branches: List[Dict[str, Any]]) -> None:
    now = datetime.now(timezone.utc)
    keep = []
    for b in branches:
        keep.append(b["id"])
        if b.get("origin") == "user":
            continue
        doc = {k: v for k, v in b.items() if k != "_id"}
        db.asset_branches.update_one({"_id": f"{asset_id}:{b['id']}"}, {"$set": {**doc, "asset": asset_id, "updated_at": now}},
                                     upsert=True)
    db.asset_branches.delete_many({"asset": asset_id, "origin": {"$ne": "user"}, "id": {"$nin": keep}})
    db.asset_branches.create_index([("asset", 1)])


def refresh(db, asset: Dict[str, Any], today: Optional[str] = None) -> List[Dict[str, Any]]:
    """Re-derive and store the asset's branches (one cached LLM call)."""
    today = today or date.today().isoformat()
    trials = candidate_trials(db, asset, today)
    events = candidate_events(db, asset["_id"])
    proposed = propose(asset, trials, events) if trials or events else []
    existing = list(db.asset_branches.find({"asset": asset["_id"]}))
    out = build(proposed, trials, events, (asset.get("company") or {}).get("name"), existing)
    save(db, asset["_id"], out)
    return out


_DASHES = re.compile(r"[‐-―−]")


def match_branches(texts: List[str], branches: List[Dict[str, Any]]) -> List[str]:
    """Branch ids named in free text: per text the branch with the longest matching alias, in text order."""
    found: List[str] = []
    for text in texts:
        t = _DASHES.sub("-", (text or "").lower())
        best: Optional[Tuple[str, int]] = None
        for b in branches:
            for a in b.get("aliases") or []:
                if (best is None or len(a) > best[1]) and re.search(rf"(?<![a-z0-9]){re.escape(a)}(?![a-z0-9])", t):
                    best = (b["id"], len(a))
        if best and best[0] not in found:
            found.append(best[0])
    return found


def place(event: Dict[str, Any], branches: List[Dict[str, Any]], by_member: Dict[str, str]) -> Tuple[Optional[str], List[str]]:
    """(branch, span) for one event: grouping membership, then its trial, then the indications it names
    (falling back to the title). None means the trunk."""
    if event["_id"] in by_member:
        return by_member[event["_id"]], []
    if event.get("nct_id") in by_member:
        return by_member[event["nct_id"]], []
    texts = list(event.get("indications") or []) or [event.get("indication") or ""]
    ids = match_branches(texts, branches) or match_branches([event.get("title") or ""], branches)
    trunks = {b["id"] for b in branches if b.get("trunk")}
    ids.sort(key=lambda i: i in trunks)  # a specific branch beats the trunk ("PH" + "ILD" is PH-ILD)
    return (ids[0], ids[1:]) if ids else (None, [])


def assign_all(db, asset_id: str) -> int:
    """Write `branch` / `span` on every event of the asset (events of an asset without branches get neither)."""
    branches = list(db.asset_branches.find({"asset": asset_id}))
    if not branches:
        db.journey_events.update_many({"asset": asset_id}, {"$unset": {"branch": "", "span": ""}})
        return 0
    trunk = next((b["id"] for b in branches if b.get("trunk")), branches[0]["id"])
    by_member = {m: b["id"] for b in branches for m in b.get("members") or []}
    ops = []
    for e in db.journey_events.find({"asset": asset_id}, {"nct_id": 1, "indications": 1, "indication": 1, "title": 1}):
        branch, span = place(e, branches, by_member)
        ops.append(UpdateOne({"_id": e["_id"]}, {"$set": {"branch": branch or trunk, "span": span}}))
    if ops:
        db.journey_events.bulk_write(ops, ordered=False)
    db.journey_events.create_index([("asset", 1), ("branch", 1), ("date", 1)])
    return len(ops)
