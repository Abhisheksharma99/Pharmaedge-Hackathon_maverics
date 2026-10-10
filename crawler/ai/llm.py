"""
OpenAI access for ingestion: structured (JSON-schema) calls with a Mongo cache
keyed by content hash, so a refresh never pays twice for the same decision.

Models (OpenAI pricing page, 2026-10-10; USD per 1M tokens input / cached input / output):
  gpt-6-luna   0.10 / 0.01 / 0.50  - default for every task: newest, cheapest recommended model, strict
                                     structured outputs on Chat Completions, adjustable reasoning effort
  gpt-5-mini   0.25 / 0.025 / 2.00 - previous reasoning default
  gpt-4.1-mini 0.40 / 0.10 / 1.60  - previous triage default (no reasoning effort: set its effort to "")
Reasoning effort is set per task (none|low|medium|high|xhigh|max on gpt-6-luna; the API default is medium):
triage and duplicate grouping are classification ("low"); event extraction does date arithmetic and has
rules to apply ("medium"). Raise or lower it per task with the LLM_*_EFFORT variables below.

Config (crawler/.env): OPENAI_API_KEY (or OPEN_AI_API_KEY), LLM_TRIAGE_MODEL, LLM_REASONING_MODEL,
LLM_TRIAGE_EFFORT, LLM_EXTRACT_EFFORT, LLM_SERVICE_TIER, LLM_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS.
LLM_SERVICE_TIER=flex halves the price of every call (slower; for background refreshes). When flex has no
capacity (429, not billed) the call is repeated once on the standard tier, so a run never fails for it.
"""

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI, RateLimitError

from storage.mongo_storage import get_db

TRIAGE_MODEL = os.getenv("LLM_TRIAGE_MODEL", "gpt-6-luna")
REASONING_MODEL = os.getenv("LLM_REASONING_MODEL", "gpt-6-luna")
TRIAGE_EFFORT = os.getenv("LLM_TRIAGE_EFFORT", "low")
EXTRACT_EFFORT = os.getenv("LLM_EXTRACT_EFFORT", "medium")
SERVICE_TIER = os.getenv("LLM_SERVICE_TIER", "")  # "" = the project's default tier; "flex" = half price, slower
EMBEDDING_MODEL = os.getenv("LLM_EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIMENSIONS = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))
# A ceiling, not a target: billing is per generated token. Stops a runaway reasoning chain from costing more
# than the answer is worth; a cut-off answer raises (the record is retried next run), it is never parsed.
MAX_OUTPUT_TOKENS = int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "16000"))

# USD per 1M tokens: (input, cached input, output). Flex = half. Unknown models are counted as 0 (tokens still are).
PRICES = {"gpt-6-luna": (0.10, 0.01, 0.50), "gpt-5.6-luna": (0.20, 0.02, 1.20), "gpt-5.4-nano": (0.20, 0.02, 1.25),
          "gpt-5.4-mini": (0.75, 0.075, 4.50), "gpt-5-mini": (0.25, 0.025, 2.00), "gpt-5-nano": (0.05, 0.005, 0.40),
          "gpt-4.1-mini": (0.40, 0.10, 1.60), "gpt-4.1-nano": (0.10, 0.025, 0.40),
          "text-embedding-3-small": (0.02, 0.02, 0.0), "text-embedding-3-large": (0.13, 0.13, 0.0)}

_client = None
_usage_lock = threading.Lock()
usage = {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "reasoning_tokens": 0, "calls": 0,
         "cache_hits": 0, "flex_fallbacks": 0, "cost_usd": 0.0}


def client() -> OpenAI:
    global _client
    if _client is None:
        key = os.getenv("OPENAI_API_KEY") or os.getenv("OPEN_AI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is not set in crawler/.env")
        _client = OpenAI(api_key=key, max_retries=4, timeout=120)
    return _client


def cost_usd(model: str, prompt: int, cached: int, completion: int, flex: bool = False) -> float:
    p_in, p_cached, p_out = PRICES.get(model, (0.0, 0.0, 0.0))
    return ((prompt - cached) * p_in + cached * p_cached + completion * p_out) / 1e6 * (0.5 if flex else 1.0)


def _record_usage(resp=None, cache_hit=False, model: str = "", flex: bool = False) -> None:
    with _usage_lock:
        if cache_hit:
            usage["cache_hits"] += 1
            return
        usage["calls"] += 1
        u = getattr(resp, "usage", None) if resp is not None else None
        if not u:
            return
        prompt = u.prompt_tokens or 0
        # Embedding responses report prompt/total tokens only.
        completion = getattr(u, "completion_tokens", 0) or 0
        cached = getattr(getattr(u, "prompt_tokens_details", None), "cached_tokens", 0) or 0
        reasoning = getattr(getattr(u, "completion_tokens_details", None), "reasoning_tokens", 0) or 0
        usage["prompt_tokens"] += prompt
        usage["completion_tokens"] += completion
        usage["cached_tokens"] += cached
        usage["reasoning_tokens"] += reasoning
        usage["cost_usd"] += cost_usd(model, prompt, cached, completion, flex)


