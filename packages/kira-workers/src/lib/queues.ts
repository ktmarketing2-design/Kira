import { Queue, QueueEvents } from "bullmq";
import { bullConnection } from "./redis.js";

// Producers used by workers to chain jobs (e.g. clusterWorker enqueueing kira:dd for a fresh
// snapshot before dispatching an alert).
export const ddQueue = new Queue("kira-dd", { connection: bullConnection });
export const volumeQueue = new Queue("kira-volume", { connection: bullConnection });
export const clusterEvalQueue = new Queue("kira-cluster-eval", { connection: bullConnection });
export const alertDispatchQueue = new Queue("kira-alert-dispatch", { connection: bullConnection });
export const heliusSyncQueue = new Queue("kira-helius-sync", { connection: bullConnection });

export const ddQueueEvents = new QueueEvents("kira-dd", { connection: bullConnection });
export const volumeQueueEvents = new QueueEvents("kira-volume", { connection: bullConnection });
