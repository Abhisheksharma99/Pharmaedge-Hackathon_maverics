"""
Adapters for the crawlers the team built as separate repo-root packages
(clinicalTrialgov/, company_pr/, conference/, patent_intel/, pubmed/). Each
adapter runs a team crawler and maps its output onto the shared record
contract (record_key, record_type, source, date, assets, ...), so it can run as
a crawl-service step. The team packages themselves are used unchanged.
"""

import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
# Local checkout: the packages sit next to crawler/. Docker: they are copied into /app beside this code.
for _root in (_HERE.parents[2], _HERE.parents[1]):
    if (_root / "company_pr" / "run.py").exists():
        TEAM_ROOT = _root
        break
else:
    raise ImportError("team crawler packages (company_pr/, conference/, ...) not found next to crawler/")

if str(TEAM_ROOT) not in sys.path:
    sys.path.append(str(TEAM_ROOT))
