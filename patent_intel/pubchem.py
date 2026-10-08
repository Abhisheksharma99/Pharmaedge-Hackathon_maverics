"""PubChem PUG-REST (documented, free, no key, 5 req/s): drug name -> patent publications linked to the
compound (PubChem sources these links from Google Patents / SureChEMBL). Used as a *relevance* set
and seed pool; it says nothing about ownership."""

from __future__ import annotations

import json
import re
from urllib.parse import quote

from .net import Http

BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/"
TTL = 7 * 86400


def to_google(pid: str) -> str | None:
    """'US-2008200449-A1' -> 'US20080200449A1' (Google pads US pre-grant serials to 7 digits);
    'EP-2026816-B1' -> 'EP2026816B1'."""
    m = re.fullmatch(r"([A-Z]{2})-([A-Z0-9]+)-([A-Z]\d?)", pid)
    if not m:
        return None
    cc, num, kind = m.groups()
    if cc == "US" and re.fullmatch(r"(19|20)\d{8}", num) and kind.startswith("A"):
        num = num[:4] + num[4:].zfill(7)
    return cc + num + kind


async def patent_ids(http: Http, name: str) -> set[str]:
    """All patent publications PubChem links to the compound named `name` (empty if unknown, e.g. biologics).
    Name -> CID first: by-name xrefs on large lists tend to fail with 503 ServerBusy, by-CID succeeds."""
    status, text = await http.get_html(f"{BASE}name/{quote(name, safe='')}/cids/JSON", TTL, ctype="json")
    if status == 404:
        return set()
    if status != 200:
        raise RuntimeError(f"PubChem name lookup {name!r} -> HTTP {status}")
    cids = json.loads(text).get("IdentifierList", {}).get("CID", [])[:1]  # first = PubChem's best match
    out: set[str] = set()
    for cid in cids:
        url = f"{BASE}cid/{int(cid)}/xrefs/PatentID/JSON"
        status, text = await http.get_html(url, TTL, ctype="json")
        if status != 200:
            raise RuntimeError(f"PubChem {url} -> HTTP {status}")
        for info in json.loads(text).get("InformationList", {}).get("Information", []):
            out.update(g for p in info.get("PatentID", []) if (g := to_google(p)))
    return out
