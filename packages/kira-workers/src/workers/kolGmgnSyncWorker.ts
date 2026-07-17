import { Worker } from "bullmq";
import { gmgnApi, jupiter } from "@ceronix/kira-shared";
import { bullConnection, redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";

const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

/** Redis-based dedup keyed by transaction hash, not the (source_id, message_id) unique
 * constraint kolIngestWorker.ts relies on: every GMGN-sourced row has source_id = null, and
 * Postgres treats NULL as distinct from NULL in a unique index, so that constraint would not
 * actually stop duplicate inserts across repeated 5-minute runs. transaction_hash is a real,
 * permanently unique on-chain identifier, safe to use directly as the dedup key. */
async function processKolGmgnSync(): Promise<void> {
  const trades = await gmgnApi.getKolTrades(100);
  if (trades.length === 0) return;

  let inserted = 0;

  for (const trade of trades) {
    if (trade.side !== "buy") continue; // "call" = a KOL buying, not selling

    const dedupeKey = `gmgnkol:seen:${trade.transactionHash}`;
    const isNew = await redis.set(dedupeKey, "1", "EX", DEDUPE_TTL_SECONDS, "NX");
    if (!isNew) continue;

    const priceAtCall = await jupiter.getPrice(trade.tokenAddress);

    const { error } = await supabase.from("kira_kol_calls").insert({
      source_id: null,
      source_user_id: null,
      source_type: "gmgn_kol",
      message_id: trade.transactionHash,
      token_address: trade.tokenAddress,
      called_at: new Date(trade.timestamp * 1000).toISOString(),
      price_at_call: priceAtCall,
      raw_text: trade.twitterUsername ? `GMGN KOL trade by @${trade.twitterUsername}` : "GMGN KOL trade",
    });

    if (error) {
      console.error("[kira-workers:kol-gmgn-sync] insert failed:", error.message);
      continue;
    }
    inserted++;
  }

  if (inserted > 0) {
    console.log(`[kira-workers:kol-gmgn-sync] ${inserted} new GMGN KOL calls recorded`);
  }
}

export function startKolGmgnSyncWorker(): Worker {
  return new Worker("kira-kol-gmgn-sync", processKolGmgnSync, { connection: bullConnection, concurrency: 1 });
}
