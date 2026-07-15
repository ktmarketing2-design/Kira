import { Router } from "express";
import { redis } from "../lib/redis.js";
import { ddQueue, ddQueueEvents, volumeQueue, volumeQueueEvents } from "../lib/queue.js";
import { requireDdQuota } from "../middleware/tier.js";

const router = Router();

const DD_JOB_TIMEOUT_MS = 15_000;
const VOLUME_JOB_TIMEOUT_MS = 15_000;

router.get("/:address/dd", requireDdQuota, async (req, res) => {
  const { address } = req.params;

  try {
    const cached = await redis.get(`ddcard:${address}`);
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }

    const job = await ddQueue.add(
      "dd",
      { tokenAddress: address, requestedBy: req.user!.id },
      { removeOnComplete: true, removeOnFail: true },
    );
    const result = await job.waitUntilFinished(ddQueueEvents, DD_JOB_TIMEOUT_MS);
    res.json(result);
  } catch (err) {
    console.error("[kira-api:token] dd failed:", err instanceof Error ? err.message : err);
    res.status(504).json({ error: "Deep Dive generation timed out or failed" });
  }
});

router.get("/:address/volume", async (req, res) => {
  const { address } = req.params;

  try {
    const cached = await redis.get(`volscore:${address}`);
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }

    const job = await volumeQueue.add(
      "volume",
      { tokenAddress: address },
      { removeOnComplete: true, removeOnFail: true },
    );
    const result = await job.waitUntilFinished(volumeQueueEvents, VOLUME_JOB_TIMEOUT_MS);
    res.json(result);
  } catch (err) {
    console.error("[kira-api:token] volume failed:", err instanceof Error ? err.message : err);
    res.status(504).json({ error: "Volume score generation timed out or failed" });
  }
});

export default router;
