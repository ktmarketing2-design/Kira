import { Router } from "express";
import { z } from "zod";
import { redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { ddQueue, ddQueueEvents, volumeQueue, volumeQueueEvents } from "../lib/queue.js";
import { requireDdQuota } from "../middleware/tier.js";
import { helius, jupiter, geckoterminal, gmgnApi, type HeliusConfig } from "@ceronix/kira-shared";

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
    // "Load more" support (Sprint 8 Part 6): clamp to what's already fetched from Helius
    // (TX_HISTORY_LOOKBACK) rather than adding real cursor pagination -- this endpoint queries
    // the mint's full signature history fresh on every call, so a bigger page is just a bigger
    // slice of the same already-fetched array, not an extra network round trip.
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, TX_HISTORY_LOOKBACK)
      : TX_RESULT_LIMIT;
    const limited = transactions.slice(0, limit);

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

// ============================================================================
// Research Notes / Research Threads (Sprint 8 Part 5, extended Sprint 9 Part 16):
// per-user, per-token panel. Started as flat notes; is_ai_message + parent_id (migration 013)
// let the same table also hold a chat thread with Kira ("Ask Kira" persists the question as a
// plain row and the /ask answer as an is_ai_message row with parent_id pointing at the question).
// Ordered chronologically ascending here (not pinned-first like before) since a chat thread reads
// top-to-bottom in the order it happened; pinning is still supported per-message for anything the
// user wants to flag, it just doesn't reorder the thread anymore.
// ============================================================================

router.get("/:address/notes", async (req, res) => {
  const { data, error } = await supabase
    .from("kira_research_notes")
    .select("id, content, pinned, is_ai_message, parent_id, created_at, updated_at")
    .eq("user_id", req.user!.id)
    .eq("token_address", req.params.address)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[kira-api:token] notes list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ notes: data ?? [] });
});

const createNoteSchema = z.object({
  content: z.string().min(1).max(4000),
  isAiMessage: z.boolean().optional(),
  parentId: z.string().uuid().optional(),
});

