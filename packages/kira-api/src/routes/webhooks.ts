import { Router } from "express";
import { z } from "zod";
import { jupiter } from "@ceronix/kira-shared";
import { supabase } from "../lib/supabase.js";
import { redis } from "../lib/redis.js";
import { clusterEvalQueue } from "../lib/queue.js";

const router = Router();

const swapTransferSchema = z.object({
  mint: z.string().optional(),
  tokenAmount: z.number().optional(),
});

const heliusTransactionSchema = z.object({
  signature: z.string(),
  timestamp: z.number(),
  feePayer: z.string().optional(),
  events: z
    .object({
      swap: z
        .object({
          tokenInputs: z.array(swapTransferSchema).optional(),
          tokenOutputs: z.array(swapTransferSchema).optional(),
        })
        .optional(),
    })
    .optional(),
});

const heliusBatchSchema = z.array(heliusTransactionSchema);

router.post("/helius", async (req, res) => {
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  const provided = req.headers["helius-auth-token"];

  if (!secret || provided !== secret) {
    res.status(401).json({ error: "Invalid webhook secret" });
    return;
  }

  const parsed = heliusBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    // Ack anyway, malformed payloads should not cause Helius to keep retrying forever.
    console.error("[kira-api:webhooks] payload validation failed:", parsed.error.message);
    res.status(200).json({ received: 0 });
    return;
  }

  let processed = 0;
  for (const tx of parsed.data) {
    try {
      const wasProcessed = await handleSwapTransaction(tx);
      if (wasProcessed) processed++;
    } catch (err) {
      console.error(
        "[kira-api:webhooks] failed processing signature",
        tx.signature,
        err instanceof Error ? err.message : err,
      );
    }
  }

  res.status(200).json({ received: processed });
});

async function handleSwapTransaction(
  tx: z.infer<typeof heliusTransactionSchema>,
): Promise<boolean> {
  const dedupeKey = `helius:sig:${tx.signature}`;
  const isNew = await redis.set(dedupeKey, "1", "EX", 24 * 60 * 60, "NX");
  if (!isNew) return false; // already processed this signature (Helius retry)

  const swap = tx.events?.swap;
  const wallet = tx.feePayer;
  if (!swap || !wallet) return false;

  const output = swap.tokenOutputs?.[0];
  const input = swap.tokenInputs?.[0];

  // Wallet received a non-SOL token -> buy. Wallet sent a non-SOL token -> sell.
  const side: "buy" | "sell" | null = output?.mint ? "buy" : input?.mint ? "sell" : null;
  const tokenAddress = side === "buy" ? output?.mint : input?.mint;
  const tokenAmount = side === "buy" ? output?.tokenAmount : input?.tokenAmount;

  if (!side || !tokenAddress || tokenAmount == null) return false;

  const price = await jupiter.getPrice(tokenAddress);
  const usdValue = price != null ? price * tokenAmount : null;
  const blockTime = new Date(tx.timestamp * 1000).toISOString();

  const { error } = await supabase.from("kira_wallet_events").insert({
    signature: tx.signature,
    wallet_address: wallet,
    token_address: tokenAddress,
    side,
    token_amount: tokenAmount,
    usd_value: usdValue,
    block_time: blockTime,
    raw: tx,
  });

  if (error) {
    if (error.code === "23505") return false; // unique signature race, already inserted
    throw new Error(`insert kira_wallet_events failed: ${error.message}`);
  }

  await clusterEvalQueue.add("cluster-eval", {
    walletAddress: wallet,
    tokenAddress,
    side,
    usdValue: usdValue ?? 0,
    timestamp: tx.timestamp * 1000,
  });

  return true;
}

export default router;
