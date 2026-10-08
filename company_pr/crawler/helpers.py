"""Shared helpers: text cleaning, date parsing, page metadata, feed parsing."""

import hashlib
import html
import io
import json
import logging
import re
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

import dateparser
from lxml import etree
from lxml import html as lxml_html
from pypdf import PdfReader

logging.getLogger("pypdf").setLevel(logging.ERROR)

# --------------------------------------------------------------------------- #
# Text
# --------------------------------------------------------------------------- #

_DROP_TAGS = ["script", "style", "noscript", "svg", "iframe", "form", "button", "template"]
_BLOCK_TAGS = {
    "p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
    "tr", "table", "section", "article", "blockquote", "pre", "header",
    "footer", "figcaption", "dd", "dt", "hr",
}
_WS = re.compile(r"[ \t\r\f\v ​]+")


# C0 control characters (lxml rejects them) and Unicode line/para separators.
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_LINE_SEPS = re.compile(r"[\u2028\u2029\u0085]")


def _sanitize(value):
    return _CONTROL.sub("", _LINE_SEPS.sub("\n", value))


def clean_text(value):
    """Collapse whitespace and unescape entities in a short string (titles etc.)."""
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        value = " ".join(v for v in value if v)
    value = _sanitize(html.unescape(str(value)))
    value = _WS.sub(" ", value.replace("\n", " ")).strip()
    return value or None


def html_to_text(value):
    """Convert an HTML fragment to readable plain text, keeping paragraph breaks."""
    if not value:
        return None
    if isinstance(value, (list, tuple)):
        value = "\n".join(v for v in value if v)
    value = _sanitize(str(value))
    if "<" not in value:
        text = _sanitize(html.unescape(value))
    else:
        try:
            root = lxml_html.fromstring(value)
        except (etree.ParserError, ValueError):
            return clean_text(value)
        for bad in root.xpath("|".join(f"//{t}" for t in _DROP_TAGS)):
            bad.drop_tree()
        for el in root.iter():
            if isinstance(el.tag, str) and el.tag.lower() in _BLOCK_TAGS:
                el.tail = "\n" + (el.tail or "")
        text = _sanitize(root.text_content())
    lines = [_WS.sub(" ", line).strip() for line in text.split("\n")]
    text = "\n".join(line for line in lines if line)
    return text or None


def pdf_to_text(body, max_pages=40):
    """Plain text of a (text-based) PDF press release, or None if it has none."""
    try:
        reader = PdfReader(io.BytesIO(body))
        raw = "\n".join((page.extract_text() or "") for page in reader.pages[:max_pages])
    except Exception:
        return None
    # pypdf yields one line per printed line; re-join wrapped sentences.
    out = []
    for line in (_WS.sub(" ", l).strip() for l in raw.splitlines()):
        if not line:
            continue
        prev = out[-1] if out else ""
        if prev.endswith("-") and line[:1].islower():
            out[-1] = prev[:-1] + line
        elif prev and not prev.endswith((".", ":", "!", "?", ";", '"', "”")) and line[:1].islower():
            out[-1] = prev + " " + line
        else:
            out.append(line)
    return "\n".join(out) or None


def url_id(url):
    return hashlib.md5(url.encode("utf-8")).hexdigest()


def domain_name(url):
    """'https://www.fiercepharma.com/x' -> 'fiercepharma'."""
    parts = urlparse(url).netloc.lower().split(":")[0].split(".")
    parts = [p for p in parts if p not in ("www", "m", "amp")]
    if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net", "ac", "gov"):
        return parts[-3]
    return parts[-2] if len(parts) >= 2 else (parts[0] if parts else None)


# --------------------------------------------------------------------------- #
# Dates
# --------------------------------------------------------------------------- #

