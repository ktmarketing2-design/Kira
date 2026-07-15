import { Worker, type Job } from "bullmq";
import {
  helius,
  jupiter,
  scoreVolume,
  type HeliusConfig,
  type VolumeInput,
  type VolumeOutput,
} from "@ceronix/kira-shared";
import { bullConnection } from "../lib/redis.js";
import { redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";

const CACHE_TTL_SECONDS = 600;
const MAX_SWAPS = 200;
const WINDOW_MS = 60 * 60 * 1000; // 1h
const MAX_SAMPLED_WALLETS = 10; // was 30, then 15, cut further for cold-DD latency (each wallet costs 2 Helius calls)
const WALLET_AGE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days, an address's first-tx date never changes

const heliusConfig: HeliusConfig = { apiKey: process.env.HELIUS_API_KEY ?? "" };

interface VolumeJobData {
  tokenAddress: string;
  pairAddress?: string;
  // Passed straight from ddWorker's already-resolved market data. Without these the engine had
  // to re-derive fdv/liquidity from a kira_token_snapshots row that does not exist yet on a
  // token's first-ever lookup, silently defaulting vol/fdv-liq ratios to 0 on every cold DD.
  fdvUsd?: number;
  liquidityUsd?: number;
}

interface DerivedSwap {
  wallet: string;
  side: "buy" | "sell";
  usdValue: number;
  timestamp: number;
}

async function deriveSwaps(tokenAddress: string, priceUsd: number | null): Promise<DerivedSwap[]> {
  const address = tokenAddress;
  const history = await helius.getTransactionHistory(heliusConfig, address, { limit: MAX_SWAPS });
  const cutoff = Date.now() - WINDOW_MS;

  const swaps: DerivedSwap[] = [];
  for (const tx of history) {
    const tsMs = tx.timestamp * 1000;
    if (tsMs < cutoff) continue;

    for (const transfer of tx.tokenTransfers ?? []) {
      if (transfer.mint !== tokenAddress || !transfer.tokenAmount) continue;
      const usdValue = priceUsd != null ? priceUsd * transfer.tokenAmount : 0;

      if (transfer.toUserAccount) {
        swaps.push({ wallet: transfer.toUserAccount, side: "buy", usdValue, timestamp: tsMs });
      }
      if (transfer.fromUserAccount) {
        swaps.push({ wallet: transfer.fromUserAccount, side: "sell", usdValue, timestamp: tsMs });
      }
    }
  }
  return swaps;
}

/**
 * Approximate wallet age: oldest timestamp found in the wallet's most recent page of
 * transaction history. Underestimates true age for wallets with more than one page of
 * history, which biases toward flagging as "new" rather than missing real new-wallet
 * activity. Cached in Redis for 30 days per wallet, a wallet's first-transaction date is
 * immutable, no reason to re-fetch it on every DD card that happens to see the same wallet.
 */
async function estimateWalletAgeDays(wallet: string): Promise<number> {
  const cacheKey = `walletage:${wallet}`;
  const cached = await redis.get(cacheKey);
  if (cached) return Number(cached);

  const history = await helius.getTransactionHistory(heliusConfig, wallet, { limit: 100 });
  const ageDays =
    history.length === 0 ? 9999 : (Date.now() - Math.min(...history.map((tx) => tx.timestamp)) * 1000) / (1000 * 60 * 60 * 24);

  await redis.set(cacheKey, String(ageDays), "EX", WALLET_AGE_CACHE_TTL_SECONDS);
  return ageDays;
}

async function processVolumeJob(job: Job<VolumeJobData>): Promise<VolumeOutput> {
  const { tokenAddress } = job.data;
  const cacheKey = `volscore:${tokenAddress}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as VolumeOutput;
  }

  const priceUsd = await jupiter.getPrice(tokenAddress);
  const swaps = await deriveSwaps(tokenAddress, priceUsd);

  const uniqueBuyers = Array.from(new Set(swaps.filter((s) => s.side === "buy").map((s) => s.wallet)));
  const sampledBuyers = uniqueBuyers.slice(0, MAX_SAMPLED_WALLETS);
  const sampledBuyerWalletAgesDays = await Promise.all(sampledBuyers.map(estimateWalletAgeDays));

  const volume24hUsd = swaps.reduce((sum, s) => sum + s.usdValue, 0);

  let fdvUsd = job.data.fdvUsd;
  let liquidityUsd = job.data.liquidityUsd;
  let snapshotId: string | undefined;

  if (fdvUsd == null || liquidityUsd == null) {
    const { data: latestSnapshot } = await supabase
      .from("kira_token_snapshots")
      .select("id, fdv_usd, liquidity_usd")
      .eq("token_address", tokenAddress)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    fdvUsd = fdvUsd ?? latestSnapshot?.fdv_usd ?? 0;
    liquidityUsd = liquidityUsd ?? latestSnapshot?.liquidity_usd ?? 0;
    snapshotId = latestSnapshot?.id;
  }

  const input: VolumeInput = {
    fdvUsd: fdvUsd ?? 0,
    liquidityUsd: liquidityUsd ?? 0,
    volume24hUsd,
    swaps: swaps.map(({ wallet, side, usdValue, timestamp }) => ({ wallet, side, usdValue, timestamp })),
    sampledBuyerWalletAgesDays,
  };

  const result = scoreVolume(input);

  await redis.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);

  // Only update an existing row (found above when fdv/liquidity weren't passed in). When ddWorker
  // passes market data directly (the normal path), it does its own insert with these columns
  // right after this job resolves, so there is nothing to backfill here.
  if (snapshotId) {
    const { error } = await supabase
      .from("kira_token_snapshots")
      .update({
        unique_buyers: uniqueBuyers.length,
        unique_sellers: Array.from(new Set(swaps.filter((s) => s.side === "sell").map((s) => s.wallet)))
          .length,
        timing_entropy: result.signals.find((s) => s.name === "timing_entropy")?.value ?? null,
        new_wallet_ratio: result.signals.find((s) => s.name === "new_wallet_ratio")?.value ?? null,
        volume_score: result.score,
        volume_verdict: result.verdict,
      })
      .eq("id", snapshotId);

    if (error) {
      console.error("[kira-workers:volume] snapshot update failed:", error.message);
    }
  }

  return result;
}

export function startVolumeWorker(): Worker<VolumeJobData, VolumeOutput> {
  return new Worker<VolumeJobData, VolumeOutput>("kira-volume", processVolumeJob, {
    connection: bullConnection,
    concurrency: 5,
  });
}
