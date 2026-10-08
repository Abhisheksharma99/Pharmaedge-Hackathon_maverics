"""HTTP(S) download handler that can fetch through curl_cffi.

Some sites (Cloudflare/Akamai/DataDome protected) reject Scrapy's TLS
fingerprint. A request is fetched with curl_cffi, impersonating a real
browser, when either

* ``request.meta["impersonate"]`` is set (e.g. ``"chrome"``, ``"safari"``), or
* the spider has a class attribute ``impersonate = "chrome"``.

``request.meta["impersonate"] = False`` opts a single request out; everything
else goes through Scrapy's normal HTTP/1.1 handler.

Being a download handler (not a middleware), it runs inside Scrapy's download
slots, so DOWNLOAD_DELAY, CONCURRENT_REQUESTS_PER_DOMAIN and AutoThrottle apply
to impersonated requests too. Bot protection sometimes flags one long-lived
session while a fresh one is served fine, so after a few consecutive refusals
(401/403/429) the curl_cffi session is replaced and the request retried once;
after a connection error the session is replaced before Scrapy retries.
"""

import asyncio
import base64
from urllib.parse import quote, urlsplit, urlunsplit

from curl_cffi import requests as curl_requests
from curl_cffi.requests.exceptions import RequestException
from scrapy.core.downloader.handlers.base import BaseDownloadHandler
from scrapy.core.downloader.handlers.http11 import HTTP11DownloadHandler
from scrapy.http import Headers
from scrapy.responsetypes import responsetypes

# Headers that curl_cffi sets itself to match the impersonated browser. Cookies
# live in the curl session's own jar, so replacing a flagged session also drops
# the bot-protection cookies (Akamai/DataDome) that got it flagged.
_SKIP_REQUEST_HEADERS = {b"user-agent", b"accept-encoding", b"connection", b"cookie"}
# curl_cffi already decoded the body, so these would be wrong downstream.
_SKIP_RESPONSE_HEADERS = {"content-encoding", "content-length", "transfer-encoding"}
_REFUSED = {401, 403, 429}
_REFUSALS_BEFORE_RESET = 3


class ImpersonateDownloadHandler(BaseDownloadHandler):
    def __init__(self, crawler):
        super().__init__(crawler)
        self._http = HTTP11DownloadHandler(crawler)
        self._session = None
        self._refusals = 0

    def _browser_for(self, request):
        browser = request.meta.get("impersonate")
        if browser is None:
            browser = getattr(self.crawler.spider, "impersonate", None)
        if browser is True:
            browser = "chrome"
        return browser or None

    async def download_request(self, request):
        browser = self._browser_for(request)
        if not browser:
            return await self._http.download_request(request)

        resp = await self._fetch(request, browser)
        if resp.status_code in _REFUSED:
            self._refusals += 1
            if self._refusals >= _REFUSALS_BEFORE_RESET:
                self.crawler.spider.logger.info(
                    f"{self._refusals} refusals in a row; starting a new browser session"
                )
                self.crawler.stats.inc_value("pr/impersonate/session_reset")
                await self._reset_session()
                resp = await self._fetch(request, browser)
        if resp.status_code not in _REFUSED:
            self._refusals = 0
        return _to_scrapy_response(resp, request)

    async def _fetch(self, request, browser):
        if self._session is None:
            self._session = curl_requests.AsyncSession(max_clients=16)
        headers = {
            k.decode(): b", ".join(v).decode("latin-1")
            for k, v in request.headers.items()
            if k.lower() not in _SKIP_REQUEST_HEADERS
        }
        proxy = _proxy_url(request.meta.get("proxy"), headers.pop("Proxy-Authorization", None))
        timeout = request.meta.get(
            "download_timeout", self.crawler.settings.getfloat("DOWNLOAD_TIMEOUT", 40)
        )
        try:
            # curl's own timeout can fail to fire on a broken HTTP/2
            # connection, so also bound the whole call.
            return await asyncio.wait_for(
                self._session.request(
                    request.method,
                    request.url,
                    headers=headers,
                    data=request.body or None,
                    impersonate=browser,
                    timeout=timeout,
                    allow_redirects=True,
                    proxy=proxy,
                ),
                timeout + 15,
            )
        except (RequestException, asyncio.TimeoutError) as exc:
            # A reset/broken connection poisons the session's connection pool,
            # so start a new one; OSError subclasses are retried by Scrapy.
            await self._reset_session()
            raise ConnectionError(f"curl_cffi failed for {request.url}: {exc}") from exc

    async def _reset_session(self):
        session, self._session = self._session, None
        self._refusals = 0
        if session is not None:
            try:  # a broken session may not close cleanly either
                await asyncio.wait_for(session.close(), 10)
            except Exception:
                pass

    async def close(self):
        await self._reset_session()
        await self._http.close()


def _to_scrapy_response(resp, request):
    headers = Headers()
    for key, value in resp.headers.multi_items():
        if key.lower() not in _SKIP_RESPONSE_HEADERS:
            headers.appendlist(key, value)
    body = resp.content or b""
    cls = responsetypes.from_args(headers=headers, url=resp.url, body=body)
    return cls(url=str(resp.url), status=resp.status_code, headers=headers, body=body, request=request)


def _proxy_url(proxy, authorization):
    """Scrapy's HttpProxyMiddleware moves proxy credentials into a
    Proxy-Authorization header; curl_cffi needs them back in the proxy URL
    (sent as a normal header they would go to the target site)."""
    if not proxy or not authorization or not authorization.lower().startswith("basic "):
        return proxy
    creds = base64.b64decode(authorization[6:].strip()).decode("latin-1")
    user, _, password = creds.partition(":")
    parts = urlsplit(proxy)
    netloc = f"{quote(user, safe='')}:{quote(password, safe='')}@{parts.netloc.rsplit('@', 1)[-1]}"
    return urlunsplit(parts._replace(netloc=netloc))
