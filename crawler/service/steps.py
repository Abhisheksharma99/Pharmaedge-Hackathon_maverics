"""
Crawl steps for onboard / refresh / competitor jobs. Each takes a StepContext and
returns counts for the job record; all writes go through the shared record
contract, tagged with the asset id. Dedup (URL / record_key / content hash) keeps
refreshes incremental.
"""

import asyncio
import logging
from collections import Counter
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from pymongo import UpdateOne

from ai import llm
from ai.events import UNTRIAGED_SOURCES, consolidate, extract_events
from ai.index import index_asset
from ai.triage import TRIAGED_SOURCES, ingest_query, ledger_id, pending_query, triage_entries, triage_stored
from corpus import company_pr as pr_corpus
from corpus import complete as corpus_complete
from corpus import ema as ema_corpus
from integrations import chmp
from integrations import conferences as conference_corpus
from integrations import designations as designation_corpus
from integrations import fda_calendar as fda_calendar_source
from integrations import market as market_source
from integrations import newsroom
from integrations import patents as patent_crawler
from integrations import presentations as presentation_source
from integrations import sec_regulatory
from journey.checks import apply_checks, fold_confirmed
from journey.derive import derive_journey
from journey.feedback import recheck as recheck_feedback
from journey.rules import build_rule_events
from journey.store import bump_asset_version, replace_rule_events
from regulatory import clinicaltrials, fda
from storage.mongo_storage import get_content_hash, get_db, insert_article, upsert_records

from .pipeline import StepContext, StepSkipped

log = logging.getLogger("crawl.steps")
StepResult = Dict[str, Any]


def regulatory(ctx: StepContext) -> StepResult:
    """openFDA, EMA's reports (EPAR, post-authorisation, DHPC, referrals, orphan designations: from the EMA corpus once
    it holds them, corpus/ema.py, else downloaded from EMA) and FDA expedited-program approvals (designations corpus)."""
    fda_counts = upsert_records("fda_records", fda.fetch_all(ctx.asset_id, ctx.names), ctx.asset_id)
    ema_counts = upsert_records("ema_records", ema_corpus.for_asset(get_db(), ctx.names), ctx.asset_id)
    # FDA expedited-program approvals (designations corpus): the journey rules attach them to the approval events.
    designation_counts = upsert_records("fda_records", designation_corpus.for_asset(get_db(), ctx.names), ctx.asset_id)
    return {"fda_new": fda_counts["inserted"], "fda_updated": fda_counts["updated"],
            "ema_new": ema_counts["inserted"], "ema_updated": ema_counts["updated"],
            "expedited_programs": designation_counts["inserted"] + designation_counts["updated"],
            "summary": f"Stored {fda_counts['inserted'] + fda_counts['updated']} FDA and "
                       f"{ema_counts['inserted'] + ema_counts['updated']} EMA records"}


async def fda_calendar(ctx: StepContext) -> StepResult:
    """PDUFA dates and advisory committee meetings naming the asset (team crawler patent_intel/fdacal.py)."""
    records, report = await fda_calendar_source.fetch(ctx.asset, ctx.names)
    counts = upsert_records("fda_records", records, ctx.asset_id)
    return {"events": len(records), "events_new": counts["inserted"], "unresolved": report["unresolved"],
            "blocked_hosts": len(report["blocked_hosts"])}


async def sec_regulatory_step(ctx: StepContext) -> StepResult:
    """PDUFA target dates and complete response letters the asset's company reported to the SEC (team crawler
    patent_intel/regulatory.py, SEC EDGAR only). Skipped without SEC_USER_AGENT."""
    records, report = await sec_regulatory.fetch(ctx.asset, ctx.names)
    if "skipped" in report:
        raise StepSkipped(report["skipped"])
    counts = upsert_records("fda_records", records, ctx.asset_id)
    return {**Counter(r["event_type"] for r in records), "new": counts["inserted"],
            "filings_read": report.get("filings_read", 0), "errors": len(report.get("errors") or [])}


