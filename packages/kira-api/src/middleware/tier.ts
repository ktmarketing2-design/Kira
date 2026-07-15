import type { NextFunction, Request, Response } from "express";
import { supabase } from "../lib/supabase.js";
import { redis } from "../lib/redis.js";
import type { KiraProfile, KiraTier } from "../types.js";

export const TIER_LIMITS: Record<
  KiraTier,
  { maxWallets: number; maxDdPerDay: number; minClusterThreshold: number }
> = {
  scout: { maxWallets: 5, maxDdPerDay: 10, minClusterThreshold: 3 },
  pro: { maxWallets: 50, maxDdPerDay: Infinity, minClusterThreshold: 2 },
  elite: { maxWallets: Infinity, maxDdPerDay: Infinity, minClusterThreshold: 2 },
  studio: { maxWallets: Infinity, maxDdPerDay: Infinity, minClusterThreshold: 2 },
};

/** Reads kira_profiles.tier and attaches req.userTier / req.profile. Runs after authMiddleware. */
export async function tierMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Missing authenticated user" });
    return;
  }

  try {
    let { data: profile, error } = await supabase
      .from("kira_profiles")
      .select("id, telegram_user_id, telegram_username, tier, tier_expires_at")
      .eq("id", req.user.id)
      .maybeSingle<KiraProfile>();

    if (error) {
      console.error("[kira-api:tier] profile lookup failed:", error.message);
      res.status(500).json({ error: "Internal server error resolving tier" });
      return;
    }

    if (!profile) {
      const { data: created, error: insertError } = await supabase
        .from("kira_profiles")
        .insert({ id: req.user.id })
        .select("id, telegram_user_id, telegram_username, tier, tier_expires_at")
        .single<KiraProfile>();

      if (insertError || !created) {
        console.error("[kira-api:tier] profile creation failed:", insertError?.message);
        res.status(500).json({ error: "Internal server error creating profile" });
        return;
      }
      profile = created;
    }

    const expired =
      profile.tier !== "scout" &&
      profile.tier_expires_at !== null &&
      new Date(profile.tier_expires_at).getTime() < Date.now();

    req.profile = profile;
    req.userTier = expired ? "scout" : profile.tier;
    next();
  } catch (err) {
    console.error("[kira-api:tier] unexpected error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Internal server error resolving tier" });
  }
}

/** Rejects adding a roster wallet once the tier's wallet cap is reached. */
export async function requireRosterCapacity(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tier = req.userTier ?? "scout";
  const limit = TIER_LIMITS[tier].maxWallets;

  if (limit === Infinity) {
    next();
    return;
  }

  const { count, error } = await supabase
    .from("kira_roster_wallets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", req.user!.id);

  if (error) {
    console.error("[kira-api:tier] roster count failed:", error.message);
    res.status(500).json({ error: "Internal server error checking roster limit" });
    return;
  }

  if ((count ?? 0) >= limit) {
    res.status(403).json({
      error: `Roster limit reached (${limit} wallets on ${tier} tier)`,
      upgradeUrl: "https://kira.ceronix.ai/upgrade",
    });
    return;
  }

  next();
}

/** Rejects (and otherwise increments) the Scout-tier daily DD request counter. */
export async function requireDdQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tier = req.userTier ?? "scout";
  const limit = TIER_LIMITS[tier].maxDdPerDay;

  if (limit === Infinity) {
    next();
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const key = `ddlimit:${req.user!.id}:${today}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, 60 * 60 * 26); // just past a day, covers timezone edges
  }

  if (current > limit) {
    res.status(403).json({
      error: `Daily Deep Dive limit reached (${limit}/day on ${tier} tier)`,
      upgradeUrl: "https://kira.ceronix.ai/upgrade",
    });
    return;
  }

  next();
}

/** Clamps requested alert settings to what the tier allows. Used inline in PATCH /me/settings. */
export function clampClusterThreshold(tier: KiraTier, requested: number): number {
  const minAllowed = TIER_LIMITS[tier].minClusterThreshold;
  return Math.max(requested, minAllowed);
}