def usage_snapshot() -> Dict[str, Any]:
    with _usage_lock:
        return dict(usage)


def usage_delta(before: Dict[str, Any]) -> Dict[str, Any]:
    """What happened since `before` (a usage_snapshot()), for a job step's counts."""
    after = usage_snapshot()
    return {"llm_calls": after["calls"] - before["calls"], "cache_hits": after["cache_hits"] - before["cache_hits"],
            "tokens": (after["prompt_tokens"] + after["completion_tokens"])
            - (before["prompt_tokens"] + before["completion_tokens"]),
            "cached_tokens": after["cached_tokens"] - before["cached_tokens"],
            "reasoning_tokens": after["reasoning_tokens"] - before["reasoning_tokens"],
            "cost_usd": round(after["cost_usd"] - before["cost_usd"], 4)}


def _is_flex_capacity_error(e: RateLimitError) -> bool:
    body = getattr(e, "body", None) or {}
    err = body.get("error", body) if isinstance(body, dict) else {}
    text = f"{err.get('code', '')} {err.get('type', '')} {err.get('message', '')} {e}".lower()
    return "resource_unavailable" in text or "resource unavailable" in text


def _create(**kwargs) -> Tuple[Any, bool]:
    """(response, billed as flex): chat.completions.create on the configured tier; flex without capacity falls
    back to the standard tier."""
    if SERVICE_TIER != "flex":
        return client().chat.completions.create(**kwargs), False
    try:
        # Flex queues longer; its "no capacity" 429 is not billed, so retry it once on standard, not 4x on flex.
        return client().with_options(timeout=900, max_retries=1).chat.completions.create(
            service_tier="flex", **kwargs), True
    except RateLimitError as e:
        if not _is_flex_capacity_error(e):
            raise
        with _usage_lock:
            usage["flex_fallbacks"] += 1
        return client().chat.completions.create(**kwargs), False


def structured(model: str, system: str, user: str, schema_name: str, schema: Dict[str, Any],
               reasoning_effort: Optional[str] = None) -> Dict[str, Any]:
    """One JSON-schema-constrained completion, cached on (model, prompt, schema, effort). reasoning_effort
    ("low", ...) trades depth for latency and cost on reasoning models; None/"" sends none (the model's default,
    and the only option for non-reasoning models such as gpt-4.1-mini)."""
    if model.startswith("gpt-4"):
        reasoning_effort = None  # non-reasoning models reject the parameter (e.g. LLM_TRIAGE_MODEL=gpt-4.1-mini)
    parts = [model, system, user, schema] + ([reasoning_effort] if reasoning_effort else [])
    key = hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()
    cache = get_db().llm_cache
    hit = cache.find_one({"_id": key}, {"result": 1})
    if hit:
        _record_usage(cache_hit=True)
        return hit["result"]
    resp, flex = _create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format={"type": "json_schema", "json_schema": {"name": schema_name, "strict": True, "schema": schema}},
        max_completion_tokens=MAX_OUTPUT_TOKENS,
        **({"reasoning_effort": reasoning_effort} if reasoning_effort else {}),
    )
    _record_usage(resp, model=model, flex=flex)
    choice = resp.choices[0]
    if choice.finish_reason == "length":  # cut off: partial JSON is never parsed or cached
        raise RuntimeError(f"{model} answer cut off at {MAX_OUTPUT_TOKENS} output tokens ({schema_name})")
    if getattr(choice.message, "refusal", None):
        raise RuntimeError(f"{model} refused ({schema_name}): {choice.message.refusal[:200]}")
    result = json.loads(choice.message.content)
    cache.update_one({"_id": key}, {"$set": {"result": result, "model": model,
                                              "created_at": datetime.now(timezone.utc)}}, upsert=True)
    return result


EMBED_BATCH = 96  # inputs per embeddings request


def embed(texts: List[str]) -> List[List[float]]:
    out: List[List[float]] = []
    for i in range(0, len(texts), EMBED_BATCH):
        resp = client().embeddings.create(model=EMBEDDING_MODEL, input=texts[i:i + EMBED_BATCH],
                                          dimensions=EMBEDDING_DIMENSIONS)
        _record_usage(resp, model=EMBEDDING_MODEL)
        out.extend(d.embedding for d in resp.data)
    return out
