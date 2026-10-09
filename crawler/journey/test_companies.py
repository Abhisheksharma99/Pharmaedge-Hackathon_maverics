"""Company-sponsor matching. Run: cd crawler && ../.venv/bin/python -m pytest journey -q"""

import pytest

from journey.companies import is_company_sponsor


@pytest.mark.parametrize("sponsor, company", [
    ("Biogen Inc.", "Biogen"), ("Actelion (Janssen)", "Actelion"), ("Actelion (Janssen)", "Janssen"),
    ("F. Hoffmann-La Roche", "Hoffmann-La Roche"), ("United Therapeutics", "United Therapeutics Corporation"),
    ("Biogen", "Biogen Inc."),
])
def test_real_sponsor_company_pairs_match(sponsor, company):
    assert is_company_sponsor(sponsor, company)


@pytest.mark.parametrize("sponsor, company", [("Pfizer", "Biogen"), ("", "Biogen"), ("Biogen", ""), ("", ""),
                                              ("Inc.", "Co Ltd")])
def test_other_companies_and_empty_names_do_not_match(sponsor, company):
    assert not is_company_sponsor(sponsor, company)
