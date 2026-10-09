"""
Rule-based journey events from structured sources (FDA, EMA, ClinicalTrials.gov,
patents).

These records are already dated and typed, so no LLM is needed: each maps to a
journey event by rule. Unstructured sources (news, press releases) become events
through AI enrichment instead (see the design spec, §5.3).

Every event keeps references to the records it came from, so the UI can always
show the evidence behind it.
"""

import re
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional

SIGNIFICANCE_BY_PHASE = {"PHASE3": "High", "PHASE2": "Medium", "PHASE4": "Low", "PHASE1": "Low", "EARLY_PHASE1": "Low"}
ACTIVE_TRIAL_STATUSES = {"RECRUITING", "ACTIVE_NOT_RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION"}


def _event(asset: str, record: Dict[str, Any], collection: str, kind: str, **fields: Any) -> Dict[str, Any]:
    """An event keyed by its source record and kind, so re-running updates instead of duplicating."""
    return {
        "_id": f"rule:{kind}:{record['record_key']}",
        "asset": asset,
        "type": kind,
        "origin": "rule",
        "confidence": 1.0,
        "is_milestone": False,
        "sources": [{"collection": collection, "record_key": record["record_key"]}],
        **fields,
    }


# Dosage-form suffixes that stay upper-case in brand names ("TYVASO DPI" -> "Tyvaso DPI").
_ACRONYMS = {"DPI", "ER", "XR", "SR", "XL", "CR", "LA", "IV", "SC", "ODT"}


def _brand(record: Dict[str, Any]) -> str:
    """Main brand name, readable: the first listed brand (others are kits/diluents)."""
    names = record.get("brand_names") or record.get("generic_names") or []
    if not names:
        return record.get("application_number", "")
    return " ".join(w if w in _ACRONYMS else w.title() for w in names[0].split())


CALENDAR_URL = re.compile(r"https?://\S+")


def fda_calendar_event(asset: str, r: Dict[str, Any], today: str) -> Dict[str, Any]:
    """FDA Tracker calendar: a PDUFA goal date ahead is the FDA decision milestone, one behind is history (the
    decision itself comes from Drugs@FDA); advisory committee meetings likewise."""
    drugs = ", ".join(r.get("drugs") or [])
    upcoming = r["date"] > today
    common = dict(category="regulatory", region="US", date=r["date"], significance="High", is_milestone=upcoming,
                  expected_date=r["date"] if upcoming else None, sponsor=r.get("company"),
                  sponsor_is_company=r.get("sponsor_is_company"),
                  summary=re.sub(r"\s+", " ", CALENDAR_URL.sub("", r.get("description") or "")).strip()[:400])
    if r.get("event_type") == "pdufa":
        if upcoming:
            return _event(asset, r, "fda_records", "regulatory_decision_expected", **common,
                          title=f"FDA decision expected (PDUFA date): {drugs}")
        return _event(asset, r, "fda_records", "pdufa_date", **{**common, "significance": "Medium"},
                      title=f"PDUFA goal date: {drugs}")
    return _event(asset, r, "fda_records", "advisory_committee", **common,
                  title=f"FDA advisory committee {'meeting scheduled' if upcoming else 'meeting'}: {drugs}")


