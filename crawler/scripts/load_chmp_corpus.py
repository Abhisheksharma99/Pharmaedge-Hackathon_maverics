"""
Load a finished CHMP crawl (ema/chmp_highlights.py output) into the CHMP corpus
collection, so the ema_chmp step starts from the full history instead of crawling
it (~30 min) on its first run. Safe to re-run.

    cd crawler && ../.venv/bin/python -m scripts.load_chmp_corpus [../ema/output/chmp_meeting_highlights.json]
"""

import json
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from integrations import chmp  # noqa: E402
from storage.mongo_storage import get_db  # noqa: E402

DEFAULT = Path(__file__).resolve().parents[2] / "ema" / "output" / "chmp_meeting_highlights.json"

if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    meetings = json.loads(path.read_text("utf-8"))
    new = chmp.store_meetings(get_db(), meetings)
    print(f"{len(meetings)} meetings loaded into {chmp.CORPUS} ({new} new)")
