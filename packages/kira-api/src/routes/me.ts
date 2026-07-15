import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { clampClusterThreshold } from "../middleware/tier.js";

const router = Router();

router.get("/", async (req, res) => {
  const { data: settings, error } = await supabase
    .from("kira_alert_settings")
    .select("*")
    .eq("user_id", req.user!.id)
    .maybeSingle();

  if (error) {
    console.error("[kira-api:me] settings lookup failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({
    profile: req.profile,
    tier: req.userTier,
    tierExpiresAt: req.profile?.tier_expires_at ?? null,
    settings: settings ?? null,
  });
});

const settingsSchema = z.object({
  clusterThreshold: z.number().int().min(2).max(10).optional(),
  windowMinutes: z.number().int().min(15).max(1440).optional(),
  minUsdPerBuy: z.number().min(0).optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
  timezone: z.string().optional(),
});

router.patch("/settings", async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid settings payload", details: parsed.error.flatten() });
    return;
  }

  const tier = req.userTier ?? "scout";
  const input = parsed.data;

  const update: Record<string, unknown> = { user_id: req.user!.id };
  if (input.clusterThreshold !== undefined) {
    update.cluster_threshold = clampClusterThreshold(tier, input.clusterThreshold);
  }
  if (input.windowMinutes !== undefined) update.window_minutes = input.windowMinutes;
  if (input.minUsdPerBuy !== undefined) update.min_usd_per_buy = input.minUsdPerBuy;
  if (input.quietHoursStart !== undefined) update.quiet_hours_start = input.quietHoursStart;
  if (input.quietHoursEnd !== undefined) update.quiet_hours_end = input.quietHoursEnd;
  if (input.timezone !== undefined) update.timezone = input.timezone;

  const { data, error } = await supabase
    .from("kira_alert_settings")
    .upsert(update, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    console.error("[kira-api:me] settings update failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({ settings: data });
});

export default router;
