"""Selective slide understanding with the OpenAI Responses API (vision), via httpx - no SDK dependency.

Only pages flagged by the worker (charts, tables, scans, clinical terms) are sent, within a per-presentation budget;
the rest are marked "deferred". Page images leave the machine only when OPENAI_API_KEY is configured.
Model output is never trusted blindly: strict JSON schema, nulls for unreadable values, validation afterwards.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import random
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger("patent_intel.presentations")
API = "https://api.openai.com/v1/responses"
PROMPT_VERSION = "slide-v1"
SLIDE_TEXT_CHARS = 6000  # native slide text sent with the image (part of the vision cache key)
PROMPT = (
    "You extract facts from ONE slide of a pharmaceutical company investor presentation. Use only what is visible on "
    "the slide image and the provided slide text. Never infer or invent numbers; if a value is not legible, use null. "
    "Report every quantitative result (efficacy, safety, financial, pipeline timing) as a metric with its unit, arm, "
    "trial, indication and timepoint when shown. For charts, list the plotted data points you can read. Bounding "
    "boxes are [x0, y0, x1, y1] normalised 0..1 from the top-left; use null if unsure. Confidence is 0..1."
)

_num = {"type": ["number", "null"]}
_str = {"type": ["string", "null"]}
_bbox = {"type": ["array", "null"], "items": {"type": "number"}}


def _obj(props: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


SCHEMA = _obj({
    "slide_title": _str,
    "slide_type": {"type": "string", "enum": ["title", "agenda", "clinical_data", "chart", "table", "pipeline",
                                               "financial", "regulatory", "commercial", "disclaimer", "other"]},
    "metrics": {"type": "array", "items": _obj({
        "metric": {"type": "string"}, "value": _num, "value_text": {"type": "string"}, "unit": _str, "arm": _str,
        "trial": _str, "indication": _str, "timepoint": _str, "comparator": _str, "p_value_text": _str,
        "source_element": {"type": "string", "enum": ["chart", "table", "text", "figure"]}, "bbox": _bbox,
        "confidence": {"type": "number"}})},
    "claims": {"type": "array", "items": _obj({
        "statement": {"type": "string"},
        "category": {"type": "string", "enum": ["efficacy", "safety", "regulatory", "commercial", "pipeline", "financial", "other"]},
        "drug": _str, "trial": _str, "confidence": {"type": "number"}})},
    "charts": {"type": "array", "items": _obj({
        "chart_type": {"type": "string"}, "title": _str, "x_axis": _str, "y_axis": _str, "bbox": _bbox,
        "series": {"type": "array", "items": _obj({"name": _str, "points": {"type": "array", "items": _obj({
            "x": {"type": "string"}, "y": _num})}})},
        "confidence": {"type": "number"}})},
    "tables": {"type": "array", "items": _obj({
        "title": _str, "bbox": _bbox, "header": {"type": "array", "items": {"type": "string"}},
        "rows": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}})},
})


class VisionError(Exception):
    pass


class VisionClient:
    RETRYABLE = frozenset({408, 409, 429, 500, 502, 503, 504})
    BACKOFF_CAP_S = 30.0

    def __init__(self, api_key: str, model: str, *, timeout_s: int, max_output_tokens: int, concurrency: int,
                 max_attempts: int = 5, retry_max_output_tokens: int | None = None) -> None:
        self.model, self.max_output_tokens, self.max_attempts = model, max_output_tokens, max_attempts
        self.retry_max_output_tokens = retry_max_output_tokens or max_output_tokens  # == budget -> no budget retry
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10),
                                        limits=httpx.Limits(max_connections=concurrency + 1),
                                        headers={"Authorization": f"Bearer {api_key}"})
        self.sem = asyncio.Semaphore(concurrency)
        self.calls = self.input_tokens = self.output_tokens = self.retries = 0

    async def aclose(self) -> None:
        await self.client.aclose()

    @staticmethod
    def _retry_after(r: httpx.Response) -> float:
        ra = r.headers.get("retry-after", "")
        try:
            return max(float(ra), 0.0)
        except ValueError:
            return 0.0

    async def _post_with_retries(self, body: dict[str, Any]) -> httpx.Response:
        """Retry transient failures (network, timeouts, 408/409/429/5xx) with exponential backoff + full jitter,
        honouring Retry-After. Never retry what cannot succeed: 4xx client errors and 429 insufficient_quota."""
        err = "no attempt"
        for attempt in range(self.max_attempts):
            wait = 0.0
            try:
                r = await self.client.post(API, json=body)
            except httpx.RequestError as e:  # timeouts, transport, decoding, redirects
                err = f"network {type(e).__name__}"
            else:
                if r.status_code == 200:
                    return r
                code = ""
                with contextlib.suppress(ValueError, AttributeError):
                    code = (r.json().get("error") or {}).get("code") or ""
                err = f"HTTP {r.status_code}{' ' + code if code else ''}"
                if r.status_code not in self.RETRYABLE or code == "insufficient_quota":
                    raise VisionError(err)  # retrying cannot help (bad request, auth, no credit)
                wait = self._retry_after(r)
            if attempt == self.max_attempts - 1:
                break
            self.retries += 1
            backoff = random.uniform(0, min(self.BACKOFF_CAP_S, 2.0 ** attempt))  # full jitter: no thundering herd
            await asyncio.sleep(min(max(wait, backoff), self.BACKOFF_CAP_S))
        raise VisionError(f"{err} after {self.max_attempts} attempts")

    async def analyse(self, image: Path, slide_text: str, page: int) -> dict[str, Any]:
        async with self.sem:  # the image is read/encoded only once a request slot is free: queued pages hold no payload
            return await self._analyse(image, slide_text, page)

    async def _analyse(self, image: Path, slide_text: str, page: int) -> dict[str, Any]:
        try:
            b64 = base64.b64encode(await asyncio.to_thread(image.read_bytes)).decode()
        except OSError as e:
            raise VisionError(f"image unreadable: {type(e).__name__}") from e
        body = {
            "model": self.model, "max_output_tokens": self.max_output_tokens,
            "input": [{"role": "user", "content": [
                {"type": "input_text", "text": f"{PROMPT}\n\nSlide text (native PDF text layer, may be empty):\n"
                                               f"{slide_text[:SLIDE_TEXT_CHARS]}"},
                {"type": "input_image", "image_url": f"data:image/png;base64,{b64}", "detail": "high"}]}],
            "text": {"format": {"type": "json_schema", "name": "slide_facts", "schema": SCHEMA, "strict": True}},
        }
        while True:
            r = await self._post_with_retries(body)
            try:
                data = r.json()
            except ValueError as e:  # 200 with a non-JSON body (proxy/HTML error page)
                raise VisionError("invalid response body") from e
            usage = data.get("usage") or {}
            self.calls += 1
            self.input_tokens += usage.get("input_tokens", 0)
            self.output_tokens += usage.get("output_tokens", 0)  # billed, includes reasoning tokens
            if data.get("status") == "completed":
                break
            reason = (data.get("incomplete_details") or {}).get("reason", data.get("status"))
            if reason == "max_output_tokens" and body["max_output_tokens"] < self.retry_max_output_tokens:
                body["max_output_tokens"] = self.retry_max_output_tokens  # very dense slide: one retry, larger budget
                continue
            raise VisionError(f"incomplete: {reason}")  # partial JSON is never parsed
        text = "".join(c.get("text", "") for o in data.get("output", []) for c in o.get("content", []) or []
                       if c.get("type") == "output_text")
        log.info("vision page=%d model=%s in_tokens=%s out_tokens=%s", page, self.model,
                 usage.get("input_tokens"), usage.get("output_tokens"))  # never the content
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise VisionError("invalid JSON from model") from e
