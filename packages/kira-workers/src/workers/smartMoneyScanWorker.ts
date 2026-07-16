import { Worker, type Job } from "bullmq";
import { bullConnection } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";

interface SmartMoneyScanJobData {
  walletAddress: string;
  tokenAddress: string;
  side: "buy" | "sell";
  usdValue: number;
  blockTime: string;
  signature: string;
}

/** Every swap from the webhook gets a job here (cheap to enqueue unconditionally), the actual
 * kira_smart_wallets membership check happens here rather than on the webhook's hot path. Most
 * jobs will find no match and no-op — that's expected, only house-list wallets produce a row. */
async function processSmartMoneyScan(job: Job<SmartMoneyScanJobData>): Promise<void> {
  const { walletAddress, tokenAddress, side, usdValue, blockTime, signature } = job.data;

  const { data: smartWallet, error: lookupError } = await supabase
    .from("kira_smart_wallets")
    .select("address")
    .eq("address", walletAddress)
    .maybeSingle();

  if (lookupError) {
    console.error("[kira-workers:smart-money-scan] lookup failed:", lookupError.message);
    return;
  }
  if (!smartWallet) return; // not a tracked smart wallet, expected for almost every swap

  const { error: insertError } = await supabase.from("kira_smart_money_events").insert({
    wallet_address: walletAddress,
    token_address: tokenAddress,
    side,
    usd_value: usdValue,
    block_time: blockTime,
    signature,
  });

  if (insertError) {
    if (insertError.code === "23505") return; // unique signature race, already inserted
    console.error("[kira-workers:smart-money-scan] event insert failed:", insertError.message);
  }
}

export function startSmartMoneyScanWorker(): Worker<SmartMoneyScanJobData, void> {
  return new Worker<SmartMoneyScanJobData, void>("kira-smart-money-scan", processSmartMoneyScan, {
    connection: bullConnection,
    concurrency: 10,
  });
}
