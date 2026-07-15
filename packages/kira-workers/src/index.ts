// =============================================================================
// kira-workers
// =============================================================================
// BullMQ worker process: DD aggregation, volume scoring, cluster evaluation,
// alert dispatch, and Helius webhook address sync. Owned by Claude Code per the
// Kira Sprint 1-2 build spec (PRD Section 6 lists five workers for this sprint).
// =============================================================================

import { startDdWorker } from "./workers/ddWorker.js";
import { startVolumeWorker } from "./workers/volumeWorker.js";
import { startClusterWorker } from "./workers/clusterWorker.js";
import { startAlertDispatchWorker } from "./workers/alertDispatchWorker.js";
import { startHeliusSyncWorker } from "./workers/heliusSyncWorker.js";

const workers = [
  startDdWorker(),
  startVolumeWorker(),
  startClusterWorker(),
  startAlertDispatchWorker(),
  startHeliusSyncWorker(),
];

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    console.error(`[kira-workers] job ${job?.id} on queue ${worker.name} failed:`, err.message);
  });
}

console.log(`[kira-workers] ${workers.length} workers started: ${workers.map((w) => w.name).join(", ")}`);

async function shutdown(): Promise<void> {
  console.log("[kira-workers] shutting down");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
