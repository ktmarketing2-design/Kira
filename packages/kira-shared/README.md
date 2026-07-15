# @ceronix/kira-shared

Typed external API clients and pure scoring engines shared by `kira-api` and `kira-workers`.
No I/O in `src/engines/`, no framework code here, this package is a library only.

## Contents

- `src/clients/` - DexScreener, GeckoTerminal, RugCheck, GoPlus, Jupiter, Helius. All
  Zod-validated, all rate-limited, all fail soft (log and return `null`/`[]`, never throw
  into the caller for a transient upstream failure).
- `src/engines/` - `scoreVolume()` (Volume Authenticity Engine) and `evaluateCluster()`
  (cluster threshold evaluation). Pure functions, unit tested.

## Local development

From the monorepo root (`/var/www/vantage`):

```
npm install
cd packages/kira-shared
npm run typecheck   # tsc -b --noEmit
npm test            # vitest run
```

No environment variables are required to run the tests, the engines take plain data in.
The Helius client does expect `HELIUS_API_KEY` at call time in whichever process imports it
(`kira-api` / `kira-workers`), not in this package directly.
