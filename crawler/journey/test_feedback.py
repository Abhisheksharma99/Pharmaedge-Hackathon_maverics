"""Re-check of notes marked "Missed by AI" at finalize (offline). Run: cd crawler && ../.venv/bin/python -m pytest journey -q"""

import pytest

from journey.feedback import recheck

ASSET = "treprostinil"


@pytest.fixture
def feed():
    lines = []
    return lines


def run(db, feed):
    return recheck(db, ASSET, lambda kind, text, **extra: feed.append((kind, text, extra)))


def note(db, note_id="n1", **fields):
    db.crawl_feedback.insert_one({"_id": f"fb-{note_id}", "asset": ASSET, "status": "open", "note_id": note_id,
                                  "title": "Phase 3 topline results announced", **fields})


def event(db, event_id="ev1", **fields):
    db.journey_events.insert_one({"_id": event_id, "asset": ASSET, "date": "2024-03-01",
                                 "title": "Topline results from the Phase 3 trial announced", "sources": [], **fields})


def stored(db, note_id="n1"):
    return db.crawl_feedback.find_one({"_id": f"fb-{note_id}"})


def test_an_event_with_the_notes_words_within_18_months_resolves_it(db, feed):
    event(db)
    note(db, date="2025-06-01")  # 15 months after the event
    assert run(db, feed) == {"feedback_checked": 1, "feedback_resolved": 1, "feedback_events_created": 0}
    assert stored(db)["status"] == "resolved" and stored(db)["resolved_event"] == "ev1"


def test_an_event_outside_the_18_month_window_does_not_match(db, feed):
    event(db)
    note(db, date="2026-06-01")  # 27 months after the event
    assert run(db, feed)["feedback_resolved"] == 0
    assert stored(db)["status"] == "open" and stored(db)["last_checked_at"]


def test_a_note_without_a_date_matches_an_event_of_any_date(db, feed):
    event(db, date="2019-01-01")
    note(db)
    assert run(db, feed)["feedback_resolved"] == 1
    assert stored(db)["resolved_event"] == "ev1"


def test_a_single_shared_word_is_not_enough(db, feed):
    event(db, title="Phase 2 enrolment completed")
    note(db)
    run(db, feed)
    assert stored(db)["status"] == "open"


def test_a_cited_source_resolves_to_the_event_built_on_it(db, feed):
    event(db, title="Something else entirely", date="2010-01-01", sources=[{"collection": "fda_records", "record_key": "K1"}])
    note(db, date="2024-03-01", sources=[{"collection": "fda_records", "record_key": "K1"}])
    run(db, feed)
    assert stored(db)["resolved_event"] == "ev1"


def test_a_record_only_match_creates_an_event_with_record_keys_then_resolves(db, feed):
    db.trial_records.insert_one({"assets": [ASSET], "record_key": "NCT01", "title": "Phase 3 topline results announced",
                                 "start_date": "2024-02-10"})
    note(db, title="Phase 3 topline results")
    assert run(db, feed) == {"feedback_checked": 1, "feedback_resolved": 1, "feedback_events_created": 1}
    created = db.journey_events.find_one({"_id": "feedback:treprostinil:n1"})
    assert created["origin"] == "feedback" and created["via"] == "finalize" and created["date"] == "2024-02-10"
    assert created["category"] == "clinical"
    assert created["sources"] == [{"collection": "trial_records", "record_key": "NCT01"}]
    assert stored(db)["status"] == "resolved" and stored(db)["resolved_event"] == "feedback:treprostinil:n1"
    assert ("event", "Phase 3 topline results", {"event_id": "feedback:treprostinil:n1"}) in feed


def user_note(db, note_id="n1", **fields):
    db.journey_notes.insert_one({"_id": note_id, "asset": ASSET, "title": "Phase 3 topline results", **fields})


def test_a_created_event_uses_the_notes_significance_else_medium_and_links_the_note(db, feed):
    db.trial_records.insert_one({"assets": [ASSET], "record_key": "NCT01", "title": "Phase 3 topline results announced",
                                 "start_date": "2024-02-10"})
    user_note(db, "n1", significance="Low")
    user_note(db, "n2")
    note(db, "n1")
    note(db, "n2")
    run(db, feed)
    assert db.journey_events.find_one({"_id": "feedback:treprostinil:n1"})["significance"] == "Low"
    assert db.journey_events.find_one({"_id": "feedback:treprostinil:n2"})["significance"] == "Medium"
    assert db.journey_notes.find_one({"_id": "n1"})["resolved_event"] == "feedback:treprostinil:n1"
    assert db.journey_notes.find_one({"_id": "n2"})["resolved_event"] == "feedback:treprostinil:n2"


def test_a_matched_event_is_linked_on_the_note_and_an_open_note_is_not(db, feed):
    event(db)
    user_note(db, "n1")
    user_note(db, "n2", title="Unrelated gibberish zzz")
    note(db, "n1")
    note(db, "n2", title="Unrelated gibberish zzz")
    run(db, feed)
    assert db.journey_notes.find_one({"_id": "n1"})["resolved_event"] == "ev1"
    assert "resolved_event" not in db.journey_notes.find_one({"_id": "n2"})


def test_no_match_keeps_the_note_open_and_stamps_last_checked_at(db, feed):
    event(db, title="Patent expiry")
    note(db)
    assert run(db, feed) == {"feedback_checked": 1, "feedback_resolved": 0, "feedback_events_created": 0}
    assert stored(db)["status"] == "open" and stored(db)["last_checked_at"]
    assert not db.journey_events.find_one({"origin": "feedback"})


def test_an_undated_note_and_undated_records_stay_open(db, feed):
    db.trial_records.insert_one({"assets": [ASSET], "record_key": "NCT01", "title": "Phase 3 topline results announced"})
    note(db, title="Phase 3 topline results")
    run(db, feed)
    assert stored(db)["status"] == "open"
    assert not db.journey_events.find_one({"origin": "feedback"})


def test_feed_wording_is_singular_for_one_note_and_plural_for_many(db, feed):
    note(db, title="Zzz qqq")
    run(db, feed)
    assert feed[-1][1] == "Re-checked 1 note marked ‘Missed by AI’ · none on the journey yet"
    event(db)
    note(db, "n2", title="Phase 3 topline results")
    feed.clear()
    run(db, feed)
    assert feed[-1][1] == "Re-checked 2 notes marked ‘Missed by AI’ · 1 now on the journey"


def test_nothing_open_logs_nothing(db, feed):
    assert run(db, feed) == {} and feed == []


def test_a_second_run_changes_nothing(db, feed):
    db.trial_records.insert_one({"assets": [ASSET], "record_key": "NCT01", "title": "Phase 3 topline results announced",
                                 "start_date": "2024-02-10"})
    note(db, title="Phase 3 topline results")
    run(db, feed)
    events_before = [dict(e) for e in db.journey_events.docs]
    assert run(db, feed) == {} and [dict(e) for e in db.journey_events.docs] == events_before
    assert len(db.journey_events.docs) == 1 and stored(db)["status"] == "resolved"