def fda_events(asset: str, records: Iterable[Dict[str, Any]], today: Optional[str] = None) -> List[Dict[str, Any]]:
    today = today or date.today().isoformat()
    events = []
    for r in records:
        if r.get("record_type") == "fda_calendar_event" and r.get("date"):
            events.append(fda_calendar_event(asset, r, today))
            continue
        if r.get("record_type") == "fda_recall":
            events.append(_event(asset, r, "fda_records", "recall", category="safety", region="US", date=r.get("date", ""),
                                 title=f"FDA recall: {r.get('product_description', '')[:90]}",
                                 summary=r.get("reason_for_recall", ""), significance="High"))
            continue
        if r.get("record_type") != "fda_submission" or not r.get("date"):
            continue
        status, sub_type, cls = r.get("submission_status"), r.get("submission_type"), r.get("submission_class") or ""
        brand, app_no = _brand(r), r.get("application_number", "")
        sponsor = (r.get("sponsor_name") or "").title()
        common = dict(category="regulatory", region="US", date=r["date"], application_number=app_no)
        if status == "TA":
            events.append(_event(asset, r, "fda_records", "tentative_approval", **common, significance="Medium",
                                 title=f"FDA tentative approval: {brand} ({sponsor})", summary=f"{app_no}"))
        elif status != "AP":
            continue
        elif sub_type == "ORIG" and app_no.startswith("ANDA"):
            events.append(_event(asset, r, "fda_records", "generic_approval", **common, significance="Medium",
                                 title=f"FDA approves generic {brand} ({sponsor})", summary=f"{app_no}"))
        elif sub_type == "ORIG":
            events.append(_event(asset, r, "fda_records", "approval", **common, significance="High",
                                 title=f"FDA approves {brand}",
                                 summary=f"{app_no} · {sponsor} · {cls or 'original application'}".strip(" ·")))
        elif cls == "Efficacy":
            events.append(_event(asset, r, "fda_records", "label_expansion", **common, significance="High",
                                 title=f"FDA approves efficacy supplement for {brand}",
                                 summary=f"{app_no} supplement {r.get('submission_number')}: new or expanded indication"))
        elif cls.startswith(("Type 3", "Type 5")):
            events.append(_event(asset, r, "fda_records", "new_formulation", **common, significance="Medium",
                                 title=f"FDA approves new formulation of {brand}", summary=f"{app_no} · {cls}"))
        elif cls == "Labeling":
            events.append(_event(asset, r, "fda_records", "label_update", **common, significance="Low",
                                 title=f"Label update for {brand}", summary=f"{app_no} supplement {r.get('submission_number')}"))
        # Manufacturing (CMC) supplements are left off the journey: frequent and not strategic.
    return events


EC_DECISION_DAYS = 67  # the European Commission decides within 67 days of a CHMP opinion
# The same occurrence in the EMA reports: a post-authorisation opinion is dated within the meeting; a withdrawal
# is announced at the next meeting.
SAME_OCCURRENCE = {"regulatory_opinion": ("label_expansion", 10), "application_withdrawn": ("application_withdrawn", 45)}


def _days_apart(a: str, b: str) -> int:
    return abs((date.fromisoformat(a[:10]) - date.fromisoformat(b[:10])).days)


def chmp_events(asset: str, r: Dict[str, Any], known: List[Dict[str, Any]], today: str) -> List[Dict[str, Any]]:
    """A CHMP opinion from the meeting highlights. When the EMA reports already gave the same occurrence an event
    (a post-authorisation opinion, a withdrawn application: same medicine, within days), the highlights record is
    added to that event's evidence instead of duplicating it. A positive opinion pending the EC decision adds the
    decision as a milestone."""
    opinion, procedure, name = r.get("opinion"), r.get("procedure"), (r.get("name_of_medicine") or "").lower()
    kind = "application_withdrawn" if opinion == "withdrawn" else "regulatory_opinion"
    same_type, window = SAME_OCCURRENCE[kind]
    same = next((e["event"] for e in known if e["medicine"] == name and e["event"]["type"] == same_type
                 and _days_apart(e["event"]["date"], r["date"]) <= window), None)
    events = []
    if same:
        same["sources"].append({"collection": "ema_records", "record_key": r["record_key"]})
        if r.get("therapeutic_indication") and same["type"] == "label_expansion":
            same.update(indication=r["therapeutic_indication"], summary=r["therapeutic_indication"])
    else:
        major = opinion in {"positive", "negative"} and procedure in {"new_medicine", "extension_of_indication"}
        significance = "High" if major else "Low" if opinion in {"other", "scientific_opinion"} else "Medium"
        summary = " · ".join(v for v in (r.get("therapeutic_indication"), r.get("company"), r.get("status")) if v)
        events.append(_event(asset, r, "ema_records", kind, category="regulatory", region="EU", date=r["date"],
                             significance=significance, title=r.get("title") or f"CHMP opinion: {name}",
                             summary=summary or r.get("section") or "", indication=r.get("therapeutic_indication")))
    decision = (date.fromisoformat(r["date"][:10]) + timedelta(days=EC_DECISION_DAYS)).isoformat()
    decided = any(e["medicine"] == name and e["event"]["type"] == "approval" and e["event"]["date"] >= r["date"]
                  for e in known)  # the EPAR already shows the Commission's authorisation
    if (opinion == "positive" and "pending ec decision" in (r.get("status") or "").lower() and decision > today
            and not decided):
        events.append(_event(asset, r, "ema_records", "regulatory_decision_expected", category="regulatory",
                             region="EU", date=decision, expected_date=decision, is_milestone=True,
                             significance="High", indication=r.get("therapeutic_indication"),
                             title=f"European Commission decision expected: {r.get('name_of_medicine')}",
                             summary=f"CHMP positive opinion adopted {r['date']}; the Commission decides within "
                                     f"{EC_DECISION_DAYS} days."))
    return events


