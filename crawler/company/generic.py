"""
Generic company-website crawler (spec §5.5), for every company without a site adapter
(adapters such as unither.py always win).

What a company site says about one drug sits in a few places: product pages, the PDFs
they link (prescribing information, annual reports) and the press-release listing.
Sitemaps name product pages in their URLs, so pages are found by a slug of one of the
asset's names in the path (or in homepage link text), then product / pipeline pages.
Only pages and documents that mention the asset are kept. Press releases are read here
only when the company has no newsroom spider (company_news covers those).

Best effort throughout: a page that fails to load is skipped, and caps keep a crawl to
a few minutes. Records follow the shared contract with the same key scheme as unither.py.
"""

import html as html_lib
import io
import re
import time
from datetime import date
from typing import Any, Dict, Iterator, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import trafilatura
from bs4 import BeautifulSoup
from curl_cffi import requests
from pypdf import PdfReader

from journey.store import asset_id as slug

MAX_SITEMAPS = 12   # sitemap files read; indexes can list hundreds
MAX_PAGES = 25
MAX_PDFS = 12
MAX_RELEASES = 20
MAX_PDF_BYTES = 25_000_000
REQUEST_DELAY = 0.5
# PDFs worth reading even when they don't name the drug in their URL or link text
DOCUMENT_HINT = re.compile(r"prescrib|label|(^|[^a-z])(p?pi|ifu)([^a-z]|$)|package.?insert|annual|10-?k", re.I)
PRODUCT_HINT = re.compile(r"product|pipeline|medicine|portfolio", re.I)
NOT_A_PAGE = re.compile(r"\.(pdf|jpe?g|png|gif|svg|webp|zip|xlsx?|docx?|pptx?|mp4|mp3)$", re.I)
# Press releases: company_news (newsroom spider) or the IR listing reader below, never twice as pages
NEWS_PATH = re.compile(r"/(news|newsroom|press|press-releases?|news-releases?|media)(/|$)", re.I)


def _get(url: str, timeout: int = 20) -> Optional[str]:
    time.sleep(REQUEST_DELAY)
    try:
        resp = requests.get(url, impersonate="chrome", timeout=timeout)
    except Exception:  # DNS, TLS, timeouts: skip the page
        return None
    return resp.text if resp.status_code == 200 else None


def _pdf_text(url: str, referer: str) -> Optional[str]:
    """One bounded attempt: a slow or broken document must not hold up the crawl."""
    time.sleep(REQUEST_DELAY)
    try:
        resp = requests.get(url, impersonate="chrome", timeout=45, headers={"Referer": referer})
        if resp.status_code != 200 or not resp.content.startswith(b"%PDF") or len(resp.content) > MAX_PDF_BYTES:
            return None
        return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(resp.content)).pages)
    except Exception:  # network errors, encrypted or malformed PDFs
        return None


