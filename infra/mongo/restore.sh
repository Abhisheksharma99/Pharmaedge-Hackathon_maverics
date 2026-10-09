#!/usr/bin/env bash
# Restores a backup made by backup.sh (every database, plus users) into this host's self-hosted MongoDB, e.g. to
# move the data to the server. Copy infra/mongo/secrets/ to the target first, so its users and passwords match
# the ones in the backup.
#
#   infra/mongo/restore.sh backups/mongo/mongo-<timestamp>.archive.gz
#   DRY_RUN=1 infra/mongo/restore.sh <archive>      # read the archive and report, write nothing
#
# Collections in the archive replace the target's (--drop); collections not in the archive are left alone.
set -euo pipefail
cd "$(dirname "$0")/../.."
archive="${1:?Usage: infra/mongo/restore.sh <backup archive>}"
[ -f "$archive" ] || { echo "No such file: $archive" >&2; exit 1; }
docker compose exec -T -e DRY_RUN="${DRY_RUN:-}" mongo sh -c '
  mongorestore --uri "mongodb://root:${MONGODB_INITDB_ROOT_PASSWORD}@localhost:27017/?authSource=admin&tls=true&tlsCAFile=/etc/mongo/ca.pem&directConnection=true" \
    --archive --gzip --oplogReplay --drop ${DRY_RUN:+--dryRun --verbose}' < "$archive" 2>&1 \
  | sed -E 's#(mongodb(\+srv)?://)[^@/ ]+@#\1***@#g' | grep -vE '^\S+\s+(reading metadata|restoring indexes|no indexes)' || true
echo "$(date -u +%FT%TZ) restore ${DRY_RUN:+(dry run) }done: $archive"
