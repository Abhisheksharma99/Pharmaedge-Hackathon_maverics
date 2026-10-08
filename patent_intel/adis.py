"""AdisInsight drug profile -> drug name, alternative names, companies.

robots.txt disallows /search and /suggest, so a drug is addressed by its profile id
(https://adisinsight.springer.com/drugs/<id>); everything else is derived from that page.
"""

from __future__ import annotations

import asyncio
import re

from selectolax.parser import HTMLParser

from .net import Http

BASE = "https://adisinsight.springer.com/drugs/"
TTL = 7 * 86400  # company/drug identity changes slowly


def adis_id(ref: str) -> str:
    """Accept '800010447' or a profile URL; reject anything else (it ends up in a URL)."""
    m = re.fullmatch(r"(?:https://adisinsight\.springer\.com/drugs/)?(\d{9})/?(?:\?.*)?", ref.strip())
    if not m:
        raise ValueError(f"not an AdisInsight drug id/url: {ref!r}")
    return m.group(1)


def _split(text: str | None) -> list[str]:
    return [s.strip() for s in (text or "").split(";") if s.strip()]


def parse_drug(html: str) -> dict:
    t = HTMLParser(html)
    heading = t.css_first("#drugNameID")
    if heading is None:
        raise ValueError("AdisInsight drug heading missing (layout drift or block page)")

    def prop(pid: str) -> str | None:
        n = t.css_first(f"#{pid} .data-list__property-value")
        return n.text(strip=True) if n else None

    alt = t.css_first(".document__alt-name")
    name, _, primary = heading.text(strip=True).partition(" - ")
    return {
        "name": name.strip(),
        # "Treprostinil - United Therapeutics Corporation" / "X - MannKind/United Therapeutics"
        "primary_companies": [c.strip() for c in primary.split("/") if c.strip()],
        "alternative_names": _split(alt.text(strip=True).removeprefix("Alternative Names:") if alt else None),
        "originators": _split(prop("at-a-glance_origniator")),  # sic: site's own id
        "developers": _split(prop("at-a-glance_developer")),
    }


async def fetch_drug(http: Http, ref: str) -> dict:
    did = adis_id(ref)
    url = BASE + did
    status, html = await http.get_html(url, TTL)
    if status != 200:
        raise RuntimeError(f"AdisInsight {url} -> HTTP {status}")
    return {"adis_id": did, "url": url, **await asyncio.to_thread(parse_drug, html)}
