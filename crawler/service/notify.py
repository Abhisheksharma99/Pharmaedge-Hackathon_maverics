"""
In-app notifications written when a crawl job ends (spec §5): onboarding finished, failed steps, and new
High-significance events on primary assets. Fanned out to active users whose preferences allow the kind
(user_prefs.notify; defaults below). The API adds comment notifications.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List
from urllib.parse import quote

DEFAULT_PREFS = {"highEvents": True, "crawls": True, "weeklyDigest": False}


def recipients(db, pref: str) -> List[str]:
    users = [str(u["_id"]) for u in db.users.find({"active": True}, {"_id": 1})]
    prefs = {p["user"]: p.get("notify") or {} for p in db.user_prefs.find({"user": {"$in": users}})}
    return [u for u in users if {**DEFAULT_PREFS, **prefs.get(u, {})}.get(pref)]


def push(db, pref: str, kind: str, title: str, sub: str, link: str) -> int:
    users = recipients(db, pref)
    now = datetime.now(timezone.utc)
    if users:
        db.notifications.insert_many([{"user": u, "kind": kind, "title": title, "sub": sub, "link": link, "read": False,
                                       "at": now} for u in users])
        db.notifications.create_index([("user", 1), ("at", -1)])
    return len(users)


def job_ended(db, job: Dict[str, Any], asset: Dict[str, Any], new_high: List[Dict[str, Any]]) -> int:
    name, asset_id = asset.get("name") or job["asset"], job["asset"]
    overview = f"/assets/{quote(asset_id, safe='')}/overview"
    failed = [s for s in job["steps"] if s["status"] == "failed"]
    sent = 0
    if job["status"] == "failed" or failed:
        title = (f"{name}: data collection failed" if job["status"] == "failed"
                 else f"{name}: {len(failed)} step{'s' if len(failed) != 1 else ''} failed")
        sub = ", ".join(s.get("label") or s["name"] for s in failed[:2]) or "See the crawl job for details"
        sent += push(db, "crawls", "job_failed", title, sub, f"/jobs/{job['_id']}")
    if job["type"] == "onboard" and asset.get("status") == "ready":
        events = db.journey_events.count_documents({"asset": asset_id})
        sent += push(db, "crawls", "onboarding_finished", f"{name} journey is ready", f"{events} journey events", overview)
    elif job["type"] != "onboard" and job["status"] != "cancelled" and new_high and asset.get("kind") == "primary":
        if len(new_high) == 1:
            title, sub, link = new_high[0]["title"], name, f"{overview}?focus={quote(new_high[0]['_id'], safe='')}"
        else:
            title = f"{len(new_high)} new high-significance events for {name}"
            sub, link = "; ".join(e["title"] for e in new_high[:2]), overview
        sent += push(db, "highEvents", "high_event", title, sub, link)
    return sent
