"""Artifact store on disk (Tier 2/3): content-addressed binaries + lossless zstd JSON + per-presentation manifest.

    <root>/objects/<sha[:2]>/<sha><ext>          every binary once (PDFs, page PNGs, embedded images)
    <root>/<company_id>/<presentation_id>/        manifest.json, extraction/*.json.zst
    <root>/cache/<key>.json.zst                   stage results keyed by input hash + config/model/prompt version

MongoDB (Tier 1) stores only hashes/paths of these. Nothing here is lossy: PNG for pixels, zstd for JSON.
Every write is temp-file + atomic rename, and the temp file is removed on any failure. `gc()` reclaims space.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import shutil
import tempfile
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import zstandard

ZSTD_LEVEL = 10


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@contextlib.contextmanager
def _atomic(dst: Path) -> Iterator[tuple[int, str]]:
    """(fd, tmp path) next to `dst`; renamed onto `dst` on success, deleted on any failure (incl. cancellation).
    Owns the fd: closes it exactly once - callers must not close it (fdopen with closefd=False)."""
    fd, tmp = tempfile.mkstemp(dir=dst.parent, suffix=".tmp")
    try:
        try:
            yield fd, tmp
        finally:
            os.close(fd)
        os.replace(tmp, dst)  # atomic: concurrent writers of the same content cannot corrupt it
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def stage_key(*parts: object) -> str:
    """Cache key for a stage: hash of its input hash + config + versions (stale results can never be reused)."""
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()


class ArtifactStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        (root / "objects").mkdir(parents=True, exist_ok=True)
        (root / "cache").mkdir(parents=True, exist_ok=True)

    def _object_path(self, sha: str, ext: str) -> Path:
        return self.root / "objects" / sha[:2] / f"{sha}{ext}"

    def put_file(self, src: Path, ext: str, sha: str | None = None, move: bool = False) -> dict[str, Any]:
        """Store a file once by content hash; returns {sha256, path, size, deduplicated}."""
        sha = sha or sha256_file(src)
        dst = self._object_path(sha, ext)
        dedup = dst.exists()
        if not dedup:
            dst.parent.mkdir(parents=True, exist_ok=True)
            with _atomic(dst) as (_, tmp):
                (shutil.move if move else shutil.copyfile)(str(src), tmp)
        else:
            os.utime(dst)  # reused now: fresh mtime keeps gc()'s grace period from collecting it under a running job
            if move:
                src.unlink(missing_ok=True)
        return {"sha256": sha, "path": str(dst), "size": dst.stat().st_size, "deduplicated": dedup}

    def doc_dir(self, company_id: str, presentation_id: str) -> Path:
        d = self.root / company_id / presentation_id
        (d / "extraction").mkdir(parents=True, exist_ok=True)
        return d

    @staticmethod
    def write_json_zst(path: Path, obj: Any) -> dict[str, Any]:
        raw = json.dumps(obj, ensure_ascii=False, sort_keys=True, default=str).encode()
        comp = zstandard.ZstdCompressor(level=ZSTD_LEVEL).compress(raw)
        with _atomic(path) as (fd, _), os.fdopen(fd, "wb", closefd=False) as f:
            f.write(comp)
        return {"path": str(path), "original_size": len(raw), "compressed_size": len(comp), "compression": "zstd",
                "original_sha256": hashlib.sha256(raw).hexdigest(), "compressed_sha256": hashlib.sha256(comp).hexdigest()}

    @staticmethod
    def read_json_zst(path: Path) -> Any:
        return json.loads(zstandard.ZstdDecompressor().decompress(path.read_bytes()))

    def cache_get(self, key: str) -> Any | None:
        p = self.root / "cache" / f"{key}.json.zst"
        return self.read_json_zst(p) if p.exists() else None

    def cache_put(self, key: str, obj: Any) -> None:
        self.write_json_zst(self.root / "cache" / f"{key}.json.zst", obj)

    def write_manifest(self, doc_dir: Path, manifest: dict[str, Any]) -> None:
        manifest = {**manifest, "created_at": datetime.now(UTC).isoformat(timespec="seconds")}
        with _atomic(doc_dir / "manifest.json") as (fd, _), os.fdopen(fd, "w", closefd=False) as f:
            json.dump(manifest, f, indent=1, sort_keys=True)

    def gc(self, *, grace_s: float, cache_max_age_s: float | None = None, delete: bool = False) -> dict[str, Any]:
        """Reclaim disk. Roots = every manifest (all stored presentations, superseded versions too) + every remaining
        cache entry (extraction results point at page objects). Only files older than `grace_s` are touched, so objects
        and temp files of a job still running (no manifest yet) survive; reuse refreshes an object's mtime.
        cache_max_age_s=None keeps the cache (it holds paid vision results). delete=False only reports."""
        old = time.time() - grace_s
        doomed: list[Path] = []
        if cache_max_age_s is not None:
            doomed += [p for p in (self.root / "cache").glob("*.json.zst") if p.stat().st_mtime < time.time() - cache_max_age_s]
        roots: set[str] = set()  # object FILE NAMES (<sha256><ext>): stored paths are absolute and go stale if the data
        for m in self.root.glob("*/*/manifest.json"):  # directory is moved/restored elsewhere; names never do
            roots |= {Path(a["path"]).name for a in json.loads(m.read_text())["artifacts"] if a.get("path")}
        for c in set((self.root / "cache").glob("*.json.zst")) - set(doomed):
            roots |= {Path(x).name for x in _paths(self.read_json_zst(c))}
        doomed += [p for p in (self.root / "objects").glob("*/*") if p.is_file() and p.name not in roots
                   and p.stat().st_mtime < old]  # unreferenced objects and stray *.tmp
        doomed += [p for d in ("tmp", "work") for p in (self.root / d).glob("*") if p.stat().st_mtime < old]
        doomed += [p for p in self.root.glob("*/*/*.tmp") if p.stat().st_mtime < old]
        size = sum(p.stat().st_size if p.is_file() else sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
                   for p in doomed)
        if delete:
            for p in doomed:
                shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
        return {"files": len(doomed), "bytes": size, "deleted": delete}


def _paths(obj: Any) -> set[str]:
    """Every "path" value inside a cached stage result."""
    if isinstance(obj, dict):
        return {v for k, v in obj.items() if k == "path" and isinstance(v, str)} | set().union(*map(_paths, obj.values()))
    if isinstance(obj, list):
        return set().union(*map(_paths, obj))
    return set()