def presentations(ctx: StepContext) -> StepResult:
    """Slides of the asset company's investor presentations that name the asset, from the presentation subsystem's
    database (patent_intel/presentations; read-only): text, claims and metrics with page provenance."""
    records = list(presentation_source.fetch(get_db(), ctx.asset, ctx.names))
    if not records:
        raise StepSkipped("No investor-presentation slide names this asset")
    counts = upsert_records("company_records", records, ctx.asset_id)
    return {"slides": len(records), "decks": len({r["presentation_id"] for r in records}), "slides_new": counts["inserted"]}


async def market(ctx: StepContext) -> StepResult:
    """The asset company's listing and daily share prices (team module patent_intel/market): for Asset AI's share-price
    reaction around journey events. Prices the patent_intel run already stored (same cluster) are reused when fresh."""
    db = get_db()
    calendar = list(db.fda_records.find({"assets": ctx.asset_id, "record_type": "fda_calendar_event"}, {"ticker": 1, "company": 1}))
    team = db.client[presentation_source.PRESENTATIONS_DB]

    def stored(ticker):
        return db.market_prices.find_one({"_id": ticker}) or team.market_prices.find_one({"_id": ticker})

    listings, price_docs, report = await market_source.fetch(ctx.asset, calendar, stored)
    if not listings:
        raise StepSkipped(f"No listed company found for {(ctx.asset.get('company') or {}).get('name') or 'this asset'}")
    now = datetime.now(timezone.utc)
    db.market_listings.bulk_write([UpdateOne({"_id": d["_id"]}, {"$set": d}, upsert=True) for d in listings], ordered=False)
    db.market_listings.update_many({"asset": ctx.asset_id, "_id": {"$nin": [d["_id"] for d in listings]}, "stale": {"$ne": True}},
                                   {"$set": {"stale": True, "stale_since": now}})
    db.market_listings.create_index("asset")
    for doc in price_docs:
        db.market_prices.replace_one({"_id": doc["_id"]}, doc, upsert=True)
    return {"listings": ", ".join(d["ticker"] for d in listings), "priced": len(price_docs),
            "reused": len(report.get("reused", [])), "unlisted": len(report["unlisted"]),
            "errors": len(report["errors"]) + sum("error" in v for v in report["prices"].values())}


def ema_chmp(ctx: StepContext) -> StepResult:
    """CHMP opinions and meeting highlights naming the asset (team crawler ema/chmp_highlights.py), from the
    meetings corpus the corpus worker crawls. Never crawled here: a full CHMP crawl takes 30+ min under EMA's rate
    limit. While the corpus is still being built, the asset gets what is in it, and the rest on its next refresh."""
    db = get_db()
    records = list(chmp.fetch(db, ctx.names))
    counts = upsert_records("ema_records", records, ctx.asset_id)
    building = {} if corpus_complete(db, "ema_chmp") else {"corpus": "still being crawled"}
    return {**Counter(r["record_type"] for r in records), "new": counts["inserted"], **building}


def clinical(ctx: StepContext) -> StepResult:
    counts = upsert_records("trial_records", clinicaltrials.fetch_all(ctx.names), ctx.asset_id)
    return {"trials_new": counts["inserted"], "trials_updated": counts["updated"],
            "summary": f"Stored {counts['inserted'] + counts['updated']} studies ({counts['inserted']} new)"}


def _domain(url: str) -> str:
    host = urlparse(url or "").netloc.lower()
    return host[4:] if host.startswith("www.") else host


def company_site(ctx: StepContext) -> StepResult:
    """Product pages and documents (prescribing information, annual reports): the site adapter when there is one
    (unither.com), else the generic crawler (spec §5.5). Press releases come from the newsroom spiders
    (company_news); the generic crawler reads the IR page only for companies without one."""
    company = ctx.asset.get("company", {})
    domain = _domain(company.get("website", ""))
    if not domain:
        raise StepSkipped("No company website")
    if domain == "unither.com":
        from company import unither

        pages = upsert_records("company_records", unither.crawl_site_pages(ctx.names), ctx.asset_id)
        return {"pages_and_documents": pages["inserted"] + pages["updated"]}
    from company import generic

    records = generic.crawl(company, ctx.names, press_releases=not newsroom.spiders_for_domain(domain))
    counts = upsert_records("company_records", records, ctx.asset_id)
    return {**Counter(r["record_type"] for r in records), "new": counts["inserted"]}


