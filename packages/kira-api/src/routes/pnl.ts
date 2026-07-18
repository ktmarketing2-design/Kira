import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requirePnlWalletCapacity } from "../middleware/tier.js";

const router = Router();

router.get("/wallets", async (req, res) => {
  const { data, error } = await supabase
    .from("kira_pnl_wallets")
    .select("*")
    .eq("user_id", req.user!.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[kira-api:pnl] wallet list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ wallets: data ?? [] });
});

const addWalletSchema = z.object({
  address: z.string().min(32).max(64),
  label: z.string().max(64).optional(),
});

router.post("/wallets", requirePnlWalletCapacity, async (req, res) => {
  const parsed = addWalletSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabase
    .from("kira_pnl_wallets")
    .insert({ user_id: req.user!.id, address: parsed.data.address, label: parsed.data.label })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: "Wallet already tracked for PnL" });
      return;
    }
    console.error("[kira-api:pnl] wallet add failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(201).json({ wallet: data });
});

router.delete("/wallets/:address", async (req, res) => {
  const { error, count } = await supabase
    .from("kira_pnl_wallets")
    .delete({ count: "exact" })
    .eq("user_id", req.user!.id)
    .eq("address", req.params.address);

  if (error) {
    console.error("[kira-api:pnl] wallet remove failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  if (!count) {
    res.status(404).json({ error: "Wallet not tracked" });
    return;
  }

  res.status(204).send();
});

router.get("/snapshots", async (req, res) => {
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet : undefined;

  let query = supabase
    .from("kira_pnl_snapshots")
    .select("*")
    .eq("user_id", req.user!.id)
    .order("date", { ascending: true });

  if (dateFrom) query = query.gte("date", dateFrom);
  if (dateTo) query = query.lte("date", dateTo);
  if (wallet) query = query.eq("wallet_address", wallet);

  const { data, error } = await query;
  if (error) {
    console.error("[kira-api:pnl] snapshots load failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ snapshots: data ?? [] });
});

/** Sprint 10 Bug 6: individual trades from kira_pnl_trades (written by pnlDigestWorker
 * alongside the daily snapshot), replacing the History tab's previous daily-snapshot-only view. */
router.get("/trades", async (req, res) => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet : undefined;
  const dateFrom = typeof req.query.from === "string" ? req.query.from : undefined;
  const dateTo = typeof req.query.to === "string" ? req.query.to : undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

  let query = supabase
    .from("kira_pnl_trades")
    .select("*")
    .eq("user_id", req.user!.id)
    .order("traded_at", { ascending: false })
    .limit(limit);

  if (wallet) query = query.eq("wallet_address", wallet);
  if (dateFrom) query = query.gte("traded_at", dateFrom);
  if (dateTo) query = query.lte("traded_at", dateTo);
  if (cursor) query = query.lt("traded_at", cursor);

  const { data, error } = await query;
  if (error) {
    console.error("[kira-api:pnl] trades load failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const trades = data ?? [];
  const nextCursor = trades.length === limit ? trades[trades.length - 1].traded_at : null;

  res.json({
    trades: trades.map((t) => ({
      id: t.id,
      walletAddress: t.wallet_address,
      tokenAddress: t.token_address,
      tokenSymbol: t.token_symbol,
      side: t.side,
      tokenAmount: t.token_amount,
      usdValue: t.usd_value,
      priceAtTrade: t.price_at_trade,
      tradedAt: t.traded_at,
    })),
    nextCursor,
  });
});

export default router;
