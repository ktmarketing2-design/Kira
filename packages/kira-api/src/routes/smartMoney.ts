import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

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
    .select("address, label, category, win_rate_30d, avg_return_30d, is_verified, added_at")
    .order("added_at", { ascending: false });

  if (error) {
    console.error("[kira-api:smart-money] wallets list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ wallets: data ?? [] });
});

export default router;
