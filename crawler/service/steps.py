"""
Crawl steps for onboard / refresh / competitor jobs. Each takes a StepContext and
returns counts for the job record; all writes go through the shared record
contract, tagged with the asset id. Dedup (URL / record_key / content hash) keeps
refreshes incremental.
"""

import asyncio
from collections import Counter
from datetime import date, datetime, timezone
from typing import Any, Dict, List
from urllib.parse import urlparse

from pymongo import UpdateOne

from ai import llm
from ai.events import consolidate, extract_events
from ai.index import index_asset
from ai.triage import ledger_id, triage_entries, triage_stored
from integrations import chmp
from integrations import conferences as conference_corpus
from integrations import fda_calendar as fda_calendar_source
from integrations import newsroom
from integrations import patents as patent_crawler
from journey.rules import build_rule_events
from journey.store import replace_rule_events
from regulatory import clinicaltrials, ema, fda
from storage.mongo_storage import get_content_hash, get_db, insert_article, upsert_records

from .pipeline import StepContext, StepSkipped

StepResult = Dict[str, Any]


def regulatory(ctx: StepContext) -> StepResult:
    fda_counts = upsert_records("fda_records", fda.fetch_all(ctx.asset_id, ctx.names), ctx.asset_id)
    ema_counts = upsert_records("ema_records", ema.fetch_all(ctx.names), ctx.asset_id)
    return {"fda_new": fda_counts["inserted"], "fda_updated": fda_counts["updated"],
            "ema_new": ema_counts["inserted"], "ema_updated": ema_counts["updated"]}


async def fda_calendar(ctx: StepContext) -> StepResult:
    """PDUFA dates and advisory committee meetings naming the asset (team crawler patent_intel/fdacal.py)."""
    records, report = await fda_calendar_source.fetch(ctx.asset, ctx.names)
    counts = upsert_records("fda_records", records, ctx.asset_id)
    return {"events": len(records), "events_new": counts["inserted"], "unresolved": report["unresolved"],
            "blocked_hosts": len(report["blocked_hosts"])}


def ema_chmp(ctx: StepContext) -> StepResult:
    """CHMP opinions and meeting highlights naming the asset (team crawler ema/chmp_highlights.py). The meetings
    corpus is refreshed at most daily, by whichever job gets there first."""
    db = get_db()
    refresh = chmp.refresh_corpus(db)
    records = list(chmp.fetch(db, ctx.names))
    counts = upsert_records("ema_records", records, ctx.asset_id)
    return {**refresh, **Counter(r["record_type"] for r in records), "new": counts["inserted"]}


def clinical(ctx: StepContext) -> StepResult:
    counts = upsert_records("trial_records", clinicaltrials.fetch_all(ctx.names), ctx.asset_id)
    return {"trials_new": counts["inserted"], "trials_updated": counts["updated"]}


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
    domain. Releases already stored are skipped; the first crawl takes the full history."""
    company = ctx.asset.get("company", {})
    spiders = newsroom.spiders_for_domain(_domain(company.get("website", "")))
    if not spiders:
        raise StepSkipped(f"No newsroom crawler for {company.get('name') or 'this company'} yet")
    known = [r["url"] for r in get_db().company_records.find(
        {"record_type": "press_release", "source": {"$in": spiders}}, {"url": 1})]
    items, summary = newsroom.run(spiders, known_urls=known, limit=50 if known else 0,
                                  timeout_min=15 if known else 60, is_cancelled=ctx.is_cancelled)
    counts = upsert_records("company_records", [newsroom.press_release(i, company.get("name"), ctx.names)
                                                for i in items], ctx.asset_id)
    return {"spiders": ", ".join(spiders), "press_releases_new": counts["inserted"],
            "spider_errors": sum(s["errors"] for s in summary)}


def _tokens(before: Dict[str, int]) -> Dict[str, int]:
    after = llm.usage_snapshot()
    return {"llm_calls": after["calls"] - before["calls"], "cache_hits": after["cache_hits"] - before["cache_hits"],
            "tokens": (after["prompt_tokens"] + after["completion_tokens"])
            - (before["prompt_tokens"] + before["completion_tokens"])}


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
            **{f"triaged_{k}": v for k, v in decisions.items()}, **_tokens(before)}


def industry_news(ctx: StepContext) -> StepResult:
    """Fierce, Reuters, BioSpace, EMA, Google News, ... (team crawler company_pr/). Only articles that mention
    the asset are kept; the rest are logged in crawl_ledger so the next refresh doesn't fetch them again."""
    db = get_db()
    known = {a["url"] for a in db.articles.find({}, {"url": 1})}
    known |= {r["url"] for r in db.crawl_ledger.find({"asset": ctx.asset_id, "collection": "articles"}, {"url": 1})
              if r.get("url")}
    items, summary = newsroom.run(newsroom.news_spiders(), known_urls=known, keywords=ctx.names,
                                  timeout_min=10, is_cancelled=ctx.is_cancelled)
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
    return {"spiders": len(summary), "articles_seen": len(items), "mentioning_asset": kept, "articles_new": new,
            "spider_errors": sum(s["errors"] for s in summary)}


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
    return {**triage_stored(ctx.asset), **_tokens(before)}


