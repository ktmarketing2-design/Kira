import { Worker } from "bullmq";
import { gmgnApi } from "@ceronix/kira-shared";
import { bullConnection } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";

/** Same shape as smartMoneyScanWorker.ts's webhook-driven path (Sprint 6): only wallets that are
 * actually in Kira's own kira_smart_wallets table produce a row, not just whatever GMGN itself
 * tags as smart money in maker_info.tags -- those are two different populations, and this
 * deliberately trusts Kira's own vetted list rather than GMGN's. kira_smart_money_events.signature
 * has its own unique constraint, so a duplicate insert across repeated 5-minute runs fails with
 * 23505 and is caught rather than needing a separate Redis dedup layer. */
async function processSmartMoneyGmgnSync(): Promise<void> {
  const trades = await gmgnApi.getSmartMoneyTrades(100);
  if (trades.length === 0) return;

  const wallets = Array.from(new Set(trades.map((t) => t.wallet)));
  const { data: knownWallets, error: lookupError } = await supabase
    .from("kira_smart_wallets")
    .select("address")
    .in("address", wallets);

  if (lookupError) {
    console.error("[kira-workers:smartmoney-gmgn-sync] lookup failed:", lookupError.message);
    return;
  }

  const knownSet = new Set((knownWallets ?? []).map((w) => w.address));
  if (knownSet.size === 0) return;

  let inserted = 0;

  for (const trade of trades) {
    if (!knownSet.has(trade.wallet)) continue;

    const { error } = await supabase.from("kira_smart_money_events").insert({
      wallet_address: trade.wallet,
      token_address: trade.tokenAddress,
      side: trade.side,
      usd_value: trade.usdValue,
      block_time: new Date(trade.timestamp * 1000).toISOString(),
      signature: trade.transactionHash,
    });

    if (error) {
      if (error.code === "23505") continue; // already recorded, expected on repeated runs
      console.error("[kira-workers:smartmoney-gmgn-sync] event insert failed:", error.message);
      continue;
    }
    inserted++;
  }

  if (inserted > 0) {
    console.log(`[kira-workers:smartmoney-gmgn-sync] ${inserted} new smart money events recorded`);
  }
}

export function startSmartMoneyGmgnSyncWorker(): Worker {
  return new Worker("kira-smartmoney-gmgn-sync", processSmartMoneyGmgnSync, {
    connection: bullConnection,
    concurrency: 1,
  });
}
