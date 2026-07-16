import { Worker } from "bullmq";
import { birdeye, type BirdeyeWallet } from "@ceronix/kira-shared";
import { bullConnection } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { heliusSyncQueue } from "../lib/queues.js";

const REFRESH_LIMIT = 50;

/** Birdeye's /trader/gainers-losers response has no tags field at all (verified live), unlike
 * the GMGN endpoint this replaced. There is nothing to categorize from, so every wallet lands in
 * 'dex_trader' — an accurate description of what a top-PnL trader on this leaderboard actually
 * does, not a guess dressed up as one. */
function categorize(): "whale" | "dex_trader" | "early_buyer" | "fund" {
  return "dex_trader";
}

function labelFor(rank: number): string {
  return `Birdeye Top Trader #${rank}`;
}

async function processSmartWalletRefresh(): Promise<void> {
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) {
    console.error("[kira-workers:smart-wallet-refresh] missing BIRDEYE_API_KEY, skipping this run");
    return;
  }

  const candidates: BirdeyeWallet[] = await birdeye.getTopWallets(apiKey, REFRESH_LIMIT);
  if (candidates.length === 0) {
    console.error("[kira-workers:smart-wallet-refresh] Birdeye returned no wallets, skipping this run");
    return;
  }

  const { data: existing } = await supabase.from("kira_smart_wallets").select("address");
  const existingAddresses = new Set((existing ?? []).map((r) => r.address));

  const rows = candidates.map((c, i) => ({
    address: c.wallet_address,
    label: labelFor(i + 1),
    category: categorize(),
    win_rate_30d: c.winrate ?? null,
    last_computed_at: new Date().toISOString(),
    is_verified: true,
  }));

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
