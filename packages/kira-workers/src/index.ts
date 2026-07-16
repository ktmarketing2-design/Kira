// =============================================================================
// kira-workers
// =============================================================================
// BullMQ worker process: DD aggregation, volume scoring, cluster evaluation,
// alert dispatch, Helius webhook address sync, Signal Filter scanning, and the
// daily PnL digest cron. Owned by Claude Code per the Kira Sprint 1-2/5 build specs.
// =============================================================================

import { startDdWorker } from "./workers/ddWorker.js";
import { startVolumeWorker } from "./workers/volumeWorker.js";
import { startClusterWorker } from "./workers/clusterWorker.js";
import { startAlertDispatchWorker } from "./workers/alertDispatchWorker.js";
import { startHeliusSyncWorker } from "./workers/heliusSyncWorker.js";
import { startSignalScanWorker } from "./workers/signalScanWorker.js";
import { startPnlDigestWorker } from "./workers/pnlDigestWorker.js";
import { startWalletPerformanceWorker } from "./workers/walletPerformanceWorker.js";
import { startKolPriceCheckWorker } from "./workers/kolPriceCheckWorker.js";
import { startKolIngest } from "./workers/kolIngestWorker.js";
import { startSmartMoneyScanWorker } from "./workers/smartMoneyScanWorker.js";
import { startSmartMoneyDigestWorker } from "./workers/smartMoneyDigestWorker.js";
import { startSmartWalletRefreshWorker } from "./workers/smartWalletRefreshWorker.js";
import { pnlDigestQueue, walletPerformanceQueue, smartMoneyDigestQueue, smartWalletRefreshQueue } from "./lib/queues.js";

const workers = [
  startDdWorker(),
  startVolumeWorker(),
  startClusterWorker(),
  startAlertDispatchWorker(),
  startHeliusSyncWorker(),
  startSignalScanWorker(),
  startPnlDigestWorker(),
  startWalletPerformanceWorker(),
  startKolPriceCheckWorker(),
  startSmartMoneyScanWorker(),
  startSmartMoneyDigestWorker(),
  startSmartWalletRefreshWorker(),
];

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    console.error(`[kira-workers] job ${job?.id} on queue ${worker.name} failed:`, err.message);
  });
}

// Idempotent: BullMQ keys repeatable jobs by their repeat options, calling add() again on every
// process boot with the same pattern/jobId does not create duplicate schedules.
await pnlDigestQueue.add(
  "digest",
  {},
  { repeat: { pattern: "0 6 * * *", tz: "UTC" }, jobId: "daily-pnl-digest" },
);

await walletPerformanceQueue.add(
  "score",
  {},
  { repeat: { pattern: "0 2 * * *", tz: "UTC" }, jobId: "nightly-wallet-performance" },
);

await smartMoneyDigestQueue.add(
  "digest",
  {},
  { repeat: { pattern: "0 7 * * *", tz: "UTC" }, jobId: "daily-smart-money-digest" },
);

await smartWalletRefreshQueue.add(
  "refresh",
  {},
  { repeat: { pattern: "0 3 * * *", tz: "UTC" }, jobId: "nightly-smart-wallet-refresh" },
);
// Also run once immediately on startup (not just the 03:00 UTC cron) so the table populates
// right away rather than waiting for the first scheduled run, distinct jobId so it does not
// collide with or reset the repeatable schedule above.
await smartWalletRefreshQueue.add("refresh", {}, { jobId: "startup-smart-wallet-refresh" });

console.log(`[kira-workers] ${workers.length} workers started: ${workers.map((w) => w.name).join(", ")}`);
console.log("[kira-workers] kira-pnl-digest repeatable job registered for 06:00 UTC daily");
console.log("[kira-workers] kira-wallet-performance repeatable job registered for 02:00 UTC daily");
console.log("[kira-workers] kira-smart-money-digest repeatable job registered for 07:00 UTC daily");
console.log("[kira-workers] kira-smart-wallet-refresh repeatable job registered for 03:00 UTC daily (plus one immediate run on startup)");

// Not a BullMQ worker, a persistent GramJS client listening for new Telegram messages. Runs
// independently of the job-queue workers above; failures here (bad session, network issue) are
// logged and swallowed inside startKolIngest itself rather than crashing the whole process, KOL
// ingestion being unavailable should not take down every other worker.
void startKolIngest();

async function shutdown(): Promise<void> {
  console.log("[kira-workers] shutting down");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
