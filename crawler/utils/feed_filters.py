"""Quality filters for feed-sourced articles.

Two checks that the Google News path has always had and the RSS/Alerts path
never did:

* ``is_blocked_domain`` - drop social posts, obituaries, job boards and other
  non-news hosts that search feeds surface alongside real articles. Google
  Alerts is the worst offender: a measured sample of its output was roughly
  two-thirds non-news (Facebook posts, an obituary, a rheumatology job listing,
  a recipe blog, SEO spam on a hijacked subdomain).
* ``is_too_old`` - enforce the freshness window. Google News applies this
  server-side via ``when:1d`` and Bing via ``qft=interval``, but a plain RSS or
  Google Alerts feed carries no time filter at all, so it must be applied here
  or the feed's whole rolling window gets stored on every poll.

Both are pure functions over stdlib + dateutil so any crawler service can
import them without dragging in the extraction stack.
"""

import os
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Domain blocklist
# ---------------------------------------------------------------------------
# Add entries here, or without a redeploy via FEED_BLOCKED_DOMAINS_EXTRA
# (comma-separated). Matching is on the registrable host AND its subdomains, so
# "facebook.com" also blocks "m.facebook.com" - but a more specific entry such
# as "messenger.eso.org" blocks only that host, leaving the parent domain alone.
BLOCKED_DOMAINS = frozenset({
    # --- social / user-generated -------------------------------------------
    "facebook.com",
    "x.com",
    "twitter.com",
    "instagram.com",
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "reddit.com",
    "linkedin.com",
    "pinterest.com",
    "threads.net",
    # --- obituaries / personal notices --------------------------------------
    "legacy.com",
    # --- classifieds / off-topic verticals -----------------------------------
    "realtor.com",
    # --- job boards ----------------------------------------------------------
    "indeed.com",
    "glassdoor.com",
    "ziprecruiter.com",
    "associationcareernetwork.com",
    # --- Q&A forums / content farms observed in live Alerts output ------------
    "ask-ayurveda.com",
    # Hijacked subdomain serving pharma SEO spam; the parent (eso.org, the
    # European Southern Observatory) is legitimate, so scope the block to the
    # one host.
    "messenger.eso.org",
})

# Turn the whole blocklist off (escape hatch for debugging a missing article).
_DISABLED = os.getenv("FEED_BLOCKED_DOMAINS_DISABLE", "").lower() in (
    "1", "true", "yes", "on")

# Default article age window in hours. Unlike the Google News path - which hard
# clamps to 24 - this is overridable in both directions, because the same RSS
# path also serves publisher feeds (PRNewswire, BioWorld) where a wider window
# is sometimes wanted. Set to 0 to disable the age filter entirely.
#
# Set to 48 rather than 24 because Google Alerts indexes with a lag: a live
# sample had six Kyverna Therapeutics articles and two Avalyn articles arriving
# 27-48h old, all of them genuinely relevant. A 24h window discarded the lot.
DEFAULT_MAX_AGE_HOURS = 0  # asset-journey: keep everything (history matters); was 48


def _extra_blocked() -> frozenset:
    """Blocklist additions from the environment, read fresh each call."""
    raw = os.getenv("FEED_BLOCKED_DOMAINS_EXTRA", "")
    return frozenset(
        d.strip().lower().lstrip(".") for d in raw.split(",") if d.strip()
    )


def blocked_domains() -> frozenset:
    """The effective blocklist: the built-in set plus any env additions."""
    return BLOCKED_DOMAINS | _extra_blocked()


def is_blocked_domain(url: str) -> bool:
    """True if ``url``'s host is blocklisted (exact host or a subdomain of one).

    A bare ``www.`` prefix is stripped first so "www.facebook.com" and
    "facebook.com" are treated as the same host.
    """
    if _DISABLED or not url:
        return False
    try:
        host = urlparse(url).netloc.split("@")[-1].split(":")[0].lower()
    except Exception:
        return False
    if not host:
        return False
    if host.startswith("www."):
        host = host[4:]
    for blocked in blocked_domains():
        if host == blocked or host.endswith("." + blocked):
            return True
    return False


def max_age_hours() -> int:
    """Configured age window, from RSS_MAX_ARTICLE_AGE_HOURS.

    Falls back to DEFAULT_MAX_AGE_HOURS (48) when unset or unparseable.
    """
    try:
        return int(os.getenv("RSS_MAX_ARTICLE_AGE_HOURS", str(DEFAULT_MAX_AGE_HOURS)))
    except (TypeError, ValueError):
        return DEFAULT_MAX_AGE_HOURS


def article_age_hours(published: Any) -> Optional[float]:
    """Age of ``published`` in hours, or None if it can't be determined.

    Accepts a datetime (naive datetimes are read as UTC, which is what
    feedparser's ``published_parsed`` produces) or a date string in any format
    dateutil can parse.
    """
    if published in (None, ""):
        return None

    parsed = published
    if not isinstance(parsed, datetime):
        try:
            import dateutil.parser
            parsed = dateutil.parser.parse(str(published))
        except Exception:
            return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - parsed).total_seconds() / 3600


def is_too_old(published: Any, max_hours: Optional[int] = None) -> bool:
    """True if the article falls outside the age window.

    Undated and unparseable articles are KEPT (returns False), matching the
    Google News path - a missing date is not evidence of staleness, and
    dropping them would silently discard feeds that omit pubDate.
    """
    limit = max_age_hours() if max_hours is None else max_hours
    if limit <= 0:
        return False
    age = article_age_hours(published)
    if age is None:
        return False
    return age > limit
