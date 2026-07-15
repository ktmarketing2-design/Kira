import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireRosterCapacity } from "../middleware/tier.js";
import { heliusSyncQueue } from "../lib/queue.js";

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
        .select("wallet_address, period, win_rate, avg_return_pct, trades")
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

export default router;
