"""Job-end notifications (offline)."""

from service import notify, steps
from service.jobs import new_job


def users(db, *ids):
    for i in ids:
        db.users.insert_one({"_id": i, "active": True})
    db.users.insert_one({"_id": "gone", "active": False})


def job(type="refresh", status="completed", failed=()):
    j = new_job("trep", type, steps.PLANS[type], None)
    j["status"] = status
    for s in j["steps"]:
        s["status"] = "failed" if s["name"] in failed else "done"
        s["error"] = "boom" if s["name"] in failed else None
    return j


def test_onboarding_finished_goes_to_everyone_who_wants_crawl_updates(db):
    users(db, "u1", "u2")
    db.user_prefs.insert_one({"user": "u2", "notify": {"crawls": False}})
    db.journey_events.insert_one({"asset": "trep"})
    n = notify.job_ended(db, job("onboard"), {"_id": "trep", "name": "Treprostinil", "status": "ready", "kind": "primary"}, [])
    assert n == 1
    [doc] = db.notifications.docs
    assert doc["user"] == "u1" and doc["kind"] == "onboarding_finished" and doc["read"] is False
    assert doc["title"] == "Treprostinil journey is ready" and doc["sub"] == "1 journey events"
    assert doc["link"] == "/assets/trep/overview"


def test_failed_steps_raise_a_job_failed_notification(db):
    users(db, "u1")
    j = job(failed=("patents",))
    notify.job_ended(db, j, {"_id": "trep", "name": "Treprostinil", "status": "ready", "kind": "primary"}, [])
    [doc] = db.notifications.docs
    assert doc["kind"] == "job_failed" and doc["title"] == "Treprostinil: 1 step failed"
    assert doc["link"] == f"/jobs/{j['_id']}"


def test_new_high_events_on_a_primary_asset(db):
    users(db, "u1")
    asset = {"_id": "trep", "name": "Treprostinil", "status": "ready", "kind": "primary"}
    notify.job_ended(db, job(), asset, [{"_id": "e1", "title": "FDA accepts Tyvaso sNDA for IPF"}])
    assert db.notifications.docs[-1]["title"] == "FDA accepts Tyvaso sNDA for IPF"
    assert db.notifications.docs[-1]["link"] == "/assets/trep/overview?focus=e1"
    notify.job_ended(db, job(), asset, [{"_id": "e1", "title": "A"}, {"_id": "e2", "title": "B"}])
    assert db.notifications.docs[-1]["title"] == "2 new high-significance events for Treprostinil"
    assert db.notifications.docs[-1]["sub"] == "A; B"
    before = len(db.notifications.docs)
    notify.job_ended(db, job("competitor"), {**asset, "kind": "competitor"}, [{"_id": "e3", "title": "C"}])
    assert len(db.notifications.docs) == before  # competitors don't notify for their own events


def test_high_event_preference_off(db):
    users(db, "u1")
    db.user_prefs.insert_one({"user": "u1", "notify": {"highEvents": False}})
    assert notify.job_ended(db, job(), {"_id": "trep", "name": "T", "status": "ready", "kind": "primary"},
                            [{"_id": "e1", "title": "A"}]) == 0
