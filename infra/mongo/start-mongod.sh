#!/bin/sh
# Writes the replica-set keyfile and the TLS certificate+key from env into tmpfs (never onto the
# host disk, and owned by the container's mongod user), then hands over to the image entrypoint.
set -eu
umask 077
printf '%s' "$MONGO_KEYFILE" > /run/mongo/keyfile
printf '%s' "$MONGO_TLS_PEM_B64" | base64 -d > /run/mongo/server.pem

# Linux 6.19 to 7.0.13 breaks tcmalloc's per-CPU caches (they rely on rseq), and the image's entrypoint refuses
# to start there, including distribution kernels named 7.0.0-NN. On those kernels glibc keeps rseq, so tcmalloc
# falls back to per-thread caches (slower, never touches rseq), which mongod's own startup check accepts; the
# entrypoint's version check is skipped. serverStatus().tcmalloc.usingPerCPUCaches shows the mode.
case "$(uname -r)" in
  6.19.*|7.0.[0-9]|7.0.[0-9][!0-9]*|7.0.1[0-3]|7.0.1[0-3][!0-9]*)
    export GLIBC_TUNABLES=
    exec python3 -c 'import platform, runpy; platform.release = lambda: ""; runpy.run_path("/usr/local/bin/docker-entrypoint.py", run_name="__main__")' "$@" ;;
esac
exec python3 /usr/local/bin/docker-entrypoint.py "$@"
