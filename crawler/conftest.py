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
            if "$ne" in cond and value == cond["$ne"]:
                return False
            if "$exists" in cond and (key in doc) != cond["$exists"]:
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
    for key in update.get("$unset", {}):
        doc.pop(key, None)
    for key, value in update.get("$inc", {}).items():
        doc[key] = doc.get(key, 0) + value
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

    def find_one_and_update(self, flt, update, projection=None, return_document=None, upsert=False):
        doc = self.find_one(flt)
        if doc is None:
            return None
        _apply(doc, update)
        return dict(doc)

    def insert_many(self, docs):
        self.docs.extend(dict(d) for d in docs)

    def delete_many(self, flt):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not _matches(d, flt)]
        return SimpleNamespace(deleted_count=before - len(self.docs))

    def bulk_write(self, ops, ordered=True):
        for op in ops:  # pymongo UpdateOne
            self.update_one(op._filter, op._doc, upsert=op._upsert)
        return SimpleNamespace(upserted_count=0, modified_count=len(ops))

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
