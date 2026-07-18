import { Queue, QueueEvents } from "bullmq";
import { bullConnection } from "./redis.js";

export const ddQueue = new Queue("kira-dd", { connection: bullConnection });
export const volumeQueue = new Queue("kira-volume", { connection: bullConnection });
export const clusterEvalQueue = new Queue("kira-cluster-eval", { connection: bullConnection });
export const alertDispatchQueue = new Queue("kira-alert-dispatch", { connection: bullConnection });
export const heliusSyncQueue = new Queue("kira-helius-sync", { connection: bullConnection });
export const signalScanQueue = new Queue("kira-signal-scan", { connection: bullConnection });
export const pnlDigestQueue = new Queue("kira-pnl-digest", { connection: bullConnection });
export const walletPerformanceQueue = new Queue("kira-wallet-performance", { connection: bullConnection });
export const smartMoneyScanQueue = new Queue("kira-smart-money-scan", { connection: bullConnection });
export const smartWalletRefreshQueue = new Queue("kira-smart-wallet-refresh", { connection: bullConnection });

// Used by routes that enqueue a job and wait for its result (DD card, volume score).
export const ddQueueEvents = new QueueEvents("kira-dd", { connection: bullConnection });
export const volumeQueueEvents = new QueueEvents("kira-volume", { connection: bullConnection });
