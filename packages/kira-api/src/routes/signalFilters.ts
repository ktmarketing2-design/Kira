import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireSignalFilterCapacity, TIER_LIMITS } from "../middleware/tier.js";

const router = Router();

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("kira_signal_filters")
    .select("*")
    .eq("user_id", req.user!.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[kira-api:signal-filters] list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const filters = data ?? [];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentMatches } = filters.length
    ? await supabase
        .from("kira_alerts")
        .select("filter_id")
        .eq("type", "signal_filter_match")
        .in(
          "filter_id",
          filters.map((f) => f.id),
        )
        .gte("created_at", since)
    : { data: [] };

  const matchCountByFilter = new Map<string, number>();
  for (const row of recentMatches ?? []) {
    if (!row.filter_id) continue;
    matchCountByFilter.set(row.filter_id, (matchCountByFilter.get(row.filter_id) ?? 0) + 1);
  }

  res.json({
    filters: filters.map((f) => ({ ...f, matches24h: matchCountByFilter.get(f.id) ?? 0 })),
  });
});

const filterSchema = z.object({
  name: z.string().min(1).max(80),
  minLiquidityUsd: z.number().min(0).nullable().optional(),
  minFdvUsd: z.number().min(0).nullable().optional(),
  maxFdvUsd: z.number().min(0).nullable().optional(),
  minVolume24h: z.number().min(0).nullable().optional(),
  minHolders: z.number().int().min(0).nullable().optional(),
  maxAgeHours: z.number().min(0).nullable().optional(),
  launchpads: z.array(z.string()).optional(),
  minRugScore: z.number().int().min(0).max(100).nullable().optional(),
  requireLpLocked: z.boolean().nullable().optional(),
  requireMintRevoked: z.boolean().nullable().optional(),
  minVolumeScore: z.number().int().min(0).max(100).nullable().optional(),
  minSocialMindshare: z.number().min(0).nullable().optional(),
  minSocialSentiment: z.number().min(0).max(10).nullable().optional(),
  minGalaxyScore: z.number().min(0).max(100).nullable().optional(),
  requireRosterWallet: z.boolean().optional(),
  minRosterWallets: z.number().int().min(1).optional(),
});

function toRow(input: Partial<z.infer<typeof filterSchema>>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.minLiquidityUsd !== undefined) row.min_liquidity_usd = input.minLiquidityUsd;
  if (input.minFdvUsd !== undefined) row.min_fdv_usd = input.minFdvUsd;
  if (input.maxFdvUsd !== undefined) row.max_fdv_usd = input.maxFdvUsd;
  if (input.minVolume24h !== undefined) row.min_volume_24h = input.minVolume24h;
  if (input.minHolders !== undefined) row.min_holders = input.minHolders;
  if (input.maxAgeHours !== undefined) row.max_age_hours = input.maxAgeHours;
  if (input.launchpads !== undefined) row.launchpads = input.launchpads;
  if (input.minRugScore !== undefined) row.min_rug_score = input.minRugScore;
  if (input.requireLpLocked !== undefined) row.require_lp_locked = input.requireLpLocked;
  if (input.requireMintRevoked !== undefined) row.require_mint_revoked = input.requireMintRevoked;
  if (input.minVolumeScore !== undefined) row.min_volume_score = input.minVolumeScore;
  if (input.minSocialMindshare !== undefined) row.min_social_mindshare = input.minSocialMindshare;
  if (input.minSocialSentiment !== undefined) row.min_social_sentiment = input.minSocialSentiment;
  if (input.minGalaxyScore !== undefined) row.min_galaxy_score = input.minGalaxyScore;
  if (input.requireRosterWallet !== undefined) row.require_roster_wallet = input.requireRosterWallet;
  if (input.minRosterWallets !== undefined) row.min_roster_wallets = input.minRosterWallets;
  return row;
}

router.post("/", requireSignalFilterCapacity, async (req, res) => {
  const parsed = filterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabase
    .from("kira_signal_filters")
    .insert({ user_id: req.user!.id, ...toRow(parsed.data) })
    .select("*")
    .single();

  if (error) {
    console.error("[kira-api:signal-filters] create failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(201).json({ filter: data });
});

const updateSchema = filterSchema.partial();

router.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabase
    .from("kira_signal_filters")
    .update({ ...toRow(parsed.data), updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("user_id", req.user!.id)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[kira-api:signal-filters] update failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Filter not found" });
    return;
  }

  res.json({ filter: data });
});

router.delete("/:id", async (req, res) => {
  const { error, count } = await supabase
    .from("kira_signal_filters")
    .delete({ count: "exact" })
    .eq("id", req.params.id)
    .eq("user_id", req.user!.id);

  if (error) {
    console.error("[kira-api:signal-filters] delete failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  if (!count) {
    res.status(404).json({ error: "Filter not found" });
    return;
  }

  res.status(204).send();
});

router.patch("/:id/toggle", async (req, res) => {
  const { data: existing, error: lookupError } = await supabase
    .from("kira_signal_filters")
    .select("id, active")
    .eq("id", req.params.id)
    .eq("user_id", req.user!.id)
    .maybeSingle();

  if (lookupError) {
    console.error("[kira-api:signal-filters] toggle lookup failed:", lookupError.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  if (!existing) {
    res.status(404).json({ error: "Filter not found" });
    return;
  }

  const activating = !existing.active;
  if (activating) {
    const tier = req.userTier ?? "scout";
    const limit = TIER_LIMITS[tier].maxSignalFilters;
    if (limit !== Infinity) {
      const { count } = await supabase
        .from("kira_signal_filters")
        .select("id", { count: "exact", head: true })
        .eq("user_id", req.user!.id)
        .eq("active", true);
      if ((count ?? 0) >= limit) {
        res.status(403).json({
          error: `Active Signal Filter limit reached (${limit} on ${tier} tier)`,
          upgradeUrl: "https://kira.ceronix.ai/upgrade",
        });
        return;
      }
    }
  }

  const { data, error } = await supabase
    .from("kira_signal_filters")
    .update({ active: activating, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select("*")
    .single();

  if (error) {
    console.error("[kira-api:signal-filters] toggle failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ filter: data });
});

export default router;