def ai_events(ctx: StepContext) -> StepResult:
    before = llm.usage_snapshot()
    counts = extract_events(ctx.asset)
    return {**counts, **consolidate(ctx.asset_id), **_tokens(before)}


def index(ctx: StepContext) -> StepResult:
    before = llm.usage_snapshot()
    return {**index_asset(ctx.asset_id), **_tokens(before)}


def journey(ctx: StepContext) -> StepResult:
    events = build_rule_events(get_db(), ctx.asset_id, ctx.asset.get("company", {}).get("name"))
    return replace_rule_events(get_db(), ctx.asset_id, events)


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


def finalize(ctx: StepContext) -> StepResult:
    """Rebuild rule events (patents found late belong in the journey too), then mark the asset ready with its
    suggested questions. The worker bumps the cache version when the job ends."""
    db = get_db()
    counts = replace_rule_events(db, ctx.asset_id, build_rule_events(db, ctx.asset_id,
                                                                     ctx.asset.get("company", {}).get("name")))
    asset = db.assets.find_one({"_id": ctx.asset_id})  # fresh: competitors were written during this job
    questions = suggested_questions(db, asset)
    now = datetime.now(timezone.utc)
    db.assets.update_one({"_id": ctx.asset_id}, {"$set": {"status": "ready", "suggested_questions": questions,
                                                          "last_crawled_at": now, "updated_at": now}})
    return {**counts, "suggested_questions": len(questions)}


STEPS = {"regulatory": regulatory, "fda_calendar": fda_calendar, "ema_chmp": ema_chmp, "clinical": clinical,
         "publications": publications, "conferences": conferences, "patents": patents, "company_site": company_site, "company_news": company_news, "news": news,
         "industry_news": industry_news, "journey": journey, "ai_triage": ai_triage, "ai_events": ai_events,
         "index": index, "competitors": competitors, "finalize": finalize}

LABELS = {
    "regulatory": "Regulatory (FDA, EMA)",
    "fda_calendar": "FDA calendar (PDUFA dates, advisory committees)",
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
    "finalize": "Finalize (journey rebuild, suggested questions, ready)",
}


def _plan(*names: str) -> List[Dict[str, str]]:
    return [{"name": n, "label": LABELS[n]} for n in names]


# Acquisition first, then the journey built from what was found. Onboarding runs the fast sources first so the
# asset page fills progressively (patents take ~10 min, and the FDA calendar reads every event's source document
# until its cache is warm, so both run after competitors; finalize puts their events in the journey). ema_chmp
# runs before ai_triage / ai_events, which extract events from its records. Competitor jobs are light:
# no company site, newsroom, industry news or patents, and no competitors of their own.
PLANS: Dict[str, List[Dict[str, str]]] = {
    "refresh": _plan("regulatory", "fda_calendar", "ema_chmp", "clinical", "publications", "conferences", "patents",
                     "company_site", "company_news", "news", "industry_news", "journey", "ai_triage", "ai_events",
                     "index", "competitors", "finalize"),
    "onboard": _plan("regulatory", "ema_chmp", "clinical", "publications", "conferences", "company_site",
                     "company_news", "news", "industry_news", "journey", "ai_triage", "ai_events", "index",
                     "competitors", "fda_calendar", "patents", "finalize"),
    "competitor": _plan("regulatory", "fda_calendar", "ema_chmp", "clinical", "publications", "conferences", "news",
                        "patents", "journey", "ai_triage", "ai_events", "index", "finalize"),
}
