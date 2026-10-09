#!/usr/bin/env bash
# Copies databases from the old cluster (Atlas) into the self-hosted MongoDB, then compares document counts.
#
#   SOURCE_URI='mongodb+srv://<user>:<password>@<cluster-host>/' infra/mongo/migrate.sh [db ...]
#
# Default databases: asset_journey pharmaedge Cluster0. Re-runnable: each target collection is dropped and
# restored, so run it again at cutover to pick up writes made to the old cluster since. The old cluster is
# only read.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${SOURCE_URI:?Set SOURCE_URI to the old cluster connection string}"
[ $# -gt 0 ] || set -- asset_journey pharmaedge Cluster0

# The source URI goes in on stdin, so it never appears in the host's process list. Tool errors can echo
# connection strings, so credentials are masked in everything printed.
printf '%s\n' "$SOURCE_URI" | docker compose exec -T mongo sh -c '
  set -eu
  read -r SRC
  DST="mongodb://root:${MONGODB_INITDB_ROOT_PASSWORD}@localhost:27017/?authSource=admin&tls=true&tlsCAFile=/etc/mongo/ca.pem&directConnection=true"
  for db in "$@"; do
    echo "== copying $db"
    mongodump --uri "$SRC" --db "$db" --archive --gzip \
      | mongorestore --uri "$DST" --archive --gzip --drop --nsInclude "$db.*"
  done
  for db in "$@"; do
    DB="$db" SRC="$SRC" mongosh --quiet "$DST" --eval "
      const src = new Mongo(process.env.SRC).getDB(process.env.DB), dst = db.getSiblingDB(process.env.DB);
      for (const c of src.getCollectionNames().sort()) {
        const a = src.getCollection(c).countDocuments({}), b = dst.getCollection(c).countDocuments({});
        print((a === b ? \"ok       \" : \"MISMATCH \") + process.env.DB + \".\" + c + \": \" + a + \" -> \" + b);
      }"
  done
' sh "$@" 2>&1 | sed -E 's#(mongodb(\+srv)?://)[^@/ ]+@#\1***@#g'
