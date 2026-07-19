import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireUserKolSourceCapacity } from "../middleware/tier.js";

const router = Router();

const PAGE_SIZE = 30;
// Computed in application code rather than a SQL view/function, keeping the Sprint 5 migration
// set to exactly the three files the build spec lists (004, 005, 006), no fourth migration for
// a stats view. Call volume is bounded (KOL ingestion watches ~10 channels), fine to aggregate
// in JS rather than push the computation into Postgres.
const MAX_CALLS_FOR_AGGREGATION = 5000;

interface KolCallRow {
  id: string;
  source_id: string;
  token_address: string;
  called_at: string;
  price_at_call: number | null;
  price_1h: number | null;
  price_4h: number | null;
  price_24h: number | null;
  price_7d: number | null;
  source_type: "telegram" | "gmgn_kol" | "twitter";
}

function returnPct(entry: number | null, exit: number | null): number | null {
  if (entry == null || exit == null || entry === 0) return null;
  return ((exit - entry) / entry) * 100;
}

function isWin(entry: number | null, exit: number | null): boolean | null {
  const pct = returnPct(entry, exit);
  if (pct == null) return null;
  return pct > 0;
}

router.get("/sources", async (_req, res) => {
  const [{ data: sources, error: sourcesError }, { data: calls, error: callsError }] = await Promise.all([
    supabase.from("kira_kol_sources").select("*").order("display_name", { ascending: true }),
    supabase
      .from("kira_kol_calls")
      .select("id, source_id, token_address, called_at, price_at_call, price_1h, price_4h, price_24h, price_7d")
      .order("called_at", { ascending: false })
      .limit(MAX_CALLS_FOR_AGGREGATION),
  ]);

  if (sourcesError || callsError) {
    console.error("[kira-api:kol] sources/calls load failed:", sourcesError?.message, callsError?.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60 * 1000;
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;

  const callsBySource = new Map<string, KolCallRow[]>();
  for (const call of (calls as KolCallRow[] | null) ?? []) {
    const list = callsBySource.get(call.source_id) ?? [];
    list.push(call);
    callsBySource.set(call.source_id, list);
  }

  const totalCallsAllSources = (calls ?? []).length;

  const results = (sources ?? []).map((source) => {
    const sourceCalls = callsBySource.get(source.id) ?? [];
    const calls24h = sourceCalls.filter((c) => new Date(c.called_at).getTime() >= cutoff24h);
    const calls7d = sourceCalls.filter((c) => new Date(c.called_at).getTime() >= cutoff7d);

    const winRate = (subset: KolCallRow[], field: "price_24h" | "price_7d"): number | null => {
      const decided = subset.map((c) => isWin(c.price_at_call, c[field])).filter((w): w is boolean => w != null);
      if (decided.length === 0) return null;
      return decided.filter(Boolean).length / decided.length;
    };

    const avgReturn24h = (() => {
      const returns = calls24h
        .map((c) => returnPct(c.price_at_call, c.price_24h))
        .filter((r): r is number => r != null);
      if (returns.length === 0) return null;
      return returns.reduce((a, b) => a + b, 0) / returns.length;
    })();

    return {
      id: source.id,
      platform: source.platform,
      displayName: source.display_name,
      channelIdentifier: source.channel_identifier,
      active: source.active,
      totalCalls: sourceCalls.length,
      winRate24h: winRate(calls24h, "price_24h"),
      winRate7d: winRate(calls7d, "price_7d"),
      avgReturn24h,
      lastCallAt: sourceCalls[0]?.called_at ?? null,
    };
  });

  res.json({ sources: results, totalCalls: totalCallsAllSources, warmingUp: totalCallsAllSources < 10 });
});

router.get("/calls", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const sourceId = typeof req.query.source === "string" ? req.query.source : undefined;
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
  const minReturn = typeof req.query.minReturn === "string" ? Number(req.query.minReturn) : undefined;
  const sourceType = typeof req.query.sourceType === "string" ? req.query.sourceType : undefined;

  let query = supabase
    .from("kira_kol_calls")
    .select("*")
    .order("called_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) query = query.lt("called_at", cursor);
  if (sourceId) query = query.eq("source_id", sourceId);
  if (dateFrom) query = query.gte("called_at", dateFrom);
  if (dateTo) query = query.lte("called_at", dateTo);
  if (sourceType === "telegram" || sourceType === "gmgn_kol" || sourceType === "twitter") query = query.eq("source_type", sourceType);

  const { data, error } = await query;
  if (error) {
    console.error("[kira-api:kol] calls list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  let calls = (data as KolCallRow[] | null) ?? [];
  if (minReturn != null && Number.isFinite(minReturn)) {
    calls = calls.filter((c) => {
      const pct = returnPct(c.price_at_call, c.price_24h);
      return pct != null && pct >= minReturn;
    });
  }

  const nextCursor = data && data.length === PAGE_SIZE ? data[data.length - 1].called_at : null;

  res.json({
    calls: calls.map((c) => ({
      id: c.id,
      sourceId: c.source_id,
      sourceType: c.source_type,
      tokenAddress: c.token_address,
      calledAt: c.called_at,
      priceAtCall: c.price_at_call,
      return1h: returnPct(c.price_at_call, c.price_1h),
      return4h: returnPct(c.price_at_call, c.price_4h),
      return24h: returnPct(c.price_at_call, c.price_24h),
      return7d: returnPct(c.price_at_call, c.price_7d),
    })),
    nextCursor,
  });
});

router.get("/sources/:id/calls", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

  let query = supabase
    .from("kira_kol_calls")
    .select("*")
    .eq("source_id", req.params.id)
    .order("called_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) query = query.lt("called_at", cursor);

  const { data, error } = await query;
  if (error) {
    console.error("[kira-api:kol] source calls failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const calls = (data as KolCallRow[] | null) ?? [];
  const nextCursor = calls.length === PAGE_SIZE ? calls[calls.length - 1].called_at : null;

  res.json({
    calls: calls.map((c) => ({
      id: c.id,
      sourceId: c.source_id,
      sourceType: c.source_type,
      tokenAddress: c.token_address,
      calledAt: c.called_at,
      priceAtCall: c.price_at_call,
      return1h: returnPct(c.price_at_call, c.price_1h),
      return4h: returnPct(c.price_at_call, c.price_4h),
      return24h: returnPct(c.price_at_call, c.price_24h),
      return7d: returnPct(c.price_at_call, c.price_7d),
    })),
    nextCursor,
  });
});

// ============================================================================
// Personal KOL sources (Sprint 8 Bug 4): user-managed channel list, separate from the
// curated kira_kol_sources table above. Management (add/list/remove) only -- kolIngestWorker
// does not yet watch these channels, so totalCalls/lastCallAt stay 0/null until that ingestion
// path is built as separate follow-up work. Flagged to the user rather than silently building a
// bigger ingestion change under a "bug fix" label.
// ============================================================================

const CHANNEL_HANDLE_RE = /^@?[A-Za-z0-9_]{5,32}$/;

function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

router.get("/user-sources", async (req, res) => {
  const [{ data: sources, error: sourcesError }, { data: calls, error: callsError }] = await Promise.all([
    supabase
      .from("kira_user_kol_sources")
      .select("id, platform, channel_identifier, display_name, active, added_at")
      .eq("user_id", req.user!.id)
      .order("added_at", { ascending: false }),
    // source_user_id (not source_id): personal-channel calls are attributed to the user, not a
    // kira_kol_sources row. message_id is prefixed "user:<personalSourceId>:<telegramMessageId>"
    // by kolIngestWorker specifically so a single query here can be split back out per-channel
    // in JS below, without an extra query per source.
    supabase
      .from("kira_kol_calls")
      .select("message_id, called_at")
      .eq("source_user_id", req.user!.id)
      .order("called_at", { ascending: false })
      .limit(MAX_CALLS_FOR_AGGREGATION),
  ]);

  if (sourcesError || callsError) {
    console.error("[kira-api:kol] user-sources list failed:", sourcesError?.message, callsError?.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const statsBySourceId = new Map<string, { totalCalls: number; lastCallAt: string }>();
  for (const call of (calls as { message_id: string; called_at: string }[] | null) ?? []) {
    const match = /^user:([^:]+):/.exec(call.message_id);
    if (!match) continue;
    const sourceId = match[1];
    const existing = statsBySourceId.get(sourceId);
    if (existing) {
      existing.totalCalls++;
    } else {
      // calls arrive ordered called_at desc, so the first one seen per source is the latest.
      statsBySourceId.set(sourceId, { totalCalls: 1, lastCallAt: call.called_at });
    }
  }

  res.json({
    sources: (sources ?? []).map((s) => {
      const stats = statsBySourceId.get(s.id);
      return {
        id: s.id,
        platform: s.platform,
        channelIdentifier: s.channel_identifier,
        displayName: s.display_name,
        active: s.active,
        addedAt: s.added_at,
        totalCalls: stats?.totalCalls ?? 0,
        lastCallAt: stats?.lastCallAt ?? null,
      };
    }),
  });
});

const addUserSourceSchema = z.object({
  channelIdentifier: z.string().min(1).max(64),
});

router.post("/user-sources", requireUserKolSourceCapacity, async (req, res) => {
  const parsed = addUserSourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const handle = normalizeHandle(parsed.data.channelIdentifier);
  if (!CHANNEL_HANDLE_RE.test(handle)) {
    res.status(400).json({ error: "Enter a valid Telegram @handle" });
    return;
  }

  const { data, error } = await supabase
    .from("kira_user_kol_sources")
    .insert({ user_id: req.user!.id, platform: "telegram", channel_identifier: handle })
    .select("id, platform, channel_identifier, display_name, active, added_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: "That channel is already in your sources" });
      return;
    }
    console.error("[kira-api:kol] user-source insert failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(201).json({
    source: {
      id: data.id,
      platform: data.platform,
      channelIdentifier: data.channel_identifier,
      displayName: data.display_name,
      active: data.active,
      addedAt: data.added_at,
      totalCalls: 0,
      lastCallAt: null,
    },
  });
});

router.delete("/user-sources/:id", async (req, res) => {
  const { error, count } = await supabase
    .from("kira_user_kol_sources")
    .delete({ count: "exact" })
    .eq("id", req.params.id)
    .eq("user_id", req.user!.id);

  if (error) {
    console.error("[kira-api:kol] user-source delete failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  if (!count) {
    res.status(404).json({ error: "Source not found" });
    return;
  }

  res.status(204).send();
});

// ============================================================================
// Notification preferences (Sprint 10 Bug 5): the Leaderboard tab's per-row Chart Bubbles/Toast/
// Alerts toggles were pure local component state, discarded on refresh. kira_kol_notification_prefs
// scopes source_id to kira_kol_sources (the curated list) only, per the sprint's own migration --
// personal (kira_user_kol_sources) rows have no FK target here, so their row toggles necessarily
// stay local-only, same as before. This isn't an oversight: persisting preferences for a source
// the user could delete/re-add at will (personal sources) is a different feature than persisting
// them for the fixed curated list, and the schema as specified only covers the latter.
// ============================================================================

const prefsRowSchema = z.object({
  chart_bubbles: z.boolean(),
  toast: z.boolean(),
  alert_types: z.array(z.string()),
});

router.get("/prefs", async (req, res) => {
  const { data, error } = await supabase
    .from("kira_kol_notification_prefs")
    .select("source_id, chart_bubbles, toast, alert_types")
    .eq("user_id", req.user!.id);

  if (error) {
    console.error("[kira-api:kol] prefs list failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({
    prefs: (data ?? []).map((p) => ({
      sourceId: p.source_id,
      chartBubbles: p.chart_bubbles,
      toast: p.toast,
      alertTypes: p.alert_types,
    })),
  });
});

router.post("/prefs/:sourceId", async (req, res) => {
  const parsed = prefsRowSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabase
    .from("kira_kol_notification_prefs")
    .upsert(
      {
        user_id: req.user!.id,
        source_id: req.params.sourceId,
        chart_bubbles: parsed.data.chart_bubbles,
        toast: parsed.data.toast,
        alert_types: parsed.data.alert_types,
      },
      { onConflict: "user_id,source_id" },
    )
    .select("source_id, chart_bubbles, toast, alert_types")
    .single();

  if (error) {
    if (error.code === "23503") {
      // FK violation -- sourceId isn't a real kira_kol_sources row (e.g. a personal source id).
      res.status(400).json({ error: "Not a valid curated KOL source" });
      return;
    }
    console.error("[kira-api:kol] prefs upsert failed:", error.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.json({
    pref: {
      sourceId: data.source_id,
      chartBubbles: data.chart_bubbles,
      toast: data.toast,
      alertTypes: data.alert_types,
    },
  });
});

export default router;