def company_news(ctx: StepContext) -> StepResult:
    """Press releases from the company's newsroom spider(s) (team crawler company_pr/), picked by website
    domain: from the company_pr corpus for spiders whose full history is in it (corpus/company_pr.py), else
    crawled here (releases already stored are skipped; the first crawl takes the full history)."""
    company = ctx.asset.get("company", {})
    spiders = newsroom.spiders_for_domain(_domain(company.get("website", "")))
    if not spiders:
        raise StepSkipped(f"No newsroom crawler for {company.get('name') or 'this company'} yet")
    db = get_db()
    stored = pr_corpus.stored_spiders(db)
    from_corpus, live = [s for s in spiders if s in stored], [s for s in spiders if s not in stored]
    items, summary = list(pr_corpus.items(db, from_corpus)) if from_corpus else [], []
    if live:
        known = [r["url"] for r in db.company_records.find(
            {"record_type": "press_release", "source": {"$in": live}}, {"url": 1})]
        crawled, summary = newsroom.run(live, known_urls=known, limit=50 if known else 0,
                                        timeout_min=15 if known else 60, is_cancelled=ctx.is_cancelled)
        items += crawled
    counts = upsert_records("company_records", [newsroom.press_release(i, company.get("name"), ctx.names)
                                                for i in items], ctx.asset_id)
    return {"spiders": ", ".join(spiders), "from_corpus": len(from_corpus), "press_releases_new": counts["inserted"],
            "spider_errors": sum(s["errors"] for s in summary)}


def _high_ids(db, asset_id: str) -> set:
    return {e["_id"] for e in db.journey_events.find({"asset": asset_id, "significance": "High"}, {"_id": 1})}


def _log_new_events(ctx: StepContext, db, before: set, cap: int = 40) -> None:
    """One feed line per new High event (the live build pops them on its timeline)."""
    new = [e for e in db.journey_events.find({"asset": ctx.asset_id, "significance": "High"},
                                             {"title": 1, "date": 1, "key": 1, "sources": 1, "merged_sources": 1})
           if e["_id"] not in before]
    # key events first, then newest first, so an onboarding build shows what matters instead of the oldest events
    new.sort(key=lambda e: e.get("date") or "", reverse=True)
    new.sort(key=lambda e: not e.get("key"))
    for e in new[:cap]:
        ctx.log("event", e.get("title") or e["_id"], event_id=e["_id"],
                merged=len(e.get("sources") or []) + len(e.get("merged_sources") or []))


VERDICTS = {"ingest": "Ingest", "headline": "Headline", "skip": "Skip"}


def _sample_verdicts(decisions: List[Any], per: Optional[Dict[str, int]] = None) -> List[Any]:
    per = per or {"ingest": 6, "headline": 3, "skip": 3}
    taken: Dict[str, int] = {}
    out = []
    for title, decision in decisions:
        if taken.get(decision, 0) < per.get(decision, 0):
            taken[decision] = taken.get(decision, 0) + 1
            out.append((title, decision))
    return out


def publications(ctx: StepContext) -> StepResult:
    from regulatory import pubmed_source
    db, new = get_db(), 0
    known = lambda key: db.publication_records.count_documents({"record_key": key}, limit=1) > 0  # noqa: E731
    batch: List[Dict[str, Any]] = []
    # Competitors get the 300 newest articles: enough for their landscape, cheap to triage.
    limit = 300 if ctx.job_type == "competitor" else pubmed_source.MAX_RESULTS
    for record in pubmed_source.fetch(ctx.names, known=known, max_results=limit):
        batch.append(record)
        if len(batch) >= 100:
            new += upsert_records("publication_records", batch, ctx.asset_id)["inserted"]
            batch = []
        if ctx.is_cancelled():
            break
    if batch:
        new += upsert_records("publication_records", batch, ctx.asset_id)["inserted"]
    return {"publications_new": new}


