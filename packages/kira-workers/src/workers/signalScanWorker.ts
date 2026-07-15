import { Worker, type Job } from "bullmq";
import { rugcheck, evaluateSignalFilter, type SignalFilter, type FilterableTokenSnapshot } from "@ceronix/kira-shared";
import { bullConnection, redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { ddQueue, ddQueueEvents, alertDispatchQueue } from "../lib/queues.js";
import type { DdCard } from "./ddWorker.js";

const SEEN_TTL_SECONDS = 48 * 60 * 60;
const MATCH_DEDUPE_TTL_SECONDS = 24 * 60 * 60;

interface SignalScanJobData {
  tokenAddress: string;
  firstSeenAt: number; // ms epoch, from the triggering webhook event
}

interface SignalFilterRow {
  id: string;
  user_id: string;
  name: string;
  min_liquidity_usd: number | null;
  min_fdv_usd: number | null;
  max_fdv_usd: number | null;
  min_volume_24h: number | null;
  min_holders: number | null;
  max_age_hours: number | null;
  launchpads: string[] | null;
  min_rug_score: number | null;
  require_lp_locked: boolean | null;
  require_mint_revoked: boolean | null;
  min_volume_score: number | null;
  min_social_mindshare: number | null;
  min_social_sentiment: number | null;
  min_galaxy_score: number | null;
  require_roster_wallet: boolean;
  min_roster_wallets: number;
}

function mapRow(row: SignalFilterRow): SignalFilter & { id: string; userId: string; name: string } {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    minLiquidityUsd: row.min_liquidity_usd,
    minFdvUsd: row.min_fdv_usd,
    maxFdvUsd: row.max_fdv_usd,
    minVolume24h: row.min_volume_24h,
    minHolders: row.min_holders,
    maxAgeHours: row.max_age_hours,
    launchpads: row.launchpads ?? [],
    minRugScore: row.min_rug_score,
    requireLpLocked: row.require_lp_locked,
    requireMintRevoked: row.require_mint_revoked,
    minVolumeScore: row.min_volume_score,
    minSocialMindshare: row.min_social_mindshare,
    minSocialSentiment: row.min_social_sentiment,
    minGalaxyScore: row.min_galaxy_score,
    requireRosterWallet: row.require_roster_wallet,
    minRosterWallets: row.min_roster_wallets,
  };
}

/**
 * Cheap, RugCheck-only proxy score for the Tier 2 discard decision. Deliberately not the full
 * computeRugScore() formula in ddWorker.ts (that also needs GoPlus's honeypot check, a second
 * API call this tier is specifically trying to avoid paying for tokens that won't survive it).
 * Honeypot status is simply not counted here, Tier 3's full DD pipeline computes the real score.
 */
function proxyRugScore(report: { mintAuthorityRevoked: boolean; freezeAuthorityRevoked: boolean; lpLocked: boolean; top10HolderPct: number | null } | null): number {
  if (!report) return 0;
  let score = 100;
  if (!report.mintAuthorityRevoked) score -= 20;
  if (!report.freezeAuthorityRevoked) score -= 15;
  if (!report.lpLocked) score -= 25;
  if ((report.top10HolderPct ?? 0) > 50) score -= 10;
  return Math.max(0, Math.min(100, score));
}

interface RosterBuyer {
  address: string;
  label: string | null;
  usdValue: number;
}

async function findRosterWalletsBuying(userId: string, tokenAddress: string): Promise<RosterBuyer[]> {
  const { data: rosterRows } = await supabase
    .from("kira_roster_wallets")
    .select("address, label")
    .eq("user_id", userId);
  if (!rosterRows || rosterRows.length === 0) return [];

  const addresses = rosterRows.map((r) => r.address);
  const { data: eventRows } = await supabase
    .from("kira_wallet_events")
    .select("wallet_address, usd_value")
    .eq("token_address", tokenAddress)
    .eq("side", "buy")
    .in("wallet_address", addresses);

  const labelByAddress = new Map(rosterRows.map((r) => [r.address, r.label]));
  const usdByAddress = new Map<string, number>();
  for (const e of eventRows ?? []) {
    usdByAddress.set(e.wallet_address, (usdByAddress.get(e.wallet_address) ?? 0) + (e.usd_value ?? 0));
  }

  return Array.from(usdByAddress.entries()).map(([address, usdValue]) => ({
    address,
    label: labelByAddress.get(address) ?? null,
    usdValue,
  }));
}

