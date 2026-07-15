import { Redis } from "ioredis";

const host = process.env.REDIS_HOST || "127.0.0.1";
const port = Number(process.env.REDIS_PORT || 6379);

// Shared client for direct app-level Redis ops (cache reads/writes, counters).
export const redis = new Redis({ host, port, maxRetriesPerRequest: null });

// Plain connection options for BullMQ constructs (Queue, QueueEvents, Worker), each of which
// opens its own dedicated connection internally. Do not pass the shared `redis` client above
// into BullMQ, QueueEvents needs a blocking subscriber connection of its own.
export const bullConnection = { host, port, maxRetriesPerRequest: null as null };
