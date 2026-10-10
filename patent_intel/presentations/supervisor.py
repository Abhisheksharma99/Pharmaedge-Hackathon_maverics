"""Supervised worker process: the only place presentation CPU/RAM work happens.

One fresh interpreter per document (spawn cost ~0.1 s), own process group, killed as a group on: page timeout
(no progress), job timeout, RSS limit (whole process tree, psutil every 200 ms) or cancellation. Every exit path
kills and *awaits* the process, so no zombies and no orphaned grandchildren. The asyncio loop only reads pipes.
ProcessPoolExecutor was rejected: a hung task cannot be killed and a killed worker breaks the whole pool.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
import sys
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import psutil

log = logging.getLogger("patent_intel.presentations")
PROJECT_ROOT = str(Path(__file__).resolve().parents[2])
# Parent-side memory bounds (the RSS limit only protects the worker). Real decks: ~6 KB of JSON per page, so a heavy
# 200-page deck is ~1-10 MB; latest_n (default 6) decks in flight -> worst case ~100 MB for hostile input.
LINE_LIMIT = 2 * 1024 * 1024  # one page message
MAX_OUTPUT_BYTES = 16 * 1024 * 1024  # one document


class WorkerFailed(Exception):
    """code: page_timeout | job_timeout | rss_limit | crashed | protocol | output_too_large"""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def _tree_rss(pid: int) -> int:
    try:
        p = psutil.Process(pid)
        return sum(x.memory_info().rss for x in [p, *p.children(recursive=True)])
    except psutil.Error:
        return 0


def _kill_group(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is None:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(proc.pid, signal.SIGKILL)  # own session -> kills grandchildren too


async def run_worker(job: dict[str, Any], *, page_timeout: float, job_timeout: float, memory_limit_mb: int,
                     telemetry: dict[str, Any], argv: list[str] | None = None,
                     max_output_bytes: int = MAX_OUTPUT_BYTES) -> AsyncIterator[dict[str, Any]]:
    """Yield worker messages; raise WorkerFailed on timeout/RSS/crash/oversized output. telemetry gets pid, peak_rss_mb,
    output_bytes, duration_s.
    `argv` replaces the worker command (tests use it to run deliberately hanging/leaking/crashing workers)."""
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PYTHONPATH": PROJECT_ROOT, "PYTHONHASHSEED": "0",
           "HOME": job["out_dir"], "TMPDIR": job["out_dir"]}  # minimal environment: no secrets inherited
    started = time.monotonic()
    deadline = started + job_timeout
    err_path = Path(job["out_dir"]) / "worker.stderr"  # a file, not a pipe: a chatty library can never block the worker
    with err_path.open("wb") as err:
        proc = await asyncio.create_subprocess_exec(
            *(argv or [sys.executable, "-m", "patent_intel.presentations.worker"]),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=err,
            cwd=job["out_dir"], env=env, start_new_session=True, limit=LINE_LIMIT)
    telemetry.update(pid=proc.pid, peak_rss_mb=0.0)
    over_limit = asyncio.Event()

    async def watch_rss() -> None:
        while proc.returncode is None:
            rss = await asyncio.to_thread(_tree_rss, proc.pid) / 2**20  # psutil walks the process table: off the loop
            telemetry["peak_rss_mb"] = round(max(telemetry["peak_rss_mb"], rss), 1)
            if rss > memory_limit_mb:
                over_limit.set()
                _kill_group(proc)
                return
            await asyncio.sleep(0.2)

    watcher = asyncio.create_task(watch_rss())
    out_bytes = 0
    try:
        assert proc.stdin and proc.stdout
        proc.stdin.write((json.dumps(job) + "\n").encode())
        await proc.stdin.drain()
        proc.stdin.close()
        while True:
            # Deadlines are checked per read, never as a cancel scope around `yield`: the consumer's own awaits between
            # messages must not receive a cancellation meant for the worker (it would surface as a task cancellation).
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise WorkerFailed("job_timeout", f"> {job_timeout}s")
            try:
                line = await asyncio.wait_for(proc.stdout.readline(), min(page_timeout, remaining))
            except TimeoutError:
                if time.monotonic() >= deadline:
                    raise WorkerFailed("job_timeout", f"> {job_timeout}s") from None
                raise WorkerFailed("page_timeout", f"no progress for {page_timeout}s") from None
            except ValueError as e:  # one line over LINE_LIMIT
                raise WorkerFailed("output_too_large", "page message over limit") from e
            if not line:
                if over_limit.is_set():
                    raise WorkerFailed("rss_limit", f"> {memory_limit_mb} MB")
                raise WorkerFailed("crashed", f"exit {await proc.wait()}")
            out_bytes += len(line)
            if out_bytes > max_output_bytes:  # the parent keeps every page: bound it per document
                raise WorkerFailed("output_too_large", f"> {max_output_bytes} bytes")
            try:
                msg = json.loads(line)
            except json.JSONDecodeError as e:
                raise WorkerFailed("protocol", "invalid JSON line") from e
            if msg.get("type") == "done":
                return
            yield msg
    except WorkerFailed as e:
        log.warning("worker failed code=%s stderr_tail=%r", e.code, _tail(err_path))
        raise
    finally:
        _kill_group(proc)  # no-op if it already exited
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watcher
        with contextlib.suppress(ProcessLookupError):
            await proc.wait()  # reap: never leave a zombie, also on cancellation
        telemetry["output_bytes"] = out_bytes
        telemetry["duration_s"] = round(time.monotonic() - started, 3)


def _tail(path: Path, n: int = 500) -> str:
    """Last bytes of the worker's stderr (library warnings, tracebacks) for the failure log; never the document."""
    try:
        with path.open("rb") as f:
            f.seek(max(path.stat().st_size - n, 0))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""