def ema_events(asset: str, records: Iterable[Dict[str, Any]], today: Optional[str] = None) -> List[Dict[str, Any]]:
    today = today or date.today().isoformat()
    events, known, chmp = [], [], []
    for r in records:
        if not r.get("date"):
            continue
        if r.get("record_type") == "ema_chmp_opinion":
            chmp.append(r)  # after the EMA reports, so a duplicate folds into their event
            continue
        if r.get("record_type") == "ema_chmp_highlight":
            continue  # narrative only: AI event extraction reads it
        rt, name = r.get("record_type"), r.get("name_of_medicine") or r.get("medicine_name") or "medicine"
        common = dict(category="regulatory", region="EU", date=r["date"])
        if rt == "ema_epar" and r.get("medicine_status") == "Authorised":
            events.append(_event(asset, r, "ema_records", "approval", **common, significance="High",
                                 title=f"EU marketing authorisation: {name}",
                                 summary=f"{r.get('marketing_authorisation_developer_applicant_holder', '')} · "
                                         f"{r.get('therapeutic_area_mesh', '')}".strip(" ·")))
        elif rt == "ema_epar" and "withdrawn" in (r.get("medicine_status") or "").lower():
            events.append(_event(asset, r, "ema_records", "application_withdrawn", **common, significance="Medium",
                                 title=f"EU application withdrawn: {name}",
                                 summary=r.get("marketing_authorisation_developer_applicant_holder", "")))
        elif rt == "ema_orphan_designation":
            events.append(_event(asset, r, "ema_records", "orphan_designation", **common, significance="Medium",
                                 title=f"EU orphan designation ({r.get('status', '')}): {r.get('intended_use', '')[:80]}",
                                 summary=r.get("eu_designation_number", "")))
        elif rt == "ema_post_authorisation":
            events.append(_event(asset, r, "ema_records", "label_expansion", **common, significance="Medium",
                                 title=f"CHMP {r.get('post_authorisation_opinion_status', '').lower()} opinion: {name}",
                                 summary="Post-authorisation procedure (e.g. new indication or variation)"))
        elif rt == "ema_dhpc":
            events.append(_event(asset, r, "ema_records", "safety_communication", category="safety", region="EU",
                                 date=r["date"], significance="High", title=f"Safety communication: {name}",
                                 summary=r.get("dhpc_type", "")))
        if events and events[-1]["sources"][0]["record_key"] == r["record_key"]:
            known.append({"medicine": name.lower(), "event": events[-1]})
    for r in sorted(chmp, key=lambda r: r["date"]):
        events.extend(chmp_events(asset, r, known, today))
    return events


def _phase(record: Dict[str, Any]) -> str:
    phases = [p for p in record.get("phases") or [] if p != "NA"]
    return phases[-1] if phases else ""


