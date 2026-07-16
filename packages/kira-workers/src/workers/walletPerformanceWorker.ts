import { Worker, type Job } from "bullmq";
import { helius, dexscreener, geckoterminal, type HeliusConfig } from "@ceronix/kira-shared";
import { bullConnection, redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";

const heliusConfig: HeliusConfig = { apiKey: process.env.HELIUS_API_KEY ?? "" };
const SOL_MINT = "So11111111111111111111111111111111111111112";
const LOOKBACK_SECONDS = 90 * 24 * 60 * 60;
const MATURITY_SECONDS = 7 * 24 * 60 * 60; // a trade needs to be 7d old before it can be scored
const WIN_THRESHOLD_PCT = 10;
const TRADES_CACHE_TTL_SECONDS = 95 * 24 * 60 * 60;
const PERIODS: Array<{ key: "7d" | "30d" | "90d"; days: number }> = [
  { key: "7d", days: 7 },
  { key: "30d", days: 30 },
  { key: "90d", days: 90 },
];

interface WalletPerfJobData {
  walletAddress?: string; // present for a manual single-wallet refresh, absent for the nightly full sweep
}

interface ScoredTrade {
  tokenAddress: string;
  entryTimestamp: number; // unix seconds
  entryPriceUsd: number;
  returnPct: number | null; // null until the trade is >= 7d old and an exit price was found
}

/** Pool lookups are cached briefly, the same mint gets hit repeatedly across a wallet's trade
 * history and again across every roster wallet holding the same popular token. */
async function resolvePoolAddress(tokenAddress: string): Promise<string | null> {
  const cacheKey = `perf:pool:${tokenAddress}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached || null;

  const info = await dexscreener.getTokenInfo("solana", tokenAddress);
  await redis.set(cacheKey, info?.pairAddress ?? "", "EX", 3600);
  return info?.pairAddress ?? null;
}

/** Closest hourly candle to a target timestamp. GeckoTerminal's free-tier OHLCV endpoint returns
 * a fixed recent window, not arbitrary historical ranges, so this is a best-effort match rather
 * than an exact lookup — acceptable for a directional win/loss signal, not exact P&L accounting. */
function closestClose(candles: geckoterminal.OhlcvCandle[], targetTsSeconds: number): number | null {
  if (candles.length === 0) return null;
  let best = candles[0];
  let bestDiff = Math.abs(best.timestamp - targetTsSeconds);
  for (const c of candles) {
    const diff = Math.abs(c.timestamp - targetTsSeconds);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best.close;
}

async function priceNear(tokenAddress: string, targetTsSeconds: number): Promise<number | null> {
  const poolAddress = await resolvePoolAddress(tokenAddress);
  if (!poolAddress) return null;
  const candles = await geckoterminal.getOhlcv("solana", poolAddress, "hour");
  return closestClose(candles, targetTsSeconds);
}

/** New buy entries since the wallet's Redis cursor. A "buy" is any incoming non-SOL token
 * transfer to the wallet, mirroring pnlDigestWorker's trade-derivation approach. */
async function deriveNewEntries(address: string, sinceTs: number): Promise<ScoredTrade[]> {
  const history = await helius.getTransactionHistory(heliusConfig, address, { limit: 100 });
  const entries: ScoredTrade[] = [];

  for (const tx of history) {
    if (tx.timestamp <= sinceTs) continue;

    for (const transfer of tx.tokenTransfers ?? []) {
      if (!transfer.mint || transfer.mint === SOL_MINT || !transfer.tokenAmount) continue;
      if (transfer.toUserAccount !== address) continue;

      const entryPriceUsd = await priceNear(transfer.mint, tx.timestamp);
      if (entryPriceUsd == null || entryPriceUsd <= 0) continue;

      entries.push({
        tokenAddress: transfer.mint,
        entryTimestamp: tx.timestamp,
        entryPriceUsd,
        returnPct: null,
      });
    }
  }

  return entries;
}

async function loadCachedTrades(address: string): Promise<ScoredTrade[]> {
  const raw = await redis.get(`perf:trades:${address}`);
  return raw ? (JSON.parse(raw) as ScoredTrade[]) : [];
}

async function saveCachedTrades(address: string, trades: ScoredTrade[]): Promise<void> {
  await redis.set(`perf:trades:${address}`, JSON.stringify(trades), "EX", TRADES_CACHE_TTL_SECONDS);
}

/** Scores any trade that has crossed the 7d maturity mark but hasn't been scored yet. Scoring is
 * a one-time cost per trade: once returnPct is set it is never recomputed. */
async function scoreMaturedTrades(trades: ScoredTrade[]): Promise<void> {
  const now = Date.now() / 1000;
  for (const trade of trades) {
    if (trade.returnPct !== null) continue;
    if (now - trade.entryTimestamp < MATURITY_SECONDS) continue;

    const exitPriceUsd = await priceNear(trade.tokenAddress, trade.entryTimestamp + MATURITY_SECONDS);
    if (exitPriceUsd == null) continue;

    trade.returnPct = ((exitPriceUsd - trade.entryPriceUsd) / trade.entryPriceUsd) * 100;
  }
}

async function processWallet(address: string): Promise<void> {
  const cursorKey = `perf:cursor:${address}`;
  const lastTs = Number((await redis.get(cursorKey)) ?? 0);

  const newEntries = await deriveNewEntries(address, lastTs);
  if (newEntries.length > 0) {
    const newCursor = Math.max(...newEntries.map((t) => t.entryTimestamp));
    await redis.set(cursorKey, String(newCursor));
  }

  const existing = await loadCachedTrades(address);
  const cutoff = Date.now() / 1000 - LOOKBACK_SECONDS;
  let trades = [...existing, ...newEntries].filter((t) => t.entryTimestamp >= cutoff);

  await scoreMaturedTrades(trades);
  await saveCachedTrades(address, trades);

  const now = Date.now() / 1000;
  const computedAt = new Date().toISOString();

  for (const { key, days } of PERIODS) {
    const windowCutoff = now - days * 24 * 60 * 60;
    const scored = trades.filter((t) => t.entryTimestamp >= windowCutoff && t.returnPct !== null);

    const wins = scored.filter((t) => (t.returnPct as number) >= WIN_THRESHOLD_PCT).length;
    const avgReturnPct =
      scored.length > 0 ? scored.reduce((sum, t) => sum + (t.returnPct as number), 0) / scored.length : null;

    const { error } = await supabase.from("kira_wallet_performance").upsert(
      {
        wallet_address: address,
        period: key,
        trades: scored.length,
        wins,
        win_rate: scored.length > 0 ? wins / scored.length : null, // fraction 0-1, matches kira-web display convention (multiplies by 100)
        avg_return_pct: avgReturnPct,
        computed_at: computedAt,
      },
      { onConflict: "wallet_address,period" },
    );

    if (error) {
      console.error("[kira-workers:wallet-performance] upsert failed:", address, key, error.message);
    }
  }
}

async function processWalletPerformance(job: Job<WalletPerfJobData>): Promise<void> {
  let addresses: string[];

  if (job.data.walletAddress) {
    addresses = [job.data.walletAddress];
  } else {
    const { data, error } = await supabase.from("kira_roster_wallets").select("address");
    if (error) {
      console.error("[kira-workers:wallet-performance] roster load failed:", error.message);
      return;
    }
    addresses = Array.from(new Set((data ?? []).map((r) => r.address)));
  }

  for (const address of addresses) {
    try {
      await processWallet(address);
    } catch (err) {
      console.error(
        "[kira-workers:wallet-performance] wallet processing failed:",
        address,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export function startWalletPerformanceWorker(): Worker<WalletPerfJobData, void> {
  return new Worker<WalletPerfJobData, void>("kira-wallet-performance", processWalletPerformance, {
    connection: bullConnection,
    concurrency: 1,
  });
}
