"""Company x drug portfolio crawl over Google Patents /patent/ pages only (robots-allowed).

Frontier priority:
  0 - expansion: DOCDB family members of included docs; cited/citing docs whose (row) assignee matches the
      company AND are drug-relevant (in the PubChem set or a drug term in the title)
  1 - probes: PubChem-linked documents (relevance known, ownership unknown), WO first, newest first,
      capped by `probe_budget` - they only exist to find seeds
Stops when the frontier is empty or `max_pages` is reached (reported, never silent)."""

from __future__ import annotations

import asyncio
import heapq
import logging
import re
from dataclasses import dataclass, field

from . import google_patents as gp
from .matching import best_match, normalize
from .net import Http, HostDown

log = logging.getLogger("patent_intel")


def term_pattern(terms: list[str]) -> re.Pattern[str]:
    if not (alts := [re.escape(t) for t in terms if t.strip()]):
        raise ValueError("no search terms")
    return re.compile(r"(?<!\w)(?:" + "|".join(alts) + r")(?!\w)", re.I)


def _probe_order(pub: str) -> tuple[int, str]:
    rank = 0 if pub.startswith("WO") else 1 if pub[:2] in {"US", "EP"} else 2  # WO = one per PCT family
    return rank, "".join(reversed(pub))  # cheap deterministic shuffle within rank (avoid one number range)


@dataclass
class Crawl:
    pages: dict[str, dict] = field(default_factory=dict)  # pub -> parsed page
    via: dict[str, str] = field(default_factory=dict)  # pub -> how it entered the frontier
    not_found: list[str] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    unfetched_family: set[str] = field(default_factory=set)
    probes_used: int = 0
    duplicates: int = 0  # requested numbers that resolved to an already-crawled document
    budget_exhausted: bool = False


def _relevant(p: dict, rx: re.Pattern[str], rel: set[str]) -> bool:
    return p["publication_number"] in rel or bool(rx.search(f"{p.get('title') or ''} {p.get('abstract') or ''}"))


def _owners(p: dict) -> list[str]:
    return list(dict.fromkeys(p["assignee_original"] + p["assignee_current"]))