router.post("/:address/notes", async (req, res) => {
  const parsed = createNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabase
    .from("kira_research_notes")
    .insert({
      user_id: req.user!.id,
      token_address: req.params.address,
      content: parsed.data.content,
      is_ai_message: parsed.data.isAiMessage ?? false,
      parent_id: parsed.data.parentId ?? null,
    })
    .select("id, content, pinned, is_ai_message, parent_id, created_at, updated_at")
    .single();

  if (error) {
    console.error("[kira-api:token] note insert failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(201).json({ note: data });
});

const updateNoteSchema = z.object({
  content: z.string().min(1).max(4000).optional(),
  pinned: z.boolean().optional(),
});

router.patch("/:address/notes/:id", async (req, res) => {
  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success || (parsed.data.content === undefined && parsed.data.pinned === undefined)) {
    res.status(400).json({ error: "Invalid payload", details: parsed.success ? undefined : parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabase
    .from("kira_research_notes")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("user_id", req.user!.id)
    .eq("token_address", req.params.address)
    .select("id, content, pinned, is_ai_message, parent_id, created_at, updated_at")
    .maybeSingle();

  if (error) {
    console.error("[kira-api:token] note update failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  if (!data) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json({ note: data });
});

router.delete("/:address/notes/:id", async (req, res) => {
  const { error, count } = await supabase
    .from("kira_research_notes")
    .delete({ count: "exact" })
    .eq("id", req.params.id)
    .eq("user_id", req.user!.id)
    .eq("token_address", req.params.address);

  if (error) {
    console.error("[kira-api:token] note delete failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  if (!count) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.status(204).send();
});

// ============================================================================
// Token Full Terminal (Sprint 8 Part 6): aggregated GMGN token data for the token page's
// Trades/Holders/Traders/Dev Info/Stats tabs. Field names and quirks (marcket_cap typo,
// amount_percentage as a 0-1 fraction, dev address at info.dev.creator_address not info.creator,
// unix-seconds timestamps) come from Antigravity's live-verified report
// (kira-sprint8-part6-code.md), not re-tested independently.
// ============================================================================

const TOKEN_FULL_CACHE_TTL_SECONDS = 120;

interface RawHolderOrTrader {
  address?: string;
  usd_value?: number | string | null;
  amount_percentage?: number | string | null;
  amount_cur?: number | string | null;
  cost?: number | string | null;
  cost_cur?: number | string | null;
  accu_cost?: number | string | null;
  realized_profit?: number | string | null;
  unrealized_profit?: number | string | null;
  profit?: number | string | null;
  buy_volume_cur?: number | string | null;
  sell_volume_cur?: number | string | null;
  buy_tx_count_cur?: number | null;
  sell_tx_count_cur?: number | null;
  netflow_usd?: number | string | null;
  wallet_tag_v2?: string | null;
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

router.get("/:address/full", async (req, res) => {
  const { address } = req.params;
  const cacheKey = `token:full:${address}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  const [info, pool, holders, smartDegens, renowned, ratTraders, bundlers, traders] = await Promise.all([
    gmgnApi.getTokenInfo(address),
    gmgnApi.getTokenPool(address),
    gmgnApi.getTokenHolders(address),
    gmgnApi.getTokenHolders(address, { tag: "smart_degen" }),
    gmgnApi.getTokenHolders(address, { tag: "renowned" }),
    gmgnApi.getTokenHolders(address, { tag: "rat_trader" }),
    gmgnApi.getTokenHolders(address, { tag: "bundler" }),
    gmgnApi.getTokenTraders(address),
  ]);

  const infoRecord = (info ?? {}) as Record<string, any>;
  const devAddress: string | undefined = infoRecord.dev?.creator_address;
  const devHistory = devAddress ? await gmgnApi.getCreatorHistory(devAddress) : null;

  const taggedAddress = (list: unknown[]) => new Set((list as RawHolderOrTrader[]).map((h) => h.address));
  const smartDegenAddresses = taggedAddress(smartDegens);
  const renownedAddresses = taggedAddress(renowned);
  const ratTraderAddresses = taggedAddress(ratTraders);
  const bundlerAddresses = taggedAddress(bundlers);

  function getHolderTags(walletAddress: string | undefined): string[] {
    if (!walletAddress) return [];
    const tags: string[] = [];
    if (smartDegenAddresses.has(walletAddress)) tags.push("smart_degen");
    if (renownedAddresses.has(walletAddress)) tags.push("renowned");
    if (ratTraderAddresses.has(walletAddress)) tags.push("rat_trader");
    if (bundlerAddresses.has(walletAddress)) tags.push("bundler");
    return tags;
  }

  function mapHolderOrTrader(h: RawHolderOrTrader) {
    return {
      address: h.address ?? null,
      usdValue: numOrNull(h.usd_value),
      amountPercentage: numOrNull(h.amount_percentage),
      balance: numOrNull(h.amount_cur),
      costBasis: numOrNull(h.cost ?? h.cost_cur ?? h.accu_cost),
      realizedProfit: numOrNull(h.realized_profit),
      unrealizedProfit: numOrNull(h.unrealized_profit),
      totalProfit: numOrNull(h.profit),
      buyVolume: numOrNull(h.buy_volume_cur),
      sellVolume: numOrNull(h.sell_volume_cur),
      buyTxCount: h.buy_tx_count_cur ?? null,
      sellTxCount: h.sell_tx_count_cur ?? null,
      netflowUsd: numOrNull(h.netflow_usd),
      walletTag: h.wallet_tag_v2 ?? null,
      tags: getHolderTags(h.address),
    };
  }

  const devHistoryRecord = devHistory as Record<string, any> | null;

  const result = {
    address,
    meta: {
      symbol: infoRecord.symbol ?? null,
      name: infoRecord.name ?? null,
      logo: infoRecord.logo ?? null,
      decimals: infoRecord.decimals ?? null,
      totalSupply: numOrNull(infoRecord.total_supply),
      circulatingSupply: numOrNull(infoRecord.circulating_supply),
      holderCount: infoRecord.holder_count ?? null,
      launchpad: infoRecord.launchpad ?? infoRecord.launchpad_platform ?? null,
      createdAt: infoRecord.creation_timestamp ?? null,
      openedAt: infoRecord.open_timestamp ?? null,
      migratedAt: infoRecord.migrated_timestamp ?? null,
      athPrice: numOrNull(infoRecord.ath_price),
      lockedRatio: numOrNull(infoRecord.locked_ratio),
      visitingCount: infoRecord.visiting_count ?? null,
      social: {
        twitter: infoRecord.link?.twitter ?? null,
        telegram: infoRecord.link?.telegram ?? null,
        website: infoRecord.link?.website ?? null,
      },
    },
    priceStats: {
      current: numOrNull(infoRecord.price?.price),
      change1m: numOrNull(infoRecord.price?.price_1m),
      change5m: numOrNull(infoRecord.price?.price_5m),
      change1h: numOrNull(infoRecord.price?.price_1h),
      change6h: numOrNull(infoRecord.price?.price_6h),
      change24h: numOrNull(infoRecord.price?.price_24h),
      buys1m: infoRecord.price?.buys_1m ?? null,
      buys5m: infoRecord.price?.buys_5m ?? null,
      buys1h: infoRecord.price?.buys_1h ?? null,
      buys6h: infoRecord.price?.buys_6h ?? null,
      buys24h: infoRecord.price?.buys_24h ?? null,
      sells1m: infoRecord.price?.sells_1m ?? null,
      sells5m: infoRecord.price?.sells_5m ?? null,
      sells1h: infoRecord.price?.sells_1h ?? null,
      sells6h: infoRecord.price?.sells_6h ?? null,
      sells24h: infoRecord.price?.sells_24h ?? null,
    },
    pool: pool
      ? {
          poolAddress: (pool as Record<string, any>).pool_address ?? null,
          exchange: (pool as Record<string, any>).exchange ?? null,
          liquidity: numOrNull((pool as Record<string, any>).liquidity),
          baseReserve: numOrNull((pool as Record<string, any>).base_reserve),
          quoteReserve: numOrNull((pool as Record<string, any>).quote_reserve),
          baseReserveValue: numOrNull((pool as Record<string, any>).base_reserve_value),
          quoteReserveValue: numOrNull((pool as Record<string, any>).quote_reserve_value),
          initialLiquidity: numOrNull((pool as Record<string, any>).initial_liquidity),
          feeRatio: numOrNull((pool as Record<string, any>).fee_ratio),
          createdAt: (pool as Record<string, any>).creation_timestamp ?? null,
          quoteSymbol: (pool as Record<string, any>).quote_symbol ?? null,
        }
      : null,
    holders: (holders as RawHolderOrTrader[]).map(mapHolderOrTrader),
    traders: (traders as RawHolderOrTrader[]).map(mapHolderOrTrader),
    dev: {
      address: devAddress ?? null,
      tokenBalance: numOrNull(infoRecord.dev?.creator_token_balance),
      tokenStatus: infoRecord.dev?.creator_token_status ?? null,
      top10HolderRate: numOrNull(infoRecord.dev?.top_10_holder_rate),
      fundSource: infoRecord.dev?.fund_from ?? null,
      fundSourceTimestamp: infoRecord.dev?.fund_from_ts ?? null,
      tokensCreated: infoRecord.dev?.creator_open_count ?? null,
      athTokenInfo: infoRecord.dev?.ath_token_info ?? null,
      history: devHistoryRecord
        ? {
            totalCreated: devHistoryRecord.inner_count ?? null,
            openCount: devHistoryRecord.open_count ?? null,
            openRatio: numOrNull(devHistoryRecord.open_ratio),
            lastCreatedAt: devHistoryRecord.last_create_timestamp ?? null,
            athToken: devHistoryRecord.creator_ath_info ?? null,
            tokens: ((devHistoryRecord.tokens ?? []) as any[]).map((t) => ({
              address: t.token_address ?? null,
              symbol: t.symbol ?? null,
              logo: t.logo ?? null,
              createdAt: t.create_timestamp ?? null,
              isOpen: t.is_open ?? null,
              // Confirmed: this field is misspelled "marcket_cap" in GMGN's response.
              marketCap: numOrNull(t.market_cap ?? t.marcket_cap),
              athMarketCap: numOrNull(t.token_ath_mc),
              holders: t.holders ?? null,
              liquidity: numOrNull(t.pool_liquidity),
              launchpad: t.launchpad_platform ?? null,
              isPump: t.is_pump ?? null,
              bundlerRate: numOrNull(t.bundler_rate),
            })),
          }
        : null,
    },
    tagsSummary: infoRecord.wallet_tags_stat ?? null,
    updatedAt: Date.now(),
  };

  await redis.set(cacheKey, JSON.stringify(result), "EX", TOKEN_FULL_CACHE_TTL_SECONDS);
  res.json(result);
});

export default router;
