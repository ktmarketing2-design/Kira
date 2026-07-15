# @ceronix/kira-web

Vite + React + TypeScript + Tailwind v4. Two faces of `kira.ceronix.ai`:

- `/` — logged-out landing page (marketing, static copy, hardcoded stat bar for now)
- `/login`, `/link/:code`, `/dashboard`, `/roster`, `/alerts`, `/token(/:address)`, `/settings`,
  `/upgrade` — the authenticated app, gated by Supabase Auth

## Local development

```
npm install
cd packages/kira-web
cp .env.example .env.local   # fill in the three VITE_ vars below
npm run dev
```

Requires `kira-api` running locally (or point `VITE_API_URL` at the production API) for anything
past the landing page.

## Environment variables

Build-time only (Vite inlines anything prefixed `VITE_` into the client bundle, these are public
values, never put a service-role key or anything secret in a `VITE_*` var):

```
VITE_SUPABASE_URL=https://ccxfetpzllxkoosvzdzd.supabase.co
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=https://kira-api.ceronix.ai   # or http://localhost:4020 for local dev
```

`ccxfetpzllxkoosvzdzd` is the confirmed Kira Supabase project ref. The anon key is provisioned
separately (not a value this repo hardcodes anywhere, see `src/lib/supabase.ts`).

## Cloudflare Pages deployment (operator/Antigravity)

1. Build command: `npm run build` (run from `packages/kira-web`, or configure the Pages project's
   root directory as `packages/kira-web` with the monorepo's `npm install` as the install command)
2. Output directory: `packages/kira-web/dist`
3. `public/_redirects` (already in the repo, copied into `dist/` by Vite automatically) makes
   Cloudflare Pages serve `index.html` for every path so client-side routing works: `/* /index.html 200`
4. Set the three `VITE_*` env vars above in the Cloudflare Pages dashboard (Settings → Environment
   variables). `VITE_SUPABASE_ANON_KEY` is the public anon key, safe to expose, it's what
   Supabase's client-side SDK is designed for, RLS enforces the actual access control.
5. Point `kira.ceronix.ai` DNS/custom domain at the Pages project.

No server, no PM2 process for this package, it's a static build.

## Known gaps (Sprint 3-4 scope)

- **Quick Stats** on the dashboard: "Today's Alerts" and "Wallets Tracked" are computed client-side
  from `/alerts` and `/roster`, real numbers. "Tokens DD'd" and "Vol Authenticity Avg" are shown as
  "not tracked yet", there is no endpoint that exposes a user's DD-request history or a rolling
  volume-score average, and adding one wasn't in scope for this sprint (only
  `POST /auth/telegram-link` was authorized as a kira-api change). Wire these up once such an
  endpoint exists rather than fabricate numbers.
- **"Add to Watchlist"** buttons (dashboard alert cards, token page) are inert by design, there is
  no watchlist table/feature yet, matching the mockups without pretending the feature works.
- **Wallet-signature (Phantom) login**, mentioned in the Phase 1 PRD's auth spec, is not part of
  this sprint's actual `/login` spec (magic link + Telegram only), not built.
- Chart Studio, Signal Filter UI, KOL scoring UI, and payment processing are explicitly out of
  scope per the Sprint 3-4 build prompt's "Do Not" list.
