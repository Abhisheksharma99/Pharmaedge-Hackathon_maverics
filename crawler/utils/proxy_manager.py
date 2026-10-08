"""
Proxy Manager
Centralizes residential-proxy (e.g. Decodo) configuration so every fetch path -
the remote browser broker, local Playwright, and plain requests/curl-cffi - builds
its proxy the same way.

Supports "sticky sessions": each crawl gets its own session token appended to the
proxy username so one crawl keeps one upstream IP, while different crawls running
concurrently get different IPs. This is what lets us run 150-200 crawlers at once
without all of them sharing (and getting one) IP banned.

Environment variables (kept compatible with the existing news/rss services):
    RESIDENTIAL_PROXY   Full pre-built proxy URL. If set, used verbatim
                        (sticky sessions are NOT applied to a pre-built URL).
    PROXY_USERNAME      Base username, e.g. "user-pharmaedge-sessionduration-2"
    PROXY_PASSWORD      Proxy password
    PROXY_HOST          Proxy gateway host (default: gate.decodo.com)
    PROXY_PORT          Proxy gateway port (default: 10001)
    PROXY_ENABLED       "false" to disable proxying even when creds are present
    PROXY_STICKY        "false" to disable sticky sessions (rotate IP per request)
"""

import os
import random
import string
from typing import Dict, Optional
from urllib.parse import urlparse, quote


def _truthy(value: str, default: bool = True) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


class ProxyManager:
    """Builds proxy URLs/configs from environment, with optional sticky sessions."""

    def __init__(self):
        self.full_url = os.getenv("RESIDENTIAL_PROXY", "").strip()
        self.username = os.getenv("PROXY_USERNAME", "").strip()
        self.password = os.getenv("PROXY_PASSWORD", "").strip()
        self.host = os.getenv("PROXY_HOST", "gate.decodo.com").strip()
        self.port = os.getenv("PROXY_PORT", "10001").strip()
        self.enabled = _truthy(os.getenv("PROXY_ENABLED", ""), default=True)
        self.sticky = _truthy(os.getenv("PROXY_STICKY", ""), default=True)

    @property
    def is_configured(self) -> bool:
        """True if a proxy can actually be built and proxying is enabled."""
        if not self.enabled:
            return False
        return bool(self.full_url or (self.username and self.password))

    @staticmethod
    def new_session_token(length: int = 8) -> str:
        """Generate a random sticky-session token (one per crawl)."""
        alphabet = string.ascii_lowercase + string.digits
        return "".join(random.choice(alphabet) for _ in range(length))

    def _session_username(self, session_token: Optional[str]) -> str:
        """Append the Decodo sticky-session suffix to the base username."""
        if session_token and self.sticky:
            return f"{self.username}-session-{session_token}"
        return self.username

    def proxy_url(self, session_token: Optional[str] = None) -> str:
        """
        Full proxy URL with embedded credentials (used by the broker /launch
        payload and by requests/curl-cffi). Returns "" when not configured.
        """
        if not self.is_configured:
            return ""
        # A pre-built URL is used as-is; we can't safely splice a session token in.
        if self.full_url:
            return self.full_url
        user = quote(self._session_username(session_token), safe="")
        pwd = quote(self.password, safe="")
        return f"http://{user}:{pwd}@{self.host}:{self.port}"

    def playwright_proxy(self, session_token: Optional[str] = None) -> Optional[Dict[str, str]]:
        """
        Proxy config dict for playwright's launch(proxy=...) (local fallback path).
        Returns None when not configured.
        """
        if not self.is_configured:
            return None
        if self.full_url:
            parsed = urlparse(self.full_url)
            server = f"{parsed.scheme}://{parsed.hostname}"
            if parsed.port:
                server += f":{parsed.port}"
            cfg = {"server": server}
            if parsed.username:
                cfg["username"] = parsed.username
            if parsed.password:
                cfg["password"] = parsed.password
            return cfg
        return {
            "server": f"http://{self.host}:{self.port}",
            "username": self._session_username(session_token),
            "password": self.password,
        }

    def requests_proxies(self, session_token: Optional[str] = None) -> Optional[Dict[str, str]]:
        """Proxy dict for requests/curl-cffi ({'http': ..., 'https': ...})."""
        url = self.proxy_url(session_token)
        if not url:
            return None
        return {"http": url, "https": url}

    @staticmethod
    def is_google_host(url: str) -> bool:
        """True if the URL points at any Google property.

        Matches every ccTLD form - google.com, google.co.in, google.co.uk,
        news.google.com - not just google.com, because Google Alerts hands out
        feed URLs on the user's local domain (e.g. www.google.co.in/alerts/feeds/...).
        """
        try:
            host = urlparse(url).netloc.split("@")[-1].split(":")[0].lower()
        except Exception:
            return False
        if not host:
            return False
        labels = host.split(".")
        # google.<tld> (google.com) or google.<sld>.<tld> (google.co.in),
        # with any subdomain prefix (news.google.com, www.google.co.uk).
        if len(labels) >= 2 and labels[-2] == "google":
            return True
        return (
            len(labels) >= 3
            and labels[-3] == "google"
            and labels[-2] in ("co", "com", "org", "net")
        )

    def requests_proxies_for(
        self, url: str, session_token: Optional[str] = None
    ) -> Optional[Dict[str, str]]:
        """Proxy dict chosen per-URL.

        The Decodo residential plan rejects CONNECT to every Google domain with
        HTTP 403 ("Received HTTP code 403 from proxy after CONNECT"), so Google
        URLs must be fetched DIRECT from the egress IP. Everything else keeps the
        sticky per-crawl residential IP.
        """
        if self.is_google_host(url):
            return None
        return self.requests_proxies(session_token)
