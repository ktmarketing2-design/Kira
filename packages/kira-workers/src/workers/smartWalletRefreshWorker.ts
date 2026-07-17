import { Worker } from "bullmq";
import { gmgnApi } from "@ceronix/kira-shared";
import { bullConnection } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { heliusSyncQueue } from "../lib/queues.js";

// Bounds worst-case worker runtime: each gmgn-cli invocation is a real subprocess + network
// round-trip, not a cheap in-process call. 10 tokens x up to 20 smart-money holders each, deduped,
// then one portfolio-stats lookup per unique wallet.
const TOKEN_SAMPLE_SIZE = 10;
const HOLDERS_PER_TOKEN = 20;
const MAX_WALLETS_SCORED = 50;

/** GMGN's tags for this endpoint describe trading-bot affiliation ('trojan', 'pump_smart') and
 * social status ('app_smart_money') far more often than a wallet archetype, so 'whale' is the
 * only one that maps cleanly. Everything else defaults to 'dex_trader'. */
function categorize(tags: string[]): "whale" | "dex_trader" | "early_buyer" | "fund" {
  if (tags.includes("whale")) return "whale";
  return "dex_trader";
}

/** Most frequently called tokens in kira_kol_calls, newest-first window capped at 1000 rows
 * (kira_kol_calls has no aggregate/count RPC exposed, so this counts client-side over a bounded
 * recent sample rather than the full table). */
async function loadMostCalledTokens(limit: number): Promise<string[]> {
  const { data, error } = await supabase
    .from("kira_kol_calls")
    .select("token_address")
    .order("called_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("[kira-workers:smart-wallet-refresh] kira_kol_calls load failed:", error.message);
    return [];
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.token_address, (counts.get(row.token_address) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tokenAddress]) => tokenAddress);
}

// Every wallet reaching here came from the token holders --tag smart_degen query, which is the
// selection filter, not something guaranteed to also appear in the wallet's own tags array
// (verified live: most did not carry app_smart_money there despite being smart_degen matches).
// Label reflects how the wallet was actually sourced, not a re-check of its self-reported tags.
function labelFor(rank: number): string {
  return `GMGN Smart Money #${rank}`;
}

async function processSmartWalletRefresh(): Promise<void> {
  const tokens = await loadMostCalledTokens(TOKEN_SAMPLE_SIZE);
  if (tokens.length === 0) {
    console.error("[kira-workers:smart-wallet-refresh] no KOL-called tokens found, skipping this run");
    return;
  }

  const walletTags = new Map<string, string[]>();
  for (const tokenAddress of tokens) {
    const holders = await gmgnApi.getSmartMoneyHolders(tokenAddress, HOLDERS_PER_TOKEN);
    for (const holder of holders) {
      if (!walletTags.has(holder.walletAddress)) {
        walletTags.set(holder.walletAddress, holder.tags);
      }
    }
  }

  if (walletTags.size === 0) {
    console.error("[kira-workers:smart-wallet-refresh] GMGN returned no smart-money holders across sampled tokens, skipping this run");
    return;
  }

  const { data: existing } = await supabase.from("kira_smart_wallets").select("address");
  const existingAddresses = new Set((existing ?? []).map((r) => r.address));

  const walletsToScore = Array.from(walletTags.keys()).slice(0, MAX_WALLETS_SCORED);
  const rows: Array<{
    address: string;
    label: string;
    category: "whale" | "dex_trader" | "early_buyer" | "fund";
    win_rate_30d: number | null;
    last_computed_at: string;
    is_verified: boolean;
  }> = [];

  let rank = 1;
  for (const address of walletsToScore) {
    const tags = walletTags.get(address) ?? [];
    const pnl = await gmgnApi.getWalletPnl(address, "30d");
    rows.push({
      address,
      label: labelFor(rank),
      category: categorize(tags),
      win_rate_30d: pnl?.winRate ?? null,
      last_computed_at: new Date().toISOString(),
      is_verified: true,
    });
    rank++;
  }

  const { error } = await supabase.from("kira_smart_wallets").upsert(rows, { onConflict: "address" });

  if (error) {
    console.error("[kira-workers:smart-wallet-refresh] upsert failed:", error.message);
    return;
  }

  const newCount = rows.filter((r) => !existingAddresses.has(r.address)).length;

  if (newCount > 0) {
    await heliusSyncQueue.add("sync", {}, { jobId: "helius-sync-debounce", delay: 30_000 });
  }

  console.log(`[kira-workers:smart-wallet-refresh] Smart wallet refresh complete: ${rows.length} wallets upserted, ${newCount} new`);
}

export function startSmartWalletRefreshWorker(): Worker {
  return new Worker("kira-smart-wallet-refresh", processSmartWalletRefresh, {
    connection: bullConnection,
    concurrency: 1,
  });
}
