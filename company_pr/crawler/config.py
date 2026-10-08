"""Search configuration for the aggregator spiders.

Edit the lists below, or override any of them with a comma-separated
environment variable of the same name, e.g.

    SEARCH_KEYWORDS="IgA nephropathy,antifungal" python run.py -s google_news
"""

import os


def _env_list(name, default):
    raw = os.getenv(name)
    if raw:
        return [v.strip() for v in raw.split(",") if v.strip()]
    return list(default)


# Keywords used by google_news, prnewswire and globenewswire keyword searches.
SEARCH_KEYWORDS = _env_list(
    "SEARCH_KEYWORDS",
    [
        "IgA nephropathy",
        "lupus nephritis",
        "complement inhibitor",
        "antifungal",
        "antibiotic resistance",
        "invasive fungal infection",
    ],
)

# Keywords for the Basilea-focused searches (prnewswire_basilea,
# globenewswire_basilea).
BASILEA_KEYWORDS = _env_list(
    "BASILEA_KEYWORDS",
    [
        "Basilea Pharmaceutica",
        "isavuconazole",
        "ceftobiprole",
        "fosmanogepix",
        "antifungal",
        "antibacterial",
    ],
)

# GlobeNewswire search paths (https://www.globenewswire.com/en/search/<path>).
GLOBE_NEWS_SEARCH_PATHS = _env_list(
    "GLOBE_NEWS_SEARCH_PATHS",
    ["industry/Pharmaceuticals", "industry/Biotechnology"],
)

# Google Alerts RSS feed URLs (create alerts at google.com/alerts with
# "Deliver to: RSS feed"). The google_alerts spider is skipped when empty.
GOOGLE_ALERTS_RSS_URLS = _env_list("GOOGLE_ALERTS_RSS_URLS", [])
