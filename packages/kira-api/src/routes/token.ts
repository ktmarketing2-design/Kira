import { Router } from "express";
import { z } from "zod";
import { redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { ddQueue, ddQueueEvents, volumeQueue, volumeQueueEvents } from "../lib/queue.js";
import { requireDdQuota } from "../middleware/tier.js";
import { helius, jupiter, geckoterminal, type HeliusConfig } from "@ceronix/kira-shared";

const router = Router();

// Raised from 15s (Sprint 7): cold DD generation now includes GMGN Deep Intel enrichment,
// which needs up to ~9 sequential gmgn-cli calls under that client'''s own 1/sec internal rate
// limiter. Verified live: a real cold BONK DD took 21s end to end with GMGN enrichment included,
// which the old 15s timeout would have hard-failed as a 504 even though the underlying BullMQ
// job succeeded and populated the cache.
const DD_JOB_TIMEOUT_MS = 30_000;
const VOLUME_JOB_TIMEOUT_MS = 15_000;
const TX_HISTORY_LOOKBACK = 60; // fetch more than 20 since not every parsed tx yields a transfer for this mint
const TX_RESULT_LIMIT = 20;
const heliusConfig: HeliusConfig = { apiKey: process.env.HELIUS_API_KEY ?? "" };

const OHLCV_CACHE_TTL_SECONDS = 60;
const TIMEFRAME_PARAMS: Record<string, { timeframe: "minute" | "hour" | "day"; aggregate: number }> = {
  "15m": { timeframe: "minute", aggregate: 15 },
  "1h": { timeframe: "hour", aggregate: 1 },
  "4h": { timeframe: "hour", aggregate: 4 },
  "1d": { timeframe: "day", aggregate: 1 },
};

function timeAgo(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// Read-only, no requireDdQuota: the watchlist page shows price/rug/volume score for many
// tokens at once "from existing DD cache where available, otherwise show dashes" (Sprint 8 Part
// 2 spec) -- routing that through /:address/dd would burn a Scout's 10/day DD quota just by
// opening the page, since that route's quota middleware runs before its own cache check.
router.get("/:address/dd-cached", async (req, res) => {
  const cached = await redis.get(`ddcard:${req.params.address}`);
  res.json({ card: cached ? JSON.parse(cached) : null });
});

router.get("/:address/dd", requireDdQuota, async (req, res) => {
  const { address } = req.params;

  try {
    const cached = await redis.get(`ddcard:${address}`);
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }

    const job = await ddQueue.add(
      "dd",
      { tokenAddress: address, requestedBy: req.user!.id },
      { removeOnComplete: true, removeOnFail: true },
    );
    const result = await job.waitUntilFinished(ddQueueEvents, DD_JOB_TIMEOUT_MS);
    res.json(result);
  } catch (err) {
    console.error("[kira-api:token] dd failed:", err instanceof Error ? err.message : err);
    res.status(504).json({ error: "Deep Dive generation timed out or failed" });
  }
});

router.get("/:address/volume", async (req, res) => {
  const { address } = req.params;

  try {
    const cached = await redis.get(`volscore:${address}`);
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }

    const job = await volumeQueue.add(
      "volume",
      { tokenAddress: address },
      { removeOnComplete: true, removeOnFail: true },
    );
    const result = await job.waitUntilFinished(volumeQueueEvents, VOLUME_JOB_TIMEOUT_MS);
    res.json(result);
  } catch (err) {
    console.error("[kira-api:token] volume failed:", err instanceof Error ? err.message : err);
    res.status(504).json({ error: "Volume score generation timed out or failed" });
  }
});

// Recent swaps for the trading-activity panel. Uses Helius parsed transaction history queried
// directly on the token mint address (same proven approach as kira-workers/volumeWorker.ts's
// deriveSwaps), not a pool address: kira_token_snapshots does not persist pairAddress anywhere
// (checked — the DD card only holds it transiently in the Redis-cached JSON, ddWorker's insert
// into kira_token_snapshots never writes a pair_address column, and no such column exists in any
// migration), and Helius's getSignaturesForAddress works against any account including a mint,
// so resolving a pool address first would be an unnecessary extra network call for no benefit.
// This also means it works for pre-graduation bonding-curve tokens too, not just graduated ones.
router.get("/:address/transactions", async (req, res) => {
  const { address } = req.params;

  try {
    const priceUsd = await jupiter.getPrice(address);
    const history = await helius.getTransactionHistory(heliusConfig, address, { limit: TX_HISTORY_LOOKBACK });

    const transactions: Array<{
      signature: string;
      wallet: string;
      walletFull: string;
      side: "buy" | "sell";
      usdValue: number;
      tokenAmount: number;
      timestamp: number;
      timeAgo: string;
    }> = [];

    for (const tx of history) {
      const timestampMs = tx.timestamp * 1000;
      for (const transfer of tx.tokenTransfers ?? []) {
        if (transfer.mint !== address || !transfer.tokenAmount) continue;

        const side: "buy" | "sell" | null = transfer.toUserAccount
          ? "buy"
          : transfer.fromUserAccount
            ? "sell"
            : null;
        const walletFull = side === "buy" ? transfer.toUserAccount : transfer.fromUserAccount;
        if (!side || !walletFull) continue;

        transactions.push({
          signature: tx.signature,
          wallet: truncateAddress(walletFull),
          walletFull,
          side,
          usdValue: priceUsd != null ? priceUsd * transfer.tokenAmount : 0,
          tokenAmount: transfer.tokenAmount,
          timestamp: timestampMs,
          timeAgo: timeAgo(timestampMs),
        });
      }
    }

    transactions.sort((a, b) => b.timestamp - a.timestamp);
    const limited = transactions.slice(0, TX_RESULT_LIMIT);

    if (limited.length === 0) {
      res.json({ transactions: [], source: "unavailable" });
      return;
    }

    res.json({ transactions: limited });
  } catch (err) {
    console.error("[kira-api:token] transactions failed:", err instanceof Error ? err.message : err);
    res.json({ transactions: [], source: "unavailable" });
  }
});

