"""Resource budgets for the presentation subsystem (env prefix PRESENTATION_, plus OPENAI_* for vision).

Conservative defaults: one document at a time, one vision call at a time, page-at-a-time processing."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class PresentationSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PRESENTATION_", extra="ignore")

    # scheduling / backpressure
    max_concurrent: int = Field(1, ge=1, le=4)  # documents processed at once (= worker processes)
    max_queue_size: int = Field(10, ge=1, le=100)  # API jobs waiting; beyond this -> 429
    latest_n: int = Field(6, ge=1, le=20)  # presentations per company

    # untrusted-input limits (all enforced)
    max_pdf_mb: int = Field(60, ge=1, le=500)
    max_pages: int = Field(200, ge=1, le=2000)
    max_page_pixels: int = Field(16_000_000, ge=500_000, le=100_000_000)
    render_dpi: int = Field(110, ge=36, le=300)
    max_images_per_page: int = Field(20, ge=0, le=200)
    memory_limit_mb: int = Field(1024, ge=128, le=16384)  # worker process tree RSS; exceeded -> killed
    job_timeout_s: int = Field(1800, ge=30, le=86400)
    page_timeout_s: int = Field(60, ge=5, le=3600)
    data_dir: Path = Path("Patents_Data/presentations")

    # vision (OpenAI). Disabled unless OPENAI_API_KEY is set: page images then leave the machine.
    openai_api_key: SecretStr | None = Field(None, validation_alias=AliasChoices("OPENAI_API_KEY"))
    # gpt-6-luna: benchmark 2026-10-10 on 20 UTHR slides vs gpt-5.6-luna: +34% facts, -23% cost, identical values on
    # every fact both read (25/25), 0 errors. Re-run `python -m patent_intel.presentations benchmark` before switching.
    vision_model: str = Field("gpt-6-luna", validation_alias=AliasChoices("OPENAI_VISION_MODEL"))
    vision_max_pages: int = Field(40, ge=0, le=500)  # per presentation; the rest -> status "deferred"
    # output budget per slide incl. reasoning tokens; the luna models allow up to 128,000 (OpenAI model pages).
    # Billing is per generated token, so a higher ceiling costs nothing on normal slides.
    vision_max_output_tokens: int = Field(6000, ge=500, le=128_000)
    vision_retry_max_output_tokens: int = Field(12_000, ge=500, le=128_000)  # one retry when an answer was cut off
    vision_concurrency: int = Field(8, ge=1, le=64)  # remote API calls: no local CPU/RAM; bounded by rate limits
    vision_max_attempts: int = Field(5, ge=1, le=10)  # retries with exponential backoff + full jitter
    vision_timeout_s: int = Field(90, ge=10, le=600)
    vision_image_max_side: int = Field(1600, ge=512, le=4096)  # px sent to the model (evidence PNG stays full)

    @field_validator("data_dir")
    @classmethod
    def _absolute(cls, v: Path) -> Path:
        return v.resolve()  # worker processes run in their own cwd: every path that crosses over must be absolute

    @property
    def vision_enabled(self) -> bool:
        return self.openai_api_key is not None and bool(self.openai_api_key.get_secret_value())


@lru_cache
def presentation_settings() -> PresentationSettings:
    return PresentationSettings()
