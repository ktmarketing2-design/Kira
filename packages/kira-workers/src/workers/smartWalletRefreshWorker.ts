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

// Priority order per Sprint 10: real identity first (twitter handle, then display name), then
// tag-derived role, then a plain numbered fallback. twitterUsername/name come flat off the GMGN
// holder record (verified live against a real token's `token holders` response) -- NOT nested
// under a maker_info object, which is how an earlier spec draft assumed this endpoint's shape;
// that maker_info wrapper only exists on the separate `track kol` trade-record endpoint.
// Tag-based fallback priority, most-specific/highest-signal first. Only "fresh_wallet",
// "smart_degen", and "bundler" were observed in the live holders response checked before this
// worker was first built -- "kol"/"whale"/"padre"/"axiom"/"fomo" were not present in that sample,
// so this priority order is implemented as specified but unverified against real data for those
// five; if GMGN never actually emits them, those branches are simply dead code, not fabricated.
function labelFor(rank: number, identity: { name: string | null; twitterUsername: string | null; tags: string[] }): string {
  if (identity.twitterUsername) return `@${identity.twitterUsername}`;
  if (identity.name) return identity.name;
  if (identity.tags.includes("kol")) return `KOL Trader #${rank}`;
  if (identity.tags.includes("whale")) return `Whale #${rank}`;
  if (identity.tags.includes("padre")) return `Padre Wallet #${rank}`; // GMGN's term for early buyers
  if (identity.tags.includes("axiom")) return `Axiom Trader #${rank}`; // Axiom terminal users = serious traders
  if (identity.tags.includes("smart_degen")) return `Smart Degen #${rank}`;
  return `Smart Trader #${rank}`;
}

async function processSmartWalletRefresh(): Promise<void> {
  const tokens = await loadMostCalledTokens(TOKEN_SAMPLE_SIZE);
  if (tokens.length === 0) {
    console.error("[kira-workers:smart-wallet-refresh] no KOL-called tokens found, skipping this run");
    return;
  }

  const walletIdentity = new Map<string, { name: string | null; twitterUsername: string | null; tags: string[] }>();
  for (const tokenAddress of tokens) {
    const holders = await gmgnApi.getSmartMoneyHolders(tokenAddress, HOLDERS_PER_TOKEN);
    for (const holder of holders) {
      if (!walletIdentity.has(holder.walletAddress)) {
        walletIdentity.set(holder.walletAddress, {
          name: holder.name,
          twitterUsername: holder.twitterUsername,
          tags: holder.tags,
        });
      }
    }
  }

  if (walletIdentity.size === 0) {
    console.error("[kira-workers:smart-wallet-refresh] GMGN returned no smart-money holders across sampled tokens, skipping this run");
    return;
  }

  const { data: existing } = await supabase.from("kira_smart_wallets").select("address");
  const existingAddresses = new Set((existing ?? []).map((r) => r.address));

  const walletsToScore = Array.from(walletIdentity.keys()).slice(0, MAX_WALLETS_SCORED);
  const rows: Array<{
    address: string;
    label: string;
    category: "whale" | "dex_trader" | "early_buyer" | "fund";
    win_rate_30d: number | null;
    last_computed_at: string;
    is_verified: boolean;
    tags: string[];
  }> = [];

  let rank = 1;
  for (const address of walletsToScore) {
    const identity = walletIdentity.get(address) ?? { name: null, twitterUsername: null, tags: [] };
    const pnl = await gmgnApi.getWalletPnl(address, "30d");
    rows.push({
      address,
      label: labelFor(rank, identity),
      category: categorize(identity.tags),
      win_rate_30d: pnl?.winRate ?? null,
      last_computed_at: new Date().toISOString(),
      is_verified: true,
      tags: identity.tags,
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
