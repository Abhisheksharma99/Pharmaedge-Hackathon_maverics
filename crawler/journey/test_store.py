"""Asset ids (contract slug rule). Run: cd crawler && ../.venv/bin/python -m pytest journey -q"""

import pytest

from journey.store import asset_id


@pytest.mark.parametrize("name, slug", [
    ("Treprostinil", "treprostinil"), ("treprostinil", "treprostinil"), ("Tyvaso DPI", "tyvaso-dpi"),
    ("Merck & Co.", "merck-co"), (" -ACE-011- ", "ace-011"), ("[177Lu]Lu-PSMA-617", "177lu-lu-psma-617"),
    ("Sotatercept–csrk", "sotatercept-csrk"),
])
def test_asset_ids_are_contract_slugs(name, slug):
    assert asset_id(name) == slug
