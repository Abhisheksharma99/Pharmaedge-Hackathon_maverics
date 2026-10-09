"""Generic company crawler on a canned site (offline). Run: cd crawler && ../.venv/bin/python -m pytest company -q"""

from datetime import date

import pytest

from company import generic

NAMES = ["Zorblax", "ZX-101"]
COMPANY = {"name": "Acme Pharma", "website": "https://www.acme.com", "ir_url": "https://ir.acme.com/news"}
FILLER = "The company develops medicines for rare lung diseases and works with patients and physicians. " * 4


def page(title, body, links=(), head=""):
    anchors = "".join(f'<a href="{href}">{text}</a> ' for href, text in links)
    return (f"<html><head><title>{title}</title>{head}</head><body><nav>{anchors}</nav>"
            f"<article><h1>{title}</h1><p>{body} {FILLER}</p></article></body></html>")


SITE = {
    "https://www.acme.com/robots.txt": "User-agent: *\nSitemap: https://www.acme.com/sitemap_index.xml\n",
    "https://www.acme.com/sitemap_index.xml": "<sitemapindex><sitemap><loc>https://www.acme.com/pages.xml</loc></sitemap>"
                                             "<sitemap><loc>https://www.acme.com/big.xml.gz</loc></sitemap></sitemapindex>",
    "https://www.acme.com/pages.xml": "<urlset>" + "".join(f"<url><loc>{u}</loc></url>" for u in (
        "https://www.acme.com/products/zorblax/", "https://www.acme.com/about", "https://www.acme.com/pipeline",
        "https://other.com/zorblax", "https://www.acme.com/products/zorblax-brochure.pdf",
        "https://www.acme.com/news/zorblax-approved")) + "</urlset>",
    "https://www.acme.com": page("Acme", "Welcome", [("/stories/1", "The ZX-101 story")]),
    "https://www.acme.com/products/zorblax/": page("Zorblax | Acme", "Zorblax treats lung disease.", [
        ("/docs/zorblax-pi.pdf", "Prescribing Information"), ("/docs/annual-report-2025.pdf", "Annual report"),
        ("/docs/careers.pdf", "Careers brochure"), ("https://track.example.com/c?url=zorblax_pi.pdf", "PI")]),
    "https://www.acme.com/pipeline": page("Pipeline", "Our pipeline is in oncology."),
    "https://www.acme.com/stories/1": page("Story", "A patient on ZX-101 tells her story."),
    "https://ir.acme.com/news": page("News", "Releases", [
        ("/news/2026/zorblax-approval", "Acme announces FDA approval of Zorblax"), ("/news/2026/q2", "Q2 results"),
        ("https://wire.example.com/zorblax", "Zorblax on the wire"), ("/news/zorblax.pdf", "Zorblax release PDF")]),
    "https://ir.acme.com/news/2026/zorblax-approval": page(
        "Acme announces FDA approval of Zorblax", "Acme today announced FDA approval of Zorblax (ZX-101).",
        head='<meta property="article:published_time" content="2026-05-01">'),
}
PDFS = {"https://www.acme.com/docs/zorblax-pi.pdf": "ZORBLAX prescribing information",
        "https://www.acme.com/docs/annual-report-2025.pdf": "Revenue from ZX-101 grew"}


@pytest.fixture
def fetched(monkeypatch):
    urls = []
    monkeypatch.setattr(generic, "_get", lambda url, timeout=20: urls.append(url) or SITE.get(url))
    monkeypatch.setattr(generic, "_pdf_text", lambda url, referer: urls.append(url) or PDFS.get(url))
    return urls


def test_crawls_product_pages_documents_and_releases(fetched):
    records = generic.crawl(COMPANY, NAMES, press_releases=True)
    by_url = {r["url"]: r for r in records}
    assert [(r["record_type"], r["url"]) for r in records] == [
        ("company_page", "https://www.acme.com/products/zorblax/"),
        ("company_page", "https://www.acme.com/stories/1"),  # homepage link text names the drug
        ("prescribing_info", "https://www.acme.com/docs/zorblax-pi.pdf"),
        ("annual_report", "https://www.acme.com/docs/annual-report-2025.pdf"),
        ("press_release", "https://ir.acme.com/news/2026/zorblax-approval"),
    ]
    page = by_url["https://www.acme.com/products/zorblax/"]
    assert page["record_key"] == "acme.com:company_page:https://www.acme.com/products/zorblax/"
    assert page["source"] == "acme.com" and page["company"] == "Acme Pharma" and page["title"] == "Zorblax | Acme"
    assert page["date"] == date.today().isoformat() and page["mentions"] == ["Zorblax"]
    assert by_url["https://www.acme.com/docs/annual-report-2025.pdf"]["found_on"] == page["url"]
    release = by_url["https://ir.acme.com/news/2026/zorblax-approval"]
    assert release["date"] == "2026-05-01" and release["mentions"] == ["Zorblax", "ZX-101"]
    # The pipeline page was read (product hint) but doesn't mention the drug; nothing off-site, gzipped or unhinted.
    assert "https://www.acme.com/pipeline" in fetched
    # News pages are press releases (company_news / the IR listing), tracking links aren't PDFs.
    assert not {"https://other.com/zorblax", "https://www.acme.com/big.xml.gz", "https://www.acme.com/docs/careers.pdf",
                "https://wire.example.com/zorblax", "https://ir.acme.com/news/2026/q2",
                "https://www.acme.com/news/zorblax-approved", "https://track.example.com/c?url=zorblax_pi.pdf",
                "https://ir.acme.com/news/zorblax.pdf"} & set(fetched)


def test_press_releases_are_left_to_the_newsroom_spider_when_there_is_one(fetched):
    records = generic.crawl(COMPANY, NAMES, press_releases=False)
    assert "press_release" not in {r["record_type"] for r in records}
    assert "https://ir.acme.com/news" not in fetched


def test_a_site_that_fails_to_load_yields_nothing(monkeypatch):
    monkeypatch.setattr(generic, "_get", lambda url, timeout=20: None)
    assert generic.crawl(COMPANY, NAMES, press_releases=True) == []


@pytest.mark.parametrize("name, kind", [
    ("winrevair_pi.pdf Prescribing Information", "prescribing_info"), ("winrevair_ppi.pdf", "prescribing_info"),
    ("winrevair_ifu_kits.pdf", "prescribing_info"), ("annual-report-2025.pdf", "annual_report"),
    ("form-10-k.pdf", "annual_report"), ("pipeline-chart.pdf", "company_document"), ("pipes.pdf", "company_document"),
])
def test_pdf_types(name, kind):
    assert generic._pdf_type(name) == kind
