import { Queue, QueueEvents } from "bullmq";
import { bullConnection } from "./redis.js";

// Producers used by workers to chain jobs (e.g. clusterWorker enqueueing kira:dd for a fresh
// snapshot before dispatching an alert).
export const ddQueue = new Queue("kira-dd", { connection: bullConnection });
export const volumeQueue = new Queue("kira-volume", { connection: bullConnection });
export const clusterEvalQueue = new Queue("kira-cluster-eval", { connection: bullConnection });
export const alertDispatchQueue = new Queue("kira-alert-dispatch", { connection: bullConnection });
export const heliusSyncQueue = new Queue("kira-helius-sync", { connection: bullConnection });
export const signalScanQueue = new Queue("kira-signal-scan", { connection: bullConnection });
export const pnlDigestQueue = new Queue("kira-pnl-digest", { connection: bullConnection });
export const walletPerformanceQueue = new Queue("kira-wallet-performance", { connection: bullConnection });
export const kolPriceCheckQueue = new Queue("kira-kol-price-check", { connection: bullConnection });
export const smartMoneyScanQueue = new Queue("kira-smart-money-scan", { connection: bullConnection });
export const smartMoneyDigestQueue = new Queue("kira-smart-money-digest", { connection: bullConnection });

export const ddQueueEvents = new QueueEvents("kira-dd", { connection: bullConnection });
export const volumeQueueEvents = new QueueEvents("kira-volume", { connection: bullConnection });
