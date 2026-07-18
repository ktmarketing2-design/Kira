import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { redis } from "../lib/redis.js";
import { smartWalletRefreshQueue } from "../lib/queue.js";

const router = Router();
const REFRESH_RATE_LIMIT_SECONDS = 60 * 60;

/** Recent smart money events across all tokens, last 24h, newest first. */
router.get("/events", async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("kira_smart_money_events")
    .select("id, wallet_address, token_address, side, usd_value, block_time, kira_smart_wallets(label, category)")
    .gte("block_time", since)
    .order("block_time", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[kira-api:smart-money] events list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ events: data ?? [] });
});

/** Smart money activity for one specific token, last 24h, newest first. */
router.get("/events/:tokenAddress", async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("kira_smart_money_events")
    .select("id, wallet_address, side, usd_value, block_time, kira_smart_wallets(label, category)")
    .eq("token_address", req.params.tokenAddress)
    .gte("block_time", since)
    .order("block_time", { ascending: false });

  if (error) {
    console.error("[kira-api:smart-money] token events failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ events: data ?? [] });
});

/** List of tracked smart wallets. */
router.get("/wallets", async (req, res) => {
  const { data, error } = await supabase
    .from("kira_smart_wallets")
    .select("address, label, category, win_rate_30d, avg_return_30d, is_verified, added_at, tags")
    .order("added_at", { ascending: false });

  if (error) {
    console.error("[kira-api:smart-money] wallets list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ wallets: data ?? [] });
});

/** Sprint 10 Bug 8: manual trigger for the Smart Money tab's "Refresh List" button, which
 * previously had no backend at all. Pro/Elite only + rate limited to once per hour (shared
 * across all users, not per-user -- there's exactly one kira_smart_wallets table, refreshing it
 * twice in the same hour from two different users would just be wasted gmgn-cli calls), same
 * pattern as roster.ts's /:address/refresh-performance route. */
router.post("/refresh", async (req, res) => {
  const tier = req.userTier ?? "scout";
  if (tier === "scout") {
    res.status(403).json({
      error: "Manual smart money refresh is a Pro/Elite feature",
      upgradeUrl: "https://kira.ceronix.ai/upgrade",
    });
    return;
  }

  const isNew = await redis.set("smartwalletrefresh:manual", "1", "EX", REFRESH_RATE_LIMIT_SECONDS, "NX");
  if (!isNew) {
    res.status(429).json({ error: "Smart money refresh already requested in the last hour" });
    return;
  }

  const job = await smartWalletRefreshQueue.add("refresh", {});

  res.status(202).json({ jobId: job.id, message: "Refresh queued" });
});

export default router;
