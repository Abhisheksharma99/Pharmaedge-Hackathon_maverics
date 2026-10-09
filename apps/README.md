# Asset Journey platform — apps

| App | Stack | Port (dev) |
|---|---|---|
| `apps/api` | NestJS 12 (Fastify), MongoDB driver, ioredis → Valkey, JWT in httpOnly cookies | 3000 |
| `apps/web` | React 19, Vite 8, Tailwind v4, shadcn/ui (Radix), TanStack Query, Zustand, React Router 8 | 5173 |

Design: `docs/superpowers/specs/2026-10-08-asset-journey-platform-design.md`.
Crawlers (Python) live in `crawler/` and write to the same MongoDB.

## Setup

```bash
infra/mongo/setup.sh                     # self-hosted MongoDB secrets + TLS (infra/mongo/README.md)
cp apps/api/.env.example apps/api/.env   # fill MONGODB_URI, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, OPENAI_API_KEY
npm install                              # npm workspaces (apps/*)
```

The first admin is created on first boot from `ADMIN_EMAIL` / `ADMIN_PASSWORD`; further users are
added in the app under **Settings → Users** (there is no self-signup).

## Run

**Development** (hot reload; Valkey on host port 6380 and MongoDB on 27017, both in Docker):

```bash
docker compose up -d valkey mongo mongot
npm run dev:api          # http://localhost:3000/api, Swagger at /api/docs
npm run dev:web          # http://localhost:5173 (proxies /api to :3000)
```

**Full stack in Docker** (nginx serves the app and proxies `/api`):

```bash
docker compose up -d --build   # http://localhost:8080
```

## Test

```bash
npm test                  # API e2e (in-memory MongoDB + Valkey) and web unit/UI tests
npm run test:e2e          # Playwright smoke test against http://localhost:8080 (full stack running)
```

API e2e tests need Valkey running (`docker compose up -d valkey`).

## Asset AI

`POST /api/chat/sessions/:id/turn` streams one answer as NDJSON lines: `tool_call`, `tool_result`, `card`, `token`,
`answer` (the stored message with its citations and follow-ups), `error`, `done`.

- **Tools** (`src/chat/chat-tools.ts`): assets, overview, timeline, trials, regulatory history, milestones, competitors,
  comparison, evidence search (`$vectorSearch` over the crawler's `record_chunks`), resolve a new drug, crawl progress.
  At most 6 tool calls per question.
- **Citations:** every record or event a tool returns gets a ref number. The model cites `[n]`; the stored answer is
  renumbered 1..k in reading order and keeps only the refs it used, each pointing at the record on the asset page.
- **Cards:** `identity` (resolve), `job` (crawl progress), `comparison`, `timeline`.
- **Adding an asset:** the model only calls `resolve_asset`. The user's "Confirm & start crawl" calls `POST /api/assets`,
  which creates the asset and starts its `onboard` crawl. Adding a tracked competitor promotes it to a primary asset.
- **Model:** `LLM_CHAT_MODEL` (default `gpt-5.4-mini`, reasoning off: gpt-5.4 models only take function tools on
  Chat Completions without reasoning). Without `OPENAI_API_KEY` the rest of the app works and chat answers
  `LLM_UNAVAILABLE`.

## Auth model

- Access token: JWT (HS256, 15 min), verified on every request by a global guard; routes opt out with `@Public()`.
- Refresh token: opaque, 7 days, stored hashed in Valkey, rotated on every refresh; replaying an old one
  revokes the session. Logout revokes immediately.
- Both live in `httpOnly`, `SameSite=Strict` cookies (`Secure` in production) — the browser JS never sees them.
- Roles: `admin` (user management) and `analyst`. Login is rate-limited to 5 attempts/minute per IP + email.
- If Valkey is down: cached reads fall back to MongoDB, existing sessions keep working until the access
  token expires, and new sign-ins return a clear `503 AUTH_STORE_UNAVAILABLE`.
