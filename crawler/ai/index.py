"""
Selective vector index for Asset AI (spec §5.3, step "index").

What is embedded, into `record_chunks` (one Atlas Vector Search index):
  - triage-ingested records (articles, press releases, publications, conference abstracts, CHMP highlights);
  - the company's prescribing information, annual reports and investor-presentation slides (with their claims and
    metrics; integrations/presentations.py);
  - structured records with text worth retrieving, which are about the asset by construction (no triage):
    clinical trials (titles, conditions, interventions, brief summary), patents (title, abstract, assignees),
    and FDA calendar / SEC filing evidence (the sentences that state a PDUFA date or a CRL).

Chunks are ~1,500 characters. Each chunk's stored `text` is the raw passage (what Asset AI shows and cites);
the embedded input also carries a one-line header (title | type | date), so a passage deep inside a long
document still matches questions about that document.

Incremental: a record is re-embedded only when its text, the embedding model/dimensions or EMBED_VERSION
change (content hash). A record whose text is unchanged but that is now tagged with another asset only has
that asset added to its chunks' `assets`, which the vector search filters on. Embeddings are requested in
batches across records (up to llm.EMBED_BATCH inputs per call); a failed request leaves its records unhashed,
so they are retried next run.
"""

import hashlib
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

from pymongo import ReplaceOne
from pymongo.operations import SearchIndexModel

from storage.mongo_storage import get_db

from . import llm
from .triage import TRIAGED_SOURCES, ingest_query

INDEX_NAME = "record_chunks_vector"
TEXT_INDEX_NAME = "record_chunks_text"  # lexical ($search): exact identifiers, drug codes, phrases
CHUNK, OVERLAP, MAX_CHUNKS = 1500, 200, 40
DOCUMENT_TYPES = ["prescribing_info", "annual_report", "presentation_slide"]  # company documents: no triage
# Bump when the embedded text (chunking, header, record text) changes: every record re-embeds once.
EMBED_VERSION = "2"
FLUSH_INPUTS = 256  # chunks held before an embeddings round (a few requests of llm.EMBED_BATCH)
FDA_EVIDENCE_TYPES = ["fda_calendar_event", "sec_fda_action"]

Record = Dict[str, Any]


def chunks(text: str) -> List[str]:
    text = " ".join(text.split())
    out, start = [], 0
    while start < len(text) and len(out) < MAX_CHUNKS:
        out.append(text[start:start + CHUNK])
        start += CHUNK - OVERLAP
    return out


def ensure_vector_index(db) -> None:
    """The vector index and the lexical index Asset AI fuses with it (both on mongot; verified on MongoDB 9.0.2 +
    mongot 1.70.5, including $rankFusion over the two). Created once; existing definitions are left alone."""
    coll = db.record_chunks
    existing = {i.get("name") for i in coll.list_search_indexes()}
    if INDEX_NAME not in existing:
        coll.create_search_index(SearchIndexModel(name=INDEX_NAME, type="vectorSearch", definition={"fields": [
            {"type": "vector", "path": "embedding", "numDimensions": llm.EMBEDDING_DIMENSIONS, "similarity": "cosine"},
            {"type": "filter", "path": "assets"}, {"type": "filter", "path": "collection"},
            {"type": "filter", "path": "record_type"}, {"type": "filter", "path": "date"},
        ]}))
    if TEXT_INDEX_NAME not in existing:
        # Filter fields are tokens (exact values); dates are ISO strings, so token ranges compare correctly.
        coll.create_search_index(SearchIndexModel(name=TEXT_INDEX_NAME, type="search", definition={"mappings": {
            "dynamic": False, "fields": {
                "text": {"type": "string", "analyzer": "lucene.english"},
                "title": {"type": "string", "analyzer": "lucene.english"},
                "assets": {"type": "token"}, "collection": {"type": "token"}, "record_type": {"type": "token"},
                "date": {"type": "token"}}}}))


def _lines(*pairs: Tuple[str, Any]) -> str:
    out = []
    for label, value in pairs:
        if isinstance(value, list):
            value = ", ".join(str(v) for v in value if v)
        if value:
            out.append(f"{label}: {value}" if label else str(value))
    return "\n".join(out)


def trial_text(r: Record) -> str:
    summary = ((((r.get("study") or {}).get("protocolSection") or {}).get("descriptionModule") or {})
               .get("briefSummary"))
    # Identifiers in the text: questions name trials by NCT id or acronym, and only text is searchable.
    return _lines(("Trial", " / ".join(v for v in (r.get("nct_id"), r.get("acronym")) if v)),
                  ("", r.get("official_title")), ("Conditions", r.get("conditions")),
                  ("Interventions", r.get("interventions")), ("Phase", r.get("phases")),
                  ("Status", r.get("overall_status")), ("Why stopped", r.get("why_stopped")),
                  ("Sponsor", r.get("lead_sponsor")), ("Primary completion", r.get("primary_completion_date")),
                  ("Summary", summary))


def patent_text(r: Record) -> str:
    return _lines(("Patent", r.get("publication_number")), ("Family", r.get("family_id")),
                  ("Assignees", r.get("assignees")), ("Abstract", r.get("abstract")),
                  ("Expiry", r.get("expiry_date")), ("Legal status", r.get("legal_status")))


def fda_evidence_text(r: Record) -> str:
    sentences = [e.get("sentence") or e.get("text") for e in r.get("evidence") or []]
    return _lines(("", r.get("description")), ("Evidence", [s for s in sentences if s][:10]))