def _host(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def _same_site(url: str, domain: str) -> bool:
    host = _host(url)
    return bool(domain) and (host == domain or host.endswith("." + domain))


def _has_name_slug(text: str, slugs: List[str]) -> bool:
    """A name as whole words of a URL path or link text ("/products/tyvaso-dpi/" has "tyvaso-dpi")."""
    padded = f"-{slug(text)}-"
    return any(f"-{s}-" in padded for s in slugs)


def _mentions(text: str, names: List[str]) -> List[str]:
    return [n for n in names if re.search(rf"\b{re.escape(n)}\b", text, re.I)]


def _links(html: str, base: str) -> List[Tuple[str, str]]:
    """(absolute URL without fragment, link text) for every link on a page."""
    soup = BeautifulSoup(html, "html.parser")
    return [(urljoin(base, a["href"]).split("#")[0], a.get_text(" ", strip=True)) for a in soup.select("a[href]")]


def _title(html: str, fallback: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    return soup.title.get_text(strip=True) if soup.title and soup.title.get_text(strip=True) else fallback


def _pdf_type(text: str) -> str:
    text = text.lower()
    if re.search(r"annual|10-?k", text):
        return "annual_report"
    if re.search(r"prescrib|label|(^|[^a-z])(p?pi|ifu)([^a-z]|$)|package.?insert|instructions", text):
        return "prescribing_info"
    return "company_document"


def _sitemap_urls(site: str) -> List[str]:
    """Page URLs from the sitemaps robots.txt lists (else /sitemap.xml), following sitemap indexes."""
    robots = _get(f"{site}/robots.txt") or ""
    todo = re.findall(r"(?im)^\s*sitemap:\s*(\S+)", robots) or [f"{site}/sitemap.xml"]
    urls: List[str] = []
    for _ in range(MAX_SITEMAPS):
        if not todo:
            break
        xml = _get(todo.pop(0)) or ""
        locs = [html_lib.unescape(u) for u in re.findall(r"<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)", xml)]
        if "<sitemapindex" in xml:
            todo.extend(u for u in locs if not u.endswith(".gz"))  # gzipped sitemaps aren't worth the bytes
        else:
            urls.extend(locs)
    return urls


def _product_pages(site: str, domain: str, slugs: List[str]) -> List[str]:
    """Same-site pages from the sitemap and the homepage links: those named after the drug first, then product /
    pipeline pages (smaller companies describe their drugs on one "Pipeline & Products" page)."""
    links = [(u, "") for u in _sitemap_urls(site)] + _links(_get(site) or "", site)
    links = [(u, f"{urlparse(u).path} {text}") for u, text in links if _same_site(u, domain)
             and urlparse(u).path.strip("/") and not NOT_A_PAGE.search(urlparse(u).path)
             and not NEWS_PATH.search(urlparse(u).path)]
    named = [u for u, hint in links if _has_name_slug(hint, slugs)]
    products = [u for u, hint in links if PRODUCT_HINT.search(hint)]
    return list(dict.fromkeys(named + products))[:MAX_PAGES]


def _press_releases(ir_url: str, domain: str, slugs: List[str]) -> Iterator[Tuple[str, str, str, str]]:
    """(url, title, content, date) of releases linked from the listing page whose link text names the drug."""
    listing = _get(ir_url) or ""
    links: Dict[str, str] = {}
    for url, text in _links(listing, ir_url):
        on_site = _same_site(url, domain) or _same_site(url, _host(ir_url))
        if on_site and url != ir_url and not NOT_A_PAGE.search(urlparse(url).path) and _has_name_slug(text, slugs):
            links.setdefault(url, text)
    for url, text in list(links.items())[:MAX_RELEASES]:
        html = _get(url)
        if not html:
            continue
        doc = trafilatura.bare_extraction(html, url=url, include_tables=True) or {}  # metadata: title, date
        yield url, doc.get("title") or text, doc.get("text") or "", (doc.get("date") or "")[:10]


def crawl(company: Dict[str, Any], names: List[str], press_releases: bool) -> List[Dict[str, Any]]:
    """Product pages, linked documents and (with press_releases) IR releases that mention the asset."""
    parsed = urlparse(company["website"])
    site, domain = f"{parsed.scheme or 'https'}://{parsed.netloc}", _host(company["website"])
    slugs = [s for s in (slug(n) for n in names) if s]
    today = date.today().isoformat()  # site pages and documents carry no publish date: record when we saw them

    def record(record_type: str, url: str, title: str, content: str, when: str, **extra) -> Dict[str, Any]:
        return {"record_key": f"{domain}:{record_type}:{url}", "record_type": record_type, "source": domain,
                "company": company.get("name"), "date": when, "url": url, "title": title, "content": content,
                "mentions": _mentions(f"{title} {content}", names), **extra}

    records: List[Dict[str, Any]] = []
    pdfs: Dict[str, Tuple[str, str, bool]] = {}  # pdf url -> (page it was found on, link text, names the drug)
    for url in _product_pages(site, domain, slugs):
        html = _get(url)
        if not html:
            continue
        title, content = _title(html, url), trafilatura.extract(html, include_tables=True) or ""
        if not _mentions(f"{title} {content}", names):
            continue
        records.append(record("company_page", url, title, content, today))
        for link, text in _links(html, url):
            path = urlparse(link).path
            named = _has_name_slug(f"{path} {text}", slugs)
            if path.lower().endswith(".pdf") and (named or DOCUMENT_HINT.search(f"{path} {text}")):
                pdfs.setdefault(link, (url, text, named))

    # Documents named after the drug first: a products page links every product's prescribing information.
    for pdf, (found_on, text, _) in sorted(pdfs.items(), key=lambda item: not item[1][2])[:MAX_PDFS]:
        content = _pdf_text(pdf, found_on) or ""
        if _mentions(content, names):
            filename = pdf.rsplit("/", 1)[-1]
            records.append(record(_pdf_type(f"{filename} {text}"), pdf, filename, content, today, found_on=found_on))

    if press_releases and company.get("ir_url"):
        for url, title, content, when in _press_releases(company["ir_url"], domain, slugs):
            records.append(record("press_release", url, title, content, when))
    return records