_DATE_NOISE = re.compile(
    r"\b(published|posted|updated|last updated|release date|date|on|press release|"
    r"news release)\b\s*[:|]?",
    re.I,
)
_CJK_DATE = re.compile(r"(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})")
_ISO_DATE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_MONTHS = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_MONTH_FIRST = re.compile(rf"\b{_MONTHS}\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{{2}}\b", re.I)
_DAY_FIRST = re.compile(rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+{_MONTHS},?\s+(?:19|20)\d{{2}}\b", re.I)
_YEAR_IN = re.compile(r"\b(?:19|20)\d{2}\b")
_RFC822_DATE = re.compile(r"^(\w{3}, )?\d{1,2} \w{3} \d{4} \d{2}:\d{2}")


def parse_date(value, date_order=None, languages=None):
    """Parse almost any date representation into 'YYYY-MM-DD' (or None)."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        ts = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
    if isinstance(value, (list, tuple)):
        for v in value:
            parsed = parse_date(v, date_order, languages)
            if parsed:
                return parsed
        return None

    text = clean_text(value)
    if not text:
        return None
    if text.isdigit() and len(text) in (10, 13):
        return parse_date(int(text))
    m = _ISO_DATE.search(text)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            pass
    if _RFC822_DATE.match(text):  # RSS pubDate; much faster than dateparser
        try:
            return parsedate_to_datetime(text).date().isoformat()
        except (TypeError, ValueError):
            pass
    m = _CJK_DATE.search(text)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            pass

    settings = {"PREFER_DAY_OF_MONTH": "first", "RETURN_AS_TIMEZONE_AWARE": False}
    if date_order:
        settings["DATE_ORDER"] = date_order
    candidates = [text, _DATE_NOISE.sub(" ", text).strip(" |,-")]
    for cand in candidates:
        if not cand:
            continue
        parsed = dateparser.parse(cand, languages=languages, settings=settings)
        if parsed and 1990 <= parsed.year <= datetime.now().year + 1:
            return parsed.date().isoformat()
    # A full English date inside a longer string ("Basel, 3 March 2025 – ...").
    m = _MONTH_FIRST.search(text) or _DAY_FIRST.search(text)
    if m:
        parsed = dateparser.parse(m.group(0), languages=["en"], settings=settings)
        if parsed and 1990 <= parsed.year <= datetime.now().year + 1:
            return parsed.date().isoformat()
    # Last resort: let dateparser search, preferring matches that name a year.
    try:
        from dateparser.search import search_dates

        found = search_dates(text[:200], languages=languages, settings=settings)
    except Exception:
        found = None
    found = sorted(found or [], key=lambda f: not _YEAR_IN.search(f[0]))
    for _, parsed in found:
        if 1990 <= parsed.year <= datetime.now().year + 1:
            return parsed.date().isoformat()
    return None


# --------------------------------------------------------------------------- #
# Page metadata fallbacks
# --------------------------------------------------------------------------- #

_TITLE_XPATHS = [
    '//meta[@property="og:title"]/@content',
    '//meta[@name="twitter:title"]/@content',
    "//h1//text()",
    "//title/text()",
]
_DATE_XPATHS = [
    '//meta[@property="article:published_time"]/@content',
    '//meta[@name="article:published_time"]/@content',
    '//meta[@property="og:published_time"]/@content',
    '//meta[@name="publish-date"]/@content',
    '//meta[@name="publish_date"]/@content',
    '//meta[@name="date"]/@content',
    '//meta[@name="dc.date"]/@content',
    '//meta[@name="DC.date.issued"]/@content',
    '//meta[@itemprop="datePublished"]/@content',
    '//*[@itemprop="datePublished"]/@datetime',
    '//*[@itemprop="datePublished"]/@content',
    "//time/@datetime",
]
_CONTENT_XPATHS = [
    '//*[@itemprop="articleBody"]',
    "//article",
    '//*[@role="main"]',
    "//main",
]


def _json_ld_objects(response):
    for raw in response.xpath('//script[@type="application/ld+json"]/text()').getall():
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        stack = [data]
        while stack:
            obj = stack.pop()
            if isinstance(obj, list):
                stack.extend(obj)
            elif isinstance(obj, dict):
                yield obj
                stack.extend(v for v in obj.values() if isinstance(v, (list, dict)))


def fallback_title(response):
    for xp in _TITLE_XPATHS:
        value = clean_text(response.xpath(xp).get())
        if value:
            return value
    return None


def fallback_date(response):
    for obj in _json_ld_objects(response):
        for key in ("datePublished", "dateCreated", "uploadDate"):
            if obj.get(key):
                return obj[key]
    for xp in _DATE_XPATHS:
        value = response.xpath(xp).get()
        if value and value.strip():
            return value.strip()
    return None


def fallback_content(response):
    """Best-effort article body: the main container's paragraphs."""
    for xp in _CONTENT_XPATHS:
        for node in response.xpath(xp):
            paras = node.xpath(".//p")
            text = "\n".join(p.get() for p in paras)
            if len(html_to_text(text) or "") > 200:
                return text
    paras = response.xpath("//body//p").getall()
    return "\n".join(paras) or None


# --------------------------------------------------------------------------- #
# Sitemaps / RSS / Atom
# --------------------------------------------------------------------------- #


def parse_feed(body):
    """Parse a sitemap, sitemap index, RSS or Atom document.

    Returns ``(kind, entries)`` where kind is "index" or "urls" and entries are
    ``(url, date_string_or_None, title_or_None)`` tuples.
    """
    parser = etree.XMLParser(recover=True, resolve_entities=False, huge_tree=True)
    root = etree.fromstring(body.strip() if isinstance(body, bytes) else body.strip().encode(), parser)
    if root is None:
        return "urls", []

    def local(el):
        return etree.QName(el).localname.lower() if isinstance(el.tag, str) else ""

    def child_text(el, *names):
        """Text of the first descendant matching, trying ``names`` in order."""
        for name in names:
            for child in el.iter():
                if local(child) == name and (child.text or "").strip():
                    return child.text.strip()
        return None

    kind = local(root)
    entries = []
    if kind == "sitemapindex":
        for sm in root:
            if local(sm) == "sitemap":
                loc = child_text(sm, "loc")
                if loc:
                    entries.append((loc, child_text(sm, "lastmod"), None))
        return "index", entries
    if kind == "urlset":
        for u in root:
            if local(u) == "url":
                loc = child_text(u, "loc")
                if loc:
                    entries.append(
                        (loc, child_text(u, "publication_date", "lastmod"), child_text(u, "title"))
                    )
        return "urls", entries
    # RSS (<rss><channel><item>) or Atom (<feed><entry>)
    for item in root.iter():
        name = local(item)
        if name == "item":
            link = child_text(item, "link", "guid")
            if link:
                entries.append(
                    (link, child_text(item, "pubdate", "date", "published", "updated"),
                     child_text(item, "title"))
                )
        elif name == "entry":
            link = None
            for child in item:
                if local(child) == "link" and child.get("href"):
                    if child.get("rel") in (None, "alternate"):
                        link = child.get("href")
                        break
            link = link or child_text(item, "id")
            if link:
                entries.append(
                    (link, child_text(item, "published", "updated"), child_text(item, "title"))
                )
    return "urls", entries