async def news(ctx: StepContext) -> StepResult:
    """Newswire search (PR Newswire, BioSpace, GlobeNewswire) and the Bing News archive for each of the asset's
    names (the first 3 for competitors). Discovered entries are AI-triaged before any article is fetched."""
    from services.search_listing_crawler import (SearchListingCrawler, biospace_search_url, bing_news_feed_url,
                                                 globenewswire_feed_url, prnewswire_search_url)
    saved = duplicates = 0
    decisions: Dict[str, int] = {}
    before = llm.usage_snapshot()
    for term in ctx.names[:3] if ctx.job_type == "competitor" else ctx.names:
        if ctx.is_cancelled():
            break
        crawler = SearchListingCrawler()
        crawler.entry_filter = lambda entries: triage_entries(ctx.asset, entries, decisions)
        result = await crawler.run_rss_crawler({
            "id": f"job:{ctx.asset_id}:{term}",
            "name": f"Wires - {ctx.asset_id} - {term}",
            "asset": ctx.asset_id,
            "keyword": term,
            "rss_feed_urls": [prnewswire_search_url(term), biospace_search_url(term), globenewswire_feed_url(term),
                              bing_news_feed_url(term)],
        }, max_articles=25)
        saved += result.get("articles_saved", 0)
        duplicates += result.get("articles_duplicate", 0)
    return {"articles_new": saved, "already_had": duplicates,
            **{f"triaged_{k}": v for k, v in decisions.items()}, **llm.usage_delta(before)}


def industry_news(ctx: StepContext) -> StepResult:
    """Fierce, Reuters, BioSpace, EMA, Google News, ... (team crawler company_pr/). Only articles that mention
    the asset are kept. Spiders whose full history is in the company_pr corpus are matched there; the others
    (always Google News, which searches the asset's names) are crawled, and their articles that don't mention
    the asset are logged in crawl_ledger so the next refresh doesn't fetch them again."""
    db = get_db()
    spiders, stored = newsroom.news_spiders(), pr_corpus.stored_spiders(db)
    from_corpus, live = [s for s in spiders if s in stored], [s for s in spiders if s not in stored]
    items, summary = list(pr_corpus.items(db, from_corpus, ctx.names)) if from_corpus else [], []
    if live:
        known = {a["url"] for a in db.articles.find({}, {"url": 1})}
        known |= {r["url"] for r in db.crawl_ledger.find({"asset": ctx.asset_id, "collection": "articles"},
                                                         {"url": 1}) if r.get("url")}
        crawled, summary = newsroom.run(live, known_urls=known, keywords=ctx.names, timeout_min=10,
                                        is_cancelled=ctx.is_cancelled)
        items += crawled
    new = kept = 0
    skipped: List[UpdateOne] = []
    now = datetime.now(timezone.utc)
    for item in items:
        found = newsroom.mentions(item, ctx.names)
        if found:
            kept += 1
            record = newsroom.article(item, found)
            new += insert_article({**record, "content_hash": get_content_hash(record["content"] or "")}, ctx.asset_id)
        else:
            skipped.append(UpdateOne({"_id": ledger_id(ctx.asset_id, item["news_url"])}, {"$set": {
                "asset": ctx.asset_id, "item_key": item["news_url"], "url": item["news_url"],
                "title": item.get("title"), "date": item.get("news_date"), "source": item["spider"],
                "collection": "articles", "decision": "skip", "category": "unrelated",
                "reason": "Does not mention the asset", "model": "name-filter", "decided_at": now}}, upsert=True))
    if skipped:
        db.crawl_ledger.bulk_write(skipped, ordered=False)
    return {"spiders": len(spiders), "from_corpus": len(from_corpus), "articles_seen": len(items),
            "mentioning_asset": kept, "articles_new": new, "spider_errors": sum(s["errors"] for s in summary)}


def conferences(ctx: StepContext) -> StepResult:
    """ERS / ATS / CHEST abstracts mentioning the asset, from the team's conference corpus."""
    records = list(conference_corpus.fetch(get_db(), ctx.names))
    counts = upsert_records("conference_records", records, ctx.asset_id)
    return {"abstracts": len(records), "abstracts_new": counts["inserted"]}