async def crawl(http: Http, companies: list[str], terms: list[str], relevant: set[str], seeds: list[str],
                max_pages: int = 600, probe_budget: int = 150, workers: int = 4) -> Crawl:
    """Concurrent workers share one priority frontier. Network politeness is enforced per host by `Http`
    (one in-flight request, min interval), so workers only overlap cache reads, parsing and waiting.
    Each publication number is claimed once; pages are keyed by Google's canonical number, so aliases
    (e.g. PubChem numbering) that resolve to an already-seen document are dropped as duplicates."""
    rx = term_pattern(terms)
    c = Crawl()
    heap: list[tuple[int, tuple[int, str], str, str]] = []
    best: dict[str, int] = {}  # pub -> best priority queued so far
    claimed: set[str] = set()  # requested numbers already taken by a worker (never fetched twice)
    fam_in: set[str] = set()
    cond = asyncio.Condition()
    state = {"inflight": 0, "stop": False}

    def push(pub: str, prio: int, why: str) -> None:
        # re-push when a probe (prio 1) turns out to be a family member/citation (prio 0); stale entries skipped on pop
        if pub and gp.PUB.fullmatch(pub) and pub not in claimed and prio < best.get(pub, 99):
            best[pub] = prio
            c.via[pub] = why
            heapq.heappush(heap, (prio, _probe_order(pub), pub, why))

    def take() -> str | None:
        while heap:
            prio, _, pub, _why = heapq.heappop(heap)
            if pub in claimed or prio > best[pub]:
                continue  # already claimed, or superseded by a higher-priority entry
            if prio == 1:
                if c.probes_used >= probe_budget:
                    continue
                c.probes_used += 1
            claimed.add(pub)
            return pub
        return None

    async def next_pub() -> str | None:
        async with cond:
            while True:
                if state["stop"]:
                    return None
                if len(claimed) >= max_pages:
                    c.budget_exhausted = any(pr == 0 and pb not in claimed for pr, _, pb, _ in heap)
                    return None
                if (pub := take()) is not None:
                    state["inflight"] += 1
                    return pub
                if state["inflight"] == 0:
                    return None  # frontier empty and nobody can add to it
                await cond.wait()  # another worker may still push new pages

    def handle(pub: str, page: dict) -> None:
        canon = page["publication_number"]
        if canon != pub:
            claimed.add(canon)  # the canonical number must not be fetched again either
        if canon in c.pages:
            c.duplicates += 1  # alias of a document we already have
            return
        citations = page.pop("cites") + page.pop("cited_by")  # only needed here; not kept in memory
        c.pages[canon] = page
        c.via.setdefault(canon, c.via.get(pub, "?"))
        if len(c.pages) % 50 == 0:
            log.info("crawl: %d pages, %d families, %d queued", len(c.pages), len(fam_in), len(heap))
        own = best_match(companies, _owners(page))["decision"]
        if not (own == "include" and _relevant(page, rx, relevant)) and page["family_id"] not in fam_in:
            return
        if page["family_id"]:
            fam_in.add(page["family_id"])
        for m in page["family_members"]:
            push(m, 0, f"family:{canon}")
        for row in citations:
            if (best_match(companies, [row["assigneeOriginal"] or ""])["decision"] != "reject"
                    and (row["publicationNumber"] in relevant or rx.search(row["title"] or ""))):
                push(row["publicationNumber"], 0, f"citation:{canon}")

    async def worker() -> None:
        while (pub := await next_pub()) is not None:
            try:
                _, page = await gp.fetch_patent(http, pub)
                if page is None:
                    c.not_found.append(pub)
                else:
                    handle(pub, page)  # synchronous: no await between reading and mutating shared state
            except HostDown as e:
                c.errors.append({"publication": pub, "error": f"HostDown: {e}"})
                state["stop"] = True
            except (RuntimeError, ValueError) as e:
                c.errors.append({"publication": pub, "error": f"{type(e).__name__}: {e}"})
            finally:
                async with cond:
                    state["inflight"] -= 1
                    cond.notify_all()

    for s in seeds:
        push(s, 0, "seed")
    for pub in sorted(relevant, key=_probe_order):
        push(pub, 1, "pubchem")
    async with asyncio.TaskGroup() as tg:  # any unexpected error cancels all workers (no orphaned tasks)
        for _ in range(workers):
            tg.create_task(worker())

    fetched = set(c.pages) | set(c.not_found) | claimed
    c.unfetched_family = {m for p in c.pages.values() if p["family_id"] in fam_in for m in p["family_members"]} - fetched
    return c


def classify(c: Crawl, companies: list[str], terms: list[str], relevant: set[str]) -> dict[str, list[tuple[dict, dict]]]:
    """Final pass once all families are known. include: company match + drug relevance, or member of such a
    family (unless its own assignee is a clear Latin-script mismatch -> uncertain: licensee/transfer)."""
    rx = term_pattern(terms)
    core: dict[str, str] = {}
    for pub, p in c.pages.items():
        if best_match(companies, _owners(p))["decision"] == "include" and _relevant(p, rx, relevant) and p["family_id"]:
            core.setdefault(p["family_id"], pub)
    out: dict[str, list[tuple[dict, dict]]] = {"include": [], "uncertain": [], "reject": []}
    for pub, p in c.pages.items():
        m = best_match(companies, _owners(p))
        rel = _relevant(p, rx, relevant)
        anchor = core.get(p["family_id"] or "")
        ev = {**m, "drug_relevant": rel, "via_family_of": anchor if anchor != pub else None, "found_via": c.via.get(pub)}
        if m["decision"] == "include" and (rel or anchor):
            out["include"].append((p, {**ev, "decision": "include"}))
        elif anchor and (m["decision"] == "uncertain" or not any(normalize(o) for o in _owners(p))):
            out["include"].append((p, {**ev, "decision": "include"}))  # empty / non-Latin owner in an included family
        elif anchor or (m["decision"] == "uncertain" and rel):
            out["uncertain"].append((p, {**ev, "decision": "uncertain"}))
        else:
            out["reject"].append((p, {**ev, "decision": "reject"}))
    return out
