"""
Corpus worker: crawls the shared corpora (corpus/) into MongoDB as soon as it starts, then daily.

    cd crawler && ../.venv/bin/arq service.corpus_worker.WorkerSettings

Its own queue, so multi-hour corpus crawls never hold the slots asset jobs need. Each group runs as
`python -m corpus <group>` in a child process: Scrapy and the conference crawlers stay out of the worker, and
stopping the worker stops the crawl after its current unit, with its progress kept.

On startup the groups are queued at once, or, when a source is still marked running (a worker killed mid-crawl),
after STALE_AFTER (+1 min), so that source is resumed rather than skipped. The daily cron queues them again (a
source refreshed in the last 20 h, or running elsewhere, skips itself).
"""

import asyncio
import logging
import os
import sys
from datetime import timedelta
from pathlib import Path

from arq import cron
from arq.worker import func

from corpus import CORPUS_DB, GROUPS, STALE_AFTER
from storage.mongo_storage import get_db

from .api import redis_settings

log = logging.getLogger("corpus.worker")
logging.basicConfig(level=logging.INFO)

QUEUE = "arq:corpus"
CRAWLER_DIR = Path(__file__).resolve().parents[1]
JOB_TIMEOUT = timedelta(hours=int(os.getenv("CORPUS_JOB_TIMEOUT_H", "24")))  # the next daily run continues
STOP_GRACE_S = 120
# CORPUS_GROUPS=ema,company_pr limits the worker to those groups (default: every group).
ENABLED = [g for g in GROUPS if g in os.getenv("CORPUS_GROUPS", "").split(",")] or list(GROUPS)


async def corpus_group(ctx, group: str) -> int:
    proc = await asyncio.create_subprocess_exec(sys.executable, "-m", "corpus", group, cwd=CRAWLER_DIR)
    try:
        return await proc.wait()
    except asyncio.CancelledError:  # worker shutdown or job timeout: let the crawl save its progress
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), STOP_GRACE_S)
        except asyncio.TimeoutError:
            proc.kill()
        raise


async def queue_all(ctx, delay: timedelta = timedelta(0)) -> None:
    for group in ENABLED:
        await ctx["redis"].enqueue_job("corpus_group", group, _queue_name=QUEUE, _defer_by=delay)
    log.info("corpus groups queued%s: %s", f" in {delay}" if delay else "", ", ".join(ENABLED))


def interrupted() -> bool:
    """A source still marked running: its worker may have been killed (or another worker is running it)."""
    return get_db().client[CORPUS_DB]["corpus_sources"].count_documents({"status": "running"}, limit=1) > 0


async def startup(ctx) -> None:
    wait = await asyncio.to_thread(interrupted)
    await queue_all(ctx, STALE_AFTER + timedelta(minutes=1) if wait else timedelta(0))


async def daily(ctx) -> None:
    await queue_all(ctx)


class WorkerSettings:
    queue_name = QUEUE
    functions = [func(corpus_group, timeout=JOB_TIMEOUT, max_tries=1)]
    cron_jobs = [cron(daily, hour={2}, minute={0})]
    on_startup = startup
    redis_settings = redis_settings()
    max_jobs = len(ENABLED)  # one per group: groups crawl different sites
    keep_result = 3600
