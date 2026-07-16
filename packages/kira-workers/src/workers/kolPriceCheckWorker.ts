import { Worker, type Job } from "bullmq";
import { jupiter } from "@ceronix/kira-shared";
import { bullConnection } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";

type CheckType = "1h" | "4h" | "24h" | "7d";

interface PriceCheckJobData {
  callId: string;
  tokenAddress: string;
  checkType: CheckType;
}

const COLUMN_BY_CHECK_TYPE: Record<CheckType, string> = {
  "1h": "price_1h",
  "4h": "price_4h",
  "24h": "price_24h",
  "7d": "price_7d",
};

/** Fills in one forward-price column on a kira_kol_calls row. Jupiter has no historical price
 * API (documented elsewhere in this codebase, e.g. pnlDigestWorker.ts), but this job is
 * scheduled to fire near-exactly at the target offset (delayed BullMQ job), so the live price at
 * fire time is the intended reading, not a stand-in for a historical one. */
async function processPriceCheck(job: Job<PriceCheckJobData>): Promise<void> {
  const { callId, tokenAddress, checkType } = job.data;

  const price = await jupiter.getPrice(tokenAddress);
  if (price == null) {
    console.error(`[kira-workers:kol-price-check] no price available for ${tokenAddress} at ${checkType}`);
    return;
  }

  const { error } = await supabase
    .from("kira_kol_calls")
    .update({ [COLUMN_BY_CHECK_TYPE[checkType]]: price })
    .eq("id", callId);

  if (error) {
    console.error("[kira-workers:kol-price-check] update failed:", error.message);
  }
}

export function startKolPriceCheckWorker(): Worker<PriceCheckJobData, void> {
  return new Worker<PriceCheckJobData, void>("kira-kol-price-check", processPriceCheck, {
    connection: bullConnection,
    concurrency: 5,
  });
}
