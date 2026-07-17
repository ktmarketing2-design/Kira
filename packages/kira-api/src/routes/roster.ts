import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireRosterCapacity } from "../middleware/tier.js";
import { heliusSyncQueue, walletPerformanceQueue } from "../lib/queue.js";
import { redis } from "../lib/redis.js";
import { gmgnApi } from "@ceronix/kira-shared";

const router = Router();

router.get("/", async (req, res) => {
  const { data: wallets, error } = await supabase
    .from("kira_roster_wallets")
    .select("id, address, label, created_at")
    .eq("user_id", req.user!.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[kira-api:roster] list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const addresses = (wallets ?? []).map((w) => w.address);
  const { data: performance } = addresses.length
    ? await supabase
        .from("kira_wallet_performance")
        .select("wallet_address, period, win_rate, avg_return_pct, trades, computed_at")
        .in("wallet_address", addresses)
        .eq("period", "7d")
    : { data: [] };

  const perfByAddress = new Map((performance ?? []).map((p) => [p.wallet_address, p]));

  res.json({
    wallets: (wallets ?? []).map((w) => ({
      ...w,
      performance7d: perfByAddress.get(w.address) ?? null,
    })),
  });
});

// Debounce bulk roster edits into one PATCH: a fixed jobId + delay means repeated calls while
// the job is still waiting/delayed just no-op against the existing job instead of enqueueing
// a duplicate (standard BullMQ debounce pattern).
async function scheduleHeliusSync(): Promise<void> {
  await heliusSyncQueue.add("sync", {}, { jobId: "helius-sync-debounce", delay: 30_000 });
}

const addWalletSchema = z.object({
  address: z.string().min(32).max(64),
  label: z.string().max(64).optional(),
});

router.post("/", requireRosterCapacity, async (req, res) => {
  const parsed = addWalletSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const { address, label } = parsed.data;

  const { data, error } = await supabase
    .from("kira_roster_wallets")
    .insert({ user_id: req.user!.id, address, label })
    .select("id, address, label, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: "Wallet already in roster" });
      return;
    }
    console.error("[kira-api:roster] insert failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const { data: existingWatch } = await supabase
    .from("kira_watched_addresses")
    .select("address, watcher_count")
    .eq("address", address)
    .maybeSingle();

  await supabase.from("kira_watched_addresses").upsert({
    address,
    watcher_count: (existingWatch?.watcher_count ?? 0) + 1,
  });

  await scheduleHeliusSync();

  res.status(201).json({ wallet: data });
});

router.delete("/:address", async (req, res) => {
  const { address } = req.params;

  const { error, count } = await supabase
    .from("kira_roster_wallets")
    .delete({ count: "exact" })
    .eq("user_id", req.user!.id)
    .eq("address", address);

  if (error) {
    console.error("[kira-api:roster] delete failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  if (!count) {
    res.status(404).json({ error: "Wallet not in roster" });
    return;
  }

  const { data: existing } = await supabase
    .from("kira_watched_addresses")
    .select("address, watcher_count")
    .eq("address", address)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("kira_watched_addresses")
      .update({ watcher_count: Math.max(0, existing.watcher_count - 1) })
      .eq("address", address);
  }

  await scheduleHeliusSync();

  res.status(204).send();
});

const REFRESH_RATE_LIMIT_SECONDS = 60 * 60;

/** Manual single-wallet performance refresh. Pro/Elite only, rate limited to once per hour per
 * wallet so a user can't force-trigger the Helius+GeckoTerminal-heavy scoring pass on demand. */
router.post("/:address/refresh-performance", async (req, res) => {
  const tier = req.userTier ?? "scout";
  if (tier === "scout") {
    res.status(403).json({
      error: "Manual performance refresh is a Pro/Elite feature",
      upgradeUrl: "https://kira.ceronix.ai/upgrade",
    });
    return;
  }

  const { address } = req.params;

  const { count } = await supabase
    .from("kira_roster_wallets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", req.user!.id)
    .eq("address", address);

  if (!count) {
    res.status(404).json({ error: "Wallet not in roster" });
    return;
  }

  const rateLimitKey = `perfrefresh:${address}`;
  const isNew = await redis.set(rateLimitKey, "1", "EX", REFRESH_RATE_LIMIT_SECONDS, "NX");
  if (!isNew) {
    res.status(429).json({ error: "Performance refresh already requested for this wallet in the last hour" });
    return;
  }

  await walletPerformanceQueue.add("score", { walletAddress: address });

  res.status(202).json({ queued: true });
});

const PROFILE_CACHE_TTL_SECONDS = 300;

interface RawPnlStat {
  winrate?: number | null;
  token_num?: number | null;
  avg_holding_period?: number | null;
  pnl_gt_5x_num?: number | null;
  pnl_0x_2x_num?: number | null;
}

interface RawWalletStats {
  wallet_address?: string;
  native_balance?: number | string | null;
  realized_profit?: number | string | null;
  realized_profit_pnl?: number | string | null;
  buy?: number | null;
  sell?: number | null;
  pnl_stat?: RawPnlStat;
  common?: { tags?: string[]; fund_from_address?: string | null };
}

interface RawHolding {
  balance?: number | string | null;
  usd_value?: number | string | null;
  realized_profit?: number | string | null;
  realized_profit_pnl?: number | string | null;
  accu_cost?: number | string | null;
  token?: {
    token_address?: string;
    symbol?: string;
    name?: string;
    logo?: string;
    price?: number | string | null;
  };
}

interface RawActivity {
  transaction_hash?: string;
  base_address?: string;
  side?: string;
  buy_cost_usd?: number | string | null;
  amount_usd?: number | string | null;
  timestamp?: number | null;
  base_token?: { symbol?: string };
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

router.get("/:address/profile", async (req, res) => {
  const { address } = req.params;
  const cacheKey = `wallet:profile:${address}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  const raw = await gmgnApi.getWalletProfileRaw(address);
  if (!raw.stats) {
    res.status(502).json({ error: "Profile data unavailable" });
    return;
  }

  const stats = raw.stats as RawWalletStats;
  const profile = {
    address,
    stats: {
      realizedProfit: num(stats.realized_profit),
      realizedProfitPnl: num(stats.realized_profit_pnl),
      buys: stats.buy ?? 0,
      sells: stats.sell ?? 0,
      totalTrades: (stats.buy ?? 0) + (stats.sell ?? 0),
      winRate: stats.pnl_stat?.winrate ?? null,
      tokenCount: stats.pnl_stat?.token_num ?? null,
      avgHoldingPeriodSeconds: stats.pnl_stat?.avg_holding_period ?? null,
      pnlGt5x: stats.pnl_stat?.pnl_gt_5x_num ?? null,
      pnl0to2x: stats.pnl_stat?.pnl_0x_2x_num ?? null,
      tags: stats.common?.tags ?? [],
      nativeBalance: num(stats.native_balance),
    },
    holdings: (raw.holdings as RawHolding[]).map((h) => ({
      tokenAddress: h.token?.token_address ?? null,
      symbol: h.token?.symbol ?? null,
      name: h.token?.name ?? null,
      logo: h.token?.logo ?? null,
      price: num(h.token?.price),
      balance: num(h.balance),
      usdValue: num(h.usd_value),
      realizedProfit: num(h.realized_profit),
      realizedProfitPnl: num(h.realized_profit_pnl),
    })),
    recentActivity: (raw.activity as RawActivity[]).map((a) => ({
      txHash: a.transaction_hash ?? null,
      tokenAddress: a.base_address ?? null,
      symbol: a.base_token?.symbol ?? null,
      side: a.side === "sell" ? "sell" : "buy",
      usdValue: num(a.buy_cost_usd ?? a.amount_usd),
      timestamp: a.timestamp ?? null,
    })),
  };

  await redis.set(cacheKey, JSON.stringify(profile), "EX", PROFILE_CACHE_TTL_SECONDS);
  res.json(profile);
});

export default router;
