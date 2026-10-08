"""
JSON-file backend with the same API as mongo_storage, for reviewing data before
it goes to MongoDB. Enabled via mongo_storage.use_json(out_dir).

One file per collection in out_dir (articles.json, fda_records.json, ...), each a
JSON list. Files are rewritten on every change so a crash loses nothing.
"""

import json
import os
import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, Optional

KEYS = {"articles": "url", "fda_records": "record_key", "ema_records": "record_key",
        "company_records": "record_key", "trial_records": "record_key", "runs": "id"}


class JsonStore:
    def __init__(self, out_dir: str):
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)
        self.data: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for name, key in KEYS.items():
            path = self._path(name)
            rows = json.load(open(path)) if os.path.exists(path) else []
            self.data[name] = {row[key]: row for row in rows}
        self.logs_path = self._path("logs")

    def _path(self, name: str) -> str:
        return os.path.join(self.out_dir, f"{name}.json")

    def _save(self, name: str) -> None:
        tmp = self._path(name) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(list(self.data[name].values()), f, indent=2, default=str)
        os.replace(tmp, self._path(name))

    # --- runs / logs --------------------------------------------------------

    def create_run(self, data: Dict[str, Any]) -> Dict[str, Any]:
        run = {"id": str(uuid.uuid4()), **data}
        self.data["runs"][run["id"]] = dict(run)
        self._save("runs")
        return run

    def update_run(self, run_id: str, updates: Dict[str, Any]) -> None:
        self.data["runs"].setdefault(run_id, {"id": run_id}).update(updates)
        self._save("runs")

    def add_log(self, crawler_id: str, level: str, message: str) -> None:
        # Append-only JSON lines: logs are high volume and never read back
        with open(self.logs_path + "l", "a") as f:
            f.write(json.dumps({"crawler_id": crawler_id, "level": level, "message": message,
                                "created_at": datetime.now().isoformat()}) + "\n")

    # --- articles -----------------------------------------------------------

    def article_exists(self, url: str) -> bool:
        return url in self.data["articles"]

    def tag_article_asset(self, url: str, asset: Optional[str]) -> None:
        row = self.data["articles"].get(url)
        if row is not None and asset and asset not in row["assets"]:
            row["assets"].append(asset)
            self._save("articles")

    def insert_article(self, record: Dict[str, Any], asset: Optional[str]) -> bool:
        if record["url"] in self.data["articles"]:
            self.tag_article_asset(record["url"], asset)
            return False
        # Same content under another URL (syndicated wire release) is a duplicate
        twin = next((url for url, row in self.data["articles"].items()
                     if record.get("content_hash") and row.get("content_hash") == record["content_hash"]), None)
        if twin:
            self.tag_article_asset(twin, asset)
            return False
        self.data["articles"][record["url"]] = {**record, "assets": [asset] if asset else []}
        self._save("articles")
        return True

    # --- regulatory ---------------------------------------------------------

    def upsert_records(self, collection: str, records: Iterable[Dict[str, Any]], asset: str) -> Dict[str, int]:
        inserted = updated = 0
        table = self.data[collection]
        for rec in records:
            old = table.get(rec["record_key"])
            assets = old["assets"] if old else []
            if asset not in assets:
                assets = assets + [asset]
            table[rec["record_key"]] = {**rec, "fetched_at": datetime.now().isoformat(), "assets": assets}
            if old:
                updated += 1
            else:
                inserted += 1
        self._save(collection)
        return {"inserted": inserted, "updated": updated}
