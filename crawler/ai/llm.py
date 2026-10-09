"""
OpenAI access for ingestion: structured (JSON-schema) calls with a Mongo cache
keyed by content hash, so a refresh never pays twice for the same decision.

Config (crawler/.env): OPENAI_API_KEY (or OPEN_AI_API_KEY), LLM_TRIAGE_MODEL,
LLM_REASONING_MODEL, LLM_EMBEDDING_MODEL.
"""

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from openai import OpenAI

from storage.mongo_storage import get_db

TRIAGE_MODEL = os.getenv("LLM_TRIAGE_MODEL", "gpt-4.1-mini")
REASONING_MODEL = os.getenv("LLM_REASONING_MODEL", "gpt-5-mini")
EMBEDDING_MODEL = os.getenv("LLM_EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIMENSIONS = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))

_client = None
_usage_lock = threading.Lock()
usage = {"prompt_tokens": 0, "completion_tokens": 0, "calls": 0, "cache_hits": 0}


def client() -> OpenAI:
    global _client
    if _client is None:
        key = os.getenv("OPENAI_API_KEY") or os.getenv("OPEN_AI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is not set in crawler/.env")
        _client = OpenAI(api_key=key, max_retries=4, timeout=120)
    return _client


def _record_usage(resp=None, cache_hit=False) -> None:
    with _usage_lock:
        if cache_hit:
            usage["cache_hits"] += 1
            return
        usage["calls"] += 1
        if resp is not None and resp.usage:
            usage["prompt_tokens"] += resp.usage.prompt_tokens
            # Embedding responses report prompt/total tokens only.
            usage["completion_tokens"] += getattr(resp.usage, "completion_tokens", 0) or 0


def usage_snapshot() -> Dict[str, int]:
    with _usage_lock:
        return dict(usage)


def structured(model: str, system: str, user: str, schema_name: str, schema: Dict[str, Any],
               reasoning_effort: Optional[str] = None) -> Dict[str, Any]:
    """One JSON-schema-constrained completion, cached on (model, prompt, schema). reasoning_effort ("low", ...)
    trades depth for latency on reasoning models, e.g. for the interactive resolve."""
    parts = [model, system, user, schema] + ([reasoning_effort] if reasoning_effort else [])
    key = hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()
    cache = get_db().llm_cache
    hit = cache.find_one({"_id": key}, {"result": 1})
    if hit:
        _record_usage(cache_hit=True)
        return hit["result"]
    resp = client().chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format={"type": "json_schema", "json_schema": {"name": schema_name, "strict": True, "schema": schema}},
        **({"reasoning_effort": reasoning_effort} if reasoning_effort else {}),
    )
    _record_usage(resp)
    result = json.loads(resp.choices[0].message.content)
    cache.update_one({"_id": key}, {"$set": {"result": result, "model": model,
                                              "created_at": datetime.now(timezone.utc)}}, upsert=True)
    return result


def embed(texts: List[str]) -> List[List[float]]:
    out: List[List[float]] = []
    for i in range(0, len(texts), 96):
        resp = client().embeddings.create(model=EMBEDDING_MODEL, input=texts[i:i + 96], dimensions=EMBEDDING_DIMENSIONS)
        _record_usage(resp)
        out.extend(d.embedding for d in resp.data)
    return out
