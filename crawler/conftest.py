"""Shared test fixtures: `db`, an in-memory stand-in for the few pymongo calls the crawl service makes."""

from types import SimpleNamespace

import pytest


def _matches(doc, flt):
    for key, cond in (flt or {}).items():
        value = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and value not in cond["$in"]:
                return False
            if "$nin" in cond and value in cond["$nin"]:
                return False
            if "$gte" in cond and (value is None or value < cond["$gte"]):
                return False
        elif isinstance(value, list):
            if cond not in value:
                return False
        elif value != cond:
            return False
    return True


def _apply(doc, update):
    doc.update(update.get("$set", {}))
    for key, value in update.get("$addToSet", {}).items():
        if value not in doc.setdefault(key, []):
            doc[key].append(value)
    for key, value in update.get("$pull", {}).items():
        doc[key] = [x for x in doc.get(key, []) if x != value]


class FakeCollection:
    def __init__(self):
        self.docs = []

    def find(self, flt=None, projection=None):
        return [d for d in self.docs if _matches(d, flt)]

    def find_one(self, flt=None, projection=None, sort=None):
        found = self.find(flt)
        if sort:
            key, direction = sort[0]
            found.sort(key=lambda d: d.get(key), reverse=direction < 0)
        return found[0] if found else None

    def count_documents(self, flt, limit=None):
        return len(self.find(flt))

    def insert_one(self, doc):
        self.docs.append(dict(doc))

    def update_one(self, flt, update, upsert=False):
        doc = self.find_one(flt)
        upserted = None
        if doc is None:
            if not upsert:
                return SimpleNamespace(upserted_id=None, modified_count=0)
            doc = {k: v for k, v in flt.items() if not isinstance(v, dict)}
            doc.update(update.get("$setOnInsert", {}))
            self.docs.append(doc)
            upserted = doc["_id"]
        _apply(doc, update)
        return SimpleNamespace(upserted_id=upserted, modified_count=0 if upserted else 1)

    def update_many(self, flt, update):
        for doc in self.find(flt):
            _apply(doc, update)

    def create_index(self, *args, **kwargs):
        pass


class FakeDb(dict):
    def __getattr__(self, name):
        return self.setdefault(name, FakeCollection())

    def __getitem__(self, name):
        return self.setdefault(name, FakeCollection())


@pytest.fixture
def db():
    return FakeDb()


@pytest.fixture
def mongo():
    """An in-memory MongoDB database (mongomock) on its own client, for code that reaches other databases
    through `db.client` (the corpora). Skipped when mongomock isn't installed."""
    mongomock = pytest.importorskip("mongomock")
    from mongomock.collection import BulkOperationBuilder

    def ignore_new_options(fn):  # pymongo 4.9+ passes options (sort=...) this mongomock doesn't know
        def wrapper(self, *args, **kwargs):
            for option in ("sort", "hint", "collation", "array_filters"):
                kwargs.pop(option, None)
            return fn(self, *args, **kwargs)
        return wrapper

    for name in ("add_replace", "add_update", "add_delete"):
        if not getattr(getattr(BulkOperationBuilder, name), "patched", False):
            patched = ignore_new_options(getattr(BulkOperationBuilder, name))
            patched.patched = True
            setattr(BulkOperationBuilder, name, patched)
    return mongomock.MongoClient()["asset_journey"]
