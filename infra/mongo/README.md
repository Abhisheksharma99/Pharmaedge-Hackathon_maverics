# Self-hosted MongoDB

Replaces the Atlas free cluster. Two containers in the root `docker-compose.yml`:

- `mongo`: MongoDB Community 9.0, single-node replica set `rs0`. Password auth and TLS are required on every connection.
- `mongot`: MongoDB Search / Vector Search. It serves `$search` and `$vectorSearch` (Asset AI's `record_chunks_vector` index). Only `mongo` can reach it, over the internal Docker network.

Users, created on first start by `init/01-users.js`:

| User | Access | Used by |
|---|---|---|
| `root` | everything | backups, migration, admin |
| `app` | readWrite on `asset_journey`, `pharmaedge`, `Cluster0` | our api and crawler |
| `team` | readWrite on the same three databases | teammates' crawlers connecting from outside |
| `mongot` | `searchCoordinator` | mongot sync |

Secrets live in `infra/mongo/secrets/` (git-ignored, never commit). `setup.sh` generates them: passwords, the replica-set keyfile, a private CA (`ca.pem`/`ca.key`) and the server certificate.

## Host requirement: Linux kernel

MongoDB 8+ crashes on Linux kernels **6.19 to 7.0.13** (tcmalloc/rseq bug), and the image refuses to start on them.

- Check with `uname -r`. Kernels below 6.19, or 7.0.14 and newer, are fine.
- Docker Desktop needs 4.93.0 or newer, which ships kernel 7.0.14.
- Distribution kernels named like `7.0.0-NN-generic` are also refused by the image's check, even if the fix was backported. Use the distribution's older LTS kernel or a newer kernel line.

## Local

```bash
infra/mongo/setup.sh                          # once
docker compose up -d mongo mongot             # first start creates the users and the replica set
```

Local development (`npm run dev:api`, the crawler) connects through the loopback port. Use this in `apps/api/.env` and `crawler/.env`:

```
MONGODB_URI=mongodb://app:<MONGO_APP_PASSWORD>@localhost:27017/?directConnection=true&authSource=admin&tls=true&tlsCAFile=<repo>/infra/mongo/secrets/ca.pem
```

The api and crawler containers get their own internal connection string from `secrets/app.env`. Compose loads it after each service's `.env`, so it takes precedence.

## Server

The data now lives in the instance set up locally (Atlas is no longer written to). Moving it to the server means
carrying the same secrets over and restoring a backup:

1. **Host.** A Linux server with Docker Engine and the compose plugin, about 20 GB free disk, and a public DNS name
   or static IP. Check the kernel with `uname -r` (see above).
2. **Secrets.** Copy `infra/mongo/secrets/` from the machine that has the data to the same path on the server
   (scp; never through git). Same passwords and CA, so the backup's users and teammates' `ca.pem` stay valid.
   Then add the server's address to the certificate: `infra/mongo/setup.sh <public-dns-name> [<public-ip>]`
   (keeps passwords, keyfile and CA; re-issues only the server certificate).
3. **Publish the port.** Put `MONGO_PUBLISH=0.0.0.0` in the repo-root `.env`. Without it, the port is bound to
   127.0.0.1 only.
4. **Firewall.** Allow TCP 27017 only from teammates' IPs, using the cloud provider's firewall or security group.
   - `ufw` does **not** filter ports published by Docker. Docker's iptables rules bypass it.
   - Without a provider firewall, add rules to the `DOCKER-USER` chain instead.
5. **Start.** `docker compose up -d mongo mongot` (or `docker compose up -d --build` for the whole app).
6. **Copy the data.** On the old machine: `infra/mongo/backup.sh`, then copy the archive from `backups/mongo/` to the
   server and run `infra/mongo/restore.sh backups/mongo/<file>` there (`DRY_RUN=1` first to check it).
   Search indexes are not in backups; recreate Asset AI's with
   `docker compose exec crawler-api python -c "from storage.mongo_storage import get_db; from ai.index import ensure_vector_index; ensure_vector_index(get_db())"`
   (or it is created by the next crawl's index step).
7. **Backups.** Schedule `infra/mongo/backup.sh` nightly with cron; the crontab line is in the script. It keeps 7 days
   in `backups/mongo/`. Copy those off the server too.

## Connecting from outside (teammates, Compass)

Give teammates `secrets/ca.pem` and the `team` password, over a private channel:

```
mongodb://team:<MONGO_TEAM_PASSWORD>@<public-host>:27017/?directConnection=true&authSource=admin&tls=true&tlsCAFile=/path/to/ca.pem
```

- `directConnection=true` is required. The replica-set member is registered under its internal name `mongo`, which
  only resolves inside Docker.
- `team` can read and write `asset_journey`, `pharmaedge` and `Cluster0`, and nothing else.
- Clients that set their own CA bundle must not override `tlsCAFile`: `patent_intel/store.py` passes certifi's
  bundle whenever the URI has `tls=true`, which can't verify this server's private CA. It should skip that when
  the URI already has `tlsCAFile`.
- Our own services: the containers on the server use `secrets/app.env` automatically. A laptop running
  `npm run dev:api` or the crawler points `MONGODB_URI` in `apps/api/.env` / `crawler/.env` at the server, with the
  `app` password and `ca.pem`.

## Cutover from Atlas

Done for writes so far: the local instance holds everything (on 2026-10-09, every Atlas collection matched its
copy). If someone writes to Atlas again before switching, re-copy just those databases with
`SOURCE_URI='<atlas connection string>' infra/mongo/migrate.sh pharmaedge Cluster0` (it drops and restores each
collection; never include `asset_journey`, whose newer data exists only here). Once every writer uses the new
instance, rotate or delete the Atlas user.

## Maintenance

- **Certificate renewal.** The server certificate is valid for 825 days; the CA for 10 years. To renew, re-run `setup.sh` with the same hosts, then `docker compose up -d mongo`.
- **mongot disk space.** mongot pauses index replication when its disk is about 90% full, and resumes below about 85%. Search indexes then stop updating, so watch the `mongot-data` volume.