// Cached OHLCV proxy so the browser never calls GeckoTerminal directly (avoids CORS and keeps
// GeckoTerminal's own rate limit off end users). pairAddress comes from the frontend's already-
// fetched DD card, not resolved server-side here, avoiding a redundant lookup on every candle
// refetch.
router.get("/:address/ohlcv", async (req, res) => {
  const pairAddress = typeof req.query.pairAddress === "string" ? req.query.pairAddress : null;
  const timeframeKey = typeof req.query.timeframe === "string" ? req.query.timeframe : "15m";
  const params = TIMEFRAME_PARAMS[timeframeKey];

  if (!pairAddress) {
    res.status(400).json({ error: "pairAddress query param is required" });
    return;
  }
  if (!params) {
    res.status(400).json({ error: "Invalid timeframe, expected one of: 15m, 1h, 4h, 1d" });
    return;
  }

  const cacheKey = `ohlcv:${pairAddress}:${timeframeKey}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  const candles = await geckoterminal.getOhlcv("solana", pairAddress, params.timeframe, {
    aggregate: params.aggregate,
    limit: 1000,
  });

  const payload = { candles };
  await redis.set(cacheKey, JSON.stringify(payload), "EX", OHLCV_CACHE_TTL_SECONDS);
  res.json(payload);
});

// On-chain overlay markers for Chart Studio: alerts (cluster buy/sell, signal filter match) and
// KOL calls for this token, merged and timestamped for the frontend to plot on the price chart.
router.get("/:address/events", async (req, res) => {
  const { address } = req.params;

  const [{ data: alerts, error: alertsError }, { data: kolCalls, error: kolError }] = await Promise.all([
    supabase
      .from("kira_alerts")
      .select("id, type, created_at, wallet_count, total_usd")
      .eq("token_address", address)
      .eq("user_id", req.user!.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("kira_kol_calls")
      .select("id, source_id, called_at, price_at_call")
      .eq("token_address", address)
      .order("called_at", { ascending: false })
      .limit(200),
  ]);

  if (alertsError || kolError) {
    console.error(
      "[kira-api:token] events lookup failed:",
      alertsError?.message,
      kolError?.message,
    );
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({
    alerts: (alerts ?? []).map((a) => ({
      id: a.id,
      kind: a.type,
      timestamp: a.created_at,
      walletCount: a.wallet_count,
      totalUsd: a.total_usd,
    })),
    kolCalls: (kolCalls ?? []).map((c) => ({
      id: c.id,
      sourceId: c.source_id,
      timestamp: c.called_at,
      priceAtCall: c.price_at_call,
    })),
  });
});

router.get("/:address/drawings", async (req, res) => {
  const { data, error } = await supabase
    .from("kira_chart_drawings")
    .select("drawings, updated_at")
    .eq("user_id", req.user!.id)
    .eq("token_address", req.params.address)
    .maybeSingle();

  if (error) {
    console.error("[kira-api:token] drawings load failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ drawings: data?.drawings ?? [], updatedAt: data?.updated_at ?? null });
});

const drawingsSchema = z.object({ drawings: z.array(z.unknown()) });

router.put("/:address/drawings", async (req, res) => {
  const parsed = drawingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabase
    .from("kira_chart_drawings")
    .upsert(
      {
        user_id: req.user!.id,
        token_address: req.params.address,
        drawings: parsed.data.drawings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,token_address" },
    )
    .select("id, drawings, updated_at")
    .single();

  if (error) {
    console.error("[kira-api:token] drawings save failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ id: data.id, drawings: data.drawings, updatedAt: data.updated_at });
});

export default router;
