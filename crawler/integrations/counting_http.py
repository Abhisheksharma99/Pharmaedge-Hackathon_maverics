"""patent_intel's Http client that reports every page it is asked for (cached or fetched): the live "pages checked"
count of the steps built on the team's crawlers (fda_calendar, patents)."""

from typing import Any, Callable, Optional, Tuple

from . import TEAM_ROOT  # noqa: F401  (puts the team packages on sys.path)
from patent_intel.net import MAX_ATTEMPTS, Cache, Http


class CountingHttp(Http):
    def __init__(self, cache: Cache, public_web: bool = False, on_page: Optional[Callable[[], None]] = None) -> None:
        super().__init__(cache, public_web=public_web)
        self.on_page = on_page or (lambda: None)

    async def get_html(self, url: str, ttl_s: float, ctype: Any = "html", headers: Any = None,
                       attempts: int = MAX_ATTEMPTS) -> Tuple[int, str]:
        try:
            return await super().get_html(url, ttl_s, ctype=ctype, headers=headers, attempts=attempts)
        finally:
            self.on_page()
