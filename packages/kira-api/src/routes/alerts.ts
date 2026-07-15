import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { redis } from "../lib/redis.js";

const router = Router();

const PAGE_SIZE = 20;

// kira_alerts has no "read" column in the Phase 1 schema (PRD Section 4), so read state is
// tracked out-of-band in a Redis set rather than altering the migration.
function readSetKey(userId: string): string {
  return `alertsread:${userId}`;
}

router.get("/", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const type = typeof req.query.type === "string" ? req.query.type : undefined;

  let query = supabase
    .from("kira_alerts")
    .select("*")
    .eq("user_id", req.user!.id)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) query = query.lt("created_at", cursor);
  if (type) query = query.eq("type", type);

  const { data, error } = await query;
  if (error) {
    console.error("[kira-api:alerts] list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const alerts = data ?? [];
  const readIds = alerts.length
    ? new Set(await redis.smembers(readSetKey(req.user!.id)))
    : new Set<string>();

  const nextCursor = alerts.length === PAGE_SIZE ? alerts[alerts.length - 1].created_at : null;

  res.json({
    alerts: alerts.map((a) => ({ ...a, read: readIds.has(a.id) })),
    nextCursor,
  });
});

router.post("/:id/read", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("kira_alerts")
    .select("id")
    .eq("id", id)
    .eq("user_id", req.user!.id)
    .maybeSingle();

  if (error) {
    console.error("[kira-api:alerts] read lookup failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  if (!data) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }

  await redis.sadd(readSetKey(req.user!.id), id);
  res.status(204).send();
});

export default router;
