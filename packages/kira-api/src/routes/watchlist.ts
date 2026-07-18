import { Router } from "express";
import { z } from "zod";
import { jupiter } from "@ceronix/kira-shared";
import { supabase } from "../lib/supabase.js";
import { requireWatchlistCapacity } from "../middleware/tier.js";

const router = Router();

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("kira_watchlist")
    .select("id, token_address, token_symbol, token_name, added_at, notes, price_at_add")
    .eq("user_id", req.user!.id)
    .order("added_at", { ascending: false });

  if (error) {
    console.error("[kira-api:watchlist] list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const rows = data ?? [];
  // Current price fetched here (not client-side) so the Dashboard Watchlist Snapshot can compute
  // real % change without a second route -- jupiter.getPrice is the same lightweight lookup
  // POST /watchlist uses for price_at_add, run in parallel per token rather than sequentially.
  const currentPrices = await Promise.all(rows.map((t) => jupiter.getPrice(t.token_address).catch(() => null)));

  res.json({
    tokens: rows.map((t, i) => ({
      id: t.id,
      tokenAddress: t.token_address,
      tokenSymbol: t.token_symbol,
      tokenName: t.token_name,
      addedAt: t.added_at,
      notes: t.notes,
      priceAtAdd: t.price_at_add,
      currentPriceUsd: currentPrices[i],
    })),
  });
});

const addSchema = z.object({
  tokenAddress: z.string().min(32).max(64),
  tokenSymbol: z.string().max(32).optional(),
  tokenName: z.string().max(128).optional(),
});

router.post("/", requireWatchlistCapacity, async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  // Sprint 10 Bug 3: snapshot the price at add-time so the dashboard Watchlist Snapshot can show
  // real % change later instead of dashes. Uses the lightweight Jupiter price lookup (same one
  // token.ts's header uses), not a full DD job -- adding a watchlist entry shouldn't have to wait
  // on a DD queue round-trip. null if Jupiter has no price for this token; that's an honest
  // "unknown," not a fabricated 0.
  const priceAtAdd = await jupiter.getPrice(parsed.data.tokenAddress).catch(() => null);

  const { data, error } = await supabase
    .from("kira_watchlist")
    .insert({
      user_id: req.user!.id,
      token_address: parsed.data.tokenAddress,
      token_symbol: parsed.data.tokenSymbol,
      token_name: parsed.data.tokenName,
      price_at_add: priceAtAdd,
    })
    .select("id, token_address, token_symbol, token_name, added_at, notes, price_at_add")
    .single();

  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: "Token already in watchlist" });
      return;
    }
    console.error("[kira-api:watchlist] insert failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(201).json({
    token: {
      id: data.id,
      tokenAddress: data.token_address,
      tokenSymbol: data.token_symbol,
      tokenName: data.token_name,
      addedAt: data.added_at,
      notes: data.notes,
      priceAtAdd: data.price_at_add,
    },
  });
});

router.get("/:tokenAddress", async (req, res) => {
  const { count, error } = await supabase
    .from("kira_watchlist")
    .select("id", { count: "exact", head: true })
    .eq("user_id", req.user!.id)
    .eq("token_address", req.params.tokenAddress);

  if (error) {
    console.error("[kira-api:watchlist] check failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ inWatchlist: (count ?? 0) > 0 });
});

router.delete("/:tokenAddress", async (req, res) => {
  const { error, count } = await supabase
    .from("kira_watchlist")
    .delete({ count: "exact" })
    .eq("user_id", req.user!.id)
    .eq("token_address", req.params.tokenAddress);

  if (error) {
    console.error("[kira-api:watchlist] delete failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  if (!count) {
    res.status(404).json({ error: "Token not in watchlist" });
    return;
  }

  res.status(204).send();
});

export default router;
