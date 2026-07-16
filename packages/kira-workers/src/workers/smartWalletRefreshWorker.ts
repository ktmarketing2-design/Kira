import { Worker } from "bullmq";
import { gmgn, type SmartWalletCandidate } from "@ceronix/kira-shared";
import { bullConnection } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { heliusSyncQueue } from "../lib/queues.js";

const REFRESH_LIMIT = 50;

/** GMGN's tags describe trading-bot affiliation ('trojan', 'photon', 'axiom', 'padre') and
 * social status ('kol', 'top_followed') far more often than a wallet archetype, so 'whale' and
 * 'fund' are the only tags that map cleanly. Everything else defaults to 'dex_trader', which is
 * an accurate description of what a GMGN top-PnL wallet actually does regardless of which bot or
 * platform tag it carries. */
function categorize(tags: string[]): "whale" | "dex_trader" | "early_buyer" | "fund" {
  if (tags.includes("whale")) return "whale";
  if (tags.includes("fund")) return "fund";
  if (tags.includes("early_buyer")) return "early_buyer";
  return "dex_trader";
}

function labelFor(candidate: SmartWalletCandidate, rank: number): string {
  return candidate.twitterUsername ? `@${candidate.twitterUsername}` : `GMGN Top Trader #${rank}`;
}

async function processSmartWalletRefresh(): Promise<void> {
  const candidates = await gmgn.getTopWallets("7d", REFRESH_LIMIT);
  if (candidates.length === 0) {
    console.error("[kira-workers:smart-wallet-refresh] GMGN returned no wallets, skipping this run");
    return;
  }

  const { data: existing } = await supabase.from("kira_smart_wallets").select("address");
  const existingAddresses = new Set((existing ?? []).map((r) => r.address));

  const rows = candidates.map((c, i) => ({
    address: c.walletAddress,
    label: labelFor(c, i + 1),
    category: categorize(c.tags),
    win_rate_30d: c.winRate30d,
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
