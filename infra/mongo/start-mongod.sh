#!/bin/sh
# Writes the replica-set keyfile and the TLS certificate+key from env into tmpfs (never onto the
# host disk, and owned by the container's mongod user), then hands over to the image entrypoint.
set -eu
umask 077
printf '%s' "$MONGO_KEYFILE" > /run/mongo/keyfile
printf '%s' "$MONGO_TLS_PEM_B64" | base64 -d > /run/mongo/server.pem
exec python3 /usr/local/bin/docker-entrypoint.py "$@"
