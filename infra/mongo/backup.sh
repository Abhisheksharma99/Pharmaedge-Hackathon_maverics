#!/usr/bin/env bash
# Dumps the whole self-hosted MongoDB (all databases and users, point-in-time via --oplog) to
# backups/mongo/, deleting dumps older than KEEP_DAYS (default 7). Run nightly from cron on the server:
#
#   0 2 * * * cd /path/to/repo && PATH=/usr/local/bin:/usr/bin:/bin infra/mongo/backup.sh >> backups/mongo.log 2>&1
#
# Restore: docker compose exec -T mongo sh -c 'mongorestore --uri "mongodb://root:${MONGODB_INITDB_ROOT_PASSWORD}@localhost:27017/?authSource=admin&tls=true&tlsCAFile=/etc/mongo/ca.pem&directConnection=true" --archive --gzip --oplogReplay --drop' < backups/mongo/<file>
set -euo pipefail
umask 077   # dumps include user credentials (hashed) and all data
cd "$(dirname "$0")/../.."
dir="${BACKUP_DIR:-backups/mongo}"
mkdir -p "$dir"
out="$dir/mongo-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"

docker compose exec -T mongo sh -c 'mongodump --quiet --oplog --archive --gzip --uri "mongodb://root:${MONGODB_INITDB_ROOT_PASSWORD}@localhost:27017/?authSource=admin&tls=true&tlsCAFile=/etc/mongo/ca.pem&directConnection=true"' > "$out.part"
mv "$out.part" "$out"
find "$dir" -name 'mongo-*.archive.gz' -mtime +"${KEEP_DAYS:-7}" -delete
echo "$(date -u +%FT%TZ) backup ok: $out ($(du -h "$out" | cut -f1))"
