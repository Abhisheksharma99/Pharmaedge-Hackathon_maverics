"""
Normalization for RSS/Atom feed entries.

Feeds do not hand out clean data. Search engines (Google Alerts, Bing News) wrap
links in redirect stubs carrying the destination in a ``url`` query param, and
wrap matched keywords in <b> markup inside titles. Some publishers - Fierce
Pharma and Fierce Biotech among them - put a whole HTML anchor inside <link>
instead of a bare URL. All of it has to be normalized before extraction,
publisher derivation, storage and dedup run on it.

Kept dependency-free so both the RSS crawler and the news discovery layer can
import it without dragging in the spider/extraction stack.
"""

import html
import re
from typing import Any
from urllib.parse import urlparse, parse_qs


def unwrap_search_redirect(link: str) -> str:
    """Unwrap a search-engine redirect to the real publisher URL.

    Two wrapper shapes are handled:
      - Bing News RSS:  http://www.bing.com/news/apiclick.aspx?...&url=<real>
      - Google Alerts:  https://www.google.com/url?rct=j&sa=t&url=<real>&ct=...

    Both carry the destination in a ``url`` query param, so parse_qs pulls it out
    and percent-decodes it in one step (Google encodes the target's own query
    string, e.g. ``watch%3Fv%3Dxyz`` -> ``watch?v=xyz``).

    Anything else - a plain URL, or a news.google.com link that still needs
    real decoding - passes through unchanged.
    """
    link = (link or "").strip()
    if not link:
        return ""
    try:
        parsed = urlparse(link)
        host = parsed.netloc.lower()
        is_bing = "bing.com" in host and "apiclick" in parsed.path
        # Alerts links come back on www.google.com/url even when the feed itself
        # is served from a ccTLD host such as www.google.co.in.
        is_google_redirect = _is_google_host(host) and parsed.path == "/url"
        if is_bing or is_google_redirect:
            real = parse_qs(parsed.query).get("url", [])
            if real and real[0]:
                return real[0]
    except Exception:
        pass
    return link


def clean_feed_title(title: str) -> str:
    """Strip the markup a search engine wraps around matched keywords.

    Alerts titles arrive as ``Dirty air may trigger <b>rheumatoid arthritis</b>
    flares`` and entities as ``&#39;``; both would otherwise be stored verbatim
    and break title-based dedup against the same article from another source.
    """
    if not title:
        return ""
    return html.unescape(re.sub(r"<[^>]+>", "", title)).strip()


def is_search_engine_feed_title(feed_title: str) -> bool:
    """True if a feed's own title is the search engine talking, not a publisher.

    Google Alerts names every feed ``Google Alert - <keyword>``. Using that as
    the article's publisher would label real articles with the alert keyword, so
    callers drop it and fall back to the extracted publisher / URL domain.
    """
    return (feed_title or "").strip().lower().startswith("google alert")


# A <link> whose body is an HTML anchor rather than a URL, e.g.
#   <a href="https://www.fiercebiotech.com/biotech/...">Headline</a>
# Both Fierce feeds do this. feedparser returns the markup verbatim, so without
# this the raw string was queued as if it were a URL and every fetch failed.
_ANCHOR_HREF_RE = re.compile(r"""<a\s[^>]*?href\s*=\s*["']([^"']+)["']""", re.I)


def is_http_url(value: str) -> bool:
    """True if ``value`` is a plausible absolute http(s) URL."""
    value = (value or "").strip()
    if not (value.startswith("http://") or value.startswith("https://")):
        return False
    try:
        return bool(urlparse(value).netloc)
    except Exception:
        return False


def resolve_entry_url(link: str, links: Any = None, entry_id: str = "") -> str:
    """Best available article URL for a feed entry, or "" if there is none.

    Tried in order, first valid http(s) URL wins:

      1. ``entry.link`` as-is - the overwhelmingly common case.
      2. The ``href`` of an HTML anchor inside it. Fierce Pharma and Fierce
         Biotech both ship ``<link><a href="...">Headline</a></link>``; feedparser
         hands that back untouched, and it was being queued as a URL. Every fetch
         then ran against a string starting with ``<a href=``, so both feeds
         parsed 25 articles per run and saved zero, indefinitely.
      3. Any ``href`` in ``entry.links`` (Atom's alternate/self links).
      4. ``entry.id`` - permalink-style feeds use the article URL as the guid.

    Returning "" rather than a malformed string lets the caller drop the entry and
    count it, instead of spending a fetch on something that cannot be fetched.
    """
    raw = (link or "").strip()
    if is_http_url(raw):
        return raw

    match = _ANCHOR_HREF_RE.search(raw)
    if match:
        candidate = html.unescape(match.group(1)).strip()
        if is_http_url(candidate):
            return candidate

    for item in (links or []):
        href = item.get("href", "") if isinstance(item, dict) else ""
        if is_http_url(href):
            return href.strip()

    entry_id = (entry_id or "").strip()
    if is_http_url(entry_id):
        return entry_id

    return ""


def _is_google_host(host: str) -> bool:
    """True for google.com, google.co.in, google.co.uk, news.google.com, ..."""
    labels = host.split("@")[-1].split(":")[0].split(".")
    if len(labels) >= 2 and labels[-2] == "google":
        return True
    return (
        len(labels) >= 3
        and labels[-3] == "google"
        and labels[-2] in ("co", "com", "org", "net")
    )
