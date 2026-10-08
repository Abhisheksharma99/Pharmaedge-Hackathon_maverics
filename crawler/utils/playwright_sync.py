"""
Leak-proof wrapper around Playwright's sync_playwright().

PlaywrightContextManager.__enter__ creates a private event loop and only
closes it in __exit__ - but a `with` statement never calls __exit__ when
__enter__ itself raises. That is exactly what happens when the Node driver
fails to start ("'PlaywrightContextManager' object has no attribute
'_playwright'"), so every failed start leaked one event loop. Under uvloop a
leaked loop is never freed (its __dealloc__ only logs), and each one pins 5
fds (epoll, eventfd, signal pipe pair, /dev/null). In prod 2026-10-02 the
last live worker hit its 1024-fd limit this way: health checks got
"connection reset", every HTTP fetch failed with EMFILE / curl (27), and the
container sat unhealthy with nothing crawling.
"""
from contextlib import contextmanager
from typing import Iterator


def _close_own_loop(cm) -> None:
    """Close the loop sync_playwright() created, if it still owns an open one."""
    loop = getattr(cm, "_loop", None)
    if loop is None or not getattr(cm, "_own_loop", False):
        return
    try:
        if not loop.is_closed() and not loop.is_running():
            loop.close()
    except Exception:
        pass


@contextmanager
def safe_sync_playwright() -> Iterator["object"]:
    """Drop-in replacement for `with sync_playwright() as p:`.

    Same behaviour on success; on a failed start or a failed stop the private
    event loop is still closed, so a flaky driver can't exhaust the worker's fds.
    """
    from playwright.sync_api import sync_playwright

    cm = sync_playwright()
    try:
        p = cm.__enter__()
    except BaseException:
        _close_own_loop(cm)
        raise

    try:
        yield p
    finally:
        try:
            cm.__exit__(None, None, None)
        except Exception:
            pass
        finally:
            # __exit__ closes the loop itself, unless stop_sync() raised first.
            _close_own_loop(cm)
