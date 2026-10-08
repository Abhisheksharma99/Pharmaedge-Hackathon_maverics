"""Deterministic company-name matching (no fuzzy 'looks similar' inclusion)."""

from __future__ import annotations

import re
import unicodedata

# Legal-form tokens only; stripped from the END of a name. Words like PHARMACEUTICALS are kept
# because stripping them causes collisions between unrelated companies.
SUFFIXES = {
    "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "LLC", "LLP", "LP",
    "PLC", "AG", "GMBH", "SA", "SAS", "SPA", "SRL", "SARL", "NV", "BV", "AB", "AS", "OY", "KK", "KG",
    "PTY", "PVT", "PRIVATE", "SE", "THE",
}
INCLUDE_AT = 0.95  # >= include
UNCERTAIN_AT = 0.85  # >= keep as uncertain (reported, not included)


def normalize(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    s = s.replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", re.sub(r"(?<=\b[A-Z])\.(?=[A-Z]\b)", "", s))  # S.A. -> SA
    toks = s.split()
    while toks and toks[-1] in SUFFIXES:
        toks.pop()
    while toks and toks[0] == "THE":
        toks.pop(0)
    return " ".join(toks)


def score(company: str, applicant: str) -> float:
    """1.0 exact normalized match (only this is auto-included); 0.9 applicant extends the company
    name at a word boundary ('UNITED THERAPEUTICS EUROPE' - maybe a subsidiary, maybe 'APPLE PIE
    BAKERY'); 0.85 company appears inside applicant; else 0."""
    c, a = normalize(company), normalize(applicant)
    if not c or not a:
        return 0.0
    if c == a:
        return 1.0
    if a.startswith(c + " "):
        return 0.9
    if f" {c} " in f" {a} ":
        return 0.85
    return 0.0


def best_match(companies: list[str], applicants: list[str]) -> dict:
    best = {"score": 0.0, "company": None, "applicant": None}
    for c in companies:
        for a in applicants:
            s = score(c, a)
            if s > best["score"]:
                best = {"score": s, "company": c, "applicant": a}
    best["decision"] = "include" if best["score"] >= INCLUDE_AT else "uncertain" if best["score"] >= UNCERTAIN_AT else "reject"
    return best
