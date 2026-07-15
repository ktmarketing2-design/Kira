import { Worker, type Job } from "bullmq";
import { evaluateCluster, type ClusterMember } from "@ceronix/kira-shared";
import { bullConnection, redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { alertDispatchQueue, ddQueue } from "../lib/queues.js";

const MAX_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h ceiling on cluster state
const CLUSTERBUY_TTL_SECONDS = 6 * 60 * 60;
const ALERT_DEDUPE_TTL_SECONDS = 12 * 60 * 60;

interface ClusterEvalJobData {
  walletAddress: string;
  tokenAddress: string;
  side: "buy" | "sell";
  usdValue: number;
  timestamp: number;
}

interface AlertSettingsRow {
  user_id: string;
  cluster_threshold: number;
  window_minutes: number;
  min_usd_per_buy: number;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  timezone: string;
}

function isWithinQuietHours(settings: AlertSettingsRow, now = new Date()): boolean {
  if (settings.quiet_hours_start == null || settings.quiet_hours_end == null) return false;

  let localHour: number;
  try {
    localHour = Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: settings.timezone }).format(
        now,
      ),
    );
  } catch {
    localHour = now.getUTCHours(); // fall back if timezone string is invalid
  }

  const { quiet_hours_start: start, quiet_hours_end: end } = settings;
  if (start <= end) {
    return localHour >= start && localHour < end;
  }
  // Wraps past midnight, e.g. 22 -> 6.
  return localHour >= start || localHour < end;
}

async function processClusterEval(job: Job<ClusterEvalJobData>): Promise<void> {
  const { walletAddress, tokenAddress, side, usdValue, timestamp } = job.data;

  // Cluster-buy detection only, per the Redis key design (clusterbuy:* is buy-specific).
  // cluster_sell / new_token_cluster detection is not part of the Sprint 1-2 spec.
  if (side !== "buy") return;

  const clusterKey = `cluster:${tokenAddress}`;
  await redis.zadd(clusterKey, timestamp, walletAddress);
  await redis.expire(clusterKey, Math.ceil(MAX_WINDOW_MS / 1000));
  await redis.set(`clusterbuy:${tokenAddress}:${walletAddress}`, String(usdValue), "EX", CLUSTERBUY_TTL_SECONDS);

  const trimBefore = Date.now() - MAX_WINDOW_MS;
  await redis.zremrangebyscore(clusterKey, 0, trimBefore);

  const { data: interestedRows, error: rosterError } = await supabase
    .from("kira_roster_wallets")
    .select("user_id")
    .eq("address", walletAddress);

  if (rosterError) {
    console.error("[kira-workers:cluster] roster lookup failed:", rosterError.message);
    return;
  }

  const userIds = Array.from(new Set((interestedRows ?? []).map((r) => r.user_id)));
  if (userIds.length === 0) return;

  const memberEntries = await redis.zrange(clusterKey, 0, -1, "WITHSCORES");
  const clusterMembers: ClusterMember[] = [];
  for (let i = 0; i < memberEntries.length; i += 2) {
    const wallet = memberEntries[i];
    const ts = Number(memberEntries[i + 1]);
    const usd = Number((await redis.get(`clusterbuy:${tokenAddress}:${wallet}`)) ?? 0);
    clusterMembers.push({ walletAddress: wallet, timestamp: ts, usdValue: usd, side: "buy" });
  }

  for (const userId of userIds) {
    try {
      await evaluateForUser(userId, tokenAddress, clusterMembers);
    } catch (err) {
      console.error(
        "[kira-workers:cluster] evaluation failed for user",
        userId,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function evaluateForUser(userId: string, tokenAddress: string, clusterMembers: ClusterMember[]): Promise<void> {
  const [{ data: settings, error: settingsError }, { data: rosterRows, error: rosterError }] = await Promise.all([
    supabase.from("kira_alert_settings").select("*").eq("user_id", userId).maybeSingle<AlertSettingsRow>(),
    supabase.from("kira_roster_wallets").select("address").eq("user_id", userId),
  ]);

  if (settingsError || rosterError || !settings) {
    if (settingsError) console.error("[kira-workers:cluster] settings lookup failed:", settingsError.message);
    if (rosterError) console.error("[kira-workers:cluster] roster lookup failed:", rosterError.message);
    return;
  }

  const rosterAddresses = (rosterRows ?? []).map((r) => r.address);

  const result = evaluateCluster(clusterMembers, rosterAddresses, {
    threshold: settings.cluster_threshold,
    windowMinutes: settings.window_minutes,
    minUsdPerBuy: settings.min_usd_per_buy,
  });

  if (!result.fires) return;

  const dedupeKey = `alertdedupe:${userId}:${tokenAddress}`;
  const isNew = await redis.set(dedupeKey, "1", "EX", ALERT_DEDUPE_TTL_SECONDS, "NX");
  if (!isNew) return;

  if (isWithinQuietHours(settings)) return;

  const { data: alert, error: insertError } = await supabase
    .from("kira_alerts")
    .insert({
      user_id: userId,
      type: "cluster_buy",
      token_address: tokenAddress,
      wallet_addresses: result.triggeringWallets,
      wallet_count: result.triggeringWallets.length,
      total_usd: result.totalUsd,
      window_minutes: result.windowMinutes,
      first_buyer_address: result.firstMover,
    })
    .select("id")
    .single();

  if (insertError || !alert) {
    console.error("[kira-workers:cluster] alert insert failed:", insertError?.message);
    // Undo the dedupe key so a retry can create the alert.
    await redis.del(dedupeKey);
    return;
  }

  // Pre-warm (Sprint 5 Part 5): kick off DD generation the moment the alert fires, in parallel
  // with alert-dispatch rather than waiting for it to trigger the same job later. ddWorker checks
  // its own Redis cache first, so this is a safe no-op if something else already warmed it, and
  // alert-dispatch's own DD fetch (needed for rug/volume score in the message body) will find a
  // warm cache instead of a cold 10+s generation. Not awaited, this must not delay alert-dispatch.
  void ddQueue.add("dd", { tokenAddress }, { removeOnComplete: true, removeOnFail: true }).catch((err: unknown) => {
    console.error("[kira-workers:cluster] dd pre-warm enqueue failed:", err instanceof Error ? err.message : err);
  });

  await alertDispatchQueue.add("dispatch", { alertId: alert.id });
}

export function startClusterWorker(): Worker<ClusterEvalJobData, void> {
  return new Worker<ClusterEvalJobData, void>("kira-cluster-eval", processClusterEval, {
    connection: bullConnection,
    concurrency: 10,
  });
}
