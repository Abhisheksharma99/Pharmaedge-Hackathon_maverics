"""Google Patents /patent/<pub>/en pages (allowed by robots.txt; search /?q= and /xhr are not).

One page gives the document's bibliographic data, legal status/events, its DOCDB family list, and
cited/citing documents *with their assignees* - which is what lets the crawler expand a company's
portfolio without touching the disallowed search endpoints."""

from __future__ import annotations

import asyncio
import re
from urllib.parse import quote

from selectolax.parser import HTMLParser, Node

from .net import Http

BASE = "https://patents.google.com/patent/"
PARSER_VERSION = "gp-2"
TTL = 86400  # legal status / assignee move -> short TTL
PUB = re.compile(r"[A-Z]{2}[A-Z0-9]{2,24}")


def _top_level(article: Node, prop: str) -> list[Node]:
    """Microdata scoping: props whose nearest itemscope ancestor is the article itself
    (family/citation sections repeat the same itemprops for other documents)."""
    out = []
    for n in article.css(f"[itemprop={prop}]"):
        p = n.parent
        while p is not None and "itemscope" not in p.attributes:
            p = p.parent
        if p is not None and p.mem_id == article.mem_id:
            out.append(n)
    return out


def _t(n: Node | None) -> str | None:
    if n is None:
        return None
    v = n.attributes.get("datetime") or n.attributes.get("content") or n.text(strip=True)
    return re.sub(r"\s+", " ", v).strip() or None


def _rows(t: HTMLParser, prop: str, fields: tuple[str, ...]) -> list[dict]:
    return [{f: _t(r.css_first(f"[itemprop={f}]")) for f in fields} for r in t.css(f"[itemprop={prop}]")]


def parse_patent(html: str) -> dict:
    t = HTMLParser(html)
    art = t.css_first("article.result")
    if art is None:
        raise ValueError("Google Patents article missing (layout drift or block page)")

    def one(prop: str) -> str | None:
        nodes = _top_level(art, prop)
        return _t(nodes[0]) if nodes else None

    def many(prop: str) -> list[str]:
        return [v for n in _top_level(art, prop) if (v := _t(n))]

    def items(prop: str, fields: tuple[str, ...]) -> list[dict]:
        return [{f: _t(n.css_first(f"[itemprop={f}]")) for f in fields} for n in _top_level(art, prop)]

    if not (pub := one("publicationNumber")):
        raise ValueError("Google Patents publicationNumber missing (layout drift)")
    fam = t.css_first("section[itemprop=family] h2")
    fam_m = re.search(r"ID=(\d+)", fam.text() if fam else "")
    status = _top_level(art, "legalStatusIfi")
    desc = t.css_first('meta[name="DC.description"]')
    cpc = [c for li in t.css("li[itemprop=classifications]")
           if (leaf := li.css_first("meta[itemprop=Leaf]")) and leaf.attributes.get("content") == "true"
           and (c := _t(li.css_first("[itemprop=Code]")))]
    cite = ("publicationNumber", "assigneeOriginal", "title", "priorityDate", "publicationDate")
    return {
        "publication_number": pub,
        "country": one("countryCode"),
        "kind": one("kindCode"),
        "publication_description": one("publicationDescription"),  # e.g. "Granted patent"
        "title": one("title"),
        "abstract": (desc.attributes.get("content") or "").strip() or None if desc else None,
        "application_number": one("applicationNumber"),
        "filing_date": one("filingDate"),
        "priority_date": one("priorityDate"),
        "publication_date": one("publicationDate"),
        "assignee_original": many("assigneeOriginal"),
        "assignee_current": many("assigneeCurrent"),
        "inventors": many("inventor"),
        "cpc": list(dict.fromkeys(cpc)),
        "priority_applications": _rows(t, "appsClaimingPriority", ("applicationNumber", "priorityDate", "filingDate")),
        "family_id": fam_m[1] if fam_m else None,  # DOCDB simple family
        "family_members": list(dict.fromkeys(r["publicationNumber"] for r in _rows(t, "docdbFamily", ("publicationNumber",))
                                             if r["publicationNumber"])),
        # Google's own caveat: "an assumption, not a legal conclusion" -> kept as-is, labelled by source
        "legal_status": _t(status[0].css_first("[itemprop=status]")) if status else None,
        "events": items("events", ("date", "type", "title")),
        "legal_events": items("legalEvents", ("date", "code", "title")),
        "cites": _rows(t, "backwardReferencesFamily", cite) + _rows(t, "backwardReferencesOrig", cite),
        "cited_by": _rows(t, "forwardReferencesFamily", cite) + _rows(t, "forwardReferencesOrig", cite),
    }


def page_url(pub: str) -> str:
    return BASE + quote(pub) + "/en"


async def fetch_patent(http: Http, pub: str) -> tuple[str, dict | None]:
    """Returns (url, record) or (url, None) if Google has no page for it (not 'dead' - just not found)."""
    if not PUB.fullmatch(pub):
        raise ValueError(f"bad publication number {pub!r}")
    status, html = await http.get_html(page_url(pub), TTL)
    if status == 200:
        return page_url(pub), await asyncio.to_thread(parse_patent, html)  # CPU work off the event loop
    if status == 404:
        return page_url(pub), None
    raise RuntimeError(f"Google Patents {page_url(pub)} -> HTTP {status}")