async def patents(ctx: StepContext) -> StepResult:
    """Patent families via the team's patent crawler (AdisInsight, PubChem, Google Patents)."""
    records, coverage = await patent_crawler.fetch(ctx.asset, ctx.names)
    counts = upsert_records("patent_records", records, ctx.asset_id)
    return {"patents": len(records), "patents_new": counts["inserted"], "pages_fetched": coverage["pages_fetched"],
            "uncertain": coverage["uncertain"], "budget_exhausted": coverage["budget_exhausted"]}


def ai_triage(ctx: StepContext) -> StepResult:
    before = llm.usage_snapshot()
    notable: List[Any] = []
    counts = triage_stored(ctx.asset, notable=notable)
    for title, decision in _sample_verdicts(notable):
        ctx.log("ai", f"“{str(title)[:110]}”", verdict=VERDICTS[decision])
    relevant = sum(v for k, v in counts.items() if k.endswith("_ingest"))
    dropped = sum(v for k, v in counts.items() if k.endswith("_skip"))
    return {**counts, **llm.usage_delta(before), "summary": f"{relevant} relevant · {dropped} dropped"}


def ai_events(ctx: StepContext) -> StepResult:
    before, db = llm.usage_snapshot(), get_db()
    high_before = _high_ids(db, ctx.asset_id)
    counts = extract_events(ctx.asset)
    merged = consolidate(ctx.asset_id)
    _log_new_events(ctx, db, high_before)
    return {**counts, **merged, **llm.usage_delta(before),
            "summary": f"{counts['documents']} documents · {counts['events']} events extracted · {merged['merged']} merged"}


def index(ctx: StepContext) -> StepResult:
    before = llm.usage_snapshot()
    return {**index_asset(ctx.asset_id), **llm.usage_delta(before)}


def journey(ctx: StepContext) -> StepResult:
    db = get_db()
    before = _high_ids(db, ctx.asset_id)
    counts = replace_rule_events(db, ctx.asset_id, build_rule_events(db, ctx.asset_id,
                                                                    ctx.asset.get("company", {}).get("name")))
    _log_new_events(ctx, db, before)
    return {**counts, "summary": f"{counts['events']} events from structured sources"}


async def competitors(ctx: StepContext) -> StepResult:
    """Top 5 competitors of a primary asset (onboarding/competitors.py; a scan under 30 days old is reused), each
    started on a light competitor crawl unless it was crawled in the last 24 h."""
    from arq import create_pool

    from onboarding import competitors as scan

    from .api import redis_settings

    if ctx.asset.get("kind") == "competitor":
        raise StepSkipped("Competitor assets don't get competitors of their own")
    db = get_db()
    if scan.is_fresh(ctx.asset):
        ranked, counts = ctx.asset["competitors"], {"reused_scan": 1, "new_assets": 0}
    else:
        ranked, candidates = await asyncio.to_thread(scan.identify, db, ctx.asset)
        counts = {"candidates": candidates, "new_assets": scan.save(db, ctx.asset, ranked, candidates)}
    queue = await create_pool(redis_settings())
    try:
        started = await scan.start_jobs(db, queue, ctx.asset, [c["id"] for c in ranked], PLANS["competitor"])
    finally:
        await queue.aclose()
    return {"competitors": len(ranked), **counts, "jobs_started": started}


# How the next milestone reads in a question ("... next trial readout")
MILESTONE_WORDS = {"expected_readout": "trial readout", "regulatory_decision_expected": "regulatory decision",
                   "advisory_committee": "FDA advisory committee meeting"}


def suggested_questions(db, asset: Dict[str, Any]) -> List[str]:
    """Four starter questions for Asset AI, from the asset's next milestone and top competitor."""
    name = asset["name"]
    milestone = db.journey_events.find_one({"asset": asset["_id"], "is_milestone": True,
                                            "date": {"$gte": date.today().isoformat()}}, sort=[("date", 1)])
    rival = next((c["name"] for c in asset.get("competitors") or []), None)
    if not rival and asset.get("competitor_of"):  # a competitor asset: compare it with the primary it competes with
        rival = (db.assets.find_one({"_id": asset["competitor_of"][0]}, {"name": 1}) or {}).get("name")
    kind = milestone and MILESTONE_WORDS.get(milestone["type"], milestone["type"].replace("_", " "))
    return [f"What are the key events in {name}'s journey so far?",
            f"What is expected from {name}'s next {kind}, and when?" if kind
            else f"What are the upcoming milestones for {name}?",
            f"How does {name} compare with {rival}?" if rival else f"Who are {name}'s main competitors?",
            f"What do the latest clinical trial results show for {name}?"]


