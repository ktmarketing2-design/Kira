import { Router } from "express";
import { z } from "zod";
import { redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { ddQueue, ddQueueEvents, volumeQueue, volumeQueueEvents } from "../lib/queue.js";
import { requireDdQuota } from "../middleware/tier.js";

const router = Router();

const DD_JOB_TIMEOUT_MS = 15_000;
const VOLUME_JOB_TIMEOUT_MS = 15_000;

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

export default router;
