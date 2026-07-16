import { Router } from "express";
import { z } from "zod";
import { jupiter } from "@ceronix/kira-shared";
import { supabase } from "../lib/supabase.js";
import { redis } from "../lib/redis.js";
import { clusterEvalQueue, signalScanQueue } from "../lib/queue.js";

// Native SOL and the two most common USD quote mints, never the "new token" side of a pool.
const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

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

// Second Helius webhook, registered and maintained by Antigravity per the Sprint 5 build spec
// (this endpoint only receives, it does not manage the webhook's program-id filter list). Watches
// Raydium AMM pool creation and Pump.fun bonding-curve creation so Signal Filter can evaluate
// brand-new tokens within minutes of existing. Reuses the same HELIUS_WEBHOOK_SECRET, Helius
// does not require a distinct secret per webhook and the PRD doesn't specify a second one.
//
// UNVERIFIED payload shape: this webhook has not been registered against live traffic yet (no
// HELIUS_SIGNAL_WEBHOOK_ID exists in env as of this writing), so the exact enhanced-transaction
// shape Helius sends for pool-creation / bonding-curve-creation events could not be confirmed the
// way every other client in this codebase was. Parses defensively against Helius's documented
// enhanced-transaction envelope (tokenTransfers with mint addresses) and picks the first mint
// that isn't a known quote token as the "new token" candidate. Re-verify against a real payload
// once the webhook is live and adjust if the shape differs.
const accountDataEntrySchema = z.object({
  account: z.string().optional(),
  tokenBalanceChanges: z
    .array(
      z.object({
        mint: z.string().optional(),
      }),
    )
    .optional(),
});

const programEventSchema = z.object({
  signature: z.string(),
  timestamp: z.number(),
  type: z.string().optional(),
  tokenTransfers: z.array(z.object({ mint: z.string().optional() })).optional(),
  accountData: z.array(accountDataEntrySchema).optional(),
});
const programEventBatchSchema = z.array(programEventSchema);

/**
 * Prefers tokenTransfers (present on most enhanced SWAP/pool-creation events), falls back to
 * accountData[].tokenBalanceChanges[].mint for event shapes where tokenTransfers is empty, e.g.
 * some bonding-curve creation events only surface the mint via a balance change on the new
 * token's account, not a transfer. Either way, skip known quote mints (SOL/USDC/USDT), the
 * candidate is whichever side of the pool is the actual new token.
 */
function extractCandidateMint(event: z.infer<typeof programEventSchema>): string | undefined {
  const fromTransfers = (event.tokenTransfers ?? [])
    .map((t) => t.mint)
    .find((mint): mint is string => !!mint && !QUOTE_MINTS.has(mint));
  if (fromTransfers) return fromTransfers;

  return (event.accountData ?? [])
    .flatMap((a) => a.tokenBalanceChanges ?? [])
    .map((c) => c.mint)
    .find((mint): mint is string => !!mint && !QUOTE_MINTS.has(mint));
}

router.post("/helius-programs", async (req, res) => {
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  const provided = req.headers["helius-auth-token"];

  if (!secret || provided !== secret) {
    res.status(401).json({ error: "Invalid webhook secret" });
    return;
  }

  const parsed = programEventBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error("[kira-api:webhooks] helius-programs payload validation failed:", parsed.error.message);
    res.status(200).json({ received: 0 });
    return;
  }

  let enqueued = 0;
  for (const event of parsed.data) {
    // Same dedup pattern as the swap webhook's helius:sig:{signature} (24h TTL there), but
    // signal:seen:{signature} at 48h here as specified, matching Tier 1's own signal:seen:
    // {tokenAddress} TTL in signalScanWorker. Different key prefix use (signature vs token
    // address) so there is no real collision risk despite the shared "signal:seen:" prefix,
    // this is webhook-retry protection, Tier 1's token-level dedup is a separate concern.
    const dedupeKey = `signal:seen:${event.signature}`;
    const isNew = await redis.set(dedupeKey, "1", "EX", 48 * 60 * 60, "NX");
    if (!isNew) continue;

    const candidate = extractCandidateMint(event);
    if (!candidate) continue;

    await signalScanQueue.add(
      "scan",
      { tokenAddress: candidate, firstSeenAt: event.timestamp * 1000 },
      { removeOnComplete: true, removeOnFail: true },
    );
    enqueued++;
  }

  res.status(200).json({ received: parsed.data.length, enqueued });
});

export default router;
