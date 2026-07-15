# @ceronix/kira-bot

Telegram bot (grammY, long polling). No public webhook, no direct Supabase or external API
access, everything goes through `kira-api` over `http://localhost:4020` using the internal
bot-token auth header (see `kira-api/README.md`).

## Commands

`/start` `/dd <address>` `/vol <address>` `/add <address> [label]` `/remove <address>`
`/roster` `/alerts` `/pnl` (Phase 1 stub) `/upgrade`

## Local development

```
npm install
cd packages/kira-bot
npm run typecheck
npm start   # tsx src/index.ts, needs TELEGRAM_BOT_TOKEN, REDIS_HOST/PORT, and kira-api running
```

## Known limitation (Sprint 1-2 scope)

`/dd` and `/vol` require a Solana contract address, not a ticker. Ticker-to-address resolution
(via DexScreener search) lives in `kira-shared`, which is intentionally not a dependency of this
package (bot stays thin, talks to `kira-api` only). Add it as an API-side resolution step in a
later sprint if ticker lookup from the bot is needed.
