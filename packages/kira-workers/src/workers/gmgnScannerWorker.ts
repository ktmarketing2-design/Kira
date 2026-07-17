import { Worker } from "bullmq";
import { gmgnApi } from "@ceronix/kira-shared";
import { bullConnection, redis } from "../lib/redis.js";
import { signalScanQueue, gmgnScannerQueue } from "../lib/queues.js";

const DEDUPE_TTL_SECONDS = 24 * 60 * 60;
const SIGNAL_ALERT_DEDUPE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Field names and endpoint behavior here are taken directly from Antigravity's live-verified
 * report (kira-sprint7-worker-code.md), not re-tested independently per instruction. Two things
 * from that report worth restating: signal types 14/15/16 return HTTP 400 (not supported), so
 * only signal-type 12 is polled, not the originally-planned type 16; and near_completion's
 * response uses a "pump" array key, not "near_completion" — kept exactly as reported.
 */

interface TrenchToken {
  address?: string;
}

async function dedupeAndEnqueue(tokenAddress: string | undefined): Promise<boolean> {
  if (!tokenAddress) return false;
  const dedupeKey = `gmgn:seen:${tokenAddress}`;
  const isNew = await redis.set(dedupeKey, "1", "EX", DEDUPE_TTL_SECONDS, "NX");
  if (!isNew) return false;

  // Same job data contract every other kira-signal-scan producer uses (webhooks.ts,
  // signalScanWorker's own callers) -- { tokenAddress, firstSeenAt }, job name "scan". The
  // worker itself does its own three-tier RugCheck/DD pipeline from just the address, it does
  // not read any GMGN-specific enrichment fields off the job payload.
  await signalScanQueue.add(
    "scan",
    { tokenAddress, firstSeenAt: Date.now() },
    { removeOnComplete: true, removeOnFail: true },
  );
  return true;
}

async function processTrenchBucket(
  type: gmgnApi.TrenchType,
  bucketKey: string,
  label: string,
): Promise<void> {
  const json = await gmgnApi.getTrenches(type);
  const list = (json[bucketKey] as TrenchToken[] | undefined) ?? [];

  let enqueued = 0;
  for (const token of list) {
    if (await dedupeAndEnqueue(token.address)) enqueued++;
  }
  if (enqueued > 0) {
    console.log(`[kira-gmgn-scanner] ${label}: ${enqueued} new token(s) enqueued for signal scan`);
  }
}

interface SmartDegenSignal {
  token_address?: string;
  trigger_at?: number;
  trigger_mc?: number;
  data?: { symbol?: string };
}

async function processSmartDegenSignals(): Promise<void> {
  const signals = await gmgnApi.getSmartDegenSignals();

  let enqueued = 0;
  let alertWorthy = 0;
  for (const signal of signals as SmartDegenSignal[]) {
    const tokenAddress = signal.token_address;
    if (!tokenAddress) continue;

    if (await dedupeAndEnqueue(tokenAddress)) enqueued++;

    // Deliberately a separate dedupe namespace from the enqueue check above: a token already
    // discovered via trenches earlier still deserves its own "smart money cluster-buy signal
    // fired" notice, that is a distinct, later, alert-worthy event, not a duplicate discovery.
    //
    // NOT writing to kira_alerts: same schema gap found and documented in Part 2's
    // gmgnWebSocketWorker.ts. kira_alerts.user_id is NOT NULL (it is a per-user notification
    // record), and this signal is an aggregate, token-level event with no specific user or
    // wallet attached -- there is nothing to fan this out to without either a real per-user
    // watchlist/roster match (Signal Filters are the closest concept that exists today, but
    // matching against those is real, unbuilt logic, not a one-line insert) or a migration
    // adding a broadcast-style alert type. Rather than guess at either, this only logs and
    // dedupes the observation; a real "direct alert" needs a product decision, not a field
    // mapping.
    const alertDedupeKey = `gmgn:smsignal:seen:${tokenAddress}`;
    const isNewSignal = await redis.set(alertDedupeKey, "1", "EX", SIGNAL_ALERT_DEDUPE_TTL_SECONDS, "NX");
    if (isNewSignal) {
      alertWorthy++;
      console.log(
        `[kira-gmgn-scanner] smart money cluster buy signal for ${signal.data?.symbol ?? tokenAddress} ` +
          `(trigger_mc=${signal.trigger_mc ?? "unknown"}) -- not persisted as a kira_alerts row, see comment`,
      );
    }
  }
  if (enqueued > 0 || alertWorthy > 0) {
    console.log(
      `[kira-gmgn-scanner] smart_degen signal: ${enqueued} new token(s) enqueued, ${alertWorthy} new signal(s) observed`,
    );
  }
}

async function runScanCycle(): Promise<void> {
  await processTrenchBucket("new_creation", "new_creation", "new_creation");
  await processTrenchBucket("near_completion", "pump", "near_completion");
  await processTrenchBucket("completed", "completed", "graduated");
  await processSmartDegenSignals();
}

export function startGmgnScanner(): Worker {
  return new Worker(
    "kira-gmgn-scanner",
    async () => {
      await runScanCycle();
    },
    { connection: bullConnection, concurrency: 1 },
  );
}

export async function registerGmgnScannerCron(): Promise<void> {
  await gmgnScannerQueue.add(
    "scan",
    {},
    { repeat: { every: 60_000 }, jobId: "gmgn-scanner-60s", removeOnComplete: true, removeOnFail: true },
  );
  // Also run once immediately on startup, same removeOnComplete/removeOnFail reasoning as
  // smartWalletRefreshWorker's startup job: a fixed jobId with no removal would only ever fire
  // once across the process's whole lifetime (BullMQ silently no-ops re-adding a job whose ID
  // already has a completed/failed record).
  await gmgnScannerQueue.add(
    "scan",
    {},
    { jobId: "gmgn-scanner-startup", removeOnComplete: true, removeOnFail: true },
  );
}
