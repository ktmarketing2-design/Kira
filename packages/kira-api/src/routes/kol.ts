import { Router } from "express";
import { supabase } from "../lib/supabase.js";

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

  let query = supabase
    .from("kira_kol_calls")
    .select("*")
    .order("called_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) query = query.lt("called_at", cursor);
  if (sourceId) query = query.eq("source_id", sourceId);
  if (dateFrom) query = query.gte("called_at", dateFrom);
  if (dateTo) query = query.lte("called_at", dateTo);

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

export default router;
