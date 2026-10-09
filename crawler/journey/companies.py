"""Sponsor-vs-company matching shared by the rule events and the branch candidates."""

import re
from typing import List

LEGAL_SUFFIXES = {"inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "plc",
                   "sa", "ag", "gmbh", "nv", "bv", "f"}


def _norm(name: str) -> str:
    tokens = re.sub(r"[^a-z0-9]+", " ", name.lower()).split()
    return " ".join(t for t in tokens if t not in LEGAL_SUFFIXES)


def _names(text: str) -> List[str]:
    """The name itself and each parenthetical as alternatives: "Actelion (Janssen)" -> actelion, janssen."""
    parts = [re.sub(r"\([^)]*\)", " ", text)] + re.findall(r"\(([^)]*)\)", text)
    return [n for n in (_norm(p) for p in parts) if n]


def is_company_sponsor(sponsor: str, company: str) -> bool:
    return any(c in s or s in c for s in _names(sponsor or "") for c in _names(company or ""))