def trial_events(asset: str, records: Iterable[Dict[str, Any]], company: Optional[str],
                 today: Optional[str] = None) -> List[Dict[str, Any]]:
    today = today or date.today().isoformat()
    company_l = (company or "").lower()
    events = []
    for r in records:
        phase = _phase(r)
        phase_label = phase.replace("PHASE", "Phase ").replace("EARLY_", "Early ") if phase else "Trial"
        significance = SIGNIFICANCE_BY_PHASE.get(phase, "Low")
        name = r.get("acronym") or r.get("title") or r.get("nct_id")
        common = dict(category="clinical", phase=phase or None, nct_id=r.get("nct_id"),
                      indication=", ".join((r.get("conditions") or [])[:2]),
                      sponsor=r.get("lead_sponsor"),
                      sponsor_is_company=bool(company_l) and company_l in (r.get("lead_sponsor") or "").lower(),
                      significance=significance)
        status = r.get("overall_status")
        if r.get("start_date") and r["start_date"] <= today:
            events.append(_event(asset, r, "trial_records", "trial_start", date=r["start_date"], **common,
                                 title=f"{phase_label} trial started: {name}", summary=r.get("title", "")))
        if status == "COMPLETED" and r.get("primary_completion_date"):
            events.append(_event(asset, r, "trial_records", "trial_completion", date=r["primary_completion_date"],
                                 **common, title=f"{phase_label} trial completed: {name}", summary=r.get("title", "")))
        elif status in {"TERMINATED", "WITHDRAWN"}:
            when = r.get("primary_completion_date") or r.get("completion_date") or r.get("start_date") or ""
            if when:
                events.append(_event(asset, r, "trial_records", "trial_stopped", date=when, **{**common,
                                     "significance": "Medium" if phase == "PHASE3" else "Low"},
                                     title=f"{phase_label} trial {status.lower()}: {name}",
                                     summary=r.get("why_stopped") or r.get("title", "")))
        elif status in ACTIVE_TRIAL_STATUSES and (r.get("primary_completion_date") or "") > today:
            events.append(_event(asset, r, "trial_records", "expected_readout", **common,
                                 date=r["primary_completion_date"], expected_date=r["primary_completion_date"],
                                 is_milestone=True, title=f"{phase_label} primary completion expected: {name}",
                                 summary=r.get("title", "")))
    return events


IN_FORCE = {"Active", "Granted"}


def _in_force_us_grant(r: Dict[str, Any]) -> bool:
    return r.get("country") == "US" and (r.get("kind") or "").startswith("B") and r.get("legal_status") in IN_FORCE


def patent_events(asset: str, records: Iterable[Dict[str, Any]], today: Optional[str] = None) -> List[Dict[str, Any]]:
    """US patent grants (history) and the expiries of US patents still in force (milestones: the exclusivity
    horizon). Expiries are grouped by date, since a family's patents often expire together; the last one is
    High significance (loss of exclusivity)."""
    today = today or date.today().isoformat()
    events, expiring = [], {}
    for r in records:
        if not _in_force_us_grant(r):
            continue
        if r.get("grant_date"):
            events.append(_event(asset, r, "patent_records", "patent_grant", category="ip", date=r["grant_date"],
                                 significance="Low", title=f"US patent granted: {r.get('title')}",
                                 summary=f"{r['publication_number']} ({', '.join(r.get('assignees') or [])})"))
        if (r.get("expiry_date") or "") > today:
            expiring.setdefault(r["expiry_date"], []).append(r)
    last = max(expiring, default=None)
    for when, group in sorted(expiring.items()):
        numbers = [g["publication_number"] for g in group]
        title = (f"US patent expiry: {group[0].get('title')}" if len(group) == 1
                 else f"{len(group)} US patents expire ({group[0].get('title')}, ...)")
        events.append({
            "_id": f"rule:patent_expiry:{asset}:{when}", "asset": asset, "type": "patent_expiry", "origin": "rule",
            "confidence": 1.0, "category": "ip", "date": when, "expected_date": when, "is_milestone": True,
            "significance": "High" if when == last else "Medium", "title": title,
            "summary": ("Last in-force US patent; loss of exclusivity unless extended. " if when == last else "")
                       + ", ".join(numbers),
            "sources": [{"collection": "patent_records", "record_key": g["record_key"]} for g in group],
        })
    return events


def build_rule_events(db, asset_id: str, company: Optional[str]) -> List[Dict[str, Any]]:
    q = {"assets": asset_id}
    return (fda_events(asset_id, db.fda_records.find(q))
            + ema_events(asset_id, db.ema_records.find(q))
            + trial_events(asset_id, db.trial_records.find(q, {"study": 0}), company)
            + patent_events(asset_id, db.patent_records.find(q, {"abstract": 0, "events": 0})))