def leftovers(db, asset_id: str) -> Dict[str, int]:
    """Records the AI steps have not seen yet: stored after they ran (a later step, another asset's job, the corpus
    worker). Counted on the asset's own records only; nothing is called when there are none."""
    untriaged = sum(db[c].count_documents({"assets": asset_id, **pending_query(asset_id), **extra})
                    for c, (_key, extra, _text) in TRIAGED_SOURCES.items())
    unread = sum(db[c].count_documents({**ingest_query(asset_id), f"events_done.{asset_id}": {"$exists": False}})
                 for c in TRIAGED_SOURCES)
    unread += sum(db[c].count_documents({"assets": asset_id, f"events_done.{asset_id}": {"$exists": False}, **extra})
                  for c, (_key, extra, _text) in UNTRIAGED_SOURCES.items())
    return {"untriaged": untriaged, "unread": unread}


def catch_up(ctx: StepContext, db) -> StepResult:
    """Run the AI steps on leftovers (see `leftovers`) so a finished job leaves nothing unread. A failure here is
    reported, never fatal: the next job picks the records up again."""
    left = leftovers(db, ctx.asset_id)
    if not any(left.values()):
        return {}
    before = llm.usage_snapshot()
    out: Dict[str, Any] = {f"catch_up_{k}": v for k, v in left.items()}
    try:
        triaged = triage_stored(ctx.asset) if left["untriaged"] else {}
        kept = sum(v for k, v in triaged.items() if k.endswith("_ingest"))
        extracted = extract_events(ctx.asset) if (kept or left["unread"]) else {"events": 0, "documents": 0}
        if extracted.get("events"):
            consolidate(ctx.asset_id)
        if kept or extracted.get("documents"):
            index_asset(ctx.asset_id)
        out.update({"catch_up_kept": kept, "catch_up_events": extracted.get("events", 0)})
    except Exception as e:  # noqa: BLE001 - leftovers stay for the next job; finalize must still finish
        out["catch_up_error"] = f"{type(e).__name__}: {e}"[:200]
    usage = llm.usage_delta(before)
    if usage.get("cost_usd"):
        out["catch_up_cost_usd"] = usage["cost_usd"]
    return out


def finalize(ctx: StepContext) -> StepResult:
    """Catch up on records the AI steps have not seen, rebuild rule events (patents found late belong in the journey
    too), run the cross-source checks, derive branches / key events / enrichment, then mark the asset ready with its
    suggested questions and bump the cache version."""
    db = get_db()
    caught = catch_up(ctx, db)
    counts = replace_rule_events(db, ctx.asset_id, build_rule_events(db, ctx.asset_id,
                                                                     ctx.asset.get("company", {}).get("name")))
    try:  # notes marked "Missed by AI": events they resolve to are in place before branches / key events are derived
        feedback = recheck_feedback(db, ctx.asset_id, ctx.log)
    except Exception as e:  # noqa: BLE001 - the re-check is best effort; the asset still becomes ready
        log.warning("crawl_feedback re-check failed for %s", ctx.asset_id, exc_info=True)
        feedback = {}
        ctx.log("warn", f"Couldn't re-check notes marked ‘Missed by AI’ ({type(e).__name__}); they stay open")
    checks = apply_checks(db, ctx.asset_id)  # after the rebuild: compares the AI events with the fresh rule ones
    folded = fold_confirmed(db, ctx.asset_id)  # duplicate reports of a confirmed approval join the regulator's event
    derived = derive_journey(db, ctx.asset, log=ctx.log)  # after folding: branches / key events see the final events
    asset = db.assets.find_one({"_id": ctx.asset_id})  # fresh: competitors were written during this job
    questions = suggested_questions(db, asset)
    now = datetime.now(timezone.utc)
    db.assets.update_one({"_id": ctx.asset_id}, {"$set": {"status": "ready", "suggested_questions": questions,
                                                          "last_crawled_at": now, "updated_at": now}})
    if not bump_asset_version(ctx.asset_id):  # the asset is ready now: clients refetching must not read the old view
        log.warning("cache version bump failed for %s after finalize", ctx.asset_id)
    return {**caught, **counts, **feedback, **{f"checks_{k}": v for k, v in checks.items()},
            **({"folded": folded} if folded else {}), **derived, "suggested_questions": len(questions),
            "summary": f"Asset ready · {derived.get('key_events', 0)} key events · {derived.get('branches', 0)} branches"}


