# @ceronix/kira-workers

BullMQ worker process for Kira. One Node process, five workers registered from
`src/index.ts`:

| Worker | Queue | Job |
|---|---|---|
| `ddWorker` | `kira:dd` | Fan out RugCheck/GoPlus/DexScreener/Helius, compute rug score, generate a Gemini verdict (budget-gated), cache + persist |
| `volumeWorker` | `kira:volume` | Derive recent swaps from Helius history, run `scoreVolume()`, cache + persist |
| `clusterWorker` | `kira:cluster-eval` | Update Redis cluster state, evaluate every affected user's roster against `evaluateCluster()`, create alert rows |
| `alertDispatchWorker` | `kira:alert-dispatch` | Format and send the Telegram alert, push a Supabase Realtime broadcast, mark delivered |
| `heliusSyncWorker` | `kira:helius-sync` | Debounced (30s), PATCHes the single Helius webhook's watched-address list |

## Local development

```
npm install
cd packages/kira-workers
npm run typecheck
npm start   # tsx src/index.ts, needs the shared root .env (Supabase, Redis, Helius, Gemini, Telegram)
```

## Notes / known simplifications (Sprint 1-2 scope)

- `deployerPriorRugs` in `ddWorker` is derived from RugCheck's own risk list (any risk entry
  whose name matches `/rug/i`), not a dedicated rug-pull database, none was specified for
  Sprint 1-2.
- `estimateWalletAgeDays` in `volumeWorker` samples one page of a wallet's transaction history
  (up to 100 txs) and uses the oldest timestamp found there. Wallets with more history than
  that are underestimated in age, which biases toward flagging as "new" rather than missing
  genuinely new-wallet activity. Tightening this needs a paginated walk to genesis, which is
  a real RPC-credit cost tradeoff (see `kira-build-architecture.md` Module B).
- USD values in the Helius webhook path and `volumeWorker` use the live Jupiter price at
  processing time, not the historical price at the swap's block time (Jupiter's free price
  API doesn't expose historical quotes).