async function runDdPipeline(tokenAddress: string): Promise<DdCard | null> {
  const cached = await redis.get(`ddcard:${tokenAddress}`);
  if (cached) return JSON.parse(cached) as DdCard;

  try {
    const job = await ddQueue.add("dd", { tokenAddress }, { removeOnComplete: true, removeOnFail: true });
    return (await job.waitUntilFinished(ddQueueEvents, 20_000)) as DdCard;
  } catch (err) {
    console.error("[kira-workers:signal-scan] dd pipeline failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function processSignalScan(job: Job<SignalScanJobData>): Promise<void> {
  const { tokenAddress, firstSeenAt } = job.data;

  // Tier 1: instant discard, Redis only. Also doubles as "have we scanned this token before".
  const seenKey = `signal:seen:${tokenAddress}`;
  const isNew = await redis.set(seenKey, String(firstSeenAt), "EX", SEEN_TTL_SECONDS, "NX");
  if (!isNew) return;

  const { data: filterRows, error: filterError } = await supabase
    .from("kira_signal_filters")
    .select("*")
    .eq("active", true);

  if (filterError) {
    console.error("[kira-workers:signal-scan] filter load failed:", filterError.message);
    return;
  }
  const filters = (filterRows ?? []).map(mapRow);
  if (filters.length === 0) return; // nobody has an active filter, nothing to evaluate against

  // Tier 2: one RugCheck call, only if some filter actually cares about rug score.
  const filtersWithRugScore = filters.filter((f) => f.minRugScore != null);
  if (filtersWithRugScore.length > 0) {
    const report = await rugcheck.getTokenReport(tokenAddress);
    const lowestThreshold = Math.min(...filtersWithRugScore.map((f) => f.minRugScore as number));
    if (proxyRugScore(report) < lowestThreshold) return;
  }

  // Tier 3: full DD pipeline (cache-checked internally by ddWorker), then evaluate every filter.
  const card = await runDdPipeline(tokenAddress);
  if (!card) return;

  const ageHours = (Date.now() - firstSeenAt) / (1000 * 60 * 60);
  const tokenSnapshot: FilterableTokenSnapshot = {
    liquidityUsd: card.market.liquidityUsd,
    fdvUsd: card.market.fdvUsd,
    volume24hUsd: card.market.volume24hUsd,
    holders: null, // not populated anywhere in the pipeline yet, see kira-workers/README.md
    ageHours,
    launchpad: card.launchpad,
    rugScore: card.safety.rugScore,
    lpLocked: card.safety.lpLocked,
    mintAuthorityRevoked: card.safety.mintAuthorityRevoked,
    volumeScore: card.volume?.score ?? null,
    socialMindshare: card.social?.mindshare ?? null,
    socialSentiment: card.social?.sentiment ?? null,
    galaxyScore: card.social?.galaxyScore ?? null,
  };

  for (const filter of filters) {
    const buyers = filter.requireRosterWallet ? await findRosterWalletsBuying(filter.userId, tokenAddress) : [];
    const rosterWalletCount = buyers.length;

    if (!evaluateSignalFilter(filter, tokenSnapshot, rosterWalletCount)) continue;

    const dedupeKey = `sigfilter:${filter.id}:${tokenAddress}`;
    const isNewMatch = await redis.set(dedupeKey, "1", "EX", MATCH_DEDUPE_TTL_SECONDS, "NX");
    if (!isNewMatch) continue;

    const { data: alert, error: insertError } = await supabase
      .from("kira_alerts")
      .insert({
        user_id: filter.userId,
        type: "signal_filter_match",
        filter_id: filter.id,
        token_address: tokenAddress,
        token_symbol: card.symbol,
        wallet_addresses: buyers.map((b) => b.address),
        wallet_count: rosterWalletCount,
        total_usd: buyers.reduce((sum, b) => sum + b.usdValue, 0),
        window_minutes: 0,
        dd_score: card.safety.rugScore,
        volume_score: card.volume?.score ?? null,
      })
      .select("id")
      .single();

    if (insertError || !alert) {
      console.error("[kira-workers:signal-scan] alert insert failed:", insertError?.message);
      await redis.del(dedupeKey);
      continue;
    }

    await alertDispatchQueue.add("dispatch", { alertId: alert.id });
  }
}

export function startSignalScanWorker(): Worker<SignalScanJobData, void> {
  return new Worker<SignalScanJobData, void>("kira-signal-scan", processSignalScan, {
    connection: bullConnection,
    concurrency: 5,
  });
}