STEPS = {"regulatory": regulatory, "fda_calendar": fda_calendar, "sec_regulatory": sec_regulatory_step,
         "presentations": presentations, "market": market,
         "ema_chmp": ema_chmp, "clinical": clinical,
         "publications": publications, "conferences": conferences, "patents": patents, "company_site": company_site,
         "company_news": company_news, "news": news, "industry_news": industry_news, "journey": journey,
         "ai_triage": ai_triage, "ai_events": ai_events, "index": index, "competitors": competitors,
         "finalize": finalize}

LABELS = {
    "regulatory": "Regulatory (FDA, EMA reports)",
    "fda_calendar": "FDA calendar (PDUFA dates, advisory committees)",
    "sec_regulatory": "SEC filings (PDUFA dates, complete response letters)",
    "presentations": "Investor presentations (slides, claims, metrics)",
    "market": "Share prices of the listed company",
    "ema_chmp": "EMA CHMP opinions (monthly meeting highlights)",
    "clinical": "Clinical trials (ClinicalTrials.gov)",
    "publications": "Publications (PubMed)",
    "conferences": "Conference abstracts (ERS, ATS, CHEST)",
    "patents": "Patents (AdisInsight, PubChem, Google Patents)",
    "company_site": "Company website (pages, documents)",
    "company_news": "Company press releases (newsroom)",
    "news": "Newswires and Bing News (PR Newswire, BioSpace, GlobeNewswire, Bing; AI-screened)",
    "industry_news": "Industry news (Fierce, Reuters, EMA, Google News, ...)",
    "journey": "Journey events (rules)",
    "ai_triage": "AI triage of stored records",
    "ai_events": "AI event extraction and consolidation",
    "index": "Search index for Asset AI",
    "competitors": "Competitors (top 5, each crawled lightly)",
    "finalize": "Finalize (AI catch-up, journey rebuild, checks, suggested questions, ready)",
}


def _plan(*names: str) -> List[Dict[str, str]]:
    return [{"name": n, "label": LABELS[n]} for n in names]


# Acquisition first, then the journey built from what was found. Onboarding runs the fast sources first so the
# asset page fills progressively (patents take ~10 min, and the FDA calendar reads every event's source document
# until its cache is warm, so both run after competitors, with the SEC filings search; finalize puts their events
# in the journey). ema_chmp
# runs before ai_triage / ai_events, which extract events from its records. Competitor jobs are light:
# no company site, newsroom, industry news or patents, and no competitors of their own.
PLANS: Dict[str, List[Dict[str, str]]] = {
    "refresh": _plan("regulatory", "fda_calendar", "sec_regulatory", "market", "ema_chmp", "clinical", "publications",
                     "conferences", "patents", "company_site", "company_news", "presentations", "news", "industry_news",
                     "journey", "ai_triage", "ai_events", "index", "competitors", "finalize"),
    "onboard": _plan("regulatory", "ema_chmp", "clinical", "publications", "conferences", "company_site",
                     "company_news", "presentations", "news", "industry_news", "journey", "ai_triage", "ai_events", "index",
                     "competitors", "fda_calendar", "sec_regulatory", "market", "patents", "finalize"),
    "competitor": _plan("regulatory", "fda_calendar", "sec_regulatory", "market", "ema_chmp", "clinical", "publications",
                        "conferences", "presentations", "news", "patents", "journey", "ai_triage", "ai_events", "index",
                        "finalize"),
}
