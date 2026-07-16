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
import { pnlDigestQueue, walletPerformanceQueue } from "./lib/queues.js";

const workers = [
  startDdWorker(),
  startVolumeWorker(),
  startClusterWorker(),
  startAlertDispatchWorker(),
  startHeliusSyncWorker(),
  startSignalScanWorker(),
  startPnlDigestWorker(),
  startWalletPerformanceWorker(),
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

console.log(`[kira-workers] ${workers.length} workers started: ${workers.map((w) => w.name).join(", ")}`);
console.log("[kira-workers] kira-pnl-digest repeatable job registered for 06:00 UTC daily");
console.log("[kira-workers] kira-wallet-performance repeatable job registered for 02:00 UTC daily");

async function shutdown(): Promise<void> {
  console.log("[kira-workers] shutting down");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
