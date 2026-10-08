"""
United Therapeutics (unither.com) crawler - the company behind Tyvaso,
Remodulin and Orenitram (treprostinil).

Collects three kinds of company records:
  company_page       - product / research / history pages from www.unither.com
  prescribing_info   - prescribing information / instructions-for-use PDFs
  annual_report      - annual report PDFs
  company_document   - other PDFs linked from those pages (e.g. pre-2007 releases)
  press_release      - every release on ir.unither.com/press-releases, dated

Each record gets `mentions`: which of the asset's names appear in it, so the
treprostinil-relevant subset is one filter away. robots.txt allows all paths.
"""

import re
import time
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

import trafilatura
from bs4 import BeautifulSoup
from curl_cffi import requests

from services.pdf_extractor_service import PDFExtractorService

SITE = "https://www.unither.com"
IR_SITE = "https://ir.unither.com"
# Sitemap sections with product / pipeline / company-history content
PAGE_PATTERN = re.compile(r"/research-and-medicine/|/about-us/(history|subsidiaries)$")
REQUEST_DELAY = 1.0
SOURCE = "united_therapeutics"


def _get(url: str) -> Optional[str]:
    time.sleep(REQUEST_DELAY)
    resp = requests.get(url, impersonate="chrome110", timeout=60)
    return resp.text if resp.status_code == 200 else None


def _mentions(text: str, names: List[str]) -> List[str]:
    return [n for n in names if re.search(rf"\b{re.escape(n)}\b", text, re.I)]


def _pdf_type(filename: str) -> str:
    name = filename.lower()
    if "annual-report" in name:
        return "annual_report"
    if re.search(r"(^|[-_])(pi|ppi)[-_.]|prescribing|instructions", name):
        return "prescribing_info"
    return "company_document"


def _page_record(record_type: str, url: str, title: str, content: str,
                 date: str, names: List[str], **extra) -> Dict[str, Any]:
    return {
        "record_key": f"{SOURCE}:{record_type}:{url}",
        "record_type": record_type,
        "source": SOURCE,
        "date": date,
        "url": url,
        "title": title,
        "content": content,
        "mentions": _mentions(f"{title} {content}", names),
        **extra,
    }


def crawl_site_pages(names: List[str]) -> List[Dict[str, Any]]:
    """Product / research pages from the sitemap, plus the PDFs they link."""
    sitemap = _get(f"{SITE}/sitemap.xml") or ""
    urls = [u for u in re.findall(r"<loc>([^<]+)</loc>", sitemap) if PAGE_PATTERN.search(u)]
    records, pdf_urls = [], {}
    for url in urls:
        html = _get(url)
        if not html:
            continue
        soup = BeautifulSoup(html, "html.parser")
        title = soup.title.get_text(strip=True) if soup.title else url
        content = trafilatura.extract(html, include_tables=True) or ""
        pdfs = sorted({urljoin(url, a["href"]) for a in soup.select("a[href]")
                       if ".pdf" in a["href"].lower()})
        for pdf in pdfs:
            pdf_urls.setdefault(pdf, url)
        # Site pages carry no publish date; record when we saw them
        records.append(_page_record("company_page", url, title, content,
                                    datetime.now().date().isoformat(), names, pdf_links=pdfs))

    extractor = PDFExtractorService()
    for pdf, found_on in pdf_urls.items():
        result = extractor.download_and_extract(pdf, save_locally=False, referer=found_on)
        if not result.get("success"):
            continue
        name = pdf.rsplit("/", 1)[-1]
        records.append(_page_record(_pdf_type(name), pdf, name, result.get("text", ""),
                                    datetime.now().date().isoformat(), names, found_on=found_on))
    return records


def _release_links(page: int) -> Dict[str, Dict[str, str]]:
    """url -> {title, date} from one listing page. The listing card's date
    ("30 Sep 2026") is used because release URLs mix MM-DD and DD-MM order."""
    html = _get(f"{IR_SITE}/press-releases?page={page}") or ""
    soup = BeautifulSoup(html, "html.parser")
    releases = {}
    for card in soup.select("[class*=press_release_card]"):
        link = card.select_one("a[href*='/press-releases/']")
        date_el = card.select_one("[class*=press_release_Date]")
        if not link or not re.match(r"/press-releases/\d{4}/", link["href"]):
            continue
        m = re.search(r"\d{1,2} [A-Z][a-z]{2} \d{4}", date_el.get_text(" ", strip=True) if date_el else "")
        releases[urljoin(IR_SITE, link["href"])] = {
            "title": link.get_text(" ", strip=True),
            "date": datetime.strptime(m.group(0), "%d %b %Y").date().isoformat() if m else "",
        }
    return releases


def crawl_press_releases(names: List[str], max_pages: int = 100) -> Iterable[Dict[str, Any]]:
    """Every press release, newest first. Yields so callers can save as it goes."""
    seen = set()
    for page in range(1, max_pages + 1):
        links = {u: meta for u, meta in _release_links(page).items() if u not in seen}
        if not links:
            break
        for url, meta in links.items():
            seen.add(url)
            html = _get(url)
            if not html:
                continue
            soup = BeautifulSoup(html, "html.parser")
            # Body only: the page also carries a "Recent Press Releases" sidebar
            # whose titles and dates would otherwise leak into every release.
            body = soup.select_one(".content_desc")
            title_el = soup.select_one(".content_title")
            content = body.get_text("\n", strip=True) if body else ""
            title = title_el.get_text(" ", strip=True) if title_el else meta["title"]
            pdf = next((urljoin(IR_SITE, a["href"]) for a in soup.select("a[href]")
                        if ".pdf" in a["href"].lower() and "press-releases" in a["href"]), None)
            yield _page_record("press_release", url, title, content,
                               meta["date"], names, pdf_url=pdf)
