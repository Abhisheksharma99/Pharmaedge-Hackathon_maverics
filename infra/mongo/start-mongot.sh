#!/bin/sh
# mongot reads its sync-user password from a file: write it from env into tmpfs, then start mongot.
set -eu
umask 077
printf '%s' "$MONGOT_PASSWORD" > /run/mongot/passwordFile
exec /mongot-community/mongot --config /etc/mongot/mongot.conf