def field_text(field: str) -> Callable[[Record], str]:
    return lambda r: r.get(field) or ""


class Source:
    """One collection slice to index: which records, which fields to read, how to turn a record into text."""

    def __init__(self, coll: str, key_field: str, query: Dict[str, Any], fields: List[str],
                 text: Callable[[Record], str]):
        self.coll, self.key_field, self.query, self.text = coll, key_field, query, text
        self.projection = {f: 1 for f in [key_field, "title", "date", "record_type", "assets", "url",
                                          "indexed_hash", *fields]}


def _sources(asset_id: str) -> Iterator[Source]:
    for coll, (key_field, extra, text_field) in TRIAGED_SOURCES.items():
        yield Source(coll, key_field, {**ingest_query(asset_id), **extra}, [text_field], field_text(text_field))
    yield Source("company_records", "record_key", {"assets": asset_id, "record_type": {"$in": DOCUMENT_TYPES}},
                 ["content"], field_text("content"))
    yield Source("trial_records", "record_key", {"assets": asset_id},
                 ["nct_id", "acronym", "official_title", "conditions", "interventions", "phases", "overall_status", "why_stopped",
                  "lead_sponsor", "primary_completion_date", "study.protocolSection.descriptionModule.briefSummary"],
                 trial_text)
    yield Source("patent_records", "record_key", {"assets": asset_id},
                 ["publication_number", "family_id", "assignees", "abstract", "expiry_date", "legal_status"], patent_text)
    yield Source("fda_records", "record_key", {"assets": asset_id, "record_type": {"$in": FDA_EVIDENCE_TYPES}},
                 ["description", "evidence"], fda_evidence_text)


def _digest(text: str) -> str:
    """Content hash of what is embedded, including how: a model or format change re-embeds."""
    how = f"{llm.EMBEDDING_MODEL}|{llm.EMBEDDING_DIMENSIONS}|{EMBED_VERSION}"
    return hashlib.sha1(f"{how}\n{text}".encode()).hexdigest()


def _header(r: Record, coll: str) -> str:
    return " | ".join(str(v) for v in (r.get("title"), r.get("record_type") or coll, r.get("date")) if v)


class _Pending:
    """Records waiting for their embeddings, flushed in batches across records."""

    def __init__(self, db, counts: Dict[str, int]):
        self.db, self.counts = db, counts
        self.items: List[Tuple[Source, Record, str, List[str]]] = []
        self.inputs = 0
        self.error: Optional[Exception] = None

    def add(self, src: Source, r: Record, digest: str, parts: List[str]) -> None:
        self.items.append((src, r, digest, parts))
        self.inputs += len(parts)
        if self.inputs >= FLUSH_INPUTS:
            self.flush()

    def flush(self) -> None:
        if not self.items:
            return
        items, self.items, self.inputs = self.items, [], 0
        texts = [f"{_header(r, src.coll)}\n{part}" for src, r, _, parts in items for part in parts]
        try:
            vectors = llm.embed(texts)
        except Exception as e:  # noqa: BLE001 - no indexed_hash is saved, so these records are retried next run
            self.counts["failed"] += len(items)
            self.error = e
            return
        now, at = datetime.now(timezone.utc), 0
        for src, r, digest, parts in items:
            key, mine = r[src.key_field], vectors[at:at + len(parts)]
            at += len(parts)
            self.db.record_chunks.delete_many({"collection": src.coll, "record_key": key})
            self.db.record_chunks.bulk_write([ReplaceOne({"_id": f"{src.coll}|{key}|{i}"}, {
                "collection": src.coll, "record_key": key, "chunk": i, "text": part, "embedding": vec,
                "assets": r.get("assets", []), "title": r.get("title"), "date": r.get("date"),
                "record_type": r.get("record_type") or src.coll, "url": r.get("url"), "indexed_at": now,
                "embedding_model": llm.EMBEDDING_MODEL, "embedding_version": EMBED_VERSION,
            }, upsert=True) for i, (part, vec) in enumerate(zip(parts, mine, strict=True))], ordered=False)
            self.db[src.coll].update_one({src.key_field: key}, {"$set": {"indexed_hash": digest}})
            self.counts["records"] += 1
            self.counts["chunks"] += len(parts)


def index_asset(asset_id: str) -> Dict[str, int]:
    db = get_db()
    db.record_chunks.create_index("record_key")
    counts = {"records": 0, "chunks": 0, "failed": 0, "tagged": 0}
    pending = _Pending(db, counts)
    for src in _sources(asset_id):
        unchanged: List[str] = []
        for r in db[src.coll].find(src.query, src.projection):
            text = f"{r.get('title') or ''}\n{src.text(r)}".strip()
            if not text:
                continue
            digest = _digest(text)
            if r.get("indexed_hash") == digest:
                unchanged.append(r[src.key_field])
                continue
            pending.add(src, r, digest, chunks(text))
        if unchanged:
            # Text unchanged, but the record may have been tagged with this asset since it was embedded.
            res = db.record_chunks.update_many(
                {"collection": src.coll, "record_key": {"$in": unchanged}, "assets": {"$ne": asset_id}},
                {"$addToSet": {"assets": asset_id}})
            counts["tagged"] += getattr(res, "modified_count", 0) or 0
    pending.flush()
    if pending.error and not counts["records"]:
        raise pending.error
    ensure_vector_index(db)
    return counts


def wait_until_queryable(timeout: int = 180) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = next(iter(get_db().record_chunks.list_search_indexes(INDEX_NAME)), {})
        if status.get("queryable"):
            return True
        time.sleep(3)
    return False
