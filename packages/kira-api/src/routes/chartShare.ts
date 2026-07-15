import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

/**
 * Public, unauthenticated read of a single saved drawing set by its own row id, for
 * kira.ceronix.ai/chart/:address/:drawingId share links. Uses the service-role client directly
 * rather than relying on a public-read RLS policy (none is defined on kira_chart_drawings, see
 * migration 006's comment).
 */
router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("kira_chart_drawings")
    .select("token_address, drawings, updated_at")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) {
    console.error("[kira-api:chart-share] lookup failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Drawing not found" });
    return;
  }

  res.json({ tokenAddress: data.token_address, drawings: data.drawings, updatedAt: data.updated_at });
});

export default router;
