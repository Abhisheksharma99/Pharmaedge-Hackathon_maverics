"""Live-build progress counters (offline)."""

from service.progress import measure


class StubColl:
    def __init__(self, rows=(), count=0):
        self.rows, self.count = list(rows), count

    def aggregate(self, pipeline):
        return iter(self.rows)

    def count_documents(self, flt):
        return self.count


class StubDb(dict):
    def __getitem__(self, name):
        return self.setdefault(name, StubColl())

    def __getattr__(self, name):
        return self[name]


def test_measure_counts_records_per_collection_and_year():
    db = StubDb()
    db["fda_records"] = StubColl([{"_id": "2021", "n": 3}, {"_id": "2022", "n": 2}, {"_id": "", "n": 4}])
    db["trial_records"] = StubColl([{"_id": "2019", "n": 7}])
    db["journey_events"] = StubColl(count=12)
    out = measure(db, "trep")
    assert out["records_by_coll"]["fda_records"] == 9  # undated records still count
    assert out["records_by_coll"]["articles"] == 0
    assert {"coll": "trial_records", "year": 2019, "n": 7} in out["record_years"]
    assert all(r["year"] for r in out["record_years"])  # undated buckets are not years
    assert out["events"] == 12
