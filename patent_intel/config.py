"""All runtime configuration, from environment variables or `.env` (never hard-coded, never committed)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # storage: MONGO_URI set -> MongoDB, else JSON files in DATA_DIR
    mongo_uri: SecretStr | None = None
    mongo_db: str = Field("patent_intel", pattern=r"^[A-Za-z0-9_-]{1,64}$")
    data_dir: Path = Path("Patents_Data")

    # API
    api_keys: Annotated[list[SecretStr], NoDecode] = Field(default_factory=list)  # API_KEYS=key1,key2
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)  # CORS_ORIGINS=https://app.example.com
    enable_docs: bool = False  # /docs + /openapi.json; keep off in production
    max_concurrent_jobs: int = Field(1, ge=1, le=4)  # crawls are polite (≈1 req/s/host); jobs share that pace
    max_queued_jobs: int = Field(10, ge=1, le=100)
    job_timeout_s: int = Field(7200, ge=60, le=86400)  # hard stop for one crawl job

    # crawl budgets (API requests may lower, never raise them)
    max_pages: int = Field(600, ge=10, le=5000)
    probe_pages: int = Field(150, ge=0, le=2000)

    @field_validator("api_keys", "cors_origins", mode="before")
    @classmethod
    def _csv(cls, v: object) -> object:
        return [s.strip() for s in v.split(",") if s.strip()] if isinstance(v, str) else v

    @field_validator("api_keys")
    @classmethod
    def _strong_keys(cls, v: list[SecretStr]) -> list[SecretStr]:
        if any(len(k.get_secret_value()) < 32 for k in v):
            raise ValueError("each API key must be at least 32 characters (python -c 'import secrets;print(secrets.token_urlsafe(32))')")
        return v

    @field_validator("cors_origins")
    @classmethod
    def _no_wildcard(cls, v: list[str]) -> list[str]:
        if any(o == "*" or not o.startswith(("https://", "http://localhost", "http://127.0.0.1")) for o in v):
            raise ValueError("CORS_ORIGINS must list explicit https:// origins (http only for localhost); '*' is not allowed")
        return v

    def store_spec(self) -> str:
        return self.mongo_uri.get_secret_value() if self.mongo_uri else f"json:{self.data_dir}"


@lru_cache
def settings() -> Settings:
    return Settings()
