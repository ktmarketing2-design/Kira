# @ceronix/kira-api

Express API for Kira, port `4020` (`KIRA_API_PORT`). Thin and synchronous: auth, tier gating,
CRUD against Supabase, and enqueueing BullMQ jobs for `kira-workers`. Never calls a paid
external API inline, that's the workers' job.

## Routes (Sprint 1-2)

```
GET    /health
POST   /webhooks/helius            secret-verified, no JWT
POST   /telegram/start             bot-token-verified, no JWT (see below)
GET    /me
PATCH  /me/settings
GET    /roster
POST   /roster
DELETE /roster/:address
GET    /token/:address/dd
GET    /token/:address/volume
GET    /alerts
POST   /alerts/:id/read
```

## Auth

Two paths, both handled in `src/middleware/auth.ts`:

1. **Supabase JWT** (web app): `Authorization: Bearer <token>`, verified via
   `supabase.auth.getUser()`.
2. **Internal bot header** (kira-bot, localhost only): `x-kira-bot-token: <TELEGRAM_BOT_TOKEN>`
   plus `x-telegram-user-id: <id>`. There is no dedicated internal-service secret provisioned
   for Kira, so this reuses `TELEGRAM_BOT_TOKEN`, which both `kira-bot` and `kira-api` already
   have from the same `.env`. It never leaves the box.

`POST /telegram/start` exists because `kira_profiles.id` has a foreign key to `auth.users(id)`:
a Telegram-only visitor has no Supabase auth user yet, so this route creates a shadow one via
the Supabase admin API before inserting the profile and link code. This route is not in the
Phase 1 PRD's API surface table, it was added to make the bot's documented `/start` behavior
(PRD Section 9 / Sprint prompt) satisfiable under the given schema without altering it.

## Local development

```
npm install
cd packages/kira-api
npm run typecheck
KIRA_API_PORT=4020 npm start   # tsx src/index.ts, needs the shared root .env
curl -s http://localhost:4020/health
```

## Not done here

Migration execution, PM2 process management, and Nginx routing are the operator's / 
Antigravity's responsibility per the ownership boundary in the Sprint 1-2 build prompt.
